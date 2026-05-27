/** Center pocket index for a row of multiplier slots (matches stake-math-sdk `spin_slot_index`). */
export function spinSlotRateIndex(slotCount: number): number {
	return Math.floor((slotCount - 1) / 2);
}

export function isSpinSlotRateIndex(rateIndex: number, slotCount: number): boolean {
	return rateIndex === spinSlotRateIndex(slotCount);
}
