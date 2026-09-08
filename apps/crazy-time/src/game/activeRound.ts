import { API_AMOUNT_MULTIPLIER } from 'constants-shared/bet';
import { stateBet, stateConfig, stateUrlDerived } from 'state-shared';
import { requestEndRound } from 'rgs-requests';

import { MODE_COVERAGE, MODE_NAMES, isSpot, type Spot } from './constants';
import type { BookEvent } from './typesBookEvent';

/** The open round authenticate reported, if any. */
type ResumableRound = {
	active?: boolean;
	payoutMultiplier?: number;
	state?: unknown;
	mode?: string;
} | null;

export const activeRound = (): ResumableRound => stateBet.betToResume as ResumableRound;

/**
 * True when the open round pays nothing.
 *
 * The SDK only closes a round as a side effect of settling a WIN, so a zero-payout round
 * survives the resume machine untouched and keeps blocking `/wallet/play`; it has to be closed
 * directly instead.
 */
export const activeRoundHasNoPayout = (): boolean => {
	const round = activeRound();
	return Boolean(round?.active) && !(round?.payoutMultiplier && round.payoutMultiplier > 0);
};

/** Close the open round with a direct `/wallet/end-round`, no book playback. */
export const closeActiveRgsRound = async (): Promise<{ ok: boolean; error?: string }> => {
	try {
		const data = await requestEndRound({
			sessionID: stateUrlDerived.sessionID(),
			rgsUrl: stateUrlDerived.rgsUrl(),
		});
		if (data?.balance?.amount != null) {
			stateBet.balanceAmount = data.balance.amount / API_AMOUNT_MULTIPLIER;
		}
		stateBet.betToResume = null;
		return { ok: true };
	} catch (error) {
		const detail =
			typeof error === 'object' && error && 'error' in error
				? String((error as { error: unknown }).error)
				: String(error);
		console.error('[crazy-time] could not close the open RGS round', error);
		return { ok: false, error: detail };
	}
};

/**
 * Check a mode against what the RGS says it has books for. Returns null when everything lines
 * up, or when the RGS reported no modes at all (older RGS builds, or local dev).
 */
export const describeModeMismatch = (mode: string): string | null => {
	const published = stateConfig.publishedBetModes ?? [];
	if (!published.length) return null;
	if (published.includes(mode)) return null;
	return (
		`Bet mode "${mode}" is not published on the RGS. It has: ${published.join(', ') || '(none)'}. ` +
		`This game expects: ${MODE_NAMES.join(', ')}. Re-publish games/crazy_time from stake-math-sdk.`
	);
};

/** True when authenticate left an open round that must be replayed before betting again. */
export const hasActiveRoundToResume = (): boolean =>
	Boolean((stateBet.betToResume as { active?: boolean } | null)?.active);

// The mode fixes which spots were covered, but stash the committed selection anyway so the
// replay lights the tiles in the order they were placed.
const STORAGE_KEY = 'crazy-time:committed-spots';

export const rememberCommittedSpots = (spots: Spot[]): void => {
	try {
		sessionStorage.setItem(STORAGE_KEY, JSON.stringify(spots));
	} catch {
		// Private mode / storage disabled: resume falls back to the mode's coverage.
	}
};

export const forgetCommittedSpots = (): void => {
	try {
		sessionStorage.removeItem(STORAGE_KEY);
	} catch {
		/* ignore */
	}
};

const recallCommittedSpots = (): Spot[] | null => {
	try {
		const raw = sessionStorage.getItem(STORAGE_KEY);
		if (!raw) return null;
		const parsed: unknown = JSON.parse(raw);
		if (!Array.isArray(parsed)) return null;
		const spots = parsed.filter(isSpot);
		return spots.length ? spots : null;
	} catch {
		return null;
	}
};

/** The spot the resumed book landed on and whether it was covered, from its wheelSpin event. */
const landingFromBook = (state: unknown): { spot: Spot; covered: boolean } | null => {
	if (!Array.isArray(state)) return null;
	const spin = (state as BookEvent[]).find((event) => event?.type === 'wheelSpin');
	return spin && spin.type === 'wheelSpin' ? { spot: spin.spot, covered: spin.covered } : null;
};

/**
 * The spots to replay a resumed round against.
 *
 * Prefers the mode the RGS reports for the round (its coverage IS the board), then the stashed
 * selection, and only as a last resort infers from the book which spot was covered.
 */
export const backedSpotsForResume = (state: unknown): Spot[] => {
	const mode = activeRound()?.mode;
	if (mode && MODE_COVERAGE[mode]) return [...MODE_COVERAGE[mode]];
	const remembered = recallCommittedSpots();
	if (remembered) return remembered;
	const landing = landingFromBook(state);
	return landing?.covered ? [landing.spot] : [];
};
