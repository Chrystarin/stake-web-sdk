import { stateBet } from 'state-shared';

import { playBet } from './utils';
import type { Bet, BookEvent } from './typesBookEvent';
import { stateGame, stateGameDerived } from './stateGame.svelte';
import books from '../stories/data/base_books';

type RawBook = { events?: Bet['state']; state?: Bet['state']; payoutMultiplier?: number };
type BooksByMode = Record<string, RawBook[]>;

const ROOM_EVENT: Record<string, string> = {
	plinko: 'plinkoBonus',
	wheel: 'wheelBonus',
	chest: 'chestBonus',
	tower: 'towerBonus',
};

/**
 * Play a math book locally when no RGS session is configured (dev / preview).
 *
 * The book MUST come from the mode the board committed to: each ticket has its own book set,
 * and a book from another ticket would pay the wrong spots.
 *
 * `?force=<kind>` (or `?bonus=<room>`) narrows the pick; see docs/dev-debug.md.
 */
export async function playDevLocalBook(): Promise<void> {
	const byMode = books as unknown as BooksByMode;
	const mode = stateBet.activeBetModeKey;
	const modeBooks = byMode[mode];

	if (!modeBooks?.length) {
		console.warn(
			`[crazy-time] No local books for mode "${mode}". Run the math ` +
				`(stake-math-sdk games/crazy_time), then: pnpm --filter crazy-time sync-math-books`,
		);
		stateGame.rolling = false;
		return;
	}

	const raw = pickBook(modeBooks, readForce());
	const bet = { state: raw.events ?? raw.state ?? [] } as Bet;

	// The player is charged for every chip on the board: amount x cost.
	const stake = stateGameDerived.totalStake();
	stateBet.balanceAmount = Math.max(0, stateBet.balanceAmount - stake);
	stateBet.winBookEventAmount = 0;

	await playBet(bet);

	// Book amounts are payout x100 in units of `amount` (the chip), so the cash win scales by
	// betAmount, NOT by the total stake, which cost already accounts for.
	const winCash = (stateBet.winBookEventAmount / 100) * stateBet.betAmount;
	stateBet.balanceAmount = stateBet.balanceAmount + winCash;
	stateGame.rolling = false;
}

type Force = { kind: string; value: number | null } | null;

const readForce = (): Force => {
	if (typeof window === 'undefined') return null;
	const params = new URLSearchParams(window.location.search);
	const raw = params.get('force') ?? params.get('bonus');
	if (!raw) return null;
	const [kind, value] = raw.toLowerCase().split(':');
	return { kind, value: value !== undefined && value !== '' ? Number(value) : null };
};

const eventsOf = (book: RawBook): BookEvent[] => (book.events ?? book.state ?? []) as BookEvent[];

const roomOf = (book: RawBook) =>
	eventsOf(book).find((e): e is Extract<BookEvent, { multiplier: number; total: number }> =>
		e.type.endsWith('Bonus'),
	);

const matches = (book: RawBook, kind: string): boolean => {
	const events = eventsOf(book);
	const payout = book.payoutMultiplier ?? 0;
	switch (kind) {
		case 'bonus':
			return events.some((e) => e.type.endsWith('Bonus'));
		case 'number':
			return !events.some((e) => e.type.endsWith('Bonus'));
		case 'topslot':
			return events.some((e) => e.type === 'wheelSpin' && e.topSlotApplied);
		case 'win':
			return payout > 0;
		case 'loss':
			return payout === 0;
		default:
			return ROOM_EVENT[kind] ? events.some((e) => e.type === ROOM_EVENT[kind]) : false;
	}
};

const pickBook = (modeBooks: RawBook[], force: Force): RawBook => {
	const random = (pool: RawBook[]) => pool[Math.floor(Math.random() * pool.length)];
	if (!force) return random(modeBooks);

	if (force.kind === 'maxwin') {
		return modeBooks.reduce((best, book) =>
			(book.payoutMultiplier ?? 0) > (best.payoutMultiplier ?? 0) ? book : best,
		);
	}

	let pool = modeBooks.filter((book) => matches(book, force.kind));
	if (!pool.length) {
		console.warn(`[crazy-time] ?force=${force.kind}: no sampled book of that kind for this ticket; playing a random one`);
		return random(modeBooks);
	}
	if (force.value !== null && ROOM_EVENT[force.kind]) {
		const exact = pool.filter((book) => roomOf(book)?.multiplier === force.value);
		if (exact.length) pool = exact;
		else console.warn(`[crazy-time] ?force=${force.kind}:${force.value}: no sampled book with that value; playing any ${force.kind}`);
	}
	return random(pool);
};
