import { stateBet, stateConfig, stateUrlDerived } from 'state-shared';

import { stateGame } from './stateGame.svelte';
import type { Bet, BookEvent } from './typesBookEvent';

/**
 * Stake's Bet Replay (`?replay=true`, ported from apps/plinko's plinkoReplay).
 *
 * A replay is one recorded round played back for whoever holds the link: no session, no wallet,
 * no bet. The shared `Authenticate` fetches `/bet/replay/{game}/{version}/{mode}/{event}` in place
 * of authenticating and parks the round on `stateBet.betToResume`; from there the game plays it
 * through the same resume path an interrupted round takes, which makes no session call in replay
 * (`createPrimaryMachines` skips `/wallet/end-round`).
 */
export const isReplay = (): boolean => stateUrlDerived.replay();

/** The recorded round, held for the length of the page so it can be played again. */
export type ReplayRound = {
	state: BookEvent[];
	payoutMultiplier: number;
	mode: string;
};

type ReplayPayload = {
	state?: unknown;
	events?: unknown;
	round?: { state?: unknown; events?: unknown };
	payoutMultiplier?: number;
	mode?: string;
} | null;

/**
 * The book's events, wherever the RGS keyed them: `/bet/replay` has been seen to return them as
 * `state` and as the raw math book's `events`, bare or wrapped in `round`.
 */
const replayBookEvents = (payload: ReplayPayload): BookEvent[] => {
	if (!payload) return [];
	const candidates = [payload.state, payload.events, payload.round?.state, payload.round?.events];
	for (const candidate of candidates) {
		if (Array.isArray(candidate) && candidate.length > 0) return candidate as BookEvent[];
	}
	return [];
};

/**
 * Lift the recorded round off `stateBet.betToResume`, or null when nothing playable was loaded
 * (bad parameters, an RGS error). The slot is cleared: the round is put back for each playback
 * by `stageReplayRound`, and nothing else should mistake it for an open round in the meantime.
 */
export const takeReplayRound = (): ReplayRound | null => {
	// A plain copy: the slot is a `$state` proxy, and the round has to outlive it.
	const payload = JSON.parse(JSON.stringify(stateBet.betToResume ?? null)) as ReplayPayload;
	const state = replayBookEvents(payload);
	stateBet.betToResume = null;
	if (!state.length) return null;
	return {
		state,
		payoutMultiplier: payload?.payoutMultiplier ?? 0,
		mode: payload?.mode || stateUrlDerived.mode(),
	};
};

/**
 * Replay never authenticates, so there is no bet template to take a chip from: the chip is the
 * URL's `amount` (already on `stateBet.betAmount`, in the player's currency), or 1 when the link
 * carries none, so the round still reads in multiples of a chip. The tray's grid is seeded with
 * that one value, which keeps `ensureValidStake` from moving it.
 */
export const seedReplayStake = (): void => {
	const chip = stateBet.betAmount > 0 ? stateBet.betAmount : 1;
	stateBet.betAmount = chip;
	stateBet.wageredBetAmount = chip;
	stateGame.stake = chip;
	stateConfig.betAmountOptions = [chip];
	stateConfig.betMenuOptions = [chip];
};

/** Put a fresh copy of the round where the resume machine looks for it. */
export const stageReplayRound = (round: ReplayRound): void => {
	stateBet.activeBetModeKey = round.mode;
	stateBet.betToResume = {
		...(JSON.parse(JSON.stringify(round)) as ReplayRound),
		event: '0',
		active: true,
	} as unknown as Bet;
};
