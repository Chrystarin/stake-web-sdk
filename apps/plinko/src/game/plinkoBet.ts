import { API_AMOUNT_MULTIPLIER } from 'constants-shared/bet';
import { stateBet, stateConfig } from 'state-shared';

import { BET_PER_BALL_PRESETS } from '../game-logic/constants';
import config from './config';
import { buyBonusModeName, plinkoActiveBetMode } from './plinkoBetMode';
import { stateGame } from './stateGame.svelte';

/** Max bet-per-ball options shown in the selector (mirrors the local `BET_PER_BALL_PRESETS` count). */
const MAX_STAKE_PER_BALL_OPTIONS = BET_PER_BALL_PRESETS.length;

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

/**
 * Lower per-ball stake bound. Prefers the RGS `minBet` from `/wallet/authenticate` (or, absent an
 * explicit value, the smallest `betLevels` entry); falls back to the local dev floor with no session.
 */
export function plinkoMinStakePerBall(): number {
	return stateConfig.minBet || sortedRgsGrid()[0] || config.minBet;
}

/**
 * Upper per-ball stake bound. Prefers the RGS `maxBet` from `/wallet/authenticate` (or, absent an
 * explicit value, the largest `betLevels` entry); falls back to the local dev ceiling with no session.
 */
export function plinkoMaxStakePerBall(): number {
	return stateConfig.maxBet || sortedRgsGrid().at(-1) || config.maxBet;
}

/**
 * Round a stake to the RGS `stepBet` granularity (the finest valid increment). A guard against
 * off-grid custom values before the final `betLevels` snap; a no-op when the RGS omits `stepBet`.
 */
