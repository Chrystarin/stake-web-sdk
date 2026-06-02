import { PUBLIC_CHROMATIC } from 'envs';
import { stateUrlDerived } from 'state-shared';
import { requestBetAction } from 'rgs-requests';

import { stateGame } from './stateGame.svelte';
import type { BookEvent } from './typesBookEvent';

/** Dev-only mirror of RGS session spin meter when no live session is configured. */
let devRgsSpinMeter = 0;

/** Last persisted session spin meter (RGS `/bet/action` + local cache between bets). */
let sessionSpinMeterCache = 0;

const RGS_SESSION_METERS_ACTION = 'sessionMeters';
const SESSION_SPIN_METER_STORAGE_PREFIX = 'plinko_rgs_spin_meter_';

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

/** Read spin meter start for local dev (simulates RGS session store). */
export function getDevRgsSpinMeter(): number {
	return devRgsSpinMeter;
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

/** Meta for `/wallet/play` so RGS can inject `spinMeterStart` on the served book. */
export function buildBetMetaSpinMeter(): Record<string, number> {
	const spinMeter = getSessionSpinMeterCarryOver();
	return {
		spin_meter_start: spinMeter,
		spinMeter: spinMeter,
	};
}

/** Apply cached session meter to HUD on load (display only until next book). */
export function applyCachedSpinMeterToDisplay(): void {
	applySpinMeterDisplay(getSessionSpinMeterCarryOver());
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
	} catch (error) {
		console.error('[plinko] failed to persist spin meter to RGS', error);
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
