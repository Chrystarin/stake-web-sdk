import { SPIN_METER_TIER } from './constants';

/** Center pocket index for a row of multiplier slots (matches stake-math-sdk `spin_slot_index`). */
export function spinSlotRateIndex(slotCount: number): number {
	return Math.floor((slotCount - 1) / 2);
}

export function isSpinSlotRateIndex(rateIndex: number, slotCount: number): boolean {
	return rateIndex === spinSlotRateIndex(slotCount);
}

/**
 * True where the center pocket is the SPIN pocket — i.e. the tier has a free-spin meter for it to fill
 * (10/20/50). False on the feature-free 1-ball tier, where the center is an ordinary paying pocket on
 * that tier's own board and balls landing there are never flagged `hitSpinSlot`.
 * Mirror of math `plinko_data.spin_pocket_active_for_balls`.
 */
export function spinPocketActiveForBallsPerDrop(ballsPerDrop: number): boolean {
	return Math.max(1, Math.floor(ballsPerDrop || 1)) in SPIN_METER_TIER;
}
