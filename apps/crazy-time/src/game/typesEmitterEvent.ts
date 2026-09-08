import type { Spot } from './constants';
import type { BookEventRoom } from './typesBookEvent';

/** The settled round, as the board shows it. */
export type RoundResult = {
	segment: number;
	spot: Spot;
	covered: boolean;
	/** Top Slot multiplier that applied to the hit spot (1 if none). */
	multiplier: number;
	/** Payout in units of the chip (0 when the spot was not covered). */
	payout: number;
	/** Room result before the Top Slot, for a room hit. */
	roomValue: number | null;
};

// All in-game emitter events. Kept self-contained (no Pixi UI events): the presentation is
// HTML/CSS/SVG only.
export type EmitterEventGame =
	| { type: 'bet' }
	/** Finish an RGS round that authenticate reported still open (see EnableGameActor). */
	| { type: 'resumeBet' }
	/** Spin the Top Slot reels to the authored pair. Awaited by the book. */
	| { type: 'topSlotSpin'; spot: Spot | null; multiplier: number | null }
	/** Spin the main wheel to the authored segment. Awaited by the book. */
	| { type: 'wheelSpin'; segment: number; spot: Spot; covered: boolean; multiplier: number }
	/**
	 * A bonus room plays out over the table. Awaited, so the round takes as long as the room does
	 * (and as long as the player takes to pick, in the pick rooms).
	 */
	| { type: 'bonusRound'; room: BookEventRoom; covered: boolean }
	/** The round has settled on the board. */
	| { type: 'roundSettle'; result: RoundResult }
	/** Round closed out from the board: the result readouts are taken down. */
	| { type: 'boardClear' }
	| { type: 'winShow'; amount: number }
	| { type: 'winHide' };
