/** The imperative handles the plinko module is driven through (`bind:this`). */

export type PlinkoBoardApi = {
	/** Hand the ball to the player. Resolves with the start peg they let go over. */
	arm: () => Promise<number>;
	/**
	 * Point the shot, for a host driving an `aimed` launcher: -1 at the far left of the drop zone,
	 * 0 dead centre, 1 at the far right. Clamped by the board, so the shot always lands on it.
	 */
	aim: (fraction: number) => void;
	/**
	 * The row an aimed shot is pointed along, in the board's own pixels: the top row of pegs — the
	 * x of the board's centre line, the row's y, and how far either side of centre its outermost peg
	 * stands. What a host needs to know how far its barrel may swing.
	 */
	aimRow: () => { x: number; y: number; half: number };
	/**
	 * Point an aimed shot along a LINE, for a host with a barrel: out of `from` (the muzzle, in the
	 * board's own pixels, normally above the board) and `lean` pixels across for every pixel down —
	 * the tangent of the barrel's angle from straight down, positive to the right. The board works
	 * out which peg that line is pointed at (see `snapAimedStart`), so the peg struck is the one the
	 * barrel is facing. Does the work of `aim` and `launchFrom` together.
	 */
	aimAlong: (from: { x: number; y: number }, lean: number) => void;
	/**
	 * Where an aimed shot starts, in the board's own pixels — the muzzle of whatever the host is
	 * pointing, which is normally above the board and so has a negative y. Unset, the ball starts
	 * on the drop-zone line instead.
	 */
	launchFrom: (point: { x: number; y: number } | null) => void;
	/** Fire an aimed shot — the same thing as letting go of the rail. */
	fire: () => void;
	/** Play the fall down to a pocket. Resolves once the ball is in it. */
	drop: (pocketIndex: number) => Promise<void>;
	/** Take the ball off the board and put every pocket back to rest. */
	reset: () => void;
};
