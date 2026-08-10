import { type BookEventHandlerMap } from 'utils-book';
import { stateBet } from 'state-shared';

import { eventEmitter } from './eventEmitter';
import { stateGame, stateGameDerived } from './stateGame.svelte';
import { resolveDiceColours } from './types';
import type { BookEvent, BookEventOfType, BookEventContext } from './typesBookEvent';

export const bookEventHandlerMap: BookEventHandlerMap<BookEvent, BookEventContext> = {
	reveal: async (bookEvent: BookEventOfType<'reveal'>) => {
		stateGame.gameType = bookEvent.gameType;
		stateGame.matchCount = bookEvent.selectedCount;
		stateGame.resultReady = false;
		const colours = resolveDiceColours(bookEvent.dice, stateGame.primaryColour);
		await eventEmitter.broadcastAsync({
			type: 'diceReveal',
			colours,
			matchCount: bookEvent.selectedCount,
		});
		stateGame.dice = colours;
		stateGame.resultReady = true;
		stateGameDerived.pushHistory(colours);
	},
	wheelSpin: async (bookEvent: BookEventOfType<'wheelSpin'>) => {
		await eventEmitter.broadcastAsync({ type: 'wheelShow' });
		await eventEmitter.broadcastAsync({ type: 'wheelSpin', multiplier: bookEvent.multiplier });
		await eventEmitter.broadcastAsync({ type: 'wheelHide' });
	},
	setTotalWin: async (bookEvent: BookEventOfType<'setTotalWin'>) => {
		stateBet.winBookEventAmount = bookEvent.amount;
	},
	finalWin: async (bookEvent: BookEventOfType<'finalWin'>) => {
		if (bookEvent.amount > 0) {
			await eventEmitter.broadcastAsync({ type: 'winShow', amount: bookEvent.amount });
			await eventEmitter.broadcastAsync({ type: 'winHide' });
		}
	},
};
