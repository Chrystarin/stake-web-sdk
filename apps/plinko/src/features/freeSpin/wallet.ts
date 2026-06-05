import { API_AMOUNT_MULTIPLIER } from 'constants-shared/bet';
import { PUBLIC_CHROMATIC } from 'envs';
import { stateUrlDerived } from 'state-shared';
import { requestBetAction } from 'rgs-requests';

import { FREE_SPIN_SEGMENTS } from '../../game-logic/constants';
import { hasActiveRgsSession } from '../../game/plinkoSessionMeters';
import type { Bet } from '../../game/typesBookEvent';
import {
	applyFreeSpinActionBalance,
	freeSpinMultiplierFromSegment,
	hasMeaningfulFreeSpinWalletCredit,
	isFreeSpinBonusWheelSegment,
	multiplyRoundWinByFreeSpinSegment,
	roundIncludesFreeSpinInRgsPayout,
} from './payout';
import { stateGame } from '../../game/stateGame.svelte';

const RGS_FREE_SPIN_SETTLE_ACTIONS = [
	'freeSpinTrigger',
	'free_spin_trigger',
	'freeSpinSettle',
	'sessionMeters',
] as const;

const FREE_SPIN_MULTIPLIER_SEGMENTS = FREE_SPIN_SEGMENTS.filter(
	(label) => !isFreeSpinBonusWheelSegment(label) && freeSpinMultiplierFromSegment(label) > 0,
);

export type FreeSpinWalletSettlement = {
	segment: string;
	multiplier: number;
	/** Win in stake currency units (same as HUD). */
	winAmount: number;
};

/**
 * Deterministic wheel segment per RGS round (varies by bet; not client RNG).
 * Used only when the served book omits `freeSpinTrigger` and RGS action returns no segment.
 */
export function fallbackFreeSpinSegmentFromRound(bet?: Bet): FreeSpinWalletSettlement {
	const roundKey = Number(
		(bet as { betID?: number })?.betID ?? (bet as { roundID?: number })?.roundID ?? 0,
	);
	const labels =
		FREE_SPIN_MULTIPLIER_SEGMENTS.length > 0
			? FREE_SPIN_MULTIPLIER_SEGMENTS
			: (['5X'] as const);
	const segment = labels[Math.abs(roundKey) % labels.length] ?? '5X';
	const multiplier = freeSpinMultiplierFromSegment(segment);
	const { totalWin } = multiplyRoundWinByFreeSpinSegment(segment, stateGame.pendingDropWinAmount);
	return { segment, multiplier, winAmount: totalWin };
}

/**
 * Credit free-spin win via `/bet/action` while the round is still open (before `/wallet/end-round`).
 */
export async function settleFreeSpinWalletCredit(
	settlement: FreeSpinWalletSettlement,
): Promise<boolean> {
	if (PUBLIC_CHROMATIC || stateUrlDerived.replay() || !hasActiveRgsSession()) return false;
	if (!hasMeaningfulFreeSpinWalletCredit(settlement.winAmount)) return false;
	if (roundIncludesFreeSpinInRgsPayout(stateGame.activeRoundBet)) {
		return true;
	}

	const amountApi = Math.round(settlement.winAmount * API_AMOUNT_MULTIPLIER);
	const multiplier =
		settlement.multiplier > 0
			? settlement.multiplier
			: freeSpinMultiplierFromSegment(settlement.segment);

	const meta = {
		segment: settlement.segment,
		multiplier,
		amount: settlement.winAmount,
		amount_api: amountApi,
		free_spin_settlement: true,
		spin_meter: 0,
		spinMeter: 0,
	};

	for (const action of RGS_FREE_SPIN_SETTLE_ACTIONS) {
		try {
			const actionData = await requestBetAction({
				rgsUrl: stateUrlDerived.rgsUrl(),
				sessionID: stateUrlDerived.sessionID(),
				action,
				meta,
			});
			applyFreeSpinActionBalance(actionData);
			if ((actionData as { balance?: { amount?: number } })?.balance?.amount != null) {
				return true;
			}
		} catch {
			// Try next action name configured on RGS.
		}
	}

	return false;
}
