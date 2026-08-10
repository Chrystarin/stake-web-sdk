import type { Colour } from './constants';

// All in-game emitter events. Kept self-contained (no Pixi UI events) since the
// presentation is HTML/CSS + a three.js dice canvas.
export type EmitterEventGame =
	| { type: 'bet' }
	| { type: 'diceReveal'; colours: Colour[]; matchCount: number }
	| { type: 'wheelShow' }
	| { type: 'wheelSpin'; multiplier: number }
	| { type: 'wheelHide' }
	| { type: 'winShow'; amount: number }
	| { type: 'winHide' };
