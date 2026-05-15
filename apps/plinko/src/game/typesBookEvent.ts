import type { BetType } from 'rgs-requests';

export type PlinkoBallOutcome = {
	rateIndex: number;
	multiplier: number;
	amount: number;
};

type BookEventPlinkoDrop = {
	index: number;
	type: 'plinkoDrop';
	difficulty: number;
	rowCount: number;
	ballsPerDrop: number;
	stakePerBall: number;
	outcomes: PlinkoBallOutcome[];
};

type BookEventBonusMeter = {
	index: number;
	type: 'bonusMeter';
	value: number;
	level: number;
};

type BookEventBonusRoulette = {
	index: number;
	type: 'bonusRoulette';
	freeBalls: number;
};

type BookEventFreeSpinTrigger = {
	index: number;
	type: 'freeSpinTrigger';
	multiplier: number;
};

type BookEventSetTotalWin = {
	index: number;
	type: 'setTotalWin';
	amount: number;
};

type BookEventFinalWin = {
	index: number;
	type: 'finalWin';
	amount: number;
};

export type BookEvent =
	| BookEventPlinkoDrop
	| BookEventBonusMeter
	| BookEventBonusRoulette
	| BookEventFreeSpinTrigger
	| BookEventSetTotalWin
	| BookEventFinalWin;

export type Bet = BetType<BookEvent>;
export type BookEventOfType<T extends BookEvent['type']> = Extract<BookEvent, { type: T }>;
export type BookEventContext = { bookEvents: BookEvent[] };
