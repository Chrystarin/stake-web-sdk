import { type BookEventHandlerMap } from 'utils-book';
import { stateBet } from 'state-shared';

import { eventEmitter } from './eventEmitter';
import { stateGame, stateGameDerived } from './stateGame.svelte';
import { resolveDiceColours, resolveSlotColour } from './types';
import type { BookEvent, BookEventOfType, BookEventContext } from './typesBookEvent';
import type { ColourWin } from './typesEmitterEvent';

export const bookEventHandlerMap: BookEventHandlerMap<BookEvent, BookEventContext> = {
	reveal: async (bookEvent: BookEventOfType<'reveal'>) => {
		stateGame.gameType = bookEvent.gameType;
		stateGame.resultReady = false;
		stateGame.wins = [];

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
		stateGameDerived.pushHistory(colours);
	},

	wheelSpin: async (bookEvent: BookEventOfType<'wheelSpin'>) => {
		const colour = resolveSlotColour(bookEvent.slot, stateGame.backedOrder);
		await eventEmitter.broadcastAsync({ type: 'wheelShow' });
		await eventEmitter.broadcastAsync({
			type: 'wheelSpin',
			multiplier: bookEvent.multiplier,
			colour,
		});
		await eventEmitter.broadcastAsync({ type: 'wheelHide' });
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
