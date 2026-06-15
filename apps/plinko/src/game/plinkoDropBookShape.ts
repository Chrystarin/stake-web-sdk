import { plinkoBallsPerDrop } from './plinkoBet';
import { buildBetMetaPlayConditions, plinkoCriteriaForBallsPerDrop } from './plinkoSessionMeters';
import { plinkoBetModeForBallsPerDrop } from './plinkoBetMode';
import type { Bet, BookEvent } from './typesBookEvent';
export type PlinkoDropEvent = Extract<BookEvent, { type: 'plinkoDrop' }>;

export function getPlinkoDropFromEvents(events: BookEvent[]): PlinkoDropEvent | undefined {
	return events.find((event): event is PlinkoDropEvent => event.type === 'plinkoDrop');
}

export function getPlinkoDropFromBet(bet: Bet | undefined): PlinkoDropEvent | undefined {
	const events = bet?.state;
	if (!Array.isArray(events)) return undefined;
	return getPlinkoDropFromEvents(events);
}

export function bookBallsPerDrop(drop: PlinkoDropEvent | undefined): number {
	if (!drop) return 0;
	return Math.max(1, drop.ballsPerDrop ?? drop.outcomes?.length ?? 0);
}

export function plinkoDropMatchesUi(drop: PlinkoDropEvent | undefined): boolean {
	if (!drop) return true;
	return bookBallsPerDrop(drop) === plinkoBallsPerDrop();
}

export function readBetCriteria(bet: Bet | undefined): string | undefined {
	if (!bet) return undefined;
	const raw = (bet as Bet & { criteria?: string }).criteria;
	return typeof raw === 'string' && raw.length > 0 ? raw : undefined;
}

export function plinkoDropStratumMismatchMessage(
	drop: PlinkoDropEvent | undefined,
	uiBalls = plinkoBallsPerDrop(),
	bet?: Bet,
): string | undefined {
	if (!drop) return undefined;
	const bookBalls = bookBallsPerDrop(drop);
	if (bookBalls === uiBalls) return undefined;
	const expectedCriteria = plinkoCriteriaForBallsPerDrop(uiBalls);
	const servedCriteria = readBetCriteria(bet);
	const meta = buildBetMetaPlayConditions();
		return (
		`Round book is for ${bookBalls} balls but the UI is set to ${uiBalls}. ` +
		`Expected RGS mode ${plinkoBetModeForBallsPerDrop(uiBalls)}` +
		(servedCriteria ? ` but book criteria is ${servedCriteria}` : '') +
		`. Use tier bet modes (baseone/baseten/basetwenty/basefifty), republish math, new session, or ?localBooks=1 in dev. ` +
		`Sent meta: ${JSON.stringify(meta)}`
	);
}