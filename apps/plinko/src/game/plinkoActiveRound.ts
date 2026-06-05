import { API_AMOUNT_MULTIPLIER } from 'constants-shared/bet';
import { PUBLIC_CHROMATIC } from 'envs';
import { stateBet, stateUrlDerived } from 'state-shared';
import { requestEndRound } from 'rgs-requests';

import { hasActiveRgsSession } from './plinkoSessionMeters';

/** True when authenticate left an open RGS round that must be resumed or closed. */
export function hasActiveRoundToResume(): boolean {
	return Boolean((stateBet.betToResume as { active?: boolean } | null)?.active);
}

/** Book events RGS returned are complete enough to replay (not just `active: true`). */
export function hasReplayablePlinkoBookState(state: unknown): boolean {
	if (!Array.isArray(state) || state.length === 0) return false;

	return state.some((event) => {
		if (!event || typeof event !== 'object' || !('type' in event)) return false;
		const typed = event as { type: string; outcomes?: unknown };
		if (typed.type === 'plinkoDrop') {
			return Array.isArray(typed.outcomes) && typed.outcomes.length > 0;
		}
		return (
			typed.type === 'spinMeter' ||
			typed.type === 'bonusMeter' ||
			typed.type === 'bonusRoulette' ||
			typed.type === 'bonusRound' ||
			typed.type === 'freeSpinTrigger' ||
			typed.type === 'setTotalWin' ||
			typed.type === 'finalWin'
		);
	});
}

/**
 * Close a stuck RGS round via `/wallet/end-round` (no book playback).
 * Used when authenticate reports `active: true` but omits replayable `state`.
 */
export async function closeActiveRgsRound(): Promise<boolean> {
	if (PUBLIC_CHROMATIC || stateUrlDerived.replay() || !hasActiveRgsSession()) return false;

	try {
		const data = await requestEndRound({
			sessionID: stateUrlDerived.sessionID(),
			rgsUrl: stateUrlDerived.rgsUrl(),
		});
		if (data?.balance?.amount != null) {
			stateBet.balanceAmount = data.balance.amount / API_AMOUNT_MULTIPLIER;
		}
		stateBet.betToResume = null;
		return true;
	} catch (error) {
		console.warn('[plinko] failed to close active RGS round', error);
		return false;
	}
}
