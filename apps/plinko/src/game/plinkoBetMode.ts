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

/** One purchasable Crimson Fury bonus tier. A buy is BONUS-ONLY: it plays no paid base drop. The round
 * opens with the bonus meter full, firing the bonus seeded with `freeBalls` FIXED entry balls; the in-bonus
 * level-up / chain hits then add MORE balls on top (combined total). COST is ×bet-per-ball and lives per
 * tier in `config.betModes` (independent of balls-per-drop → 4 modes) — resolve it with `buyBonusModeName`.
 * `freeBalls` = the tier's math entry count (mirror plinko_data.BUY_BONUS_TIER_DEFS). */
export type BuyBonusTier = {
	key: string;
	name: string;
	freeBalls: number;
	/** Fury-meter head-start fraction (0..1): the in-bonus level-up meter starts this filled. Mirror of
	 * the math plinko_data.BUY_BONUS_TIER_DEFS `head_start`. */
	headStart: number;
	tagline: string;
};

export const BUY_BONUS_TIERS: readonly BuyBonusTier[] = [
	// Copy and line breaks are the design's own. The \n is a real break, not a hint: the card
	// renders the tagline with `white-space: pre-line` so the two lines split where the comp splits
	// them rather than wherever the measure runs out. `pre-line` still lets a line wrap further if a
	// narrow card leaves it no room, so forcing the break here cannot push text off the panel.
	{
		key: 'standard',
		name: 'Standard',
		freeBalls: 72,
		headStart: 0,
		tagline: 'A starter batch of free balls\nwith chain potential.',
	},
	{
		key: 'enhanced',
		name: 'Enhanced',
		freeBalls: 95,
		headStart: 0,
		tagline: 'A bigger batch for stronger\nchain runs.',
	},
	{
		key: 'premium',
		name: 'Premium',
		freeBalls: 145,
		headStart: 0,
		tagline: 'Larger batch with solid\nfury progression.',
	},
	{
		key: 'superfury',
		name: 'Super Fury',
		freeBalls: 239,
		headStart: 0,
		tagline: 'A massive starting batch and\nthe strong chain reactions.',
	},
];

/** RGS mode for a buy tier (mirror math `buy_bonus_mode_name`), e.g. buystandard. */
export function buyBonusModeName(tierKey: string): string {
	return `buy${tierKey}`;
}

export const PLINKO_BUY_BONUS_MODES: readonly string[] = BUY_BONUS_TIERS.map((tier) =>
	buyBonusModeName(tier.key),
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

/** A "trigger mode" book carries an EMPTY initial drop (the balls arrive via `bonusRound`), so the client
 * must NOT try to animate the drop. The base modes fold the bonus into a real drop (not trigger modes),
 * but the BUY BONUS modes are bonus-only (empty drop), so they ARE trigger modes. */
export function isPlinkoTriggerMode(mode: string | undefined): boolean {
	return isPlinkoBuyBonusMode(mode);
}

export function ballsPerDropForPlinkoBetMode(mode: string | undefined): number | undefined {
	if (!mode) return undefined;
	const entry = Object.entries(PLINKO_BET_MODE_BY_BALLS).find(([, name]) => name === mode);
	return entry ? Number(entry[0]) : undefined;
}
