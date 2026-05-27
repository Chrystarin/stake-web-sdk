import { playBet } from './utils';
import type { Bet } from './typesBookEvent';
import books from '../stories/data/base_books';
import { stateBet } from 'state-shared';
import { isSpinSlotRateIndex } from '../game-logic/spinSlot';
import config from './config';
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
	const coefficientSets = config.defaultCoefficientSets as number[][][];
	const fallbackCoefficients =
		coefficientSets[stateGame.difficultyLevelId]?.[Math.max(0, stateGame.rowCount - 8)] ?? [];

	const events = book.events.map((event) => {
		if (event.type !== 'plinkoDrop') return { ...event };

		const coefficients = event.coefficients?.length ? event.coefficients : fallbackCoefficients;
		const slotCount = coefficients.length;
		const outcomes = resizeOutcomes(event, ballsPerDrop).map((outcome) => {
			const hitSpinSlot =
				outcome.hitSpinSlot ??
				(slotCount > 0 && isSpinSlotRateIndex(outcome.rateIndex, slotCount));
			return {
				...outcome,
				amount: stakePerBall,
				multiplier: hitSpinSlot ? 0 : outcome.multiplier,
				hitSpinSlot,
				hitBonusPeg: outcome.hitBonusPeg ?? false,
			};
		});

		return {
			...event,
			ballsPerDrop,
			stakePerBall,
			coefficients,
			outcomes,
		};
	});

	const recalculatedWinAmount = Math.round(
		events
			.filter(
				(event): event is Extract<typeof event, { type: 'plinkoDrop' }> => event.type === 'plinkoDrop',
			)
			.reduce(
				(total, drop) =>
					total + drop.outcomes.reduce((sum, outcome) => sum + outcome.amount * outcome.multiplier, 0),
				0,
			) * 100,
	);

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
