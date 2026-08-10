import { PUBLIC_CHROMATIC } from 'envs';
import { stateBet, stateUrlDerived } from 'state-shared';

import {
	bonusMeterTierFor,
	BUY_BONUS_BALLS_PER_DROP_REF,
	DEFAULT_ROW_COUNT,
	PLINKO_DEFAULT_VARIANT_ID,
	spinMeterTierFor,
} from '../game-logic/constants';
import { plinkoBallsPerDrop } from './plinkoBet';
import { traceBonusMeterWrite } from './plinkoMeterTrace';
import { stateGame } from './stateGame.svelte';
import type { BookEvent } from './typesBookEvent';

/** Dev-only mirror of RGS session spin meter when no live session is configured. */
let devRgsSpinMeter = 0;

/** In-memory spin meter synced from RGS books; sent on the next `/wallet/play` meta. */
let rgsSessionSpinMeter = 0;

/**
 * Bonus meter / level are a PER-TIER SESSION meter — each balls-per-drop tier keeps its own running
 * value for the current play session (resets on a full page reload; no cross-device persistence). A
 * fresh tier lazily initializes to its tier base (`bonusMeterTierFor(tier).start`), which is 0 on
 * EVERY tier — `BONUS_METER_TIER` is `startRatio: 0` throughout, so the bonus meter always starts
 * EMPTY. (The 0 / 1/8 / 1/4 head start belongs to the SPIN meter, `SPIN_METER_TIER` — don't confuse
 * the two.) Keyed by the REAL selected tier (`stateGame.ballPerDrop`) — never the HUD's display
 * value, which shows 1 during a bonus round.
 *
 * DISPLAY CONTINUITY ONLY: the math is stateless per drop (each book resets both meters and must fill
 * them within that drop to fire), so this store can never create or suppress a feature — the book is
 * authoritative for every trigger and payout.
 */
const rgsSessionBonusMeterByTier: Record<number, number> = {};
const rgsSessionBonusLevelByTier: Record<number, number> = {};

/**
 * Math-authored bonus-meter MAX per balls-per-drop tier, learned from served `plinkoDrop` books.
 *
 * THE MATH IS THE SOURCE OF TRUTH for how full "full" is. `BONUS_METER_TIER` in game-logic/constants is
 * only a BOOTSTRAP: it sizes the bar before any book for that tier has arrived, and it is all there is
 * in dev / local-book play with no RGS. The moment a book publishes a tier's `bonusMeterMax`, that value
 * wins for the rest of the session.
 *
 * Keeping the local constant authoritative is what let the two drift: `BONUS_METER_TIER[10]` was raised
 * 6 → 7 while books still shipped 6, so whichever wrote last decided where the bar completed. One hit
 * either way is the difference between a bar that fills exactly when the math fires and a bar the player
 * watches hit max with no bonus behind it (see `warnIfBonusMeterFilledWithoutFiring`).
 *
 * Keyed by the BOOK's own balls-per-drop, not the UI selector: the max belongs to the tier the book was
 * generated for.
 */
const rgsBonusMeterMaxByTier: Record<number, number> = {};

/** Learn a tier's authoritative bonus-meter max from a served book. Ignores absent / non-positive. */
export function rememberRgsBonusMeterMax(ballsPerDrop: number, max: number | undefined): void {
	const value = Number(max);
	if (!(value > 0)) return;
	rgsBonusMeterMaxByTier[Math.max(1, Math.floor(ballsPerDrop))] = Math.floor(value);
}

/** A tier's bonus-meter max: the math's if a book has published one, else the local bootstrap. */
export function bonusMeterMaxForTier(ballsPerDrop: number): number {
	const tier = Math.max(1, Math.floor(ballsPerDrop));
	return rgsBonusMeterMaxByTier[tier] ?? bonusMeterTierFor(tier).max;
}

/**
 * Math-authored spin-meter MAX per balls-per-drop tier — the free-spin twin of `rgsBonusMeterMaxByTier`,
 * for the same reason: the math decides where "full" is, and `SPIN_METER_TIER` only bootstraps the bar
 * until a book for that tier says otherwise.
 *
 * This one drifts even more readily than the bonus meter's. The spin meter is PER-DROP, so
 * `seedSpinMeterForCurrentTier` re-runs from `syncSpinMeterAfterBet` at the end of EVERY round — without
 * this cache each of those re-seeds put the local constant straight back, discarding the max the book had
 * just published.
 */
const rgsSpinMeterMaxByTier: Record<number, number> = {};

/** Learn a tier's authoritative spin-meter max from a served book. Ignores absent / non-positive. */
export function rememberRgsSpinMeterMax(ballsPerDrop: number, max: number | undefined): void {
	const value = Number(max);
	if (!(value > 0)) return;
	rgsSpinMeterMaxByTier[Math.max(1, Math.floor(ballsPerDrop))] = Math.floor(value);
}

/** A tier's spin-meter max: the math's if a book has published one, else the local bootstrap. */
export function spinMeterMaxForTier(ballsPerDrop: number): number {
	const tier = Math.max(1, Math.floor(ballsPerDrop));
	return rgsSpinMeterMaxByTier[tier] ?? spinMeterTierFor(tier).max;
}

