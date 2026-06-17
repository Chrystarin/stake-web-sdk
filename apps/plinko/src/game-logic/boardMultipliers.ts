import { formatCoefficientLabel } from '../lib/format';

/** Canonical slot multipliers shown on the board (15 pockets, symmetric; center = spin slot).
 * Tuned with the math SDK (crimson_plinko `plinko_data.BOARD_SLOT_MULTIPLIERS`): the per-ball
 * expected value is ~0.957, keeping base RTP within the 90.0%-96.70% compliance range. Must stay
 * label-identical to the published `coefficientSets` so `alignCoefficientSet` maps server → board. */
export const BOARD_SLOT_MULTIPLIERS = [
	100, 40, 15, 8, 1.5, 0.4, 0.2, 0, 0.2, 0.4, 1.5, 8, 15, 40, 100,
] as const;

/** Align server/config coefficients to the board table (same labels → board values). */
export function alignCoefficientSet(coefficients: number[]): number[] {
	if (coefficients.length === BOARD_SLOT_MULTIPLIERS.length) {
		return [...BOARD_SLOT_MULTIPLIERS];
	}
	return coefficients.map((value) => {
		const label = formatCoefficientLabel(value);
		const match = BOARD_SLOT_MULTIPLIERS.find(
			(board) => formatCoefficientLabel(board) === label,
		);
		const parsed = parseFloat(label);
		return match ?? (Number.isFinite(parsed) ? parsed : value);
	});
}

export function boardMultiplierAtIndex(
	rateIndex: number,
	coefficients: readonly number[],
): number {
	if (rateIndex >= 0 && rateIndex < coefficients.length) {
		return coefficients[rateIndex];
	}
	return 0;
}

export function resolveOutcomeMultiplier(
	outcome: { rateIndex: number; multiplier: number; hitSpinSlot?: boolean },
	coefficients: readonly number[],
): number {
	if (outcome.hitSpinSlot) return 0;
	return boardMultiplierAtIndex(outcome.rateIndex, coefficients);
}
