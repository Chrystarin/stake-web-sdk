import { API_AMOUNT_MULTIPLIER } from 'constants-shared/bet';
import { stateBet } from 'state-shared';

import { bookHasFreeSpinTrigger } from './bookAugmentation';
import { plinkoStakePerBall, plinkoWagerAmount } from '../../game/plinkoBet';
import type { Bet } from '../../game/typesBookEvent';
import { stateGame } from '../../game/stateGame.svelte';

export function isFreeSpinBonusWheelSegment(segmentLabel: string): boolean {
	const normalized = String(segmentLabel || '')
		.toUpperCase()
		.replace(/[^A-Z0-9]/g, '');
	return normalized === 'FREEBONUS' || normalized === 'BONUS';
}

/** Parse multiplier from wheel labels such as `5X` or `0.5X`. */
export function freeSpinMultiplierFromSegment(segmentLabel: string): number {
	const numeric = Number.parseFloat(String(segmentLabel).replace(/[^0-9.]/g, ''));
	return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
}

export type FreeSpinRoundWinResult = {
	multiplier: number;
	roundWin: number;
	totalWin: number;
};

/** Multiply the current round's settled drop win by the landed free-spin segment. */
export function multiplyRoundWinByFreeSpinSegment(
	segmentLabel: string,
	roundWin = stateGame.pendingDropWinAmount,
): FreeSpinRoundWinResult {
	if (isFreeSpinBonusWheelSegment(segmentLabel)) {
		return { multiplier: 0, roundWin, totalWin: roundWin };
	}
	const multiplier = freeSpinMultiplierFromSegment(segmentLabel);
	if (multiplier <= 0 || roundWin <= 0) {
		return { multiplier, roundWin, totalWin: roundWin };
	}
	return { multiplier, roundWin, totalWin: roundWin * multiplier };
}

type FreeSpinPayoutInput = {
	amount?: number;
	multiplier?: number;
	segment?: string;
};

const FREE_SPIN_PAYOUT_EPSILON = 0.000001;

function freeSpinStakeScale(): number {
	const bookStake = stateGame.lastBookStakePerBall > 0 ? stateGame.lastBookStakePerBall : 1;
	return plinkoStakePerBall() / bookStake;
}

function normalizeBookFreeSpinAmount(
	rawAmount: number,
	multiplier: number,
	roundWin: number,
	wager: number,
): number {
	let amount = rawAmount;
	if (amount <= 0) return 0;

	const expectedFromRound = multiplier > 0 ? roundWin * multiplier : 0;
	const expectedFromWager = multiplier > 0 ? wager * multiplier : 0;
	const scaleHint = Math.max(expectedFromRound, expectedFromWager);
	// Some pipelines store feature wins in ×100 integer units like `finalWin`.
	if (scaleHint > 0 && amount >= scaleHint * 50) {
		amount = amount / 100;
	}
	return amount * freeSpinStakeScale();
}

/**
 * Scaled total win after the free-spin segment (round drop win × multiplier).
 * Book `amount` is scaled from the book's stake per ball when present.
 */
export function resolveFreeSpinPayoutAmount(
	payload: FreeSpinPayoutInput,
	roundWin = stateGame.pendingDropWinAmount,
	wager = stateBet.wageredBetAmount > 0 ? stateBet.wageredBetAmount : plinkoWagerAmount(),
): number {
	const segment = payload.segment ?? '';
	if (isFreeSpinBonusWheelSegment(segment)) return 0;

	const multiplier =
		(payload.multiplier ?? 0) > 0
			? payload.multiplier!
			: freeSpinMultiplierFromSegment(segment);

	const bookAmount = payload.amount ?? 0;
	if (bookAmount > 0) {
		return normalizeBookFreeSpinAmount(bookAmount, multiplier, roundWin, wager);
	}

	if (multiplier > 0 && roundWin > 0) return roundWin * multiplier;
	return 0;
}

/** Incremental wallet credit: scaled total minus the base drop win already in the round. */
export function resolveFreeSpinFeatureCredit(
	segmentLabel: string,
	roundWin = stateGame.pendingDropWinAmount,
	bookPayload?: FreeSpinPayoutInput,
): number {
	if (isFreeSpinBonusWheelSegment(segmentLabel)) return 0;

	const { roundWin: baseWin, totalWin } = multiplyRoundWinByFreeSpinSegment(
		segmentLabel,
		roundWin,
	);
	const authoritativeTotal =
		bookPayload != null
			? resolveFreeSpinPayoutAmount(bookPayload, baseWin)
			: (stateGame.serverFreeSpinWinAmount ?? totalWin);
	const scaledTotal = authoritativeTotal > 0 ? authoritativeTotal : totalWin;
	return scaledTotal - baseWin;
}

/** True when the served book's payout already includes feature wins (end-round is enough). */
export function bookRoundPayoutIncludesFreeSpin(
	bet: { payoutMultiplier?: number } | undefined,
	dropWin: number,
	wager = stateBet.wageredBetAmount > 0 ? stateBet.wageredBetAmount : plinkoWagerAmount(),
): boolean {
	const roundPayout = (bet?.payoutMultiplier ?? 0) * wager;
	if (roundPayout <= FREE_SPIN_PAYOUT_EPSILON) return false;
	return roundPayout > dropWin + FREE_SPIN_PAYOUT_EPSILON;
}

/**
 * Stake RGS settles free-spin wins via `/wallet/end-round` (book `payoutMultiplier`), not `/bet/action`.
 * When true, skip client-side action credits that return 404 on production RGS.
 */
export function roundIncludesFreeSpinInRgsPayout(
	bet?: Pick<Bet, 'payoutMultiplier' | 'state'> | null,
	dropWin = stateGame.pendingDropWinAmount,
): boolean {
	if (stateGame.freeSpinSettledFromBook) return true;
	if (bookHasFreeSpinTrigger(bet?.state ?? stateGame.activeBookEvents)) return true;
	return bookRoundPayoutIncludesFreeSpin(bet ?? undefined, dropWin);
}

export function hasMeaningfulFreeSpinWalletCredit(amount: number): boolean {
	return Math.abs(amount) > FREE_SPIN_PAYOUT_EPSILON;
}

/** Apply RGS balance from `/bet/action` when the response includes it. */
export function applyFreeSpinActionBalance(data: unknown): void {
	const balance = (data as { balance?: { amount?: number } })?.balance;
	if (balance?.amount === undefined) return;
	stateBet.balanceAmount = balance.amount / API_AMOUNT_MULTIPLIER;
}