/**
 * The tier's per-drop spin-meter START, rescaled onto `max`.
 *
 * Unlike the bonus meter (`startRatio` 0 on every tier, so its start is always 0), the spin meter has a
 * real head start — 0 / 1/8 / 1/4 of max by tier. `SPIN_METER_TIER` stores that as an ABSOLUTE value
 * precomputed against the LOCAL max, so pairing it with a math-authored max that differs would misplace
 * the head start — and if the math's max were the smaller of the two, the clamp would seat the bar at
 * FULL on the first frame of every round. Rescale by the ratio instead of trusting the absolute.
 */
function spinMeterStartForTier(ballsPerDrop: number, max: number): number {
	const tier = spinMeterTierFor(ballsPerDrop);
	if (!(tier.max > 0)) return 0;
	return Math.min(max, Math.round(max * (tier.start / tier.max)));
}
/** Dev-only mirror of the per-tier bonus meter / level when no live session is configured. */
const devRgsBonusMeterByTier: Record<number, number> = {};
const devRgsBonusLevelByTier: Record<number, number> = {};

/** The real selected balls-per-drop tier that keys the per-tier bonus meter stores. */
function currentBonusTier(): number {
	return Math.max(1, Math.floor(stateGame.ballPerDrop || 1));
}

/** Tier base start for the bonus meter (the value a fresh tier / a post-trigger reset shows). */
export function bonusMeterTierStart(ballsPerDrop: number = currentBonusTier()): number {
	return bonusMeterTierFor(ballsPerDrop).start;
}

/** Read a per-tier bonus-meter store, lazily seeding a fresh tier to its tier base start. */
function readTierBonusMeter(store: Record<number, number>, tier: number): number {
	if (store[tier] == null) store[tier] = bonusMeterTierStart(tier);
	return Math.max(0, Math.floor(store[tier]));
}

/** Read a per-tier bonus-level store, lazily seeding a fresh tier to level 0. */
function readTierBonusLevel(store: Record<number, number>, tier: number): number {
	if (store[tier] == null) store[tier] = 0;
	return Math.max(0, Math.floor(store[tier]));
}

export function hasActiveRgsSession(): boolean {
	return !!(stateUrlDerived.rgsUrl()?.trim() && stateUrlDerived.sessionID()?.trim());
}

export function getRgsSessionSpinMeter(): number {
	return Math.max(0, Math.floor(rgsSessionSpinMeter));
}

export function setRgsSessionSpinMeter(value: number): void {
	rgsSessionSpinMeter = Math.max(0, Math.floor(value));
}

export function getRgsSessionBonusMeter(): number {
	return readTierBonusMeter(rgsSessionBonusMeterByTier, currentBonusTier());
}

export function getRgsSessionBonusLevel(): number {
	return readTierBonusLevel(rgsSessionBonusLevelByTier, currentBonusTier());
}

export function setRgsSessionBonusMeter(value: number, level?: number): void {
	const tier = currentBonusTier();
	rgsSessionBonusMeterByTier[tier] = Math.max(0, Math.floor(value));
	if (level != null) {
		rgsSessionBonusLevelByTier[tier] = Math.max(0, Math.floor(level));
	}
}

/** @deprecated Use `getRgsSessionSpinMeter` */
export const getSessionSpinMeterCarryOver = getRgsSessionSpinMeter;
/** @deprecated Use `setRgsSessionSpinMeter` */
export const setSessionSpinMeterCache = setRgsSessionSpinMeter;
/** @deprecated Use `getRgsSessionBonusMeter` */
export const getSessionBonusMeterCarryOver = getRgsSessionBonusMeter;
/** @deprecated Use `getRgsSessionBonusLevel` */
export const getSessionBonusLevelCarryOver = getRgsSessionBonusLevel;
/** @deprecated Use `setRgsSessionBonusMeter` */
export const setSessionBonusMeterCache = setRgsSessionBonusMeter;

/** Read spin meter start for local dev (simulates RGS session store). */
export function getDevRgsSpinMeter(): number {
	return devRgsSpinMeter;
}

/** Read bonus meter / level for local dev (simulates RGS session store) — per current tier. */
export function getDevRgsBonusMeter(): number {
	return readTierBonusMeter(devRgsBonusMeterByTier, currentBonusTier());
}

export function getDevRgsBonusLevel(): number {
	return readTierBonusLevel(devRgsBonusLevelByTier, currentBonusTier());
}

/**
 * Spin meter at bet start = the carried CLIENT SESSION meter (the player's progress).
 *
 * The served book's `spinMeterStart` is deliberately ignored: RGS selects books weighted-random by
 * `mode` and does NOT honor the play `meta`, so that field is the book's generation stratum (0, or a
 * carry-over stratum up to near-max), NOT this player's meter. Trusting it snapped the meter up to a
 * random stratum the instant a bet was placed ("sudden massive boost"). Book values are instead
 * mapped onto this session value as a delta from the book's own start (`spinMeterSessionValueFromBook`).
 */
