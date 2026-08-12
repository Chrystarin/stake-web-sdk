/**
 * Jackpot plinko — a drop-in bonus round.
 *
 * Nothing in this folder imports from the game around it, so it plugs in with one component and
 * one awaited call, and unplugs by deleting the folder. See README.md.
 */

export { default as JackpotPlinko } from './JackpotPlinko.svelte';
export { default as PlinkoBoard } from './PlinkoBoard.svelte';

export { buildPocketLadder, pocketForAward, pocketOffset, pocketHeat } from './pockets';
export type { PocketLadder } from './pockets';

export { shapeForPockets, layoutBoard, pegsFor, pegsInRow, planDrop } from './board';
export type { BoardShape, BoardLayout, BoardPeg } from './board';

export type { JackpotPlinkoApi, PlinkoBoardApi } from './types';
