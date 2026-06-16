import { PUBLIC_CHROMATIC } from 'envs';
import { stateBet, stateUrlDerived } from 'state-shared';

import { DEFAULT_ROW_COUNT, PLINKO_DEFAULT_VARIANT_ID } from '../game-logic/constants';
import { stateGame } from './stateGame.svelte';
import type { BookEvent } from './typesBookEvent';

/** Dev-only mirror of RGS session spin meter when no live session is configured. */
let devRgsSpinMeter = 0;
/** Dev-only mirror of RGS session bonus meter / level when no live session is configured. */
let devRgsBonusMeter = 0;
let devRgsBonusLevel = 0;

/** In-memory spin meter synced from RGS books; sent on the next `/wallet/play` meta. */
let rgsSessionSpinMeter = 0;
/** In-memory bonus meter / level synced from RGS books; sent on the next `/wallet/play` meta. */
let rgsSessionBonusMeter = 0;
let rgsSessionBonusLevel = 0;

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
	return Math.max(0, Math.floor(rgsSessionBonusMeter));
}

export function getRgsSessionBonusLevel(): number {
	return Math.max(0, Math.floor(rgsSessionBonusLevel));
}

export function setRgsSessionBonusMeter(value: number, level?: number): void {
	rgsSessionBonusMeter = Math.max(0, Math.floor(value));
	if (level != null) {
		rgsSessionBonusLevel = Math.max(0, Math.floor(level));
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

/** Read bonus meter / level for local dev (simulates RGS session store). */
export function getDevRgsBonusMeter(): number {
	return devRgsBonusMeter;
}

export function getDevRgsBonusLevel(): number {
	return devRgsBonusLevel;
}

/**
 * Spin meter at bet start.
 * - RGS-injected `spinMeterStart` > 0 (session carry-over from live RGS).
 * - Published lookup-table books always ship `spinMeterStart: 0` — ignore when session meter > 0.
 * - Explicit 0 with empty session meter (after free spin or first bet).
 * - Field absent: use in-memory session meter / dev mirror.
 */
export function resolveRgsSpinMeterStart(
	bookEvent: Extract<BookEvent, { type: 'plinkoDrop' }>,
): number {
	const sessionMeter = getRgsSessionSpinMeter();
	const raw = bookEvent.spinMeterStart;

	if (raw != null && raw > 0) {
		return Math.max(0, Math.floor(raw));
	}

	// Lookup-table publish files bake in spinMeterStart: 0 for every book — not a session reset.
	if (raw === 0 && sessionMeter > 0) {
		return sessionMeter;
	}

	if (raw != null) {
		return 0;
	}

	if (!hasActiveRgsSession()) return devRgsSpinMeter;
	return sessionMeter;
}

/**
 * Bonus meter at bet start.
 * - RGS-injected `bonusMeterStart` > 0 (session carry-over from live RGS).
 * - Published lookup-table books always ship `bonusMeterStart: 0` — ignore when session meter > 0.
 * - Explicit 0 with empty session meter (after bonus trigger or first bet).
 * - Field absent: use in-memory session meter / dev mirror.
 */
export function resolveRgsBonusMeterStart(
	bookEvent: Extract<BookEvent, { type: 'plinkoDrop' }>,
): number {
	const sessionMeter = getRgsSessionBonusMeter();
	const raw = bookEvent.bonusMeterStart;

	if (raw != null && raw > 0) {
		return Math.max(0, Math.floor(raw));
	}

	if (raw === 0 && sessionMeter > 0) {
		return sessionMeter;
	}

	if (raw != null) {
		return 0;
	}

	if (!hasActiveRgsSession()) return devRgsBonusMeter;
	return sessionMeter;
}

/**
 * Bonus level at bet start — same carry-over rules as `resolveRgsBonusMeterStart`.
 */
export function resolveRgsBonusLevelStart(
	bookEvent: Extract<BookEvent, { type: 'plinkoDrop' }>,
): number {
	const sessionLevel = getRgsSessionBonusLevel();
	const raw = bookEvent.bonusLevelStart;

	if (raw != null && raw > 0) {
		return Math.max(0, Math.floor(raw));
	}

	if (raw === 0 && sessionLevel > 0) {
		return sessionLevel;
	}

	if (raw != null) {
		return 0;
	}

	if (!hasActiveRgsSession()) return devRgsBonusLevel;
	return sessionLevel;
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
export function buildBetMetaSpinMeter(): Record<string, number> {
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
	if (drop && resolveRgsSpinMeterStart(drop) > 0) return false;
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
	const raw = betRelative ? betStart + bookValue : bookValue;
	return Math.max(0, Math.floor(raw));
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

/** After a bet book finishes: display RGS result and sync spin meter for the next play meta. */
export async function syncSpinMeterAfterBet(events: BookEvent[]): Promise<void> {
	const derived = deriveSpinMeterFromBookEvents(events);
	const hadFreeSpinReset =
		events.some((event) => event.type === 'freeSpinTrigger') ||
		stateGame.freeSpinAwardedThisRound;
	const spinMeter = hadFreeSpinReset
		? 0
		: Math.max(derived, stateGame.spinMeterValue, getRgsSessionSpinMeter());
	applySpinMeterDisplay(spinMeter);
	updateRgsSessionSpinMeter(spinMeter);
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
	if (drop && resolveRgsBonusMeterStart(drop) > 0) return false;
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
	const raw = betRelative ? betStart + bookValue : bookValue;
	return Math.max(0, Math.floor(raw));
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

	let bonusMeter = betStart;
	let bonusLevel = levelStart;
	for (const event of events) {
		if (event.type === 'bonusMeter') {
			bonusMeter = bonusMeterSessionValueFromBook(event.value, betStart, betRelative);
			bonusLevel = event.level;
			if (bonusMeter >= max) bonusMeter = 0;
		}
		if (event.type === 'bonusRound') {
			bonusLevel = Math.max(bonusLevel, event.level + 1);
		}
	}
	return {
		value: Math.max(0, Math.floor(bonusMeter)),
		level: Math.max(0, Math.floor(bonusLevel)),
	};
}

/** Update HUD display only — does not persist or author outcomes. */
export function applyBonusMeterDisplay(bonusMeter: number, bonusLevel?: number): void {
	const max = stateGame.bonusMeterMax > 0 ? stateGame.bonusMeterMax : bonusMeter;
	stateGame.bonusMeterValue = Math.min(Math.max(0, bonusMeter), max);
	if (bonusLevel != null) {
		stateGame.bonusMeterLevel = Math.max(0, Math.floor(bonusLevel));
	}
}

/** Sync in-memory session bonus meter / level from RGS (next play sends it via meta). */
export function updateRgsSessionBonusMeter(bonusMeter: number, bonusLevel: number): void {
	const value = Math.max(0, Math.floor(bonusMeter));
	const level = Math.max(0, Math.floor(bonusLevel));
	setRgsSessionBonusMeter(value, level);

	if (PUBLIC_CHROMATIC || stateUrlDerived.replay()) return;

	if (!hasActiveRgsSession()) {
		devRgsBonusMeter = value;
		devRgsBonusLevel = level;
	}
}

/** Apply a `bonusMeter` book event to the HUD (session-absolute, never regress mid-bet). */
export function applyBonusMeterBookEvent(bookValue: number, bookLevel: number): void {
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
	const max = stateGame.bonusMeterMax > 0 ? stateGame.bonusMeterMax : 20;
	const hitMax = events.some(
		(event) => event.type === 'bonusMeter' && event.value >= max,
	);
	return (
		hitMax &&
		events.some((event) => event.type === 'bonusRoulette' || event.type === 'bonusRound')
	);
}

/** After a bet book finishes: display RGS result and sync bonus meter for the next play meta. */
export async function syncBonusMeterAfterBet(events: BookEvent[]): Promise<void> {
	const derived = deriveBonusMeterFromBookEvents(events);
	const consumed = bonusMeterConsumedThisRound(events) || stateGame.bonusAwardedThisRound;
	const bonusMeter = consumed
		? derived.value
		: Math.max(derived.value, stateGame.bonusMeterValue, getRgsSessionBonusMeter());
	const bonusLevel = Math.max(
		derived.level,
		stateGame.bonusMeterLevel,
		getRgsSessionBonusLevel(),
	);
	applyBonusMeterDisplay(bonusMeter, bonusLevel);
	updateRgsSessionBonusMeter(bonusMeter, bonusLevel);
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
