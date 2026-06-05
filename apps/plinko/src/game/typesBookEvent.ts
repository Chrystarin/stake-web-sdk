import type { BetType } from 'rgs-requests';

export type PlinkoBallOutcome = {
	rateIndex: number;
	multiplier: number;
	amount: number;
	/** Server/math: ball path should contact a bonus (coin) peg and fill bonus meter. */
	hitBonusPeg?: boolean;
	/** Server/math: ball lands on the center spin pocket and fills spin meter. */
	hitSpinSlot?: boolean;
};

type BookEventPlinkoDrop = {
	index: number;
	type: 'plinkoDrop';
	/** Legacy wire name; always default variant (`PLINKO_DEFAULT_VARIANT_ID`). */
	difficulty: number;
	rowCount: number;
	ballsPerDrop: number;
	stakePerBall: number;
	/** Server-authored slot multipliers for this drop configuration. */
	coefficients?: number[];
	/** Server-authored free-spin meter max for this game config. */
	spinMeterMax?: number;
	/** Server-authored bonus meter max for this game config. */
	bonusMeterMax?: number;
	/** Session spin meter value at the start of this drop (RGS carry-over). */
	spinMeterStart?: number;
	/** Session bonus meter value at the start of this drop. */
	bonusMeterStart?: number;
	/** Bonus feature level at the start of this drop. */
	bonusLevelStart?: number;
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

type BookEventSpinMeter = {
	index: number;
	type: 'spinMeter';
	value: number;
	max: number;
};

type BookEventFreeSpinTrigger = {
	index: number;
	type: 'freeSpinTrigger';
	multiplier: number;
	/** Wheel segment label from math (e.g. `5X`, `BONUS`). */
	segment?: string;
	/** Authoritative scaled drop win after the segment (round drop win × segment multiplier). */
	amount?: number;
};

type BookEventBonusRound = {
	index: number;
	type: 'bonusRound';
	freeBalls: number;
	outcomes: PlinkoBallOutcome[];
	level: number;
	/** Balls already played when resuming a stateful round. */
	ballsPlayed?: number;
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
	| BookEventSpinMeter
	| BookEventFreeSpinTrigger
	| BookEventBonusRound
	| BookEventSetTotalWin
	| BookEventFinalWin;

export type Bet = BetType<BookEvent>;
export type BookEventOfType<T extends BookEvent['type']> = Extract<BookEvent, { type: T }>;
export type BookEventContext = { bookEvents: BookEvent[] };
