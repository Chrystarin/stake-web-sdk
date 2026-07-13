import type { EmitterEventHotKey } from 'components-shared';
import type { EmitterEventUi } from 'components-ui-pixi';
import type { EmitterEventModal } from 'components-ui-html';
import type { PlinkoBallOutcome } from './typesBookEvent';

export type EmitterEventPlinkoBoard = {
	type: 'plinkoDrop';
	outcomes: PlinkoBallOutcome[];
	fastMode: boolean;
};

export type EmitterEventPlinkoWin = {
	type: 'plinkoWin';
	amount: number;
	multiplier: number;
};

export type EmitterEventBonusMeter = {
	type: 'bonusMeterUpdate';
	value: number;
	level: number;
};

export type EmitterEventBonusRoulette = {
	type: 'bonusRouletteShow';
	freeBalls: number;
};

export type EmitterEventFreeSpin = {
	type: 'freeSpinShow';
	multiplier: number;
};

export type EmitterEventSound = {
	type: 'soundOnce';
	name: string;
	/** Optional playback rate (pitch). Used to pitch the 'pocket' sound up on higher multipliers. */
	rate?: number;
};

export type EmitterEventBonusBall = {
	type: 'bonusBallDrop';
	stake: number;
};

export type EmitterEventGame =
	| EmitterEventPlinkoBoard
	| EmitterEventPlinkoWin
	| EmitterEventBonusMeter
	| EmitterEventBonusRoulette
	| EmitterEventFreeSpin
	| EmitterEventBonusBall
	| EmitterEventSound;

export type EmitterEvent =
	| EmitterEventHotKey
	| EmitterEventUi
	| EmitterEventModal
	| EmitterEventGame;
