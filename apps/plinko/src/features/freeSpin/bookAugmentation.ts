/**
 * Dev / fallback helpers only. Production wallet payout comes from republished math books
 * selected via play `meta` (`buildBetMetaPlayConditions`) — see crimson_plinko INTEGRATION.md.
 */
import type { BookEvent } from '../../game/typesBookEvent';

type PlinkoDropEvent = Extract<BookEvent, { type: 'plinkoDrop' }>;

export function bookHasFreeSpinTrigger(events: BookEvent[]): boolean {
	return events.some((event) => event.type === 'freeSpinTrigger');
}

function dropWinFromEvents(events: BookEvent[]): number {
	return events
		.filter((event): event is PlinkoDropEvent => event.type === 'plinkoDrop')
		.reduce(
			(total, drop) =>
				total +
				drop.outcomes.reduce(
					(sum, outcome) => sum + outcome.amount * (outcome.multiplier ?? 0),
					0,
				),
			0,
		);
}

function roundWagerFromEvents(events: BookEvent[]): number {
	const drop = events.find((event): event is PlinkoDropEvent => event.type === 'plinkoDrop');
	if (!drop) return 0;
	const balls = Math.max(1, drop.ballsPerDrop ?? drop.outcomes.length);
	const stake = Math.max(0, drop.stakePerBall ?? 0);
	return balls * stake;
}

/**
 * Lookup books omit `freeSpinTrigger` when the spin meter fills via session carry-over.
 * Inject the event and patch settlement so end-round `payoutMultiplier` includes the feature.
 */
export function injectFreeSpinTriggerIfMeterFull(
	events: BookEvent[],
	spinMeterMax: number,
	_ballsPerDrop: number,
	_stakePerBall: number,
	segmentPayload: { segment: string; multiplier: number; amount?: number },
): BookEvent[] {
	if (bookHasFreeSpinTrigger(events)) return events;
	const peakSpin = events.reduce((peak, event) => {
		if (event.type !== 'spinMeter') return peak;
		return Math.max(peak, event.value);
	}, 0);
	if (peakSpin < spinMeterMax) return events;

	const dropWin = dropWinFromEvents(events);
	const multiplier = segmentPayload.multiplier > 0 ? segmentPayload.multiplier : 1;
	const scaledTotalWin =
		segmentPayload.amount != null && segmentPayload.amount > 0
			? segmentPayload.amount >= dropWin * multiplier * 50
				? segmentPayload.amount / 100
				: segmentPayload.amount
			: dropWin * multiplier;
	const roundWager = roundWagerFromEvents(events);
	const payoutAmount =
		roundWager > 0 ? Math.round((scaledTotalWin / roundWager) * 100) : 0;
	const triggerAmount = Math.round(scaledTotalWin * 100);

	const trigger: BookEvent = {
		index: 0,
		type: 'freeSpinTrigger',
		segment: segmentPayload.segment,
		multiplier: segmentPayload.multiplier,
		amount: triggerAmount,
	};

	const settlementIndex = events.findIndex(
		(event) => event.type === 'setTotalWin' || event.type === 'finalWin',
	);
	const insertAt = settlementIndex >= 0 ? settlementIndex : events.length;
	const next = [...events];
	next.splice(insertAt, 0, trigger);
	return next.map((event, index) => {
		if (event.type === 'setTotalWin' || event.type === 'finalWin') {
			return { ...event, index, amount: payoutAmount };
		}
		return { ...event, index };
	});
}
