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

export type BookEventPlinkoBonus = RoomCommon & {
	type: 'plinkoBonus';
	/** Slot values with the Top Slot already applied. */
	board: number[];
	dropZone: number;
	slot: number;
};

export type BookEventWheelBonus = RoomCommon & {
	type: 'wheelBonus';
	wedges: number[];
	wedge: number;
};

export type BookEventChestBonus = RoomCommon & {
	type: 'chestBonus';
	/** Value behind every chest; `chests[opened]` is the awarded one. */
	chests: number[];
	opened: number;
	chestCount: number;
};

export type BookEventTowerBonus = RoomCommon & {
	type: 'towerBonus';
	floors: number[];
	tilesPerFloor: number;
	/** Floors reached, 1-based. Pays floors[climbed - 1]. */
	climbed: number;
	/** Safe tile per climbed floor. */
	path: number[];
	/** The dragon on the floor that ended the climb, or null at the top. */
	dragonTile: number | null;
};

export type BookEventRoom =
	| BookEventPlinkoBonus
	| BookEventWheelBonus
	| BookEventChestBonus
	| BookEventTowerBonus;

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
