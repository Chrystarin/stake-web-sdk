import { playBet } from './utils';
import type { Bet, BookEvent } from './typesBookEvent';
import books from '../stories/data/base_books';
import { stateBet } from 'state-shared';
import config from './config';
import { stateGame } from './stateGame.svelte';
import { alignBookForPlayback } from './alignBookForPlayback';
import { plinkoWagerAmount } from './plinkoBet';
import { bookEventAmountToNormalisedAmount } from 'utils-shared/amount';
import { injectBonusRoundIfMeterFull } from '../features/bonus';
import { injectFreeSpinTriggerIfMeterFull } from '../features/freeSpin';
import {
	getDevRgsBonusLevel,
	getDevRgsBonusMeter,
	getDevRgsSpinMeter,
	offsetBetRelativeBonusMeterEvents,
	offsetBetRelativeSpinMeterEvents,
} from './plinkoSessionMeters';

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
	const ballsPerDrop = Math.max(1, Math.floor(stateGame.ballPerDrop || 1));
	const stakePerBall = Math.max(0, Number(stateBet.betAmount) || 0);

	let aligned = alignBookForPlayback({ ...book, state: [...book.events] });
	let patchedEvents: BookEvent[] = [...(aligned.state ?? [])];

	const drop = patchedEvents.find(
		(event): event is PlinkoDropEvent => event.type === 'plinkoDrop',
	);
	if (drop) {
		const sessionSpinMeter = getDevRgsSpinMeter();
		const sessionBonusMeter = getDevRgsBonusMeter();
		const sessionBonusLevel = getDevRgsBonusLevel();
		patchedEvents = patchedEvents.map((event) => {
			if (event.type !== 'plinkoDrop') return event;
			return {
				...event,
				spinMeterStart: event.spinMeterStart ?? sessionSpinMeter,
				bonusMeterStart: event.bonusMeterStart ?? sessionBonusMeter,
				bonusLevelStart: event.bonusLevelStart ?? sessionBonusLevel,
			};
		});
	}

	const spinMeterStart = drop?.spinMeterStart ?? getDevRgsSpinMeter();
	if (spinMeterStart > 0) {
		patchedEvents = offsetBetRelativeSpinMeterEvents(patchedEvents, spinMeterStart);
	}

	const bonusMeterStart = drop?.bonusMeterStart ?? getDevRgsBonusMeter();
	if (bonusMeterStart > 0) {
		patchedEvents = offsetBetRelativeBonusMeterEvents(patchedEvents, bonusMeterStart);
	}

	const spinMeterMax = drop?.spinMeterMax ?? config.spinMeterMax;
	const bonusMeterMax = drop?.bonusMeterMax ?? config.bonusMeterMax;
	patchedEvents = injectBonusRoundIfMeterFull(patchedEvents, bonusMeterMax, 50);
	patchedEvents = injectFreeSpinTriggerIfMeterFull(
		patchedEvents,
		spinMeterMax,
		ballsPerDrop,
		stakePerBall,
		{ segment: '5X', multiplier: 5 },
	);

	const finalWinEvent = patchedEvents.find((event) => event.type === 'finalWin');
	const payoutMultiplier = finalWinEvent?.amount ?? aligned.payoutMultiplier ?? 0;

	return { ...aligned, payoutMultiplier, state: patchedEvents };
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

	const index = Math.floor(Math.random() * matchingBooks.length);
	const book = matchingBooks[index];
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
