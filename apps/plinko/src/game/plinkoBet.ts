import { API_AMOUNT_MULTIPLIER, SMALLEST_FIAT_UNIT } from 'constants-shared/bet';
import { stateBet, stateConfig } from 'state-shared';

import { BALL_PER_DROP_TIERS, BET_PER_BALL_PRESETS } from '../game-logic/constants';
import config from './config';
import { plinkoActiveBetMode } from './plinkoBetMode';
import { stateGame } from './stateGame.svelte';

/** Largest balls-per-drop tier (used for the max-bet / max-win limit display). */
const MAX_BALLS_PER_DROP = Math.max(...BALL_PER_DROP_TIERS);

/**
 * Headline payout-multiplier cap (relative to the per-ball play amount) — mirror of math `wincap`.
 * The cap is PER-TIER (200/250/300/400); the displayed "max payout" is the GAME maximum, so use the
 * highest tier cap (fiftydrop, 400×) — the largest win any tier can produce.
 */
const PLINKO_WINCAP = Math.max(
	...Object.values(config.betModes).map((m) => m.max_win ?? 0),
	0,
);

/** Active currency's RGS `betLevels` (the only RGS-valid amounts), ascending and positive. */
function sortedRgsGrid(): number[] {
	return (stateConfig.betAmountOptions ?? [])
		.filter((level) => Number.isFinite(level) && level > 0)
		.slice()
		.sort((a, b) => a - b);
}

/** Nearest value in `grid` to `value` (grid must be non-empty). RGS rejects off-grid amounts. */
function snapValueToGrid(value: number, grid: number[]): number {
	let best = grid[0];
	let bestDiff = Math.abs(best - value);
	for (const level of grid) {
		const diff = Math.abs(level - value);
		if (diff < bestDiff) {
			best = level;
			bestDiff = diff;
		}
	}
	return best;
}

/** Balls in one paid drop (UI "balls per drop"). */
export function plinkoBallsPerDrop(): number {
	return Math.max(1, Math.floor(stateGame.ballPerDrop || 1));
}

/** Stake per ball — stored in `stateBet.betAmount` (UI "bet per ball"). */
export function plinkoStakePerBall(): number {
	return Math.max(0, Number(stateBet.betAmount) || 0);
}

/** Published cost of the active bet mode (balls per tier, or 0 for a free feature-trigger mode). */
export function plinkoBetModeCost(): number {
	const mode = plinkoActiveBetMode();
	const modeConfig = config.betModes[mode as keyof typeof config.betModes];
	return modeConfig?.cost ?? plinkoBallsPerDrop();
}

/**
 * Selectable per-ball stakes. The canonical grid is `BET_PER_BALL_PRESETS` in USD
 * (0.01, 0.10, 0.20, 1.00, 5.00, 10.00, 20.00, 50.00).
 *
 * For a live RGS session, presets are scaled into the player's currency and snapped onto the
 * authoritative `betLevels` grid, so every offered amount is one the RGS accepts (off-grid amounts
 * are rejected with `ERR_VAL – invalid amount`). The scale factor is the currency's smallest bet
 * level relative to the smallest USD preset (`SMALLEST_FIAT_UNIT`), so USD (factor 1) reproduces
 * `[0.01 … 50]` exactly while e.g. IDR/VND map onto their large-denomination grid. With no RGS
 * session (local dev) the raw presets are used.
 */
export function plinkoStakePerBallOptions(): number[] {
	const grid = sortedRgsGrid();
	if (!grid.length) {
		return BET_PER_BALL_PRESETS.filter((v) => v >= config.minBet && v <= config.maxBet);
	}

	// Currency scale: how large the smallest valid bet is vs the smallest USD preset (0.01).
	// USD grids start at 0.01 → factor 1 → presets pass through unchanged after snapping.
	const factor = grid[0] / SMALLEST_FIAT_UNIT;

	const snapped = BET_PER_BALL_PRESETS.map((preset) => snapValueToGrid(preset * factor, grid));
	// Distinct ascending levels — presets can collapse onto the same level on a coarse grid.
	return Array.from(new Set(snapped)).sort((a, b) => a - b);
}

/** Snap a per-ball stake to the nearest selectable level (RGS rejects off-grid amounts). */
export function snapStakeToBetLevels(stake: number): number {
	const opts = plinkoStakePerBallOptions();
	if (!opts.length) return Math.max(0, stake);
	return snapValueToGrid(Math.max(0, stake), opts);
}

/**
 * Base bet level for `/wallet/play` `amount` — must be a valid `betLevels` entry.
 * RGS debits `amount × mode cost` (e.g. tendrop cost 10 → $1 play amount debits $10).
 *
 * Final guard: snap to the authoritative RGS grid so a stale/off-grid stake (e.g. left over after
 * a feature round on a non-USD currency) can never be sent and rejected as `ERR_VAL`.
 */
export function plinkoPlayAmount(): number {
	const snapped = snapStakeToBetLevels(plinkoStakePerBall());
	const grid = sortedRgsGrid();
	return grid.length ? snapValueToGrid(snapped, grid) : snapped;
}

/** Sync stake to betLevels before play; returns per-ball amount for `/wallet/play`. */
export function syncPlinkoPlayAmountFromBetLevels(): number {
	const snapped = plinkoPlayAmount();
	if (snapped > 0 && snapped !== plinkoStakePerBall()) {
		stateBet.betAmount = snapped;
	}
	return snapped;
}

/** Integer API units for `/wallet/play` `amount`. */
export function plinkoPlayAmountApiUnits(): number {
	return Math.round(syncPlinkoPlayAmountFromBetLevels() * API_AMOUNT_MULTIPLIER);
}

/** Total debit for one drop (HUD display + balance checks). */
export function plinkoWagerAmount(): number {
	return plinkoPlayAmount() * plinkoBetModeCost();
}

export function canAffordPlinkoWager(): boolean {
	const wager = plinkoWagerAmount();
	// A free feature-trigger bet has wager 0 — still affordable.
	return wager >= 0 && wager <= stateBet.balanceAmount;
}

/** Max affordable per-ball stake for the current tier and balance. */
export function maxAffordableStakePerBall(): number {
	const cost = plinkoBetModeCost();
	if (cost <= 0) return 0;
	const balance = Math.max(0, stateBet.balanceAmount);
	const opts = plinkoStakePerBallOptions().filter((stake) => stake * cost <= balance);
	return opts.at(-1) ?? 0;
}

/**
 * Displayed bet/win limits in the player's currency, derived from the live per-ball grid so they
 * stay accurate across currencies (USD or RGS-scaled). `min`/`max` are TOTAL wagers (per-ball ×
 * balls-per-drop range); `maxWin` is the RGS cap = `wincap` × the largest per-ball stake.
 */
export function plinkoBetLimits(): { min: number; max: number; maxWin: number } {
	const opts = plinkoStakePerBallOptions();
	const minPerBall = opts[0] ?? config.minBet;
	const maxPerBall = opts.at(-1) ?? config.maxBet;
	return {
		min: minPerBall, // smallest total wager = smallest per-ball × 1 ball
		max: maxPerBall * MAX_BALLS_PER_DROP,
		maxWin: maxPerBall * PLINKO_WINCAP,
	};
}
