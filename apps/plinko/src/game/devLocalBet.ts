import { playBet } from './utils';
import type { Bet } from './typesBookEvent';
import books from '../stories/data/base_books';
import { stateBet } from 'state-shared';
import { stateGame } from './stateGame.svelte';
import { alignBookForPlayback } from './alignBookForPlayback';
import { plinkoWagerAmount } from './plinkoBet';
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
	const ballsPerDrop = Math.max(1, Math.floor(stateGame.ballPerDrop || 1));
	const matchingBooks = (books as (Bet & { events: Bet['state'] })[]).filter((book) =>
		bookMatchesBallsPerDrop(book, ballsPerDrop),
	);
	if (!matchingBooks.length) {
		console.warn(
			`[One-Eyed Willy's Plinko] No local books for ballsPerDrop=${ballsPerDrop}. Run sync-math-books after regenerating math strata.`,
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
		const evs = (b) => b.events ?? b.state ?? [];
		// A free spin landing on BONUS also produces a `bonusRoulette` (the chain) — exclude those for
		// `?force=bonus` so we get the BONUS-METER trigger directly, not the free-spin wheel first.
		const isChainBonus = (b) =>
			evs(b).some(
				(e) => e.type === 'freeSpinTrigger' && String(e.segment ?? '').toUpperCase() === 'BONUS',
			);
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
