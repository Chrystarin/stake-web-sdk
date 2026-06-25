import { stateBet } from 'state-shared';

import { BALL_PER_DROP_TIERS } from '../game-logic/constants';
import { plinkoBallsPerDrop } from './plinkoBet';
import { stateGame } from './stateGame.svelte';

/** RGS `/wallet/play` mode per balls-per-drop tier (matches `plinko_data.BET_MODE_BY_BALLS_PER_DROP`). */
export const PLINKO_BET_MODE_BY_BALLS: Record<number, string> = {
	1: 'onedrop',
	10: 'tendrop',
	20: 'twentydrop',
	50: 'fiftydrop',
};

/** One purchasable Crimson Fury bonus tier. A buy plays the player's current balls-per-drop drop AND a
 * forced bonus seeded with `freeBalls` fixed free balls ("N balls + M free balls"). Because the drop EV
 * scales with balls-per-drop, the COST lives per (tier × balls-per-drop) in `config.betModes` — resolve it
 * with `buyBonusModeName`. Mirrors the published math buy modes (game_config.py). */
export type BuyBonusTier = {
	key: string;
	name: string;
	freeBalls: number;
	tagline: string;
};

export const BUY_BONUS_TIERS: readonly BuyBonusTier[] = [
	{ key: 'standard', name: 'Standard', freeBalls: 25, tagline: 'Base enhanced turbulence and chain potential.' },
	{ key: 'enhanced', name: 'Enhanced', freeBalls: 35, tagline: 'Moderate head-start on the Fury meter.' },
	{ key: 'premium', name: 'Premium', freeBalls: 50, tagline: 'Larger batch with solid Fury progression.' },
	{ key: 'superfury', name: 'Super Fury', freeBalls: 80, tagline: 'Massive starting batch and strong chain reactions.' },
];

/** Balls-per-drop tiers a buy can be priced for (mirror math BUY_BONUS_BALLS_PER_DROP). */
export const BUY_BONUS_BPDS = [1, 10, 20, 50] as const;

/** RGS mode for a buy tier at a balls-per-drop (mirror math `buy_bonus_mode_name`), e.g. buystandard10. */
export function buyBonusModeName(tierKey: string, ballsPerDrop: number): string {
	const bpd = Math.max(1, Math.floor(ballsPerDrop));
	return `buy${tierKey}${bpd}`;
}

export const PLINKO_BUY_BONUS_MODES: readonly string[] = BUY_BONUS_TIERS.flatMap((tier) =>
	BUY_BONUS_BPDS.map((bpd) => buyBonusModeName(tier.key, bpd)),
);

export function buyBonusTierByKey(key: string | null | undefined): BuyBonusTier | undefined {
	return key ? BUY_BONUS_TIERS.find((tier) => tier.key === key) : undefined;
}

export function isPlinkoBuyBonusMode(mode: string | undefined): boolean {
	return !!mode && PLINKO_BUY_BONUS_MODES.includes(mode);
}

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

/** The mode the next `/wallet/play` should use. Normally the tier base mode (the free spin AND the
 * in-drop bonus fire inside it). When a buy-bonus purchase is pending it returns that buy mode for the
 * one bet, so the wager (cost ×bet-per-ball) and the sent `mode` both resolve to the purchased tier. */
export function plinkoActiveBetMode(): string {
	const pending = stateGame.pendingBuyBonusMode;
	if (isPlinkoBuyBonusMode(pending ?? undefined)) return pending as string;
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
