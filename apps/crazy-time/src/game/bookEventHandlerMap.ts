import { type BookEventHandlerMap } from 'utils-book';
import { stateBet } from 'state-shared';

import { eventEmitter } from './eventEmitter';
import { stateGame, stateGameDerived, type HistoryChip } from './stateGame.svelte';
import { SPOT_COLOUR, SPOT_LABEL, isRoomSpot } from './constants';
import type { RoundResult } from './typesEmitterEvent';
import type { BookEvent, BookEventOfType, BookEventContext, BookEventRoom } from './typesBookEvent';

/** The room events share one handler: they only differ in what the overlay draws. */
const playRoom = async (bookEvent: BookEventRoom) => {
	// `covered` for the room is whatever wheelSpin said about the spot it landed on.
	const covered = Boolean(stateGame.result?.covered);
	await eventEmitter.broadcastAsync({ type: 'bonusRound', room: bookEvent, covered });
	if (stateGame.result) stateGame.result = { ...stateGame.result, roomValue: bookEvent.multiplier };
};

/** My Bet History is this session's list in the info modal, not an archive. */
const MAX_HISTORY_ENTRIES = 100;

const TOP_SLOT_PILL = '#b8860b';
const NOT_COVERED_PILL = '#4b5563';

/** `18:04:31 18/09/2026`: the time and the date each stay whole when the cell wraps between them. */
const historyDate = (): string => {
	const now = new Date();
	const pad = (value: number) => String(value).padStart(2, '0');
	return (
		`${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())} ` +
		`${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()}`
	);
};

/** One row per settled round, newest first. */
const logRound = (result: RoundResult) => {
	const chip = stateBet.betAmount || stateGame.stake;
	const buying = stateGame.buying;
	const chips: HistoryChip[] = [
		{ label: SPOT_LABEL[result.spot], color: SPOT_COLOUR[result.spot].deep },
	];
	if (!result.covered) chips.push({ label: 'Not covered', color: NOT_COVERED_PILL });
	else {
		if (result.roomValue !== null) {
			chips.push({ label: `x${result.roomValue}`, color: SPOT_COLOUR[result.spot].base });
		}
		if (result.multiplier > 1) {
			chips.push({ label: `Top Slot x${result.multiplier}`, color: TOP_SLOT_PILL });
		}
	}
	stateGame.history.unshift({
		date: historyDate(),
		bet: buying ? stateGameDerived.buyTotal(buying) : stateGame.backedOrder.length * chip,
		chip,
		spots: buying ? 'Buy' : String(stateGame.backedOrder.length),
		chips,
		win: result.payout * chip,
	});
	if (stateGame.history.length > MAX_HISTORY_ENTRIES) stateGame.history.length = MAX_HISTORY_ENTRIES;
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
		logRound(result);
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
