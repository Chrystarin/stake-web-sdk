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

/** Apply in-memory RGS session meters to HUD (display only until next book). */
export function applyRgsSessionMetersToDisplay(): void {
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
	const { max, start } = spinMeterTierFor(activeMeterTierBalls());
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
	const { max, start } = bonusMeterTierFor(plinkoBallsPerDrop());
	stateGame.bonusMeterBaseMax = max;
	stateGame.bonusMeterMax = max;
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
		stateGame.bonusMeterValue = Math.max(0, Math.min(Math.floor(bookValue), eventMax));
		stateGame.bonusMeterLevel = bookLevel;
		return;
	}
	const betStart = stateGame.betBonusMeterStart;
	const betRelative = stateGame.bonusMeterBookValuesAreBetRelative;
	const sessionValue = bonusMeterSessionValueFromBook(bookValue, betStart, betRelative);
	const max = stateGame.bonusMeterMax > 0 ? stateGame.bonusMeterMax : sessionValue;
	const capped = Math.min(sessionValue, max);
	if (capped >= max) {
		stateGame.bonusMeterValue = max;
		stateGame.bonusMeterLevel = bookLevel;
		setRgsSessionBonusMeter(max, bookLevel);
		return;
	}
	stateGame.bonusMeterValue = Math.max(stateGame.bonusMeterValue, capped);
	stateGame.bonusMeterLevel = bookLevel;
	setRgsSessionBonusMeter(stateGame.bonusMeterValue, bookLevel);
}

function bonusMeterConsumedThisRound(events: BookEvent[]): boolean {
	// A `bonusRoulette` means a bonus round triggered this bet (incl. the dedicated trigger mode,
	// which carries no `bonusMeter` event) — the meter was spent and must reset to 0.
	return events.some((event) => event.type === 'bonusRoulette');
}

/** After a bet book finishes: leave the round's achieved fill on screen and persist it. */
export async function syncBonusMeterAfterBet(_events: BookEvent[]): Promise<void> {
	if (stateGame.bonusRoundActive || stateGame.bonusBallsRemaining > 0) return;
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
