import { playBet } from './utils';
import type { Bet } from './typesBookEvent';
import books from '../stories/data/base_books';

/** Play a math book locally when no RGS session is configured (dev / Storybook-style). */
export async function playDevLocalBook(): Promise<boolean> {
	if (!books.length) {
		console.warn(
			'[plinko] No local books. Run stake-math-sdk crimson_plinko and: pnpm run sync-math-books',
		);
		return false;
	}
	const index = Math.floor(Math.random() * books.length);
	const book = books[index] as Bet & { events: Bet['state'] };
	await playBet({ ...book, state: book.events });
	return true;
}