export function resolveRgsSpinMeterStart(
	bookEvent: Extract<BookEvent, { type: 'plinkoDrop' }>,
): number {
	// PER-DROP spin meter: each book seeds at its OWN tier-fixed `spinMeterStart` and fills in-drop;
	// it does NOT carry across bets (resets every round). The tier start is a fixed value (0 / 1/8 /
	// 1/4 of max), not a random stratum, so trusting the book is safe here. (The BONUS meter is still
	// a session meter — see `resolveRgsBonusMeterStart`.)
	return Math.max(0, Math.floor(bookEvent.spinMeterStart ?? 0));
}

/**
 * Bonus meter at bet start (OPTION A — PER-DROP, like the spin meter): each book seeds at its OWN
 * tier-fixed `bonusMeterStart` and fills in-drop; it does NOT carry across bets (resets every round —
 * statelessness). The tier start is a fixed value (3/4 / 5/8 / 2/5 of max, or 0 on 1-ball), NOT a
 * random stratum, so trusting the book is safe here (same reasoning as `resolveRgsSpinMeterStart`).
 */
export function resolveRgsBonusMeterStart(
	bookEvent: Extract<BookEvent, { type: 'plinkoDrop' }>,
): number {
	return Math.max(0, Math.floor(bookEvent.bonusMeterStart ?? 0));
}

/**
 * Bonus level at bet start = the carried CLIENT SESSION level (book stratum ignored, as above).
 */
export function resolveRgsBonusLevelStart(
	_bookEvent: Extract<BookEvent, { type: 'plinkoDrop' }>,
): number {
	if (!hasActiveRgsSession()) return getDevRgsBonusLevel();
	return getRgsSessionBonusLevel();
}

/** Normalized stake in math `plinko_conditions` — real currency is `/wallet/play` `amount`. */
const MATH_STAKE_PER_BALL = 1;

/** Criteria name for a balls-per-drop tier (matches `game_config.py` Distribution.criteria). */
export function plinkoCriteriaForBallsPerDrop(ballsPerDrop: number): string {
	return `basegame_balls_${Math.max(1, Math.floor(ballsPerDrop))}`;
}

/**
 * Meta for `/wallet/play` — must mirror `games/crimson_plinko/game_config.py` `plinko_conditions`
 * exactly (distribution condition keys only — do not send book `criteria` here).
 */
export function buildBetMetaPlayConditions(): Record<string, unknown> {
	const ballsPerDrop = Math.max(1, Math.floor(stateGame.ballPerDrop));
	const spinMax = stateGame.spinMeterMax > 0 ? stateGame.spinMeterMax : 10;
	const bonusMax = stateGame.bonusMeterMax > 0 ? stateGame.bonusMeterMax : 20;
	return {
		difficulty: PLINKO_DEFAULT_VARIANT_ID,
		row_count: DEFAULT_ROW_COUNT,
		balls_per_drop: ballsPerDrop,
		stake_per_ball: MATH_STAKE_PER_BALL,
		// Running session meters carried into the next bet so RGS can serve a matching
		// carry-over stratum book (see crimson_plinko `_FEATURE_STRATA`). RGS book selection
		// is weighted-random per mode, so this is best-effort + used for force/replay.
		spin_meter_start: Math.max(0, Math.min(spinMax, Math.floor(stateGame.spinMeterValue))),
		bonus_meter_start: Math.max(0, Math.min(bonusMax, Math.floor(stateGame.bonusMeterValue))),
		bonus_level_start: Math.max(0, Math.floor(stateGame.bonusMeterLevel)),
		reel_weights: {},
		force_wincap: false,
		force_freegame: false,
	};
}

/** @deprecated Use `buildBetMetaPlayConditions` */
export function buildBetMetaSpinMeter(): Record<string, unknown> {
	return buildBetMetaPlayConditions();
}

/**
 * Apply in-memory RGS session meters to HUD (display only until next book).
 *
 * ⚠️ Runs from PlinkoAuthenticate's seeding `$effect`, which depends on the BALANCE — so it re-fires on
 * the win credit at the end of every round, and again on every bonus-ball credit. That makes it the one
 * writer that can repaint the bars at an arbitrary moment, and it writes a value from the SESSION store
 * rather than from the round in flight.
 *
 * Both meters are PER-DROP: the live bar belongs to the current round's book (or, mid-bonus, to the
 * in-bonus level meter, which the session store knows nothing about). Repainting from the store while
 * either owns the bar resurrects an EARLIER round's fill over a book that never moved the meter — the
 * player sees a full bar with no bonus behind it, and the book carries no `bonusMeter` event to explain
 * it (which is exactly the shape reported: `flaggedPegHits: 0` with the bar at max).
 *
 * So this only seeds the bars when nothing else owns them: at launch, and in the idle gap between
 * rounds. It is a display seed, never a mid-round correction.
 */
export function applyRgsSessionMetersToDisplay(): void {
	if (
		stateGame.dropRoundActive ||
		stateGame.bonusRoundActive ||
		stateGame.bonusBallsRemaining > 0 ||
		stateGame.rouletteFlowInProgress
	) {
		return;
	}
	applySpinMeterDisplay(getRgsSessionSpinMeter());
	applyBonusMeterDisplay(getRgsSessionBonusMeter(), getRgsSessionBonusLevel());
}

