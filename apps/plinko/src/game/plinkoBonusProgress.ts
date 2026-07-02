import { stateBet } from 'state-shared';

import { stateGame } from './stateGame.svelte';
import type { BookEvent } from './typesBookEvent';

/**
 * Persist how many bonus (free) balls the player has already dropped in the ACTIVE round, so a
 * mid-bonus reload / reconnect resumes from the remaining drop count instead of re-awarding and
 * re-dropping the whole wave from scratch.
 *
 * The RGS round `state` carries the full bonus outcomes but NOT how many the client has animated —
 * that is client-side presentation state RGS never sees. So on a genuine resume `bonusRound.ballsPlayed`
 * is always 0 and every free ball drops again ("massive wave of balls / brand new bonus"). We record the
 * played count here (keyed by the RGS `roundID`) as each ball drops, then overlay it onto the resumed
 * book before playback so the existing skip logic (`startAuthoritativeBonusRound` /
 * `loadAuthoritativeBonusOutcomes`) resumes from exactly the remaining count.
 */

const STORAGE_KEY = 'plinko:bonusProgress';

type BonusProgress = { roundID: number; ballsPlayed: number };

function readRoundID(bet: unknown): number | undefined {
	const id = (bet as { roundID?: unknown } | null | undefined)?.roundID;
	return typeof id === 'number' && Number.isFinite(id) ? id : undefined;
}

/** RGS round id of the round currently playing (or being resumed). */
export function activeRoundID(): number | undefined {
	return readRoundID(stateGame.activeRoundBet) ?? readRoundID(stateBet.betToResume);
}

function safeStorage(): Storage | null {
	try {
		return typeof window !== 'undefined' ? window.localStorage : null;
	} catch {
		// Access to localStorage can throw in private-mode / sandboxed frames.
		return null;
	}
}

/** Record the running played count for the active round (no-op without a round id / storage). */
export function saveBonusProgress(ballsPlayed: number): void {
	const store = safeStorage();
	const roundID = activeRoundID();
	if (!store || roundID === undefined) return;
	const payload: BonusProgress = {
		roundID,
		ballsPlayed: Math.max(0, Math.floor(ballsPlayed)),
	};
	try {
		store.setItem(STORAGE_KEY, JSON.stringify(payload));
	} catch {
		// Ignore quota / privacy-mode write failures — resume simply falls back to full replay.
	}
}

function loadBonusProgress(): BonusProgress | null {
	const store = safeStorage();
	if (!store) return null;
	try {
		const raw = store.getItem(STORAGE_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as Partial<BonusProgress>;
		if (typeof parsed?.roundID !== 'number' || typeof parsed?.ballsPlayed !== 'number') {
			return null;
		}
		return { roundID: parsed.roundID, ballsPlayed: Math.max(0, Math.floor(parsed.ballsPlayed)) };
	} catch {
		return null;
	}
}

export function clearBonusProgress(): void {
	const store = safeStorage();
	if (!store) return;
	try {
		store.removeItem(STORAGE_KEY);
	} catch {
		// Ignore removal failures.
	}
}

/** Balls already played for the round being resumed (0 unless the saved progress matches its id). */
export function resumeBonusBallsPlayed(): number {
	const progress = loadBonusProgress();
	if (!progress) return 0;
	const roundID = activeRoundID();
	if (roundID === undefined || progress.roundID !== roundID) return 0;
	return progress.ballsPlayed;
}

/**
 * Overlay the persisted played count onto the resumed book's entry `bonusRound` event, so the resume
 * skips already-dropped free balls. Mutates the passed events in place (they are the book we replay).
 * No-op unless the saved progress matches the round being resumed.
 */
export function applyResumeBonusProgressToBook(state: unknown): void {
	if (!Array.isArray(state)) return;
	const played = resumeBonusBallsPlayed();
	if (played <= 0) return;
	const events = state as BookEvent[];
	const entry = events.find((event) => event?.type === 'bonusRound');
	if (!entry || entry.type !== 'bonusRound') return;
	const freeBalls =
		typeof entry.freeBalls === 'number'
			? entry.freeBalls
			: Array.isArray(entry.outcomes)
				? entry.outcomes.length
				: played;
	entry.ballsPlayed = Math.min(played, Math.max(0, freeBalls));
}
