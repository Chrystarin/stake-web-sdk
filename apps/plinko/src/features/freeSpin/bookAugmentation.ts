/**
 * Dev / fallback helpers only. Production wallet payout comes from republished math books
 * selected via play `meta` (`buildBetMetaPlayConditions`) — see crimson_plinko INTEGRATION.md.
 */
import type { BookEvent } from '../../game/typesBookEvent';

export function bookHasFreeSpinTrigger(events: BookEvent[]): boolean {
	return events.some((event) => event.type === 'freeSpinTrigger');
}

/**
 * Lookup books omit `freeSpinTrigger` when the spin meter fills via session carry-over.
 * Inject the event so `recordBookEvent` + deferred end-round can include the feature win.
 */
export function injectFreeSpinTriggerIfMeterFull(
	events: BookEvent[],
	spinMeterMax: number,
	_ballsPerDrop: number,
	_stakePerBall: number,
	segmentPayload: { segment: string; multiplier: number; amount: number },
): BookEvent[] {
	if (bookHasFreeSpinTrigger(events)) return events;
	const peakSpin = events.reduce((peak, event) => {
		if (event.type !== 'spinMeter') return peak;
		return Math.max(peak, event.value);
	}, 0);
	if (peakSpin < spinMeterMax) return events;

	const trigger: BookEvent = {
		index: 0,
		type: 'freeSpinTrigger',
		segment: segmentPayload.segment,
		multiplier: segmentPayload.multiplier,
		amount: segmentPayload.amount,
	};

	const settlementIndex = events.findIndex(
		(event) => event.type === 'setTotalWin' || event.type === 'finalWin',
	);
	const insertAt = settlementIndex >= 0 ? settlementIndex : events.length;
	const next = [...events];
	next.splice(insertAt, 0, trigger);
	return next.map((event, index) => ({ ...event, index }));
}
