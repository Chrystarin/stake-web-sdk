import { COLOURS, type Colour } from './constants';

export type { Colour };
export type GameType = 'basegame';

/**
 * A die in a book, named as a slot RELATIVE to the player's layout rather than as a literal
 * colour: 'B1'..'Bk' are the backed colours heaviest stack first, 'O1'.. are the unbacked
 * ones in canonical order. That relative encoding is what lets one book set serve every
 * possible colour choice — the client substitutes its own picks at playback.
 */
export type DiceToken = `B${number}` | `O${number}`;

/** Parse a slot label into its kind and 0-based index. */
export const parseSlot = (token: DiceToken): { backed: boolean; index: number } => ({
	backed: token[0] === 'B',
	index: Number(token.slice(1)) - 1,
});

/**
 * The colours a book's slots refer to, in slot order: backed colours first (heaviest stack
 * first, exactly as the mode was chosen), then the unbacked ones in canonical order.
 */
export const slotColours = (backedOrder: Colour[]): Colour[] => {
	const backed = new Set(backedOrder);
	return [...backedOrder, ...COLOURS.filter((colour) => !backed.has(colour))];
};

/**
 * Resolve a book's dice slots into concrete colours. Deterministic given the same backed
 * ordering, so replays render identically.
 */
export const resolveDiceColours = (dice: DiceToken[], backedOrder: Colour[]): Colour[] => {
	const slots = slotColours(backedOrder);
	return dice.map((token) => {
		const { backed, index } = parseSlot(token);
		const offset = backed ? index : backedOrder.length + index;
		return slots[offset] ?? slots[0];
	});
};

/** Resolve a single slot label (used by winInfo / wheelSpin events). */
export const resolveSlotColour = (token: DiceToken, backedOrder: Colour[]): Colour =>
	resolveDiceColours([token], backedOrder)[0];
