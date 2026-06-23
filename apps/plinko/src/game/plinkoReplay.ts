import { stateBet, stateUrlDerived } from 'state-shared';

import { ballsPerDropForPlinkoBetMode } from './plinkoBetMode';
import { stateGame } from './stateGame.svelte';
import type { BookEvent } from './typesBookEvent';

/** True when the game was launched in Stake's deterministic replay mode (`?replay=true`). */
export function isPlinkoReplay(): boolean {
	return stateUrlDerived.replay();
}

type PlinkoDropEvent = Extract<BookEvent, { type: 'plinkoDrop' }>;

type ResumePayload = {
	state?: unknown;
	events?: unknown;
	round?: { state?: unknown; events?: unknown };
} | null;

/**
 * Pull the book events out of a resume/replay payload regardless of how the RGS keyed them. The
 * `/wallet/play` (resume) response nests them as `round.state`, but the `/bet/replay` endpoint returns
 * the raw math book whose events live under `events` (and may or may not be wrapped in `round`). Try
 * every known location and return the first non-empty array.
 */
export function plinkoResumeBookEvents(bet: unknown): unknown[] {
	const payload = bet as ResumePayload;
	if (!payload) return [];
	const candidates = [payload.state, payload.events, payload.round?.state, payload.round?.events];
	for (const candidate of candidates) {
		if (Array.isArray(candidate) && candidate.length > 0) return candidate;
	}
	return [];
}

/**
 * Normalize `stateBet.betToResume` so the rest of the resume pipeline (`ResumeBet`, `resumeGame`,
 * `onResumeGameActive`) always finds the book under `.state`. The `/bet/replay` response keys the
 * events as `events`, which would otherwise leave `.state` empty and silently skip playback.
 *
 * Safe for a normal active-round resume too: that payload already has a populated `.state`, so this
 * is a no-op there.
 */
export function normalizePlinkoBetToResume(): void {
	const bet = stateBet.betToResume as { state?: unknown } | null;
	if (!bet) return;
	const hasState = Array.isArray(bet.state) && bet.state.length > 0;
	if (hasState) return;
	const events = plinkoResumeBookEvents(bet);
	if (isPlinkoReplay()) {
		console.info('[plinko][replay] betToResume keys', {
			keys: Object.keys(bet as object),
			resolvedEventCount: events.length,
		});
	}
	if (events.length > 0) bet.state = events;
}

/**
 * Align the UI to the served replay book BEFORE playback so the recorded round is reproduced
 * exactly. Replay carries no player session, so nothing else sets the balls-per-drop tier or the
 * per-ball stake from the book — without this, `alignBookForPlayback` / the `plinkoDrop` handler
 * would resize the book to the default UI tier and flag a stratum mismatch.
 *
 * No-op outside replay mode.
 */
export function alignPlinkoUiToReplayBook(state: BookEvent[]): void {
	if (!isPlinkoReplay()) return;

	const drop = state.find((event): event is PlinkoDropEvent => event.type === 'plinkoDrop');

	// Balls-per-drop: prefer the book's own count, fall back to the replayed `mode` mapping.
	const bookBalls = drop?.ballsPerDrop ?? drop?.outcomes?.length ?? 0;
	const modeBalls = ballsPerDropForPlinkoBetMode(stateUrlDerived.mode()) ?? 0;
	const balls = bookBalls > 0 ? bookBalls : modeBalls;
	// Set the UI tier so `plinkoBallsPerDrop()` matches the served outcomes (no resize, no mismatch).
	if (balls > 0) stateGame.ballPerDrop = balls;

	// Per-ball stake: use the book's authored stake so the displayed win matches the recorded payout
	// exactly (stake scaling becomes a 1:1 no-op during playback).
	const bookStake = drop?.stakePerBall ?? 0;
	if (bookStake > 0) {
		stateBet.betAmount = bookStake;
		stateBet.wageredBetAmount = bookStake;
	}
}