/** @deprecated Use `applyRgsSessionMetersToDisplay` */
export function applyCachedSpinMeterToDisplay(): void {
	applySpinMeterDisplay(getRgsSessionSpinMeter());
}

/** @deprecated Use `applyRgsSessionMetersToDisplay` */
export function applyCachedBonusMeterToDisplay(): void {
	applyBonusMeterDisplay(getRgsSessionBonusMeter(), getRgsSessionBonusLevel());
}

type PlinkoDropEvent = Extract<BookEvent, { type: 'plinkoDrop' }>;

const getPlinkoDrop = (events: BookEvent[]): PlinkoDropEvent | undefined =>
	events.find((event): event is PlinkoDropEvent => event.type === 'plinkoDrop');

/**
 * Lookup-table books encode `spinMeter.value` cumulative from 0 for this bet only.
 * Live RGS/math books with matching `spinMeterStart` use session-absolute values.
 */
export function spinMeterBookValuesAreBetRelative(
	events: BookEvent[],
	betStart?: number,
): boolean {
	const drop = getPlinkoDrop(events);
	// Only the book's OWN start (RGS honored the meta) means values are session-absolute.
	// A carried session start over a 0-start book keeps the book values bet-relative.
	if (drop && (drop.spinMeterStart ?? 0) > 0) return false;
	const start =
		betStart ??
		stateGame.betSpinMeterStart ??
		(drop ? resolveRgsSpinMeterStart(drop) : getRgsSessionSpinMeter());
	if (start === 0) return false;

	const firstSpinMeter = events.find(
		(event): event is Extract<BookEvent, { type: 'spinMeter' }> => event.type === 'spinMeter',
	);
	if (!firstSpinMeter) return false;

	return firstSpinMeter.value <= start;
}

/** Map a book `spinMeter.value` to the session-absolute meter reading. */
export function spinMeterSessionValueFromBook(
	bookValue: number,
	betStart: number,
	betRelative: boolean,
): number {
	// Book meter values are cumulative from the BOOK's OWN generation start. For lookup books that is
	// 0 (bet-relative). For a carry-over stratum book it is the stratum the book was generated for —
	// a weighted-random value RGS picked (it ignores the play meta), NOT the player's progress. Map
	// every value onto the carried session as a delta from the book's own start so a high-stratum
	// book can never boost the player's meter the moment a bet is placed.
	const bookOwnStart = betRelative
		? 0
		: getPlinkoDrop(stateGame.activeBookEvents)?.spinMeterStart ?? 0;
	return Math.max(0, Math.floor(betStart + (Math.floor(bookValue) - bookOwnStart)));
}

/** Derive authoritative session spin meter from RGS book events. */
export function deriveSpinMeterFromBookEvents(events: BookEvent[]): number {
	const drop = getPlinkoDrop(events);
	const betStart =
		stateGame.betSpinMeterStart ??
		(drop ? resolveRgsSpinMeterStart(drop) : getRgsSessionSpinMeter());
	const betRelative = spinMeterBookValuesAreBetRelative(events, betStart);

	let spinMeter = betStart;
	for (const event of events) {
		if (event.type === 'spinMeter') {
			spinMeter = spinMeterSessionValueFromBook(event.value, betStart, betRelative);
		}
		if (event.type === 'freeSpinTrigger') spinMeter = 0;
	}
	return Math.max(0, Math.floor(spinMeter));
}

/** Update HUD display only — does not persist or author outcomes. */
export function applySpinMeterDisplay(spinMeter: number): void {
	const max = stateGame.spinMeterMax > 0 ? stateGame.spinMeterMax : spinMeter;
	stateGame.spinMeterValue = Math.min(Math.max(0, spinMeter), max);
}

/** Sync in-memory session spin meter from RGS (next play sends it via meta). */
export function updateRgsSessionSpinMeter(spinMeter: number): void {
	const value = Math.max(0, Math.floor(spinMeter));
	setRgsSessionSpinMeter(value);

	if (PUBLIC_CHROMATIC || stateUrlDerived.replay()) return;

	if (!hasActiveRgsSession()) {
		devRgsSpinMeter = value;
	}
}

/** Reset spin meter to 0 on HUD and in-memory RGS session state after a free-spin award. */
export function resetSpinMeterSession(): void {
	applySpinMeterDisplay(0);
	updateRgsSessionSpinMeter(0);
}

/**
 * Seed the spin-meter HUD to the CURRENT balls-per-drop tier's per-drop start + max (1-ball → max 1
 * / start 0, no free spin). The free-spin meter is per-drop, so it resets to this start each round
 * and re-seeds here when the player switches tier.
 */
