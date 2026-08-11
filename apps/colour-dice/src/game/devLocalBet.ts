import { stateBet } from 'state-shared';

import { playBet } from './utils';
import type { Bet } from './typesBookEvent';
import { stateGame, stateGameDerived } from './stateGame.svelte';
import books from '../stories/data/base_books';

type RawBook = { events?: Bet['state']; state?: Bet['state']; payoutMultiplier?: number };
type BooksByMode = Record<string, RawBook[]>;

/**
 * Play a math book locally when no RGS session is configured (dev / preview).
 *
 * The book MUST come from the mode the board committed to: each chip layout has its own
 * book set, and a book from another layout would describe a different number of backed
 * colours than the player actually staked.
 */
export async function playDevLocalBook(): Promise<void> {
	const byMode = books as unknown as BooksByMode;
	const mode = stateBet.activeBetModeKey;
	const modeBooks = byMode[mode];

	if (!modeBooks?.length) {
		console.warn(
			`[colour-dice] No local books for mode "${mode}". Run the math ` +
				`(stake-math-sdk games/colour_dice), then: pnpm --filter colour-dice sync-math-books`,
		);
		stateGame.rolling = false;
		return;
	}

	const raw = modeBooks[Math.floor(Math.random() * modeBooks.length)];
	const bet = { state: raw.events ?? raw.state ?? [] } as Bet;

	// The player is charged for every chip on the board: amount x cost.
	const stake = stateGameDerived.totalStake();
	stateBet.balanceAmount = Math.max(0, stateBet.balanceAmount - stake);
	stateBet.winBookEventAmount = 0;

	await playBet(bet);

	// Book amounts are payout x100 in units of `amount` (the per-chip stake), so the cash
	// win scales by betAmount — NOT by the total stake, which cost already accounts for.
	const winCash = (stateBet.winBookEventAmount / 100) * stateBet.betAmount;
	stateBet.balanceAmount = stateBet.balanceAmount + winCash;
	stateGame.rolling = false;
}
