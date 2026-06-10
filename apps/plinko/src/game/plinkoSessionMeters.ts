import { PUBLIC_CHROMATIC } from 'envs';
import { stateBet, stateUrlDerived } from 'state-shared';
import { requestBetAction } from 'rgs-requests';

import { PLINKO_DEFAULT_VARIANT_ID } from '../game-logic/constants';
import { stateGame } from './stateGame.svelte';
import type { BookEvent } from './typesBookEvent';

/** Dev-only mirror of RGS session spin meter when no live session is configured. */
let devRgsSpinMeter = 0;
/** Dev-only mirror of RGS session bonus meter / level when no live session is configured. */
let devRgsBonusMeter = 0;
let devRgsBonusLevel = 0;

/** Last persisted session spin meter (RGS `/bet/action` + local cache between bets). */
let sessionSpinMeterCache = 0;
/** Last persisted session bonus meter and level (RGS `/bet/action` + local cache between bets). */
let sessionBonusMeterCache = 0;
let sessionBonusLevelCache = 0;

const RGS_SESSION_METERS_ACTION = 'sessionMeters';
const SESSION_SPIN_METER_STORAGE_PREFIX = 'plinko_rgs_spin_meter_';
const SESSION_BONUS_METER_STORAGE_PREFIX = 'plinko_rgs_bonus_meter_';
const SESSION_BONUS_LEVEL_STORAGE_PREFIX = 'plinko_rgs_bonus_level_';

export function hasActiveRgsSession(): boolean {
	return !!(stateUrlDerived.rgsUrl()?.trim() && stateUrlDerived.sessionID()?.trim());
}

function sessionSpinMeterStorageKey(): string {
	const id = stateUrlDerived.sessionID()?.trim() || 'local-dev';
	return `${SESSION_SPIN_METER_STORAGE_PREFIX}${id}`;
}

/** Load cached spin meter from sessionStorage (survives page refresh within same sessionID). */
export function hydrateSessionSpinMeterCache(): number {
	if (typeof sessionStorage === 'undefined') return sessionSpinMeterCache;
	try {
		const raw = sessionStorage.getItem(sessionSpinMeterStorageKey());
		if (raw != null) {
			sessionSpinMeterCache = Math.max(0, Math.floor(Number(raw) || 0));
		}
	} catch {
		// Ignore private-mode / quota errors.
	}
	return sessionSpinMeterCache;
}

export function getSessionSpinMeterCarryOver(): number {
	return Math.max(0, Math.floor(sessionSpinMeterCache));
}

export function setSessionSpinMeterCache(value: number): void {
	sessionSpinMeterCache = Math.max(0, Math.floor(value));
	if (typeof sessionStorage === 'undefined') return;
	try {
		sessionStorage.setItem(sessionSpinMeterStorageKey(), String(sessionSpinMeterCache));
	} catch {
		// Ignore private-mode / quota errors.
	}
}

function sessionBonusMeterStorageKey(): string {
	const id = stateUrlDerived.sessionID()?.trim() || 'local-dev';
	return `${SESSION_BONUS_METER_STORAGE_PREFIX}${id}`;
}

function sessionBonusLevelStorageKey(): string {
	const id = stateUrlDerived.sessionID()?.trim() || 'local-dev';
	return `${SESSION_BONUS_LEVEL_STORAGE_PREFIX}${id}`;
}

/** Load cached bonus meter / level from sessionStorage (survives page refresh within same sessionID). */
export function hydrateSessionBonusMeterCache(): { value: number; level: number } {
	if (typeof sessionStorage !== 'undefined') {
		try {
			const rawMeter = sessionStorage.getItem(sessionBonusMeterStorageKey());
			if (rawMeter != null) {
				sessionBonusMeterCache = Math.max(0, Math.floor(Number(rawMeter) || 0));
			}
			const rawLevel = sessionStorage.getItem(sessionBonusLevelStorageKey());
			if (rawLevel != null) {
				sessionBonusLevelCache = Math.max(0, Math.floor(Number(rawLevel) || 0));
			}
		} catch {
			// Ignore private-mode / quota errors.
		}
	}
	return {
		value: sessionBonusMeterCache,
		level: sessionBonusLevelCache,
	};
}

export function getSessionBonusMeterCarryOver(): number {
	return Math.max(0, Math.floor(sessionBonusMeterCache));
}

export function getSessionBonusLevelCarryOver(): number {
	return Math.max(0, Math.floor(sessionBonusLevelCache));
}