export function seedSpinMeterForCurrentTier(): void {
	// MAX from `spinMeterMaxForTier` (math's if published, local constant only as bootstrap), and the
	// head start rescaled onto it — see `spinMeterStartForTier`. Taking the constant's max here is what
	// used to discard the book's own value at the end of every round.
	const tierBalls = activeMeterTierBalls();
	const max = spinMeterMaxForTier(tierBalls);
	const start = spinMeterStartForTier(tierBalls, max);
	stateGame.spinMeterBaseMax = max;
	stateGame.spinMeterMax = max;
	stateGame.spinMeterValue = Math.min(Math.max(0, start), max);
	setRgsSessionSpinMeter(start);
}

/**
 * The balls-per-drop tier the meters should mirror RIGHT NOW.
 *
 * Normally the player's selected tier. While a BUY BONUS purchase is in flight it is the math's fixed
 * `BUY_BONUS_BALLS_PER_DROP_REF` instead: a buy is bonus-only, so the math generates its book at that
 * reference tier regardless of the selector, and the served book's `spinMeterMax` / `spinMeterStart`
 * come from it. Resolving the tier here (rather than at the call site) is what makes the reset STICK —
 * `seedSpinMeterForCurrentTier` is re-run from several reactive paths (`syncBallPerDropTier` is invoked
 * from an `$effect` that re-fires when `bonusRoundActive` / `authoritativeMeterFlow` flip as the bought
 * bonus starts), and each of those would otherwise snap the bar back to the selected tier's start.
 *
 * Reading `pendingBuyBonusMode` also keeps those effects subscribed to it, so the meters restore
 * themselves to the selected tier the moment the purchased round settles and the flag clears.
 */
export function activeMeterTierBalls(): number {
	if (stateGame.pendingBuyBonusMode) return BUY_BONUS_BALLS_PER_DROP_REF;
	return plinkoBallsPerDrop();
}

/**
 * Seed the bonus-meter HUD to the CURRENT balls-per-drop tier's max + stored per-tier SESSION value
 * (or the tier base start when the tier is first seen this session). Called on tier switch + mount so
 * switching tiers shows that tier's running meter. Unlike the per-drop spin meter, this does NOT reset
 * the value — the bonus meter carries its per-tier session progress across rounds.
 */
export function seedBonusMeterForCurrentTier(): void {
	// PER-DROP bonus meter (Option A): reset to the current tier's start + max each round (no cross-bet
	// carry — statelessness). Identical in spirit to `seedSpinMeterForCurrentTier`. 1-ball start is 0
	// (cosmetic, never fires).
	//
	// The MAX comes from `bonusMeterMaxForTier`, not the local constant: this function re-runs from
	// several reactive paths, so taking the constant here is what used to stomp the math's own max back
	// to the bootstrap value between rounds.
	const { start } = bonusMeterTierFor(plinkoBallsPerDrop());
	const max = bonusMeterMaxForTier(plinkoBallsPerDrop());
	stateGame.bonusMeterBaseMax = max;
	stateGame.bonusMeterMax = max;
	traceBonusMeterWrite('seedBonusMeterForCurrentTier', Math.min(Math.max(0, start), max));
	stateGame.bonusMeterValue = Math.min(Math.max(0, start), max);
	stateGame.bonusMeterLevel = 0;
	// Push the seed into the session store too — otherwise the previous tier's value is left behind and
	// the next `applyRgsSessionMetersToDisplay` (any balance change re-runs it) snaps the bar back to it.
	setRgsSessionBonusMeter(stateGame.bonusMeterValue, 0);
}

/** Apply a `spinMeter` book event to the HUD (session-absolute, never regress mid-bet). */
export function applySpinMeterBookEvent(bookValue: number): void {
	const betStart = stateGame.betSpinMeterStart;
	const betRelative = stateGame.spinMeterBookValuesAreBetRelative;
	const sessionValue = spinMeterSessionValueFromBook(bookValue, betStart, betRelative);
	const max = stateGame.spinMeterMax > 0 ? stateGame.spinMeterMax : sessionValue;
	const capped = Math.min(sessionValue, max);
	if (capped >= max) {
		stateGame.spinMeterValue = max;
		setRgsSessionSpinMeter(max);
		return;
	}
	stateGame.spinMeterValue = Math.max(stateGame.spinMeterValue, capped);
	setRgsSessionSpinMeter(stateGame.spinMeterValue);
}

/**
 * After a bet book finishes (bet re-enabled): the free-spin meter is PER-DROP, so reset it to the
 * current tier's start value — ready for the next round, no cross-bet carry. The meter filled (and
 * possibly fired the in-drop free spin) during the just-finished book's `spinMeter` events.
 */
export async function syncSpinMeterAfterBet(_events: BookEvent[]): Promise<void> {
	seedSpinMeterForCurrentTier();
}

/** Offset lookup-table `spinMeter` events when injecting session carry-over (local dev). */
export function offsetBetRelativeSpinMeterEvents(
	events: BookEvent[],
	spinMeterStart: number,
): BookEvent[] {
	if (spinMeterStart <= 0) return events;
	return events.map((event) => {
		if (event.type !== 'spinMeter') return event;
		return { ...event, value: event.value + spinMeterStart };
	});
}

/**
 * Lookup-table books encode `bonusMeter.value` cumulative from 0 for this bet only.
 * Live RGS/math books with matching `bonusMeterStart` use session-absolute values.
 */
