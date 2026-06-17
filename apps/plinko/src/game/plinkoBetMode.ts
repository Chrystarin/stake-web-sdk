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

/** Dedicated feature-trigger modes (match `plinko_data` FREESPIN/BONUS_MODE_BY_BALLS). */
export const PLINKO_FREESPIN_MODE_BY_BALLS: Record<number, string> = {
	1: 'freespinone',
	10: 'freespinten',
	20: 'freespintwenty',
	50: 'freespinfifty',
};
export const PLINKO_BONUS_MODE_BY_BALLS: Record<number, string> = {
	1: 'bonusone',
	10: 'bonusten',
	20: 'bonustwenty',
	50: 'bonusfifty',
};

export const PLINKO_BET_MODES = [
	...Object.values(PLINKO_BET_MODE_BY_BALLS),
	...Object.values(PLINKO_FREESPIN_MODE_BY_BALLS),
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

export function freeSpinTriggerModeForBalls(ballsPerDrop: number): string {
	return modeForBalls(PLINKO_FREESPIN_MODE_BY_BALLS, ballsPerDrop);
}

export function bonusTriggerModeForBalls(ballsPerDrop: number): string {
	return modeForBalls(PLINKO_BONUS_MODE_BY_BALLS, ballsPerDrop);
}

/**
 * The mode the next `/wallet/play` should use: a dedicated trigger mode when a meter is full
 * (`stateGame.pendingFeatureTrigger`), otherwise the normal balls-per-drop tier mode.
 */
export function plinkoActiveBetMode(): string {
	const balls = plinkoBallsPerDrop();
	if (stateGame.pendingFeatureTrigger === 'spin') return freeSpinTriggerModeForBalls(balls);
	if (stateGame.pendingFeatureTrigger === 'bonus') return bonusTriggerModeForBalls(balls);
	return plinkoBetModeForBallsPerDrop(balls);
}

/** Set `stateBet.activeBetModeKey` before `/wallet/play` (trigger mode when a meter is full). */
export function syncPlinkoBetModeFromUi(): void {
	stateBet.activeBetModeKey = plinkoActiveBetMode();
}

/** True for the dedicated free-spin / bonus trigger modes (no base-drop animation). */
export function isPlinkoTriggerMode(mode: string | undefined): boolean {
	if (!mode) return false;
	return (
		Object.values(PLINKO_FREESPIN_MODE_BY_BALLS).includes(mode) ||
		Object.values(PLINKO_BONUS_MODE_BY_BALLS).includes(mode)
	);
}

export function ballsPerDropForPlinkoBetMode(mode: string | undefined): number | undefined {
	if (!mode) return undefined;
	for (const map of [
		PLINKO_BET_MODE_BY_BALLS,
		PLINKO_FREESPIN_MODE_BY_BALLS,
		PLINKO_BONUS_MODE_BY_BALLS,
	]) {
		const entry = Object.entries(map).find(([, name]) => name === mode);
		if (entry) return Number(entry[0]);
	}
	return undefined;
}
