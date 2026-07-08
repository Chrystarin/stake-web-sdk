import { stateBet } from 'state-shared';
import { createPlayBookUtils } from 'utils-book';

import type { Bet } from './typesBookEvent';
import { bookEventHandlerMap } from './bookEventHandlerMap';

export const { playBookEvent, playBookEvents } = createPlayBookUtils({ bookEventHandlerMap });

export const playBet = async (bet: Bet) => {
	stateBet.winBookEventAmount = 0;
	await playBookEvents(bet.state);
};

// Colour Dice has no multi-part bonus round, so a resumed bet simply replays its book.
export const convertTorResumableBet = (betToResume: Bet) => betToResume;