export function bonusMeterBookValuesAreBetRelative(
	events: BookEvent[],
	betStart?: number,
): boolean {
	const drop = getPlinkoDrop(events);
	// Only the book's OWN start (RGS honored the meta) means values are session-absolute.
	if (drop && (drop.bonusMeterStart ?? 0) > 0) return false;
	const start =
		betStart ??
		stateGame.betBonusMeterStart ??
		(drop ? resolveRgsBonusMeterStart(drop) : getRgsSessionBonusMeter());
	if (start === 0) return false;

	const firstBonusMeter = events.find(
		(event): event is Extract<BookEvent, { type: 'bonusMeter' }> => event.type === 'bonusMeter',
	);
	if (!firstBonusMeter) return false;

	return firstBonusMeter.value <= start;
}

/** Map a book `bonusMeter.value` to the session-absolute meter reading. */
export function bonusMeterSessionValueFromBook(
	bookValue: number,
	betStart: number,
	betRelative: boolean,
): number {
	// See `spinMeterSessionValueFromBook`: remap the book value as a delta from the BOOK's own start
	// onto the carried session, so a served carry-over stratum book (RGS picks books weighted-random,
	// ignoring the meta) can't snap the bonus meter up to its stratum on bet placement.
	const bookOwnStart = betRelative
		? 0
		: getPlinkoDrop(stateGame.activeBookEvents)?.bonusMeterStart ?? 0;
	return Math.max(0, Math.floor(betStart + (Math.floor(bookValue) - bookOwnStart)));
}

export type DerivedBonusMeterState = { value: number; level: number };

/** Derive authoritative session bonus meter / level from RGS book events. */
export function deriveBonusMeterFromBookEvents(events: BookEvent[]): DerivedBonusMeterState {
	const drop = getPlinkoDrop(events);
	const betStart =
		stateGame.betBonusMeterStart ??
		(drop ? resolveRgsBonusMeterStart(drop) : getRgsSessionBonusMeter());
	const levelStart =
		stateGame.betBonusLevelStart ??
		(drop ? resolveRgsBonusLevelStart(drop) : getRgsSessionBonusLevel());
	const betRelative = bonusMeterBookValuesAreBetRelative(events, betStart);
	const max = stateGame.bonusMeterMax > 0 ? stateGame.bonusMeterMax : 20;

	// A free-spin wheel landing on BONUS also emits `bonusRoulette`, but that bonus is driven by
	// the SPIN meter — the bonus meter must NOT reset in that case.
	const bonusFromFreeSpin = events.some(
		(event) =>
			event.type === 'freeSpinTrigger' &&
			String(event.segment ?? '').toUpperCase().includes('BONUS'),
	);

	let bonusMeter = betStart;
	let bonusLevel = levelStart;
	let bonusConsumed = false;
	for (const event of events) {
		if (event.type === 'bonusMeter') {
			// Clamp to max but NEVER auto-zero on reaching max: base modes suppress the in-drop
			// feature, so a full meter must CARRY OVER (the trigger mode fires it next bet). Only a
			// real consumption (`bonusRoulette` below) resets the meter — handled after the loop.
			bonusMeter = Math.min(
				max,
				bonusMeterSessionValueFromBook(event.value, betStart, betRelative),
			);
			bonusLevel = event.level;
		}
		if (event.type === 'bonusRoulette' && !bonusFromFreeSpin) {
			// Bonus triggered BY the bonus meter (incl. the dedicated bonus trigger mode, which
			// carries no `bonusMeter` event): the meter was spent, so end the bet at 0 — otherwise
			// it stays at the carried full value and immediately re-triggers in a loop.
			bonusConsumed = true;
		}
		if (event.type === 'bonusRound') {
			bonusLevel = Math.max(bonusLevel, event.level + 1);
		}
	}
	if (bonusConsumed) {
		// Reset to the tier base start (0 on 1/10-ball, 1/8 on 20-ball, 1/4 on 50-ball), NOT 0.
		bonusMeter = bonusMeterTierStart();
		bonusLevel = 0;
	}
	return {
		value: Math.max(0, Math.floor(bonusMeter)),
		level: Math.max(0, Math.floor(bonusLevel)),
	};
}

/**
 * Set the HUD bonus meter (does not author outcomes) and keep the session store in step.
 *
 * ⚠️ The session write is NOT optional. `applyRgsSessionMetersToDisplay` pushes the session value back
 * into the HUD, and it is re-run from PlinkoAuthenticate's seeding `$effect` — which re-fires on every
 * balance change, i.e. on the win credit at the end of every round. Any reset that moved the display
 * WITHOUT moving the session left a stale value behind that the next balance change resurrected, which
 * the player saw as the meter snapping back and then bouncing up again a beat later.
 */
export function applyBonusMeterDisplay(bonusMeter: number, bonusLevel?: number): void {
	const max = stateGame.bonusMeterMax > 0 ? stateGame.bonusMeterMax : bonusMeter;
	traceBonusMeterWrite('applyBonusMeterDisplay', Math.min(Math.max(0, bonusMeter), max));
	stateGame.bonusMeterValue = Math.min(Math.max(0, bonusMeter), max);
	if (bonusLevel != null) {
		stateGame.bonusMeterLevel = Math.max(0, Math.floor(bonusLevel));
	}
	setRgsSessionBonusMeter(stateGame.bonusMeterValue, stateGame.bonusMeterLevel);
}

