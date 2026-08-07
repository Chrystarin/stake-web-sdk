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

/** 1-BALL BOARD (the `onedrop` tier only) — mirror of math `plinko_data.ONE_BALL_BOARD_SLOT_MULTIPLIERS`.
 * That tier is FEATURE-FREE (no free spin, no bonus — see `isSingleBallMode`), so nothing but the board
 * funds it and the shared table's ~89.6% EV is under the 90% compliance floor. Here the two 1.5× pockets
 * pay 2.0× instead — they land 12.2% of the time, so that single step is worth +6.11 points and puts the
 * tier at 95.745%. Everything else, the 0× center included, is identical to the shared board.
 * ⚠️ THESE POCKET VALUES *ARE* the tier's RTP — with no feature and no quota to tune, `onedrop` returns
 * exactly this board's EV. They were center 0.1× / sides 0.3× (95.396%), which left the tier 0.30% below
 * the 95.7% every other mode is tuned to and was the largest term in the cross-mode RTP spread Stake
 * rejected. The 1.5× pockets are the dial because they land 3× less often than the middle three, so they
 * resolve 3× finer: one decimal in the middle is worth 2–4 RTP points, far too coarse to correct 0.30%.
 * Do not adjust them without re-running the math's `rtp_audit.py`.
 * ⚠️ Balls landing center on this tier are NOT flagged `hitSpinSlot` by the math. The payout is the same
 * either way (this board's center is 0× too) — a tier with no meter just must not report meter hits. */
export const ONE_BALL_BOARD_SLOT_MULTIPLIERS = [
	100, 50, 20, 5, 2.0, 0.4, 0.2, 0, 0.2, 0.4, 2.0, 5, 20, 50, 100,
] as const;

/** Per-balls-per-drop board override. Only tiers listed here differ from `BOARD_SLOT_MULTIPLIERS`. */
export const BOARD_SLOT_MULTIPLIERS_BY_BALLS: Record<number, readonly number[]> = {
	1: ONE_BALL_BOARD_SLOT_MULTIPLIERS,
};

/**
 * Every distinct pocket label any board can show — i.e. exactly the set of
 * `img/multiplier_slot_text_<label>.webp` files that has to exist, and the set worth preloading.
 *
 * Derived from the board tables rather than listed by hand. It was written out twice (the engine's
 * texture load and `preloadAssets`), and both copies had to be remembered whenever a board was re-cut:
 * the preload list had already fallen behind once, so switching to 1 ball/drop fetched that tier's
 * labels cold. A label with no asset still falls back to a Pixi `Text`, so a miss is invisible in
 * review — which is exactly why this should not be a hand-maintained list.
 */
export const BOARD_LABELS: readonly string[] = [
	...new Set(
		[BOARD_SLOT_MULTIPLIERS, ...Object.values(BOARD_SLOT_MULTIPLIERS_BY_BALLS)]
			.flatMap((board) => [...board])
			.map(formatCoefficientLabel),
	),
];

/** The board a balls-per-drop tier plays (the shared board unless the tier has its own table). */
export function boardMultipliersForBallsPerDrop(ballsPerDrop: number): readonly number[] {
	return (
		BOARD_SLOT_MULTIPLIERS_BY_BALLS[Math.max(1, Math.floor(ballsPerDrop || 1))] ??
		BOARD_SLOT_MULTIPLIERS
	);
}

/** Align server/config coefficients to the board table (same labels → board values). `ballsPerDrop`
 * selects which board to align onto — pass the book's own tier so a 1-ball book maps to the 1-ball
 * board (its center pays) rather than the shared one. */
export function alignCoefficientSet(coefficients: number[], ballsPerDrop = 0): number[] {
	const board = boardMultipliersForBallsPerDrop(ballsPerDrop);
	if (coefficients.length === board.length) {
		return [...board];
	}
	return coefficients.map((value) => {
		const label = formatCoefficientLabel(value);
		const match = board.find((slot) => formatCoefficientLabel(slot) === label);
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

/** Payout multiple for a landed ball. ALWAYS the board value at the landed pocket: the spin pocket pays
 * 0 because every board's center IS 0, not because of the `hitSpinSlot` flag — the 1-ball board carries
 * no such flag at all (no meter to feed) and still pays its center's 0. */
export function resolveOutcomeMultiplier(
	outcome: { rateIndex: number; multiplier: number; hitSpinSlot?: boolean },
	coefficients: readonly number[],
): number {
	return boardMultiplierAtIndex(outcome.rateIndex, coefficients);
}
