import { API_AMOUNT_MULTIPLIER } from 'constants-shared/bet';
import { stateBet, stateConfig, stateUrlDerived } from 'state-shared';
import { requestEndRound } from 'rgs-requests';

import { COLOURS, MODE_NAMES, type Colour } from './constants';
import type { BookEvent } from './typesBookEvent';

/** The open round authenticate reported, if any. */
type ResumableRound = { active?: boolean; payoutMultiplier?: number; state?: unknown } | null;

export const activeRound = (): ResumableRound => stateBet.betToResume as ResumableRound;

/**
 * True when the open round pays nothing.
 *
 * This matters because the SDK only closes a round as a side effect of settling a WIN
 * (`singleRoundWin.newGame` calls end-round; `noWin` does nothing at either end). A
 * zero-payout round therefore survives the resume machine untouched and keeps blocking
 * `/wallet/play`, so it has to be closed directly instead.
 */
export const activeRoundHasNoPayout = (): boolean => {
	const round = activeRound();
	return Boolean(round?.active) && !(round?.payoutMultiplier && round.payoutMultiplier > 0);
};

/**
 * Close the open round with a direct `/wallet/end-round`, no book playback.
 *
 * Returns the RGS error when it refuses — a 500 here means the round is stuck server-side
 * and no amount of client retrying will shift it.
 */
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
		console.error('[colour-dice] could not close the open RGS round', error);
		return { ok: false, error: detail };
	}
};

/**
 * Check a mode against what the RGS says it has books for.
 *
 * `/wallet/play` sends `mode` verbatim, and the RGS answers a mode it cannot find with a
 * generic error ("Something went wrong") that gives no hint the published math is out of
 * date. Since this game's modes have been renamed more than once, that is the likeliest
 * cause of a blanket bet failure — so name it explicitly rather than let it be a mystery.
 *
 * Returns null when everything lines up, or when the RGS reported no modes at all (older RGS
 * builds, or local dev) — in that case we cannot tell, so we do not block the bet.
 */
export const describeModeMismatch = (mode: string): string | null => {
	const published = stateConfig.publishedBetModes ?? [];
	if (!published.length) return null;
	if (published.includes(mode)) return null;
	return (
		`Bet mode "${mode}" is not published on the RGS. It has: ${published.join(', ') || '(none)'}. ` +
		`This game expects: ${MODE_NAMES.join(', ')}. Re-publish games/colour_dice from stake-math-sdk.`
	);
};

/**
 * Helpers for an RGS round that authenticate reported still open.
 *
 * The RGS closes a round on the next `/wallet/play` (or an explicit `/wallet/end-round`), so
 * a reload or dropped connection mid-round leaves one hanging. Until it is finished, every
 * play is rejected with ERR_VAL "player has active round" — hence the resume path.
 */

/** True when authenticate left an open round that must be replayed before betting again. */
export const hasActiveRoundToResume = (): boolean =>
	Boolean((stateBet.betToResume as { active?: boolean } | null)?.active);

// Which colours were backed is a purely client-side choice — the RGS only ever sees the
// mode (how many) and the amount. So a resumed book can say "three colours were backed" but
// not which three. Stash the committed selection so a reload replays against the real board.
const STORAGE_KEY = 'colour-dice:committed-colours';

const isColour = (value: unknown): value is Colour =>
	typeof value === 'string' && (COLOURS as readonly string[]).includes(value);

export const rememberCommittedColours = (colours: Colour[]): void => {
	try {
		sessionStorage.setItem(STORAGE_KEY, JSON.stringify(colours));
	} catch {
		// Private mode / storage disabled — resume just falls back to canonical colours.
	}
};

export const forgetCommittedColours = (): void => {
	try {
		sessionStorage.removeItem(STORAGE_KEY);
	} catch {
		/* ignore */
	}
};

const recallCommittedColours = (): Colour[] | null => {
	try {
		const raw = sessionStorage.getItem(STORAGE_KEY);
		if (!raw) return null;
		const parsed: unknown = JSON.parse(raw);
		if (!Array.isArray(parsed)) return null;
		const colours = parsed.filter(isColour);
		return colours.length ? colours : null;
	} catch {
		return null;
	}
};

/** How many colours the resumed book was played with, from its reveal event. */
const backedCountFromBook = (state: unknown): number => {
	if (!Array.isArray(state)) return 0;
	const reveal = (state as BookEvent[]).find((event) => event?.type === 'reveal');
	return reveal && 'backedCount' in reveal ? reveal.backedCount : 0;
};

/**
 * The colours to replay a resumed round against.
 *
 * Prefers the selection stashed when the bet was committed. Falls back to the first N
 * canonical colours, which keeps the replay coherent (right number of backed colours, right
 * payouts) even though it cannot recover the player's actual picks — money is already
 * settled by then, so this only affects which boxes light up.
 */
export const backedColoursForResume = (state: unknown): Colour[] => {
	const remembered = recallCommittedColours();
	const count = backedCountFromBook(state);
	if (remembered && (!count || remembered.length === count)) return remembered;
	if (count > 0) return COLOURS.slice(0, count);
	return remembered ?? [];
};