/** Sync in-memory session bonus meter / level from RGS (next play sends it via meta). */
export function updateRgsSessionBonusMeter(bonusMeter: number, bonusLevel: number): void {
	const value = Math.max(0, Math.floor(bonusMeter));
	const level = Math.max(0, Math.floor(bonusLevel));
	setRgsSessionBonusMeter(value, level);

	if (PUBLIC_CHROMATIC || stateUrlDerived.replay()) return;

	if (!hasActiveRgsSession()) {
		const tier = currentBonusTier();
		devRgsBonusMeterByTier[tier] = value;
		devRgsBonusLevelByTier[tier] = level;
	}
}

/**
 * Ceiling for the TRIGGER-phase bar: it may only COMPLETE on a round the book actually fires on.
 *
 * `BONUS_METER_TIER` documents `max` as the hits-to-fill the math itself triggers at, so a full bar is a
 * promise of a bonus. Books have been observed reaching `bonusMeterMax` with no `bonusRoulette` behind
 * them — and with `hitBonusPeg` flagged on none of their outcomes, so the fill came from the book's own
 * `bonusMeter` events rather than from anything the player could see happen on the board. Rendering that
 * as a completed bar makes a promise the round then breaks.
 *
 * The whole book is known up front (`activeBookEvents` is assigned before playback begins), so when it
 * carries no wheel we hold the bar one notch short — the same "never complete what nothing will consume"
 * rule the in-bonus meter already applies in `onCoinPegHit`. On a firing round the ceiling is `max`, so
 * the bar completes exactly when the bonus arrives, which is the invariant players actually read.
 *
 * This is presentation only: it changes no outcome, no award and no payout. The underlying book
 * inconsistency is still reported by `warnIfBonusMeterFilledWithoutFiring`.
 */
export function triggerPhaseBonusMeterCeiling(max: number): number {
	if (!(max > 0)) return max;
	const events = stateGame.activeBookEvents ?? [];
	// No served book in play (dev/local seeding, pre-first-bet) — the client fallback owns the fill there,
	// so don't second-guess it.
	if (events.length === 0) return max;
	if (events.some((event) => event.type === 'bonusRoulette')) return max;
	return Math.max(0, max - 1);
}

/** Hold the trigger-phase bar under its ceiling after a provisional client bump. */
export function clampBonusMeterToTriggerCeiling(): void {
	if (stateGame.bonusRoundActive) return;
	const ceiling = triggerPhaseBonusMeterCeiling(stateGame.bonusMeterMax);
	if (stateGame.bonusMeterValue > ceiling) {
		traceBonusMeterWrite('clampBonusMeterToTriggerCeiling', ceiling);
		traceBonusMeterWrite('applyBonusMeterBookEvent:atCeiling', ceiling);
		stateGame.bonusMeterValue = ceiling;
	}
}

/** Apply a `bonusMeter` book event to the HUD. The TRIGGER-phase meter (no `eventMax`) is per-drop and
 * only increases toward the per-tier max. The IN-BONUS "energy" meter (with `eventMax` = the level-up
 * threshold) is set DIRECTLY so it can RESET to empty on a level-up and fill exactly as the book says. */
export function applyBonusMeterBookEvent(
	bookValue: number,
	bookLevel: number,
	eventMax?: number,
): void {
	if (eventMax && eventMax > 0) {
		// In-bonus level-up meter: starts empty each level, fills to `eventMax`, resets on level-up.
		stateGame.bonusMeterMax = eventMax;
		traceBonusMeterWrite('applyBonusMeterBookEvent:inBonus', Math.max(0, Math.min(Math.floor(bookValue), eventMax)));
		stateGame.bonusMeterValue = Math.max(0, Math.min(Math.floor(bookValue), eventMax));
		stateGame.bonusMeterLevel = bookLevel;
		return;
	}
	const betStart = stateGame.betBonusMeterStart;
	const betRelative = stateGame.bonusMeterBookValuesAreBetRelative;
	const sessionValue = bonusMeterSessionValueFromBook(bookValue, betStart, betRelative);
	const max = stateGame.bonusMeterMax > 0 ? stateGame.bonusMeterMax : sessionValue;
	const ceiling = triggerPhaseBonusMeterCeiling(max);
	const capped = Math.min(sessionValue, ceiling);
	if (capped >= ceiling) {
		stateGame.bonusMeterValue = ceiling;
		stateGame.bonusMeterLevel = bookLevel;
		setRgsSessionBonusMeter(ceiling, bookLevel);
		return;
	}
	traceBonusMeterWrite('applyBonusMeterBookEvent:raise', Math.max(stateGame.bonusMeterValue, capped));
	stateGame.bonusMeterValue = Math.max(stateGame.bonusMeterValue, capped);
	stateGame.bonusMeterLevel = bookLevel;
	setRgsSessionBonusMeter(stateGame.bonusMeterValue, bookLevel);
}

