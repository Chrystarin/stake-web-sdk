import { playBet } from './utils';
import type { Bet } from './typesBookEvent';
import books from '../stories/data/base_books';
import { stateBet } from 'state-shared';
import { stateGame } from './stateGame.svelte';
import { alignBookForPlayback } from './alignBookForPlayback';
import { plinkoWagerAmount } from './plinkoBet';
import { buyBonusTierByKey } from './plinkoBetMode';
import { bookEventAmountToNormalisedAmount } from 'utils-shared/amount';

type PlinkoDropEvent = Extract<Bet['state'][number], { type: 'plinkoDrop' }>;

function bookMatchesBallsPerDrop(book: Bet & { events: Bet['state'] }, ballsPerDrop: number): boolean {
	const drop = book.events.find(
		(event): event is PlinkoDropEvent => event.type === 'plinkoDrop',
	);
	if (!drop) return false;
	const bookBalls = drop.ballsPerDrop ?? drop.outcomes?.length ?? 0;
	return bookBalls === ballsPerDrop;
}

const adaptBookForCurrentSelection = (book: Bet & { events: Bet['state'] }): Bet => {
	return alignBookForPlayback({ ...book, state: [...book.events] });
};

/**
 * Play a math book locally when no RGS session is configured (dev / Storybook-style).
 * Win display and balance credit use served-book settlement (`winBookEventAmount`), not client math.
 */
export async function playDevLocalBook(): Promise<boolean> {
	if (!books.length) {
		console.warn(
			"[One-Eyed Willy's Plinko] No local books. Run stake-math-sdk games/crimson_plinko, then: pnpm run sync-math-books",
		);
		return false;
	}
	const allBooks = books as (Bet & { events: Bet['state'] })[];
	const evs = (b: Bet & { events?: Bet['state'] }) => b.events ?? b.state ?? [];
	// A free spin landing on BONUS chains into a bonus (and shows the free-spin wheel first).
	const isChainBonus = (b: Bet & { events?: Bet['state'] }) =>
		evs(b).some(
			(e) => e.type === 'freeSpinTrigger' && String(e.segment ?? '').toUpperCase() === 'BONUS',
		);
	const ballsPerDrop = Math.max(1, Math.floor(stateGame.ballPerDrop || 1));

	// BUY BONUS (dev): a buy is bonus-only — the real book is an EMPTY drop + bonusRoulette + bonusRound.
	// Prefer a real buy book (empty drop) whose entry matches the purchased tier; fall back to any other
	// bonus-only book, then any non-chain bonus book. The wager already reflects the buy cost
	// (plinkoActiveBetMode → buy mode).
	const buyPending = Boolean(stateGame.pendingBuyBonusMode);
	const isBonusBook = (book: Bet & { events?: Bet['state'] }) =>
		evs(book).some((e) => e.type === 'bonusRoulette') && !isChainBonus(book);
	const isEmptyDrop = (book: Bet & { events?: Bet['state'] }) => {
		const drop = evs(book).find((e) => e.type === 'plinkoDrop') as PlinkoDropEvent | undefined;
		return !!drop && (drop.outcomes?.length ?? drop.ballsPerDrop ?? 0) === 0;
	};
	const entryFreeBalls = (book: Bet & { events?: Bet['state'] }) => {
		const r = evs(book).find((e) => e.type === 'bonusRoulette') as { freeBalls?: number } | undefined;
		return r?.freeBalls ?? 0;
	};
	// The purchased tier's entry count (e.g. buystandard → 71), to pick the matching real buy book.
	const tierEntry = buyPending
		? (buyBonusTierByKey((stateGame.pendingBuyBonusMode ?? '').replace(/^buy/, ''))?.freeBalls ?? 0)
		: 0;
	function pickBuyBooks(): (Bet & { events: Bet['state'] })[] {
		const tierMatch = allBooks.filter(
			(book) => isEmptyDrop(book) && isBonusBook(book) && entryFreeBalls(book) === tierEntry,
		);
		if (tierMatch.length) return tierMatch;
		const anyEmptyDrop = allBooks.filter((book) => isEmptyDrop(book) && isBonusBook(book));
		if (anyEmptyDrop.length) return anyEmptyDrop;
		return allBooks.filter(isBonusBook); // last resort: a base-mode bonus book (non-empty drop)
	}
	const matchingBooks = buyPending
		? pickBuyBooks()
		: allBooks.filter((book) => bookMatchesBallsPerDrop(book, ballsPerDrop));
	if (!matchingBooks.length) {
		console.warn(
			buyPending
				? "[One-Eyed Willy's Plinko] No local bonus books to demo a buy. Re-run import-math-books with bonus samples."
				: `[One-Eyed Willy's Plinko] No local books for ballsPerDrop=${ballsPerDrop}. Run sync-math-books after regenerating math strata.`,
		);
		return false;
	}
	const wager = plinkoWagerAmount();
	if (wager <= 0 || wager > stateBet.balanceAmount) {
		return false;
	}

	// DEV-ONLY testing aid (no effect on published RTP): `?force=bonus` / `?force=freespin` makes
	// dev-local play prefer a matching book that contains that feature, so you can summon it on demand.
	// Falls back to the full pool when the tier has no such book (e.g. free spin on 1-ball).
	let pool = matchingBooks;
	const force =
		typeof window !== 'undefined'
			? new URLSearchParams(window.location.search)
					.get('force')
					?.toLowerCase()
					.replace(/[^a-z]/g, '')
			: undefined;
	if (force === 'bonus' || force === 'freespin') {
		// `?force=bonus` excludes free-spin→BONUS chains (shared `isChainBonus`) so we get the BONUS-METER
		// trigger directly, not the free-spin wheel first.
		const forced =
			force === 'bonus'
				? matchingBooks.filter(
						(b) => evs(b).some((e) => e.type === 'bonusRoulette') && !isChainBonus(b),
					)
				: matchingBooks.filter((b) => evs(b).some((e) => e.type === 'freeSpinTrigger'));
		if (forced.length) pool = forced;
	}

	const index = Math.floor(Math.random() * pool.length);
	const book = pool[index];
	const adaptedBook = adaptBookForCurrentSelection(book);

	stateBet.balanceAmount -= wager;
	stateBet.wageredBetAmount = wager;

	try {
		await playBet({ ...adaptedBook, state: adaptedBook.state });
		const roundWin = bookEventAmountToNormalisedAmount(stateBet.winBookEventAmount);
		if (roundWin > 0) {
			stateBet.balanceAmount += roundWin;
		}
		return true;
	} catch (error) {
		stateBet.balanceAmount += wager;
		throw error;
	}
}
