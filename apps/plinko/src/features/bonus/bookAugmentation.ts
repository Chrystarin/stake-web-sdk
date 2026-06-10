/**
 * Dev / fallback helpers only. Production wallet payout comes from republished math books
 * selected via play `meta` (`buildBetMetaPlayConditions`) — see crimson_plinko INTEGRATION.md.
 */
import type { BookEvent } from '../../game/typesBookEvent';

export function bookHasBonusRoulette(events: BookEvent[]): boolean {
	return events.some((event) => event.type === 'bonusRoulette');
}

/**
 * Lookup books omit `bonusRoulette` when the bonus meter fills via session carry-over.
 * Inject wheel + bonus round so deferred settlement and presentation can run.
 */
export function injectBonusRoundIfMeterFull(
	events: BookEvent[],
	bonusMeterMax: number,
	freeBalls: number,
): BookEvent[] {
	if (bookHasBonusRoulette(events)) return events;
	const peakBonus = events.reduce((peak, event) => {
		if (event.type !== 'bonusMeter') return peak;
		return Math.max(peak, event.value);
	}, 0);
	if (peakBonus < bonusMeterMax) return events;

	const roulette: BookEvent = {
		index: 0,
		type: 'bonusRoulette',
		freeBalls,
	};
	const bonusRound: BookEvent = {
		index: 0,
		type: 'bonusRound',
		freeBalls,
		outcomes: [],
		level: 0,
		ballsPlayed: 0,
	};

	const settlementIndex = events.findIndex(
		(event) => event.type === 'setTotalWin' || event.type === 'finalWin',
	);
	const insertAt = settlementIndex >= 0 ? settlementIndex : events.length;
	const next = [...events];
	next.splice(insertAt, 0, roulette, bonusRound);
	return next.map((event, index) => ({ ...event, index }));
}
