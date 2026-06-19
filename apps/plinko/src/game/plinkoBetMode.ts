import { stateBet } from 'state-shared';

import { BALL_PER_DROP_TIERS } from '../game-logic/constants';
import { plinkoBallsPerDrop } from './plinkoBet';
import { stateGame } from './stateGame.svelte';

/** RGS `/wallet/play` mode per balls-per-drop tier (matches `plinko_data.BET_MODE_BY_BALLS_PER_DROP`). */
export const PLINKO_BET_MODE_BY_BALLS: Record<number, string> = {
	1: 'baseone',
	10: 'baseten',
	20: 'basetwenty',
	50: 'basefifty',
};

/** Dedicated BONUS trigger modes (match `plinko_data.BONUS_MODE_BY_BALLS`). The client auto-fires one
 * when the bonus meter fills. Cost = the tier cost (same as the base mode), and the bonus payout is
 * SIZED so the mode is compliant — so triggering deducts exactly one normal bet, not 49×. */
export const PLINKO_BONUS_MODE_BY_BALLS: Record<number, string> = {
	1: 'bonusone',
	10: 'bonusten',
	20: 'bonustwenty',
	50: 'bonusfifty',
};

export const PLINKO_BET_MODES = [
	...Object.values(PLINKO_BET_MODE_BY_BALLS),
	...Object.values(PLINKO_BONUS_MODE_BY_BALLS),
];

function modeForBalls(map: Record<number, string>, ballsPerDrop: number): string {
	const balls = Math.max(1, Math.floor(ballsPerDrop));
	if (balls in map) return map[balls];
	const tier = (BALL_PER_DROP_TIERS as readonly number[]).reduce((best, candidate) =>
		Math.abs(candidate - balls) < Math.abs(best - balls) ? candidate : best,
	);
	return map[tier] ?? map[10];
}

export function plinkoBetModeForBallsPerDrop(ballsPerDrop: number): string {
	return modeForBalls(PLINKO_BET_MODE_BY_BALLS, ballsPerDrop);
}

export function bonusTriggerModeForBalls(ballsPerDrop: number): string {
	return modeForBalls(PLINKO_BONUS_MODE_BY_BALLS, ballsPerDrop);
}

/**
 * The mode the next `/wallet/play` should use: the dedicated BONUS trigger mode when the bonus meter is
 * full (`stateGame.pendingFeatureTrigger`, auto-fired), otherwise the normal tier mode. The free spin
 * needs no mode — it fires in-drop inside the base book.
 */
export function plinkoActiveBetMode(): string {
	const balls = plinkoBallsPerDrop();
	if (stateGame.pendingFeatureTrigger === 'bonus') return bonusTriggerModeForBalls(balls);
	return plinkoBetModeForBallsPerDrop(balls);
}

/** Set `stateBet.activeBetModeKey` before `/wallet/play` (bonus trigger mode when its meter is full). */
export function syncPlinkoBetModeFromUi(): void {
	stateBet.activeBetModeKey = plinkoActiveBetMode();
}

/** True for the dedicated BONUS trigger mode (empty initial drop). */
export function isPlinkoTriggerMode(mode: string | undefined): boolean {
	if (!mode) return false;
	return Object.values(PLINKO_BONUS_MODE_BY_BALLS).includes(mode);
}

export function ballsPerDropForPlinkoBetMode(mode: string | undefined): number | undefined {
	if (!mode) return undefined;
	for (const map of [PLINKO_BET_MODE_BY_BALLS, PLINKO_BONUS_MODE_BY_BALLS]) {
		const entry = Object.entries(map).find(([, name]) => name === mode);
		if (entry) return Number(entry[0]);
	}
	return undefined;
}