export function setSessionBonusMeterCache(value: number, level?: number): void {
	sessionBonusMeterCache = Math.max(0, Math.floor(value));
	if (level != null) {
		sessionBonusLevelCache = Math.max(0, Math.floor(level));
	}
	if (typeof sessionStorage === 'undefined') return;
	try {
		sessionStorage.setItem(sessionBonusMeterStorageKey(), String(sessionBonusMeterCache));
		if (level != null) {
			sessionStorage.setItem(sessionBonusLevelStorageKey(), String(sessionBonusLevelCache));
		}
	} catch {
		// Ignore private-mode / quota errors.
	}
}

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
 * - Published lookup-table books always ship `spinMeterStart: 0` — ignore when cache > 0.
 * - Explicit 0 with empty cache (after free spin or first bet).
 * - Field absent: use session cache / dev mirror.
 */
export function resolveRgsSpinMeterStart(
	bookEvent: Extract<BookEvent, { type: 'plinkoDrop' }>,
): number {
	const cached = getSessionSpinMeterCarryOver();
	const raw = bookEvent.spinMeterStart;

	if (raw != null && raw > 0) {
		return Math.max(0, Math.floor(raw));
	}

	// Lookup-table publish files bake in spinMeterStart: 0 for every book — not a session reset.
	if (raw === 0 && cached > 0) {
		return cached;
	}

	if (raw != null) {
		return 0;
	}

	if (!hasActiveRgsSession()) return devRgsSpinMeter;
	return cached;
}

/**
 * Bonus meter at bet start.
 * - RGS-injected `bonusMeterStart` > 0 (session carry-over from live RGS).
 * - Published lookup-table books always ship `bonusMeterStart: 0` — ignore when cache > 0.
 * - Explicit 0 with empty cache (after bonus trigger or first bet).
 * - Field absent: use session cache / dev mirror.
 */
export function resolveRgsBonusMeterStart(
	bookEvent: Extract<BookEvent, { type: 'plinkoDrop' }>,
): number {
	const cached = getSessionBonusMeterCarryOver();
	const raw = bookEvent.bonusMeterStart;

	if (raw != null && raw > 0) {
		return Math.max(0, Math.floor(raw));
	}

	if (raw === 0 && cached > 0) {
		return cached;
	}

	if (raw != null) {
		return 0;
	}

	if (!hasActiveRgsSession()) return devRgsBonusMeter;
	return cached;
}

/**
 * Bonus level at bet start — same carry-over rules as `resolveRgsBonusMeterStart`.
 */
export function resolveRgsBonusLevelStart(
	bookEvent: Extract<BookEvent, { type: 'plinkoDrop' }>,
): number {
	const cached = getSessionBonusLevelCarryOver();
	const raw = bookEvent.bonusLevelStart;

	if (raw != null && raw > 0) {
		return Math.max(0, Math.floor(raw));
	}

	if (raw === 0 && cached > 0) {
		return cached;
	}

	if (raw != null) {
		return 0;
	}

	if (!hasActiveRgsSession()) return devRgsBonusLevel;
	return cached;
}

/**
 * Meta for `/wallet/play` — Stake Engine maps this to math distribution `conditions`
 * (`spin_meter_start`, etc.) and serves a book with matching `plinkoDrop.spinMeterStart`
 * and authoritative `freeSpinTrigger` / payout. Required for session meter carry-over.
 */
export function buildBetMetaPlayConditions(): Record<string, number> {
	const spinMeter = getSessionSpinMeterCarryOver();
	const bonusMeter = getSessionBonusMeterCarryOver();
	const bonusLevel = getSessionBonusLevelCarryOver();
	return {
		spin_meter_start: spinMeter,
		spinMeter: spinMeter,
		bonus_meter_start: bonusMeter,
		bonusMeter: bonusMeter,
		bonus_level_start: bonusLevel,
		bonusLevel: bonusLevel,
		difficulty: PLINKO_DEFAULT_VARIANT_ID,
		row_count: Math.max(8, Math.floor(stateGame.rowCount)),
		balls_per_drop: Math.max(1, Math.floor(stateGame.ballPerDrop)),
		stake_per_ball: Math.max(0, Number(stateBet.betAmount) || 0),
	};
}

/** @deprecated Use `buildBetMetaPlayConditions` */
export function buildBetMetaSpinMeter(): Record<string, number> {
	return buildBetMetaPlayConditions();
}

/** Apply cached session meter to HUD on load (display only until next book). */
export function applyCachedSpinMeterToDisplay(): void {
	applySpinMeterDisplay(getSessionSpinMeterCarryOver());
}

