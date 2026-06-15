import type { Bet, BookEvent } from './typesBookEvent';
import { splitBookEventsBeforeSettlement } from './plinkoRoundSettlement';

/** Normalize the served round bet (RGS `/wallet/play` or synced math book). */
export function normalizeAuthoritativeBet(bet: Bet): Bet {
	const withCriteria = bet as Bet & { criteria?: string };
	return {
		...bet,
		state: Array.isArray(bet.state) ? [...bet.state] : [],
		...(withCriteria.criteria ? { criteria: withCriteria.criteria } : {}),
	};
}

function eventsDifferForPlayback(
	authoritativeEvents: BookEvent[],
	playbackEvents: BookEvent[],
): boolean {
	if (playbackEvents.length !== authoritativeEvents.length) return true;
	return playbackEvents.some((event, index) => event !== authoritativeEvents[index]);
}

/** Prelude events for animation; settlement always comes from the authoritative book. */
export function preludeEventsForPlayback(
	authoritativeEvents: BookEvent[],
	playbackEvents: BookEvent[],
): BookEvent[] {
	const source = eventsDifferForPlayback(authoritativeEvents, playbackEvents)
		? playbackEvents
		: authoritativeEvents;
	return splitBookEventsBeforeSettlement(source).prelude;
}

export function authoritativeSettlementEvents(events: BookEvent[]): BookEvent[] {
	return splitBookEventsBeforeSettlement(events).settlement;
}
