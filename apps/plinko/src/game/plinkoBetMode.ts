import { stateBet } from 'state-shared';

import { BALL_PER_DROP_TIERS } from '../game-logic/constants';
import { plinkoBallsPerDrop } from './plinkoBet';

/** RGS `/wallet/play` mode per balls-per-drop tier (matches `plinko_data.BET_MODE_BY_BALLS_PER_DROP`). */
export const PLINKO_BET_MODE_BY_BALLS: Record<number, string> = {
	1: 'onedrop',
	10: 'tendrop',
	20: 'twentydrop',
	50: 'fiftydrop',
};

/** FOLDED-BONUS DESIGN: only the 4 BASE modes exist. The bonus is FREE and fires in-drop inside the
 * base book (math quota) — there is NO separate bonus trigger mode, so the client never plays one. */
export const PLINKO_BET_MODES = [...Object.values(PLINKO_BET_MODE_BY_BALLS)];

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

/** The mode the next `/wallet/play` should use — always the normal tier base mode. The free spin AND
 * the bonus both fire in-drop inside this base book; neither needs a dedicated mode. */
export function plinkoActiveBetMode(): string {
	return plinkoBetModeForBallsPerDrop(plinkoBallsPerDrop());
}

/** Set `stateBet.activeBetModeKey` before `/wallet/play`. */
export function syncPlinkoBetModeFromUi(): void {
	stateBet.activeBetModeKey = plinkoActiveBetMode();
}

/** FOLDED-BONUS DESIGN: there are no trigger modes (the bonus is in the base book). Always false —
 * kept so callers/imports stay stable. */
export function isPlinkoTriggerMode(_mode: string | undefined): boolean {
	return false;
}

export function ballsPerDropForPlinkoBetMode(mode: string | undefined): number | undefined {
	if (!mode) return undefined;
	const entry = Object.entries(PLINKO_BET_MODE_BY_BALLS).find(([, name]) => name === mode);
	return entry ? Number(entry[0]) : undefined;
}
