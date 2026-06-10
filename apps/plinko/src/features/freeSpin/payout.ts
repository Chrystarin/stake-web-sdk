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

type FreeSpinPayoutInput = {
	amount?: number;
	multiplier?: number;
	segment?: string;
};

/** Base drop win for the active round (excludes bonus-session wins; uses snapshot when set). */
export function getFreeSpinBaseRoundWin(): number {
	if (stateGame.freeSpinBaseRoundWin > 0) return stateGame.freeSpinBaseRoundWin;
	if (stateGame.bonusAwardedThisRound) return stateGame.baseRoundDropWinAmount;
	return stateGame.pendingDropWinAmount;
}

function resolveFreeSpinSegmentMultiplier(
	segmentLabel: string,
	payload?: FreeSpinPayoutInput,
): number {
	const normalizedPayloadSegment = String(payload?.segment ?? '')
		.toUpperCase()
		.replace(/x$/i, 'X');
	const normalizedLabel = String(segmentLabel || '')
		.toUpperCase()
		.replace(/x$/i, 'X');
	if (
		(payload?.multiplier ?? 0) > 0 &&
		(!normalizedPayloadSegment || normalizedPayloadSegment === normalizedLabel)
	) {
		return payload!.multiplier!;
	}
	return freeSpinMultiplierFromSegment(segmentLabel);
}

/**
 * Authoritative free-spin total for display/wallet: base drop win × math segment multiplier.
 * Book `amount` is only used when it matches base × multiplier after stake scaling.
 */
export function resolveFreeSpinRoundTotalWin(
	segmentLabel: string,
	payload?: FreeSpinPayoutInput,
	baseRoundWin = getFreeSpinBaseRoundWin(),
): number {
	if (isFreeSpinBonusWheelSegment(segmentLabel)) return baseRoundWin;

	const multiplier = resolveFreeSpinSegmentMultiplier(segmentLabel, payload);
	if (multiplier <= 0 || baseRoundWin <= 0) return baseRoundWin;

	const fromBase = baseRoundWin * multiplier;
	const bookAmount = payload?.amount ?? 0;
	if (bookAmount <= 0) return fromBase;

	const scaledBook = normalizeBookFreeSpinAmount(bookAmount, baseRoundWin, multiplier);
	if (scaledBook <= 0) return fromBase;

	if (Math.abs(scaledBook - fromBase) <= FREE_SPIN_PAYOUT_EPSILON) return fromBase;
	if (scaledBook > fromBase + FREE_SPIN_PAYOUT_EPSILON) return scaledBook;
	return fromBase;
}

/** Multiply the current round's settled drop win by the landed free-spin segment. */
export function multiplyRoundWinByFreeSpinSegment(
	segmentLabel: string,
	roundWin = getFreeSpinBaseRoundWin(),
): FreeSpinRoundWinResult {
	if (isFreeSpinBonusWheelSegment(segmentLabel)) {
		return { multiplier: 0, roundWin, totalWin: roundWin };
	}
	const multiplier = freeSpinMultiplierFromSegment(segmentLabel);
	if (multiplier <= 0 || roundWin <= 0) {
		return { multiplier, roundWin, totalWin: roundWin };
	}
	const totalWin = resolveFreeSpinRoundTotalWin(
		segmentLabel,
		stateGame.freeSpinTriggerPayload,
		roundWin,
	);
	return { multiplier, roundWin, totalWin };
}

const FREE_SPIN_PAYOUT_EPSILON = 0.000001;

function freeSpinStakeScale(): number {
	const bookStake = stateGame.lastBookStakePerBall > 0 ? stateGame.lastBookStakePerBall : 1;
	return plinkoStakePerBall() / bookStake;
}

/** Book / bet `payoutMultiplier` is stored as return multiple × 100 (e.g. 465 → 4.65×). */
export function bookPayoutMultiplierDecimal(payoutMultiplier?: number): number {
	return Math.max(0, (payoutMultiplier ?? 0) / 100);
}

/** Authoritative round payout from the served book (`payoutMultiplier` × wager). */
export function getBookRoundPayoutAmount(
	bet?: { payoutMultiplier?: number } | null,
	wager = stateBet.wageredBetAmount > 0 ? stateBet.wageredBetAmount : plinkoWagerAmount(),
): number {
	const multiplier = bookPayoutMultiplierDecimal(bet?.payoutMultiplier);
	if (multiplier <= 0 || wager <= 0) return 0;
	return multiplier * wager;
}

function normalizeBookFreeSpinAmount(
	rawAmount: number,
	baseRoundWin: number,
	multiplier: number,
): number {
	if (rawAmount <= 0) return 0;
	const fromBase = baseRoundWin * multiplier;
	const asTimes100 = (rawAmount / 100) * freeSpinStakeScale();
	const asRawCurrency = rawAmount * freeSpinStakeScale();
	// New math books use ×100 at book stake; older fixtures may use raw currency floats.
	if (fromBase > FREE_SPIN_PAYOUT_EPSILON) {
		if (Math.abs(asTimes100 - fromBase) <= Math.abs(asRawCurrency - fromBase)) {
			return asTimes100;
		}
		return asRawCurrency;
	}
	return rawAmount >= 100 ? asTimes100 : asRawCurrency;
}

/**
 * Scaled total win after the free-spin segment (round drop win × multiplier).
 * Book `amount` is scaled from the book's stake per ball when present.
 */
export function resolveFreeSpinPayoutAmount(
	payload: FreeSpinPayoutInput,
	roundWin = getFreeSpinBaseRoundWin(),
): number {
	const segment = payload.segment ?? '';
	if (isFreeSpinBonusWheelSegment(segment)) return 0;
	return resolveFreeSpinRoundTotalWin(segment, payload, roundWin);
}

/** Incremental wallet credit: scaled total minus the base drop win already in the round. */
export function resolveFreeSpinFeatureCredit(
	segmentLabel: string,
	roundWin = getFreeSpinBaseRoundWin(),
	bookPayload?: FreeSpinPayoutInput,
): number {
	if (isFreeSpinBonusWheelSegment(segmentLabel)) return 0;

	const baseWin = roundWin;
	const totalWin = resolveFreeSpinRoundTotalWin(
		segmentLabel,
		bookPayload ?? stateGame.freeSpinTriggerPayload,
		baseWin,
	);
	return totalWin - baseWin;
}

/** True when the served book's payout already includes feature wins (end-round is enough). */
export function bookRoundPayoutIncludesFreeSpin(
	bet: { payoutMultiplier?: number } | undefined,
	dropWin: number,
	wager = stateBet.wageredBetAmount > 0 ? stateBet.wageredBetAmount : plinkoWagerAmount(),
): boolean {
	const roundPayout = getBookRoundPayoutAmount(bet, wager);
	if (roundPayout <= FREE_SPIN_PAYOUT_EPSILON) return false;
	return roundPayout > dropWin + FREE_SPIN_PAYOUT_EPSILON;
}

/**
 * Stake RGS settles free-spin wins via `/wallet/end-round` (book `payoutMultiplier`), not `/bet/action`.
 * When true, skip client-side action credits that return 404 on production RGS.
 */
export function roundIncludesFreeSpinInRgsPayout(
	bet?: Pick<Bet, 'payoutMultiplier' | 'state'> | null,
	dropWin = getFreeSpinBaseRoundWin(),
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
