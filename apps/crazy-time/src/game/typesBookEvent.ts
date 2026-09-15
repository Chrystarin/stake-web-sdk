import type { BetType } from 'rgs-requests';

import type { Spot } from './constants';
import type { GameType } from './types';

/** The Top Slot result: one spot may carry a multiplier this spin, or none (`spot: null`). */
export type BookEventTopSlot = {
	index: number;
	type: 'topSlot';
	spot: Spot | null;
	multiplier: number | null;
	gameType: GameType;
};

/**
 * Where the wheel stopped. `covered` says whether the ticket this book was drawn for had a
 * chip on that spot, and `multiplier` is the Top Slot multiplier that applied (1 if none).
 */
export type BookEventWheelSpin = {
	index: number;
	type: 'wheelSpin';
	segment: number;
	spot: Spot;
	covered: boolean;
	topSlotApplied: boolean;
	multiplier: number;
};

type RoomCommon = {
	index: number;
	/** Room result before the Top Slot. */
	multiplier: number;
	topSlotMultiplier: number;
	/** multiplier x topSlotMultiplier: what one chip on the room returns. */
	total: number;
};

export type BookEventPiratePlinko = RoomCommon & {
	type: 'piratePlinkoRoom';
	/** Slot values with the Top Slot already applied. */
	board: number[];
	dropZone: number;
	slot: number;
};

export type BookEventBonusWheel = RoomCommon & {
	type: 'bonusWheelRoom';
	wedges: number[];
	/**
	 * Each wedge's width in the math's units (a full wedge 4, the 1,000x sliver 1): what the book
	 * weighs. The disc is drawn at equal widths regardless (see README, "Bonus Wheel drawn at
	 * equal widths"). Older books omit it; `WHEEL_WIDTHS` stands in.
	 */
	widths?: number[];
	wedge: number;
};

export type BookEventChest = RoomCommon & {
	type: 'chestRoom';
	/** Value behind every chest; `chests[opened]` is the awarded one. */
	chests: number[];
	opened: number;
	chestCount: number;
};

export type BookEventOceanVoyage = RoomCommon & {
	type: 'oceanVoyageRoom';
	depths: number[];
	tilesPerDepth: number;
	/** Depths reached, 1-based. Pays depths[dived - 1]. */
	dived: number;
	/** Safe tile per dived depth. */
	path: number[];
	/** The kraken at the depth that ended the dive, or null on a clean surfacing. */
	krakenTile: number | null;
};

export type BookEventRoom =
	| BookEventPiratePlinko
	| BookEventBonusWheel
	| BookEventChest
	| BookEventOceanVoyage;

export type BookEventWinInfo = {
	index: number;
	type: 'winInfo';
	spot: Spot;
	covered: boolean;
	/** n for a number spot, the room result for a room. */
	baseValue: number;
	topSlotMultiplier: number;
	/** Round payout x100, in units of the chip. */
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
	| BookEventTopSlot
	| BookEventWheelSpin
	| BookEventRoom
	| BookEventWinInfo
	| BookEventSetTotalWin
	| BookEventFinalWin;

export type Bet = BetType<BookEvent>;
export type BookEventOfType<T extends BookEvent['type']> = Extract<BookEvent, { type: T }>;
export type BookEventContext = { bookEvents: BookEvent[] };
