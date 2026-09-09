/** The imperative handles the plinko module is driven through (`bind:this`). */

export type PlinkoBoardApi = {
	/** Hand the ball to the player. Resolves with the start peg they let go over. */
	arm: () => Promise<number>;
	/**
	 * Point the shot, for a host driving an `aimed` launcher: -1 at the far left of the drop zone,
	 * 0 dead centre, 1 at the far right. Clamped by the board, so the shot always lands on it.
	 */
	aim: (fraction: number) => void;
	/** Fire an aimed shot — the same thing as letting go of the rail. */
	/**
	 * Where an aimed shot starts, in the board's own pixels — the muzzle of whatever the host is
	 * pointing, which is normally above the board and so has a negative y. Unset, the ball starts
	 * on the drop-zone line instead.
	 */
	launchFrom: (point: { x: number; y: number } | null) => void;
	fire: () => void;
	/** Play the fall down to a pocket. Resolves once the ball is in it. */
	drop: (pocketIndex: number) => Promise<void>;
	/** Take the ball off the board and put every pocket back to rest. */
	reset: () => void;
};
