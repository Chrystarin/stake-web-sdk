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

/**
 * Start / stop a sound that is HELD for as long as something is on screen, rather than played once
 * (e.g. the post-bonus treasure screen's coin bed). Handled by EnableSound, which also drops the loop
 * if the player turns Sound off while it is up.
 *
 * ⚠️ Two types rather than one with a union `type` field: the emitter picks a handler's argument with
 * `Extract<Event, { type: T }>`, which resolves to `never` for an event whose own `type` is a union.
 */
export type EmitterEventSoundLoopStart = {
	type: 'soundLoopStart';
	name: string;
};

export type EmitterEventSoundLoopStop = {
	type: 'soundLoopStop';
	name: string;
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
	| EmitterEventSound
	| EmitterEventSoundLoopStart
	| EmitterEventSoundLoopStop;

export type EmitterEvent =
	| EmitterEventHotKey
	| EmitterEventUi
	| EmitterEventModal
	| EmitterEventGame;
