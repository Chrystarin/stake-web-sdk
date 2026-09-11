import { type BookEventHandlerMap } from 'utils-book';
import { stateBet } from 'state-shared';

import { eventEmitter } from './eventEmitter';
import { stateGame } from './stateGame.svelte';
import { isRoomSpot } from './constants';
import type { BookEvent, BookEventOfType, BookEventContext, BookEventRoom } from './typesBookEvent';

/** The room events share one handler: they only differ in what the overlay draws. */
const playRoom = async (bookEvent: BookEventRoom) => {
	// `covered` for the room is whatever wheelSpin said about the spot it landed on.
	const covered = Boolean(stateGame.result?.covered);
	await eventEmitter.broadcastAsync({ type: 'bonusRound', room: bookEvent, covered });
	if (stateGame.result) stateGame.result = { ...stateGame.result, roomValue: bookEvent.multiplier };
};

export const bookEventHandlerMap: BookEventHandlerMap<BookEvent, BookEventContext> = {
	topSlot: async (bookEvent: BookEventOfType<'topSlot'>) => {
		stateGame.gameType = bookEvent.gameType;
		stateGame.resultReady = false;
		stateGame.result = null;
		stateGame.topSlot = { spot: bookEvent.spot, multiplier: bookEvent.multiplier };
		await eventEmitter.broadcastAsync({
			type: 'topSlotSpin',
			spot: bookEvent.spot,
			multiplier: bookEvent.multiplier,
		});
	},

	wheelSpin: async (bookEvent: BookEventOfType<'wheelSpin'>) => {
		// Sanity check the served book against the committed board: `covered` must agree with
		// whether the board actually had a chip on that spot. A mismatch means the RGS served a
		// book for a different ticket than the one sent to /wallet/play.
		const boardCovered = stateGame.backedOrder.includes(bookEvent.spot);
		if (boardCovered !== bookEvent.covered) {
			console.error(
				`[crazy-time] book says ${bookEvent.spot} covered=${bookEvent.covered} but the board ` +
					`committed [${stateGame.backedOrder.join(', ')}]: check the bet mode sent to /wallet/play`,
			);
		}
		await eventEmitter.broadcastAsync({
			type: 'wheelSpin',
			segment: bookEvent.segment,
			spot: bookEvent.spot,
			covered: bookEvent.covered,
			multiplier: bookEvent.multiplier,
		});
		// Provisional result: rooms fill in roomValue, winInfo fills in the payout.
		stateGame.result = {
			segment: bookEvent.segment,
			spot: bookEvent.spot,
			covered: bookEvent.covered,
			multiplier: bookEvent.multiplier,
			payout: 0,
			roomValue: isRoomSpot(bookEvent.spot) ? 0 : null,
		};
	},

	piratePlinkoRoom: playRoom,
	bonusWheelRoom: playRoom,
	chestRoom: playRoom,
	oceanVoyageRoom: playRoom,

	winInfo: async (bookEvent: BookEventOfType<'winInfo'>) => {
		const result = {
			segment: stateGame.result?.segment ?? 0,
			spot: bookEvent.spot,
			covered: bookEvent.covered,
			multiplier: bookEvent.topSlotMultiplier,
			payout: bookEvent.totalWin / 100,
			roomValue: isRoomSpot(bookEvent.spot) ? bookEvent.baseValue : null,
		};
		stateGame.result = result;
		stateGame.resultReady = true;
		stateGame.rolling = false;
		await eventEmitter.broadcastAsync({ type: 'roundSettle', result });
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
