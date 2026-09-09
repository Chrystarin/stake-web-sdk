/** The imperative handles the plinko module is driven through (`bind:this`). */

export type PlinkoBoardApi = {
	/** Hand the ball to the player. Resolves with the start peg they let go over. */
	arm: () => Promise<number>;
	/** Play the fall down to a pocket. Resolves once the ball is in it. */
	drop: (pocketIndex: number) => Promise<void>;
	/** Take the ball off the board and put every pocket back to rest. */
	reset: () => void;
};
