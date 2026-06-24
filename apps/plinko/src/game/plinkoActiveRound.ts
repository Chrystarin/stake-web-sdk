import { API_AMOUNT_MULTIPLIER } from 'constants-shared/bet';
import { PUBLIC_CHROMATIC } from 'envs';
import { stateBet, stateUrlDerived } from 'state-shared';
import { requestEndRound } from 'rgs-requests';

import { hasActiveRgsSession } from './plinkoSessionMeters';
import { getPlinkoDropFromEvents } from './plinkoDropBookShape';
import { ballsPerDropForPlinkoBetMode } from './plinkoBetMode';
import { stateGame } from './stateGame.svelte';
import type { BookEvent } from './typesBookEvent';

/** True when authenticate left an open RGS round that must be resumed or closed. */
export function hasActiveRoundToResume(): boolean {
	return Boolean((stateBet.betToResume as { active?: boolean } | null)?.active);
}

/**
 * Align the UI balls-per-drop tier to a genuine active-round resume's book BEFORE playback.
 *
 * Launch resets the tier to the default (10 balls), but a resumed round — most visibly the long-lived,
 * player-interactive bonus round — carries the player's real tier (e.g. 20/50). Without this,
 * `playBet`'s stratum check (`plinkoDropMatchesUi`) sees 10 ≠ 50, flags a false mismatch, and pops an
 * error toast banner ("Round book is for 50 balls but the UI is set to 10 … Sent meta: {…}") across the
 * top of the screen on every bonus resume. Mirrors `alignPlinkoUiToReplayBook`, but touches ONLY the
 * tier — the per-ball stake stays the real session stake (the book's `stakePerBall` is just the base
 * authoring unit). No-op in replay (the replay path aligns the tier in `alignPlinkoUiToReplayBook`).
 */
export function alignPlinkoUiToResumeBook(state: unknown, mode?: string): void {
	if (stateUrlDerived.replay()) return;
	const events = Array.isArray(state) ? (state as BookEvent[]) : [];
	const drop = getPlinkoDropFromEvents(events);
	// Prefer the book's own count (authoritative for the resumed round); fall back to the served
	// `mode` mapping when the resumed state carries no drop (e.g. a pure bonus-ball continuation).
	const bookBalls = Math.max(0, drop?.ballsPerDrop ?? drop?.outcomes?.length ?? 0);
	const modeBalls = ballsPerDropForPlinkoBetMode(mode) ?? 0;
	const balls = bookBalls > 0 ? bookBalls : modeBalls;
	if (balls > 0) stateGame.ballPerDrop = balls;
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
