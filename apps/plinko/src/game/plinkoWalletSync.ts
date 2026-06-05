import { API_AMOUNT_MULTIPLIER } from 'constants-shared/bet';
import { PUBLIC_CHROMATIC } from 'envs';
import { stateBet, stateUrlDerived } from 'state-shared';

import { stateGame } from './stateGame.svelte';
import { requestWalletBalance } from 'rgs-requests';

import { bookHasFreeSpinTrigger } from '../features/freeSpin/bookAugmentation';
import { applyFreeSpinActionBalance } from '../features/freeSpin/payout';
import { bookHasFeatureSettlement, bookWillReachSpinMeterMax } from './plinkoRoundSettlement';
import { hasActiveRgsSession } from './plinkoSessionMeters';
import type { Bet } from './typesBookEvent';

/** Route all paying / feature rounds through deferred end-round (after animations). */
export function getPlinkoBetType(bet: Bet): 'noWin' | 'singleRoundWin' | 'bonusWin' {
	const events = bet.state ?? [];
	if (bet.active === true) return 'bonusWin';
	if ((bet.payoutMultiplier ?? 0) > 0) return 'bonusWin';
	if (bookHasFeatureSettlement(events)) return 'bonusWin';
	if (bookHasFreeSpinTrigger(events)) return 'bonusWin';
	if (stateGame.freeSpinAwardedThisRound) return 'bonusWin';
	if (bookWillReachSpinMeterMax(events)) return 'bonusWin';
	return 'noWin';
}

/** Snapshot balance after `/wallet/play` (wager already deducted). */
export function snapshotBalanceAfterPlay(): void {
	stateGame.balanceAfterPlayApi = Math.round(stateBet.balanceAmount * API_AMOUNT_MULTIPLIER);
}

/** Pull the latest balance from RGS (fallback when end-round omits balance). */
export async function refreshWalletBalanceFromRgs(): Promise<void> {
	if (PUBLIC_CHROMATIC || stateUrlDerived.replay() || !hasActiveRgsSession()) return;
	try {
		const data = await requestWalletBalance({
			rgsUrl: stateUrlDerived.rgsUrl(),
			sessionID: stateUrlDerived.sessionID(),
		});
		applyFreeSpinActionBalance(data);
	} catch (error) {
		console.warn('[plinko] wallet balance refresh failed', error);
	}
}

/** After end-round: use the latest RGS wallet balance (do not overwrite with stale `round.payout`). */
export async function syncPlinkoWalletAfterRound(bet: Bet): Promise<void> {
	if (PUBLIC_CHROMATIC || stateUrlDerived.replay() || !hasActiveRgsSession()) return;

	void bet;
	await refreshWalletBalanceFromRgs();
}