export function snapStakeToStep(stake: number): number {
	const step = stateConfig.stepBet;
	const value = Math.max(0, stake);
	if (!step || step <= 0) return value;
	return Math.round(value / step) * step;
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
 * Evenly sample up to `count` values from a sorted list, always keeping the first and last so the
 * offered min/max match the source min/max. Returns the list unchanged when it already has `count`
 * or fewer entries. De-dupes in case index rounding lands on the same value twice.
 */
function sampleEvenlySpaced(sorted: number[], count: number): number[] {
	if (count <= 0) return [];
	if (sorted.length <= count) return sorted.slice();
	const picked: number[] = [];
	for (let i = 0; i < count; i++) {
		picked.push(sorted[Math.round((i * (sorted.length - 1)) / (count - 1))]);
	}
	return Array.from(new Set(picked));
}

/**
 * Selectable per-ball stakes.
 *
 * With a live RGS session these come straight from the `betLevels` grid (clamped to the RGS
 * `minBet`/`maxBet`), down-sampled to at most `MAX_STAKE_PER_BALL_OPTIONS` evenly spaced values that
 * still span the RGS min→max. So the offered stakes match exactly what the RGS accepts — up to its
 * real `maxBet` — without flooding the selector with dozens of levels, and every value is an actual
 * `betLevels` entry (off-grid amounts are rejected with `ERR_VAL – invalid amount`). betLevels are
 * already per-currency, so no scaling is needed. With no RGS session (local dev) the USD
 * `BET_PER_BALL_PRESETS` ladder is used.
 */
export function plinkoStakePerBallOptions(): number[] {
	const grid = sortedRgsGrid();
	if (!grid.length) {
		return BET_PER_BALL_PRESETS.filter(
			(v) => v >= plinkoMinStakePerBall() && v <= plinkoMaxStakePerBall(),
		);
	}

	// Clamp the RGS grid to the min/max bet bounds, then down-sample to ≤ MAX_STAKE_PER_BALL_OPTIONS
	// spanning min→max. Never return empty — keep the raw grid if the clamp would remove everything.
	const min = plinkoMinStakePerBall();
	const max = plinkoMaxStakePerBall();
	const bounded = grid.filter((v) => v >= min && v <= max);
	const usable = bounded.length ? bounded : grid;
	return sampleEvenlySpaced(usable, MAX_STAKE_PER_BALL_OPTIONS);
}

/**
 * The full ordered set of valid per-ball stakes — EVERY `betLevels` entry within [minBet, maxBet].
 * This is the authoritative valid-amount set (what the RGS accepts): the +/- stepper walks it one
 * level at a time, and `snapStakeToBetLevels` snaps to it. `plinkoStakePerBallOptions()` is just an
 * 8-value shortcut sampled from this for the preset dropdown. With no RGS grid (local dev) the grid
 * IS the preset ladder, so this and the options coincide.
 */
export function plinkoStakePerBallSteps(): number[] {
	const grid = sortedRgsGrid();
	if (!grid.length) return plinkoStakePerBallOptions();
	const min = plinkoMinStakePerBall();
	const max = plinkoMaxStakePerBall();
	const bounded = grid.filter((v) => v >= min && v <= max);
	return bounded.length ? bounded : grid;
}

/** Snap a per-ball stake to the nearest valid `betLevels` entry (RGS rejects off-grid amounts). */
export function snapStakeToBetLevels(stake: number): number {
	const steps = plinkoStakePerBallSteps();
	if (!steps.length) return Math.max(0, stake);
	return snapValueToGrid(Math.max(0, stake), steps);
}

/**
 * Base bet level for `/wallet/play` `amount` — must be a valid `betLevels` entry.
 * RGS debits `amount × mode cost` (e.g. tendrop cost 10 → $1 play amount debits $10).
 *
 * Final guard: snap to the authoritative RGS grid so a stale/off-grid stake (e.g. left over after
 * a feature round on a non-USD currency) can never be sent and rejected as `ERR_VAL`.
 */
export function plinkoPlayAmount(): number {
	// Step-snap first (RGS `stepBet` granularity), then snap onto the authoritative `betLevels` grid.
	const stepped = snapStakeToStep(plinkoStakePerBall());
	const snapped = snapStakeToBetLevels(stepped);
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

/** Published cost (×bet-per-ball) of a buy tier, from `config.betModes`. Bonus-only buy → bpd-independent. */
export function buyBonusCost(tierKey: string): number {
	const mode = buyBonusModeName(tierKey);
	const modeConfig = config.betModes[mode as keyof typeof config.betModes];
	return modeConfig?.cost ?? 0;
}

/** Price (in the player's currency) to buy a tier = cost × per-ball stake. */
export function buyBonusPrice(tierKey: string): number {
	return plinkoPlayAmount() * buyBonusCost(tierKey);
}

/** Whether the player can afford a buy-bonus tier at the current stake. */
export function canAffordBuyBonus(tierKey: string): boolean {
	const price = buyBonusPrice(tierKey);
	return price > 0 && price <= stateBet.balanceAmount;
}

/** Max affordable per-ball stake for the current tier and balance. */
export function maxAffordableStakePerBall(): number {
	const cost = plinkoBetModeCost();
	if (cost <= 0) return 0;
	const balance = Math.max(0, stateBet.balanceAmount);
	// Consider the full valid grid (not just the 8 presets) so the clamp can reach the true largest
	// affordable betLevel — otherwise the +/- stepper couldn't step past the highest affordable preset.
	const opts = plinkoStakePerBallSteps().filter((stake) => stake * cost <= balance);
	return opts.at(-1) ?? 0;
}

/**
 * Displayed bet/win limits in the player's currency — the RGS per-play values, NOT multiplied by
 * balls-per-drop. `min`/`max` are the RGS `minBet`/`maxBet` (a single ball's stake range, which is
 * what the RGS actually validates per play); `maxWin` = `wincap` × RGS `maxBet` (the max payout on a
 * single max-stake ball). Sourced from the RGS config with the offered grid / local presets as a
 * fallback when no session is present.
 */
export function plinkoBetLimits(): { min: number; max: number; maxWin: number } {
	const minPerBall = plinkoMinStakePerBall(); // RGS minBet (→ grid[0] → local floor)
	const maxPerBall = plinkoMaxStakePerBall(); // RGS maxBet (→ grid[-1] → local ceiling)
	return {
		min: minPerBall,
		max: maxPerBall,
		maxWin: maxPerBall * PLINKO_WINCAP,
	};
}
