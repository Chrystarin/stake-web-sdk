import { stateBet } from 'state-shared';

import { playBet } from './utils';
import type { Bet } from './typesBookEvent';
import books from '../stories/data/base_books';

type RawBook = { events?: Bet['state']; state?: Bet['state']; payoutMultiplier?: number };

/**
 * Play a math book locally when no RGS session is configured (dev / preview).
 * Deducts the stake, plays the book's events through the animation pipeline, then
 * credits the served win (setTotalWin -> stateBet.winBookEventAmount).
 */
export async function playDevLocalBook(): Promise<void> {
	const allBooks = books as unknown as RawBook[];
	if (!allBooks.length) {
		console.warn('[Colour Dice] No local books. Run stake-math-sdk games/colour_dice, then: pnpm --filter colour-dice sync-math-books');
		return;
	}

	const raw = allBooks[Math.floor(Math.random() * allBooks.length)];
	const events = raw.events ?? raw.state ?? [];
	const bet = { state: events } as Bet;

	stateBet.balanceAmount = Math.max(0, stateBet.balanceAmount - stateBet.betAmount);
	stateBet.winBookEventAmount = 0;

	await playBet(bet);

	// winBookEventAmount is payout*100 relative to a base bet of 1.
	const winCash = (stateBet.winBookEventAmount / 100) * stateBet.betAmount;
	stateBet.balanceAmount = stateBet.balanceAmount + winCash;
}