/** Apply cached session bonus meter / level to HUD on load (display only until next book). */
export function applyCachedBonusMeterToDisplay(): void {
	applyBonusMeterDisplay(getSessionBonusMeterCarryOver(), getSessionBonusLevelCarryOver());
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
		(drop ? resolveRgsSpinMeterStart(drop) : getSessionSpinMeterCarryOver());
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
		(drop ? resolveRgsSpinMeterStart(drop) : getSessionSpinMeterCarryOver());
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

/** Persist a session spin meter value to RGS (or dev mirror). */
export async function persistSpinMeterValue(spinMeter: number): Promise<void> {
	const value = Math.max(0, Math.floor(spinMeter));
	setSessionSpinMeterCache(value);

	if (PUBLIC_CHROMATIC || stateUrlDerived.replay()) return;

	if (!hasActiveRgsSession()) {
		devRgsSpinMeter = value;
		return;
	}

	// Session meter carry-over is sent on the next `/wallet/play` via `buildBetMetaPlayConditions`.
	// `/bet/action` is optional and returns 404 on Stake production RGS for this game.
	try {
		await requestBetAction({
			rgsUrl: stateUrlDerived.rgsUrl(),
			sessionID: stateUrlDerived.sessionID(),
			action: RGS_SESSION_METERS_ACTION,
			meta: {
				spin_meter: value,
				spinMeter: value,
			},
		});
	} catch {
		// Ignore — meta on the next play is authoritative.
	}
}

/** Reset spin meter to 0 on HUD and RGS after a free-spin award. */
export async function resetSpinMeterSession(): Promise<void> {
	applySpinMeterDisplay(0);
	await persistSpinMeterValue(0);
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
		setSessionSpinMeterCache(max);
		return;
	}
	stateGame.spinMeterValue = Math.max(stateGame.spinMeterValue, capped);
	setSessionSpinMeterCache(stateGame.spinMeterValue);
}

/** After a bet book finishes: display RGS result and persist spin meter to RGS. */
export async function syncSpinMeterAfterBet(events: BookEvent[]): Promise<void> {
	const derived = deriveSpinMeterFromBookEvents(events);
	const hadFreeSpinReset =
		events.some((event) => event.type === 'freeSpinTrigger') ||
		stateGame.freeSpinAwardedThisRound;
	const spinMeter = hadFreeSpinReset
		? 0
		: Math.max(derived, stateGame.spinMeterValue, getSessionSpinMeterCarryOver());
	applySpinMeterDisplay(spinMeter);
	await persistSpinMeterValue(spinMeter);
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
		(drop ? resolveRgsBonusMeterStart(drop) : getSessionBonusMeterCarryOver());
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
		(drop ? resolveRgsBonusMeterStart(drop) : getSessionBonusMeterCarryOver());
	const levelStart =
		stateGame.betBonusLevelStart ??
		(drop ? resolveRgsBonusLevelStart(drop) : getSessionBonusLevelCarryOver());
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

/** Persist session bonus meter / level to RGS (or dev mirror). */
export async function persistBonusMeterValue(
	bonusMeter: number,
	bonusLevel: number,
): Promise<void> {
	const value = Math.max(0, Math.floor(bonusMeter));
	const level = Math.max(0, Math.floor(bonusLevel));
	setSessionBonusMeterCache(value, level);

	if (PUBLIC_CHROMATIC || stateUrlDerived.replay()) return;

	if (!hasActiveRgsSession()) {
		devRgsBonusMeter = value;
		devRgsBonusLevel = level;
		return;
	}

	try {
		await requestBetAction({
			rgsUrl: stateUrlDerived.rgsUrl(),
			sessionID: stateUrlDerived.sessionID(),
			action: RGS_SESSION_METERS_ACTION,
			meta: {
				bonus_meter: value,
				bonusMeter: value,
				bonus_level: level,
				bonusLevel: level,
			},
		});
	} catch {
		// Ignore — meta on the next play is authoritative.
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
		setSessionBonusMeterCache(max, bookLevel);
		return;
	}
	stateGame.bonusMeterValue = Math.max(stateGame.bonusMeterValue, capped);
	stateGame.bonusMeterLevel = bookLevel;
	setSessionBonusMeterCache(stateGame.bonusMeterValue, bookLevel);
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

/** After a bet book finishes: display RGS result and persist bonus meter to RGS. */
export async function syncBonusMeterAfterBet(events: BookEvent[]): Promise<void> {
	const derived = deriveBonusMeterFromBookEvents(events);
	const consumed = bonusMeterConsumedThisRound(events) || stateGame.bonusAwardedThisRound;
	const bonusMeter = consumed
		? derived.value
		: Math.max(derived.value, stateGame.bonusMeterValue, getSessionBonusMeterCarryOver());
	const bonusLevel = Math.max(
		derived.level,
		stateGame.bonusMeterLevel,
		getSessionBonusLevelCarryOver(),
	);
	applyBonusMeterDisplay(bonusMeter, bonusLevel);
	await persistBonusMeterValue(bonusMeter, bonusLevel);
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
