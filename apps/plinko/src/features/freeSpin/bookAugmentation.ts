/**
 * Dev / fallback helpers only. Production wallet payout comes from republished math books
 * selected via play `meta` (`buildBetMetaPlayConditions`) — see crimson_plinko INTEGRATION.md.
 */
import { plinkoWagerAmount } from '../../game/plinkoBet';
import { bookWillReachSpinMeterMax } from '../../game/plinkoRoundSettlement';
import type { Bet, BookEvent } from '../../game/typesBookEvent';
import { resolveFreeSpinPayoutAmount } from './payout';
import { fallbackFreeSpinSegmentFromRound } from './wallet';

export function bookHasFreeSpinTrigger(events: BookEvent[]): boolean {
	return events.some((event) => event.type === 'freeSpinTrigger');
}

/**
 * Lookup books omit `freeSpinTrigger` when the spin meter fills via session carry-over.
 * Inject the event and bump settlement so `recordBookEvent` + deferred end-round can include the feature win.
 */
export function injectFreeSpinTriggerIfMeterFull(
	events: BookEvent[],
	spinMeterMax: number,
	ballsPerDrop: number,
	stakePerBall: number,
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

function bumpSettlementWinAmounts(events: BookEvent[], extraWinCurrency: number): BookEvent[] {
	const wager = plinkoWagerAmount();
	if (extraWinCurrency <= 0 || wager <= 0) return events;
	const extraAmountInt = Math.round((extraWinCurrency / wager) * 100);
	if (extraAmountInt <= 0) return events;
	return events.map((event) => {
		if (event.type === 'setTotalWin' || event.type === 'finalWin') {
			return { ...event, amount: event.amount + extraAmountInt };
		}
		return event;
	});
}

/** Augment an RGS book when session carry-over fills the spin meter but the served book omits the feature. */
export function augmentBetBookForSessionMeterFull(bet: Bet): { bet: Bet; augmented: boolean } {
	const events = bet.state ?? [];
	if (bookHasFreeSpinTrigger(events)) return { bet, augmented: false };
	if (!bookWillReachSpinMeterMax(events)) return { bet, augmented: false };

	const drop = events.find(
		(event): event is Extract<BookEvent, { type: 'plinkoDrop' }> => event.type === 'plinkoDrop',
	);
	if (!drop) return { bet, augmented: false };

	const spinMeterMax = drop.spinMeterMax != null && drop.spinMeterMax > 0 ? drop.spinMeterMax : 10;
	const ballsPerDrop = Math.max(1, Math.floor(drop.ballsPerDrop || 1));
	const stakePerBall = drop.stakePerBall > 0 ? drop.stakePerBall : 1;
	const roundWager = stakePerBall * ballsPerDrop;

	const fallback = fallbackFreeSpinSegmentFromRound(bet);
	const freeSpinWin = resolveFreeSpinPayoutAmount({
		segment: fallback.segment,
		multiplier: fallback.multiplier,
		amount: roundWager * fallback.multiplier,
	});

	let nextEvents = injectFreeSpinTriggerIfMeterFull(
		events,
		spinMeterMax,
		ballsPerDrop,
		stakePerBall,
		{
			segment: fallback.segment,
			multiplier: fallback.multiplier,
			amount: freeSpinWin > 0 ? freeSpinWin : roundWager * fallback.multiplier,
		},
	);
	nextEvents = bumpSettlementWinAmounts(nextEvents, freeSpinWin);

	return { bet: { ...bet, state: nextEvents }, augmented: true };
}