function bonusMeterConsumedThisRound(events: BookEvent[]): boolean {
	// A `bonusRoulette` means a bonus round triggered this bet (incl. the dedicated trigger mode,
	// which carries no `bonusMeter` event) — the meter was spent and must reset to 0.
	return events.some((event) => event.type === 'bonusRoulette');
}

/**
 * DIAGNOSTIC for "the bar went full but no bonus came".
 *
 * `BONUS_METER_TIER` defines `max` as the hits-to-fill that the MATH itself fires on, and the client bar
 * is credited once per book-authored `hitBonusPeg` outcome — so a full bar and a `bonusRoulette` event
 * should coincide. When they don't, this logs the numbers needed to tell the two causes apart:
 *
 *  - `bonusMeterMax` ≠ `resolvedMax` → the CLIENT bar was measured against the wrong threshold (see the
 *    max restore in `resetBonusRoundVisualState` and the per-tier cache above).
 *  - they agree → the BOOK filled its own meter to max without emitting `bonusRoulette`. A math/RGS
 *    question, not a client one. `flaggedPegHits` says whether the fill was even attributable to
 *    coin-peg outcomes the player could watch land: 0 means the meter moved purely on `bonusMeter`
 *    events with nothing on the board behind it.
 *
 * Keyed on the BOOK's own peak, not the displayed bar: the bar is now deliberately held one notch short
 * on a non-firing round (`triggerPhaseBonusMeterCeiling`), so it can no longer be the signal.
 *
 * Warn-only, both in dev and production: a full bar with no bonus costs the player nothing, so this must
 * never interrupt a live round the way the fairness guard's DEV throw did.
 */
function warnIfBonusMeterFilledWithoutFiring(events: BookEvent[]): void {
	if (events.some((event) => event.type === 'bonusRoulette')) return;
	const max = bonusMeterMaxForTier(plinkoBallsPerDrop());
	if (!(max > 0)) return;
	const bonusMeterEvents = events.filter(
		(event): event is Extract<BookEvent, { type: 'bonusMeter' }> => event.type === 'bonusMeter',
	);
	const bookPeak = bonusMeterEvents.reduce(
		(peak, event) => Math.max(peak, Math.floor(event.value)),
		0,
	);
	if (bookPeak < max) return;
	const drop = getPlinkoDrop(events);
	const flaggedPegHits = (drop?.outcomes ?? []).filter(
		(outcome) => (outcome as { hitBonusPeg?: boolean }).hitBonusPeg === true,
	).length;
	console.warn('[plinko] book bonus meter reached max but the book fired no bonus', {
		bookPeak,
		bookBonusMeterValues: bonusMeterEvents.map((event) => event.value),
		displayedBonusMeterValue: stateGame.bonusMeterValue,
		bonusMeterMax: stateGame.bonusMeterMax,
		bonusMeterBaseMax: stateGame.bonusMeterBaseMax,
		// What the bar SHOULD be sized to (math's if published) vs the local bootstrap constant. These
		// two disagreeing is the client-side cause; them agreeing points at the book instead.
		resolvedMax: max,
		bootstrapTierMax: bonusMeterTierFor(plinkoBallsPerDrop()).max,
		ballsPerDrop: plinkoBallsPerDrop(),
		bookBonusMeterMax: drop?.bonusMeterMax,
		bookBonusMeterStart: drop?.bonusMeterStart,
		flaggedPegHits,
	});
}

/** After a bet book finishes: leave the round's achieved fill on screen and persist it. */
export async function syncBonusMeterAfterBet(events: BookEvent[]): Promise<void> {
	if (stateGame.bonusRoundActive || stateGame.bonusBallsRemaining > 0) return;
	warnIfBonusMeterFilledWithoutFiring(events);
	// The meter is still PER-DROP — it is re-seeded from the next book's own `bonusMeterStart` when that
	// bet starts (see the `plinkoDrop` handler) — but it must NOT be wiped here. The balls have only just
	// landed, so resetting on round completion yanked the bar back down in front of the player before they
	// could read what the round achieved, and the round-end balance credit then re-ran
	// `applyRgsSessionMetersToDisplay` (PlinkoAuthenticate's seeding `$effect` depends on the balance) with
	// the session value this reset never cleared — which bounced the bar straight back up. Hold the
	// achieved reading and persist it, so display and session agree and the meter stays put until the
	// next bet. A bonus that fired this round owns the display instead and resets it on its own way out
	// (`resetBonusRoundVisualState`), which the guard above defers to.
	updateRgsSessionBonusMeter(stateGame.bonusMeterValue, stateGame.bonusMeterLevel);
}

/** Offset lookup-table `bonusMeter` events when injecting session carry-over (local dev). */
export function offsetBetRelativeBonusMeterEvents(
	events: BookEvent[],
	bonusMeterStart: number,
): BookEvent[] {
	if (bonusMeterStart <= 0) return events;
	return events.map((event) => {
		if (event.type !== 'bonusMeter') return event;
		return { ...event, value: event.value + bonusMeterStart };
	});
}
