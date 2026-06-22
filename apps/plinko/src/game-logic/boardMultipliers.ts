import { formatCoefficientLabel } from '../lib/format';

/** Canonical slot multipliers shown on the board (15 pockets, symmetric; center = spin slot).
 * Aztec values, tuned with the math SDK (crimson_plinko `plinko_data.BOARD_SLOT_MULTIPLIERS`).
 * FOLDED-BONUS DESIGN: the bonus is FREE and fires IN-DROP on a rare per-tier quota inside the base
 * book, so to fund it (+ the in-drop free spin) under the 96.70% cap the board is LOWERED to a fair
 * 14-row Galton EV of ~0.896 (base RTP = board + bonus_add + free_spin_add ≈ 0.957). Must stay
 * label-identical to the published `coefficientSets` so `alignCoefficientSet` maps server → board. */
export const BOARD_SLOT_MULTIPLIERS = [
	100, 50, 20, 5, 1.5, 0.4, 0.2, 0, 0.2, 0.4, 1.5, 5, 20, 50, 100,
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
