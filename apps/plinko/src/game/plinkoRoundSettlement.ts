import type { Bet, BookEvent } from './typesBookEvent';

const SETTLEMENT_EVENT_TYPES = new Set(['setTotalWin', 'finalWin']);

/** Split book events so settlement runs after prelude playback. */
export function splitBookEventsBeforeSettlement(events: BookEvent[]): {
	prelude: BookEvent[];
	settlement: BookEvent[];
} {
	const settlementIndex = events.findIndex((event) => SETTLEMENT_EVENT_TYPES.has(event.type));
	if (settlementIndex < 0) return { prelude: events, settlement: [] };
	return {
		prelude: events.slice(0, settlementIndex),
		settlement: events.slice(settlementIndex),
	};
}

/** Base game books have no feature settlement events. */
export function bookHasFeatureSettlement(_events: BookEvent[]): boolean {
	return false;
}

/** Base game books have no bonus-round play completion. */
export function bookRequiresBonusPlayCompletion(_events: BookEvent[]): boolean {
	return false;
}

/** Base game books have no spin-meter feature. */
export function bookWillReachSpinMeterMax(_events: BookEvent[]): boolean {
	return false;
}

/**
 * Base game is stateless: defer `/wallet/end-round` only while an RGS round is still active.
 */
export function checkIsPlinkoDeferredSettlement(bet: Bet): boolean {
	return bet.active === true;
}
