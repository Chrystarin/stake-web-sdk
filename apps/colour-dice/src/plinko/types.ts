/** The imperative handles the plinko module is driven through (`bind:this`). */

export type PlinkoBoardApi = {
	/** Hand the ball to the player. Resolves with the start peg they let go over. */
	arm: () => Promise<number>;
	/** Play the fall down to a pocket. Resolves once the ball is in it. */
	drop: (pocketIndex: number) => Promise<void>;
	/** Take the ball off the board and put every pocket back to rest. */
	reset: () => void;
};

export type JackpotPlinkoApi = {
	/**
	 * Play one jackpot round for `award` — the multiplier the RGS settled on. Resolves when the
	 * screen has slid away again, so a book sequence can simply await it.
	 */
	play: (award: number, options?: { accent?: string }) => Promise<void>;
};
