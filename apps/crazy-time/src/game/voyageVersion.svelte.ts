/**
 * Which Ocean Voyage the next bought round plays. The original is the default — whether the wheel
 * lands on it or the player buys it — and the Buy Bonus screen's small "v2" button asks for the
 * helm version instead. Both are the same book played two ways, so nothing here touches the maths.
 *
 * Set by the buy (Game.svelte `startBuy`), read once when the room goes up (BonusRound), and put
 * back by the round that read it, so a wheel landing never inherits it.
 */
export const voyageVersion = $state({ v2: false });
