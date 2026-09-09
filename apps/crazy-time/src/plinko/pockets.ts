/**
 * The pocket ladder a jackpot round drops into.
 *
 * Awards climb OUTWARD: the cheapest sits alone in the middle pocket and the dearest is at both
 * edges, mirrored either side of centre. That is what makes the drop worth watching — the middle
 * is where a ball ends up by default and the corners are the prize — and it is why a ladder is
 * always an ODD number of pockets, `2n - 1` for `n` distinct awards.
 */

export type PocketLadder = {
	/** Award per pocket, left → right. A palindrome, cheapest in the middle. */
	values: number[];
	/** The distinct awards, cheapest first. */
	awards: number[];
	/** Pocket count — always odd. */
	count: number;
};

/**
 * Lay `awards` out as a ladder. Duplicates are dropped and the order they arrive in is
 * irrelevant: the ladder is built from the sorted set, so the caller can pass the paytable
 * however it happens to be written.
 */
export const buildPocketLadder = (awards: readonly number[]): PocketLadder => {
	const ordered = [...new Set(awards)].sort((a, b) => a - b);
	// A single award would give a one-pocket board, which is not a plinko round at all — pad it
	// so there is at least a middle and two edges to aim between.
	const ranked = ordered.length >= 2 ? ordered : [ordered[0] ?? 0, ordered[0] ?? 0];
	const count = ranked.length * 2 - 1;
	const middle = (count - 1) / 2;
	const values = Array.from({ length: count }, (_, index) => ranked[Math.abs(index - middle)]);
	return { values, awards: ranked, count };
};

/** Pocket offset from centre, in pocket widths. Negative is left. */
export const pocketOffset = (ladder: PocketLadder, index: number): number =>
	index - (ladder.count - 1) / 2;

/**
 * The pocket to aim an award at.
 *
 * Every award except the cheapest sits in TWO pockets, one each side, so which one the ball is
 * sent to is a free choice — and the only honest way to spend it is on the side the player
 * dropped from, so the ball travels the shorter, more plausible path to a result that was
 * settled before it was ever released.
 *
 * An award that is not on the ladder (a paytable the caller has since changed, say) resolves to
 * the nearest one rather than throwing: the round still has to play out.
 */
export const pocketForAward = (
	ladder: PocketLadder,
	award: number,
	/** Where the ball starts, as an offset from centre in pocket widths. */
	fromOffset: number,
): number => {
	const nearestAward = ladder.awards.reduce((best, value) =>
		Math.abs(value - award) < Math.abs(best - award) ? value : best,
	);
	const candidates = ladder.values
		.map((value, index) => ({ value, index }))
		.filter((pocket) => pocket.value === nearestAward);
	if (!candidates.length) return (ladder.count - 1) / 2;
	return candidates.reduce((best, pocket) =>
		Math.abs(pocketOffset(ladder, pocket.index) - fromOffset) <
		Math.abs(pocketOffset(ladder, best.index) - fromOffset)
			? pocket
			: best,
	).index;
};

/** 0 for the middle pocket, 1 for the edges — drives how hot a pocket is painted. */
export const pocketHeat = (ladder: PocketLadder, index: number): number => {
	const middle = (ladder.count - 1) / 2;
	return middle > 0 ? Math.abs(index - middle) / middle : 0;
};
