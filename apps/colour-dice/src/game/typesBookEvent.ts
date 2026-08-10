import type { BetType } from 'rgs-requests';

import type { DiceToken, GameType } from './types';

export type BookEventReveal = {
	index: number;
	type: 'reveal';
	dice: DiceToken[];
	selectedCount: number;
	gameType: GameType;
};

export type BookEventWheelSpin = {
	index: number;
	type: 'wheelSpin';
	multiplier: number;
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
	| BookEventSetTotalWin
	| BookEventFinalWin;

export type Bet = BetType<BookEvent>;
export type BookEventOfType<T extends BookEvent['type']> = Extract<BookEvent, { type: T }>;
export type BookEventContext = { bookEvents: BookEvent[] };
