import { type BookEventHandlerMap } from 'utils-book';
import { stateBet } from 'state-shared';

import { eventEmitter } from './eventEmitter';
import { stateGame } from './stateGame.svelte';
import { resolveDiceColours, resolveSlotColour } from './types';
import type { BookEvent, BookEventOfType, BookEventContext } from './typesBookEvent';
import type { ColourWin } from './typesEmitterEvent';

export const bookEventHandlerMap: BookEventHandlerMap<BookEvent, BookEventContext> = {
	reveal: async (bookEvent: BookEventOfType<'reveal'>) => {
		stateGame.gameType = bookEvent.gameType;
		stateGame.resultReady = false;
		stateGame.wins = [];
		stateGame.jackpot = null;

		// The book's slots resolve against the ordering frozen at roll time. A mismatch means
		// the served book is for a different colour count than the board committed to — surface
		// it rather than rendering a roll that does not correspond to the bet.
		if (bookEvent.backedCount !== stateGame.backedOrder.length) {
			console.error(
				`[colour-dice] book is for ${bookEvent.backedCount} colours but the board committed ` +
					`${stateGame.backedOrder.length} — check the bet mode sent to /wallet/play`,
			);
		}

		const colours = resolveDiceColours(bookEvent.dice, stateGame.backedOrder);
		await eventEmitter.broadcastAsync({ type: 'diceReveal', colours });
		stateGame.dice = colours;
	},

	/**
	 * The jackpot. Named for the math contract — the book still calls a triple a `wheelSpin` — but
	 * the wheel is gone: the award is played out on the plinko screen instead (see src/plinko).
	 *
	 * This lands AFTER `reveal`, which does not resolve until the dice have finished rolling, so
	 * the jackpot only ever opens on a result the player has already seen. One awaited broadcast,
	 * because the round now takes as long as the player takes to drop the ball.
	 */
	wheelSpin: async (bookEvent: BookEventOfType<'wheelSpin'>) => {
		const colour = resolveSlotColour(bookEvent.slot, stateGame.backedOrder);
		await eventEmitter.broadcastAsync({
			type: 'jackpotRound',
			multiplier: bookEvent.multiplier,
			colour,
		});
		// Recorded only once the round is over. The award is settled long before the ball is
		// released, so publishing it any earlier puts the answer on the table while the player is
		// still being asked where to drop from — and the screen covering the board is the wrong
		// thing to be relying on to keep it quiet.
		stateGame.jackpot = { colour, multiplier: bookEvent.multiplier };
	},

	winInfo: async (bookEvent: BookEventOfType<'winInfo'>) => {
		// Every backed colour that landed pays on its own match count — this is the whole
		// point of the layout model, and why more than one colour can win in a round.
		const wins: ColourWin[] = bookEvent.wins.map((win) => ({
			colour: resolveSlotColour(win.slot, stateGame.backedOrder),
			matches: win.matches,
			multiplier: win.amount / 100,
		}));

		stateGame.wins = wins;
		stateGame.resultReady = true;
		stateGame.rolling = false;

		await eventEmitter.broadcastAsync({
			type: 'diceSettle',
			colours: stateGame.dice.filter((colour): colour is NonNullable<typeof colour> => colour !== null),
			wins,
		});
	},

	setTotalWin: async (bookEvent: BookEventOfType<'setTotalWin'>) => {
		stateBet.winBookEventAmount = bookEvent.amount;
	},

	finalWin: async (bookEvent: BookEventOfType<'finalWin'>) => {
		stateGame.rolling = false;
		if (bookEvent.amount > 0) {
			await eventEmitter.broadcastAsync({ type: 'winShow', amount: bookEvent.amount });
			await eventEmitter.broadcastAsync({ type: 'winHide' });
		}
	},
};
