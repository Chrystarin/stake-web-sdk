import type { BetType } from 'rgs-requests';

import type { DiceToken, GameType } from './types';

/**
 * The roll. `dice` are selection-relative slots ('B1'..'Bk' backed in selection order,
 * 'O1'.. unbacked), and `backedCount` is how many colours were backed — so a book is
 * self-describing for replays and offline playback without needing the live board state.
 */
export type BookEventReveal = {
	index: number;
	type: 'reveal';
	dice: DiceToken[];
	backedCount: number;
	gameType: GameType;
};

/** Emitted only when a backed colour takes all three dice. */
export type BookEventWheelSpin = {
	index: number;
	type: 'wheelSpin';
	slot: DiceToken;
	multiplier: number;
};

/**
 * Per-colour breakdown — the whole point of the model: each backed colour that landed pays
 * on its own match count. `amount` is that colour's contribution to the round multiplier
 * (x100), in units of `amount` (the per-colour stake).
 */
export type BookEventWinInfo = {
	index: number;
	type: 'winInfo';
	wins: {
		slot: DiceToken;
		matches: number;
		amount: number;
	}[];
	totalWin: number;
};

export type BookEventSetTotalWin = {
	index: number;
	type: 'setTotalWin';
	amount: number;
};

export type BookEventFinalWin = {
	index: number;
	type: 'finalWin';
	amount: number;
};

export type BookEvent =
	| BookEventReveal
	| BookEventWheelSpin
	| BookEventWinInfo
	| BookEventSetTotalWin
	| BookEventFinalWin;

export type Bet = BetType<BookEvent>;
export type BookEventOfType<T extends BookEvent['type']> = Extract<BookEvent, { type: T }>;
export type BookEventContext = { bookEvents: BookEvent[] };
