import { API_AMOUNT_MULTIPLIER } from 'constants-shared/bet';
import { stateBet, stateConfig } from 'state-shared';

import { BET_PER_BALL_PRESETS } from '../game-logic/constants';
import config from './config';
import { plinkoBetModeForBallsPerDrop } from './plinkoBetMode';
import { stateGame } from './stateGame.svelte';

/** Balls in one paid drop (UI "balls per drop"). */
export function plinkoBallsPerDrop(): number {
	return Math.max(1, Math.floor(stateGame.ballPerDrop || 1));
}

/** Stake per ball — stored in `stateBet.betAmount` (UI "bet per ball"). */
export function plinkoStakePerBall(): number {
	return Math.max(0, Number(stateBet.betAmount) || 0);
}

/** Published bet-mode cost (balls per tier). RGS debit = play amount × cost. */
export function plinkoBetModeCost(): number {
	const mode = plinkoBetModeForBallsPerDrop(plinkoBallsPerDrop());
	const modeConfig = config.betModes[mode as keyof typeof config.betModes];
	return modeConfig?.cost ?? plinkoBallsPerDrop();
}

/**
 * Selectable per-ball stakes — restricted to `BET_PER_BALL_PRESETS`
 * (0.01, 0.10, 0.20, 0.50, 1.00, 5.00, 10.00, 20.00, 50.00).
 *
 * When an RGS session provides `betLevels`, only presets the session also allows are shown
 * (RGS rejects off-grid amounts); otherwise all presets within min/max are offered.
 */
export function plinkoStakePerBallOptions(): number[] {
	const presets = BET_PER_BALL_PRESETS.filter((v) => v >= config.minBet && v <= config.maxBet);
	const rgsLevels = stateConfig.betAmountOptions;
	if (rgsLevels?.length) {
		const allowed = presets.filter((preset) =>
			rgsLevels.some((level) => Math.abs(level - preset) < 1e-9),
		);
		if (allowed.length) return allowed;
	}
	return presets;
}

/** Snap a per-ball stake to the nearest allowed level (RGS rejects off-grid amounts). */
export function snapStakeToBetLevels(stake: number): number {
	const opts = plinkoStakePerBallOptions();
	if (!opts.length) return Math.max(0, stake);

	const target = Math.max(0, stake);
	let best = opts[0];
	let bestDiff = Math.abs(best - target);
	for (const level of opts) {
		const diff = Math.abs(level - target);
		if (diff < bestDiff) {
			best = level;
			bestDiff = diff;
		}
	}
	return best;
}

/**
 * Base bet level for `/wallet/play` `amount` — must be a valid `betLevels` entry.
 * RGS debits `amount × mode cost` (e.g. baseten cost 10 → $1 play amount debits $10).
 */
export function plinkoPlayAmount(): number {
	return snapStakeToBetLevels(plinkoStakePerBall());
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
	return wager > 0 && wager <= stateBet.balanceAmount;
}

/** Max affordable per-ball stake for the current tier and balance. */
export function maxAffordableStakePerBall(): number {
	const cost = plinkoBetModeCost();
	if (cost <= 0) return 0;
	const balance = Math.max(0, stateBet.balanceAmount);
	const opts = plinkoStakePerBallOptions().filter((stake) => stake * cost <= balance);
	return opts.at(-1) ?? 0;
}
