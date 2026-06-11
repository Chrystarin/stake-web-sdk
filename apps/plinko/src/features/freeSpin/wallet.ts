import { API_AMOUNT_MULTIPLIER } from 'constants-shared/bet';

import { FREE_SPIN_SEGMENTS } from '../../game-logic/constants';
import type { Bet } from '../../game/typesBookEvent';
import {
	freeSpinMultiplierFromSegment,
	getFreeSpinBaseRoundWin,
	isFreeSpinBonusWheelSegment,
	multiplyRoundWinByFreeSpinSegment,
} from './payout';

const FREE_SPIN_MULTIPLIER_SEGMENTS = FREE_SPIN_SEGMENTS.filter(
	(label) => !isFreeSpinBonusWheelSegment(label) && freeSpinMultiplierFromSegment(label) > 0,
);

export type FreeSpinWalletSettlement = {
	segment: string;
	multiplier: number;
	/** Win in stake currency units (same as HUD). */
	winAmount: number;
};

/**
 * Deterministic wheel segment per RGS round (varies by bet; not client RNG).
 * Used only when the served book omits `freeSpinTrigger` (presentation fallback; no wallet credit).
 */
export function fallbackFreeSpinSegmentFromRound(bet?: Bet): FreeSpinWalletSettlement {
	const roundKey = Number(
		(bet as { betID?: number })?.betID ?? (bet as { roundID?: number })?.roundID ?? 0,
	);
	const labels =
		FREE_SPIN_MULTIPLIER_SEGMENTS.length > 0
			? FREE_SPIN_MULTIPLIER_SEGMENTS
			: (['5X'] as const);
	const segment = labels[Math.abs(roundKey) % labels.length] ?? '5X';
	const multiplier = freeSpinMultiplierFromSegment(segment);
	const { totalWin } = multiplyRoundWinByFreeSpinSegment(segment, getFreeSpinBaseRoundWin());
	return { segment, multiplier, winAmount: totalWin };
}
