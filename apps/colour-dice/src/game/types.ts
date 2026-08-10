import { COLOURS, type Colour } from './constants';

export type { Colour };
export type GameType = 'basegame';

// A die token from the book: 'MATCH' or 'C1'..'C5'.
export type DiceToken = 'MATCH' | 'C1' | 'C2' | 'C3' | 'C4' | 'C5';

/**
 * Resolve a book's relative dice tokens into concrete colours, given the colour the
 * player backed. 'MATCH' -> backed colour; 'C1'..'C5' -> the five other colours in
 * canonical order. This is deterministic, so replays render identically.
 */
export const resolveDiceColours = (dice: DiceToken[], backed: Colour): Colour[] => {
	const others = COLOURS.filter((colour) => colour !== backed);
	return dice.map((token) => {
		if (token === 'MATCH') return backed;
		const index = Number(token.slice(1)) - 1;
		return others[index] ?? backed;
	});
};
