import type { Bet, BookEvent } from './typesBookEvent';
import {
	resolveRgsSpinMeterStart,
	spinMeterBookValuesAreBetRelative,
	spinMeterSessionValueFromBook,
} from './plinkoSessionMeters';

const FEATURE_EVENT_TYPES = new Set([
	'freeSpinTrigger',
	'bonusRound',
	'bonusRoulette',
]);

/** Book includes feature events that must finish before RGS wallet settlement. */
export function bookHasFeatureSettlement(events: BookEvent[]): boolean {
	return events.some((event) => FEATURE_EVENT_TYPES.has(event.type));
}

/**
 * Session carry-over + this book's spin-meter events will reach max (lookup books
 * often omit `freeSpinTrigger` even when the meter fills).
 */
export function bookWillReachSpinMeterMax(events: BookEvent[]): boolean {
	if (events.some((event) => event.type === 'freeSpinTrigger')) return true;

	const drop = events.find(
		(event): event is Extract<BookEvent, { type: 'plinkoDrop' }> => event.type === 'plinkoDrop',
	);
	if (!drop) return false;

	const max = drop.spinMeterMax != null && drop.spinMeterMax > 0 ? drop.spinMeterMax : 10;
	const start = resolveRgsSpinMeterStart(drop);
	const betRelative = spinMeterBookValuesAreBetRelative(events, start);

	let peak = start;
	for (const event of events) {
		if (event.type === 'spinMeter') {
			peak = spinMeterSessionValueFromBook(event.value, start, betRelative);
		}
	}
	return peak >= max;
}

/**
 * Use `bonusWin` timing: call `/wallet/end-round` after animations, not before.
 * See README FAQ and crimson_plinko INTEGRATION.md (stateful bonus / features).
 */
export function checkIsPlinkoDeferredSettlement(bet: Bet): boolean {
	const events = bet.state ?? [];
	if (bet.active === true) return true;
	if (bookHasFeatureSettlement(events)) return true;
	return bookWillReachSpinMeterMax(events);
}
