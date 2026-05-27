import { playBet } from './utils';
import type { Bet } from './typesBookEvent';
import books from '../stories/data/base_books';
import { stateBet } from 'state-shared';
import { stateGame } from './stateGame.svelte';

type PlinkoDropEvent = Extract<Bet['state'][number], { type: 'plinkoDrop' }>;

const resizeOutcomes = (event: PlinkoDropEvent, targetCount: number): PlinkoDropEvent['outcomes'] => {
	const source = event.outcomes ?? [];
	const n = Math.max(1, Math.floor(targetCount || 1));
	if (!source.length) return [];
	if (source.length === n) return source;
	if (source.length > n) return source.slice(0, n);
	const expanded = Array.from({ length: n }, (_, i) => source[i % source.length]);
	return expanded;
};

const adaptBookForCurrentSelection = (book: Bet & { events: Bet['state'] }): Bet & { events: Bet['state'] } => {
	const ballsPerDrop = Math.max(1, Math.floor(stateGame.ballPerDrop || 1));
	const stakePerBall = Math.max(0, Number(stateBet.betAmount) || 0);

	const events = book.events.map((event) => {
		if (event.type !== 'plinkoDrop') return { ...event };

		const outcomes = resizeOutcomes(event, ballsPerDrop).map((outcome) => ({
			...outcome,
			amount: stakePerBall,
		}));

		return {
			...event,
			ballsPerDrop,
			stakePerBall,
			outcomes,
		};
	});

	const plinkoDrop = events.find(
		(event): event is Extract<typeof event, { type: 'plinkoDrop' }> => event.type === 'plinkoDrop',
	);
	const recalculatedWinAmount = plinkoDrop
		? Math.round(
				plinkoDrop.outcomes.reduce(
					(sum, outcome) => sum + outcome.amount * outcome.multiplier,
					0,
				) * 100,
			)
		: 0;

	const patchedEvents = events.map((event) => {
		if (event.type === 'setTotalWin' || event.type === 'finalWin') {
			return { ...event, amount: recalculatedWinAmount };
		}
		return event;
	});

	return { ...book, events: patchedEvents };
};

/** Play a math book locally when no RGS session is configured (dev / Storybook-style). */
export async function playDevLocalBook(): Promise<boolean> {
	if (!books.length) {
		console.warn(
			"[One-Eyed Willy's Plinko] No local books. Run stake-math-sdk games/crimson_plinko, then: pnpm run sync-math-books",
		);
		return false;
	}
	const index = Math.floor(Math.random() * books.length);
	const book = books[index] as Bet & { events: Bet['state'] };
	const adaptedBook = adaptBookForCurrentSelection(book);
	await playBet({ ...adaptedBook, state: adaptedBook.events });
	return true;
}
