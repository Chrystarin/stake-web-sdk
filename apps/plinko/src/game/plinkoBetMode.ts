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
 * The mode the next `/wallet/play` should use:
 *  - bonus trigger mode when the bonus meter is full (auto-fired free bonus, `pendingFeatureTrigger`);
 *  - free-spin mode when the spin meter is full — the player's NEXT paid spin is the boosted one
 *    (the zero-sum wheel multiplies its own drop). No auto-fire and no free debit: it is a normal
 *    bet the player places, so the balance only ever moves on a real spin.
 *  - otherwise the normal balls-per-drop tier mode.
 */
export function plinkoActiveBetMode(): string {
	const balls = plinkoBallsPerDrop();
	if (stateGame.pendingFeatureTrigger === 'bonus') return bonusTriggerModeForBalls(balls);
	if (stateGame.pendingFeatureTrigger === 'spin' || isPlinkoSpinMeterFull()) {
		return freeSpinTriggerModeForBalls(balls);
	}
	return plinkoBetModeForBallsPerDrop(balls);
}

/** Set `stateBet.activeBetModeKey` before `/wallet/play` (trigger mode when a meter is full). */
export function syncPlinkoBetModeFromUi(): void {
	stateBet.activeBetModeKey = plinkoActiveBetMode();
}

/** True for the dedicated free-spin / bonus trigger modes. */
export function isPlinkoTriggerMode(mode: string | undefined): boolean {
	if (!mode) return false;
	return (
		Object.values(PLINKO_FREESPIN_MODE_BY_BALLS).includes(mode) ||
		Object.values(PLINKO_BONUS_MODE_BY_BALLS).includes(mode)
	);
}

/**
 * True only for the bonus trigger modes, whose book carries an EMPTY initial drop (the bonus balls
 * come later via `bonusRound`). The free-spin mode is a real, paid, watched spin, so its drop
 * animates normally; only the bonus drop is skipped.
 */
export function isPlinkoBonusTriggerMode(mode: string | undefined): boolean {
	if (!mode) return false;
	return Object.values(PLINKO_BONUS_MODE_BY_BALLS).includes(mode);
}

/** True when the spin meter is full, so the next paid spin is served by the free-spin mode. */
export function isPlinkoSpinMeterFull(): boolean {
	return stateGame.spinMeterMax > 0 && stateGame.spinMeterValue >= stateGame.spinMeterMax;
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
