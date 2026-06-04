import { API_AMOUNT_MULTIPLIER } from 'constants-shared/bet';
import { stateBet } from 'state-shared';

import { plinkoStakePerBall, plinkoWagerAmount } from '../../game/plinkoBet';
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

type FreeSpinPayoutInput = {
	amount?: number;
	multiplier?: number;
	segment?: string;
};

/**
 * Resolve free-spin payout in stake currency units (wager × segment multiplier).
 * Book `amount` is scaled from the book's stake per ball; falls back to multiplier × round wager.
 */
export function resolveFreeSpinPayoutAmount(
	payload: FreeSpinPayoutInput,
	wager = stateBet.wageredBetAmount > 0 ? stateBet.wageredBetAmount : plinkoWagerAmount(),
): number {
	const segment = payload.segment ?? '';
	if (isFreeSpinBonusWheelSegment(segment)) return 0;

	const bookStake = stateGame.lastBookStakePerBall > 0 ? stateGame.lastBookStakePerBall : 1;
	const stakeScale = plinkoStakePerBall() / bookStake;

	let amount = payload.amount ?? 0;
	if (amount > 0) {
		const expectedFromMultiplier =
			(payload.multiplier ?? 0) > 0 ? wager * (payload.multiplier as number) : 0;
		// Some pipelines store feature wins in ×100 integer units like `finalWin`.
		if (expectedFromMultiplier > 0 && amount >= expectedFromMultiplier * 50) {
			amount = amount / 100;
		}
		return amount * stakeScale;
	}

	const multiplier =
		(payload.multiplier ?? 0) > 0
			? payload.multiplier!
			: freeSpinMultiplierFromSegment(segment);
	if (multiplier > 0) return wager * multiplier;

	return 0;
}

/** Apply RGS balance from `/bet/action` when the response includes it. */
export function applyFreeSpinActionBalance(data: unknown): void {
	const balance = (data as { balance?: { amount?: number } })?.balance;
	if (balance?.amount === undefined) return;
	stateBet.balanceAmount = balance.amount / API_AMOUNT_MULTIPLIER;
}
