import { stateBet } from 'state-shared';
import { bookEventAmountToNormalisedAmount } from 'utils-shared/amount';

import { getBookRoundPayoutAmount } from '../features/freeSpin/payout';
import { stateGame } from './stateGame.svelte';
import type { Bet, BookEvent } from './typesBookEvent';

/**
 * Win display must mirror the served book and RGS wallet settlement — never client-recalculated
 * drop totals. Use `applyRgsRoundWinFromBookEventAmount` / `applyRgsRoundWinFromBet` only.
 */

/** Last `setTotalWin` / `finalWin` amount from a served book (×100 payout multiplier). */
export function getSettlementBookEventAmount(events: BookEvent[]): number {
	for (let i = events.length - 1; i >= 0; i--) {
		const event = events[i];
		if (event.type === 'finalWin' || event.type === 'setTotalWin') {
			return event.amount;
		}
	}
	return 0;
}

/** Currency win from RGS book settlement amount or bet `payoutMultiplier`. */
export function resolveRgsRoundWinCurrency(
	bookEventAmount?: number,
	bet?: Pick<Bet, 'payoutMultiplier'> | null,
): number {
	if (bookEventAmount != null && bookEventAmount > 0) {
		return bookEventAmountToNormalisedAmount(bookEventAmount);
	}
	return getBookRoundPayoutAmount(bet);
}

/** Sync betting panel, HUD, and win popup from served-book settlement (`setTotalWin` / `finalWin`). */
export function applyRgsRoundWinFromBookEventAmount(bookEventAmount: number): number {
	stateBet.winBookEventAmount = bookEventAmount;
	const currencyWin = bookEventAmountToNormalisedAmount(bookEventAmount);
	stateGame.winAmount = currencyWin;
	stateGame.winPopupAmount = currencyWin;
	return currencyWin;
}

export function applyRgsRoundWinFromBet(bet?: Pick<Bet, 'payoutMultiplier'> | null): number {
	const payoutMultiplier = bet?.payoutMultiplier ?? 0;
	if (payoutMultiplier <= 0) return 0;
	return applyRgsRoundWinFromBookEventAmount(payoutMultiplier);
}

export function seedRgsRoundWinFromBet(bet: Bet, events: BookEvent[]): void {
	const settlementAmount = getSettlementBookEventAmount(events) || bet.payoutMultiplier || 0;
	if (settlementAmount > 0) {
		applyRgsRoundWinFromBookEventAmount(settlementAmount);
	}
}
