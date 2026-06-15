import { stateBet } from 'state-shared';

import { BALL_PER_DROP_TIERS } from '../game-logic/constants';
import { plinkoBallsPerDrop } from './plinkoBet';

/** RGS `/wallet/play` mode per balls-per-drop tier (matches `plinko_data.BET_MODE_BY_BALLS_PER_DROP`). */
export const PLINKO_BET_MODE_BY_BALLS: Record<number, string> = {
	1: 'baseone',
	10: 'baseten',
	20: 'basetwenty',
	50: 'basefifty',
};

export const PLINKO_BET_MODES = Object.values(PLINKO_BET_MODE_BY_BALLS);

export function plinkoBetModeForBallsPerDrop(ballsPerDrop: number): string {
	const balls = Math.max(1, Math.floor(ballsPerDrop));
	if (balls in PLINKO_BET_MODE_BY_BALLS) {
		return PLINKO_BET_MODE_BY_BALLS[balls];
	}
	const tier = (BALL_PER_DROP_TIERS as readonly number[]).reduce((best, candidate) =>
		Math.abs(candidate - balls) < Math.abs(best - balls) ? candidate : best,
	);
	return PLINKO_BET_MODE_BY_BALLS[tier] ?? 'baseten';
}

/** Set `stateBet.activeBetModeKey` from the UI balls-per-drop tier before `/wallet/play`. */
export function syncPlinkoBetModeFromUi(): void {
	stateBet.activeBetModeKey = plinkoBetModeForBallsPerDrop(plinkoBallsPerDrop());
}

export function ballsPerDropForPlinkoBetMode(mode: string | undefined): number | undefined {
	if (!mode) return undefined;
	const entry = Object.entries(PLINKO_BET_MODE_BY_BALLS).find(([, name]) => name === mode);
	return entry ? Number(entry[0]) : undefined;
}
