import type { PlinkoBallOutcome } from './typesBookEvent';

/** Sum currency win for a drop from authored outcomes (spin-pocket balls pay 0). */
export function plinkoDropRawWin(outcomes: PlinkoBallOutcome[]): number {
	return outcomes.reduce(
		(sum, outcome) =>
			sum + outcome.amount * (outcome.hitSpinSlot ? 0 : outcome.multiplier),
		0,
	);
}

/**
 * Stake-normalized settlement amount for `setTotalWin` / `finalWin` (return multiple × 100).
 * Matches stake-math-sdk `game_override.update_final_win`: rawWin / dropWager.
 */
export function plinkoNormalizedSettlementAmount(rawWin: number, dropWager: number): number {
	if (dropWager <= 0) return 0;
	return Math.round((rawWin / dropWager) * 100);
}

export function plinkoSettlementAmountFromOutcomes(
	outcomes: PlinkoBallOutcome[],
	dropWager: number,
): number {
	return plinkoNormalizedSettlementAmount(plinkoDropRawWin(outcomes), dropWager);
}
