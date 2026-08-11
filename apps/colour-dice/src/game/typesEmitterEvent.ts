import type { Colour } from './constants';

/** One backed colour's result for the round. */
export type ColourWin = {
	colour: Colour;
	matches: number;
	/** Contribution to the round multiplier, in units of the per-colour stake. */
	multiplier: number;
};

// All in-game emitter events. Kept self-contained (no Pixi UI events) since the
// presentation is HTML/CSS + a three.js dice canvas.
export type EmitterEventGame =
	| { type: 'bet' }
	/** Finish an RGS round that authenticate reported still open (see EnableGameActor). */
	| { type: 'resumeBet' }
	| { type: 'diceReveal'; colours: Colour[] }
	| { type: 'diceSettle'; colours: Colour[]; wins: ColourWin[] }
	/** Round closed out from the board: the dice slide off the table and are taken away. */
	| { type: 'diceClear' }
	| { type: 'wheelShow' }
	| { type: 'wheelSpin'; multiplier: number; colour: Colour }
	| { type: 'wheelHide' }
	| { type: 'winShow'; amount: number }
	| { type: 'winHide' };
