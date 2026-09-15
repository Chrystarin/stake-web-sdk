/**
 * Jackpot plinko — the board a bonus round is played on.
 *
 * Lifted from Colour Dice (`apps/colour-dice/src/plinko`), minus that game's `JackpotPlinko`
 * screen: Crazy Time already has a screen for a bonus room, so only the board comes over. Nothing
 * in this folder imports from the game around it. See README.md.
 */

export { default as PlinkoBoard } from './PlinkoBoard.svelte';

export { buildPocketLadder, pocketForAward, pocketOffset, pocketHeat } from './pockets';
export type { PocketLadder } from './pockets';

export {
	shapeForPockets,
	layoutBoard,
	pegsFor,
	pegsInRow,
	planDrop,
	planDropWithBombs,
	placeBombs,
	inBlast,
	pegKey,
} from './board';
export type { BoardShape, BoardLayout, BoardPeg, BoardFrame, BombSite, Contact } from './board';

export type { PlinkoBoardApi } from './types';
