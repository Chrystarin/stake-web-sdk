import { PUBLIC_CHROMATIC } from 'envs';
import { stateUrlDerived } from 'state-shared';
import { requestEndEvent } from 'rgs-requests';

import type { BaseBookEvent } from './types';

export function recordBookEvent<TBookEvent extends BaseBookEvent>({
	bookEvent,
}: {
	bookEvent: TBookEvent;
}) {
	if (PUBLIC_CHROMATIC || stateUrlDerived.replay()) {
		console.log('mock request end-event:', { index: bookEvent.index, type: bookEvent.type });
		return;
	}

	const rgsUrl = stateUrlDerived.rgsUrl();
	const sessionID = stateUrlDerived.sessionID();
	// Dev-local play has no RGS session — firing anyway makes every recorded book event reject
	// with an unhandled "Failed to fetch" (Safari: "TypeError: Load failed"), which reads as a
	// crash clue on devices where the console is the only diagnostic.
	if (!rgsUrl || !sessionID) return;

	try {
		// requestEndEvent is async and this call is deliberately fire-and-forget; the catch must be
		// ON THE PROMISE — the try/catch around it only ever covered a synchronous throw, so a failed
		// request still surfaced as an unhandledrejection.
		void requestEndEvent({
			eventIndex: bookEvent.index,
			rgsUrl,
			sessionID,
		}).catch((error) => {
			console.warn('[utils-book] end-event request failed:', error);
		});
	} catch (error) {
		console.error(error);
	}
}

export function checkIsMultipleRevealEvents<TBookEvent extends BaseBookEvent>({
	bookEvents,
}: {
	bookEvents: TBookEvent[];
}) {
	const revealEventCount = bookEvents.filter((bookEvent) => bookEvent.type === 'reveal').length;
	const isMultipleReveals = revealEventCount > 1;
	return isMultipleReveals;
}
