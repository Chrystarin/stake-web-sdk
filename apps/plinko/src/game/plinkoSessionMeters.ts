import { stateUrlDerived } from 'state-shared';

import config from './config';
import {
	applyAuthoritativeMeterConfig,
	type PlinkoDropMeterConfig,
} from './plinkoMeterConfig';
import { stateGame } from './stateGame.svelte';
import type { BookEvent } from './typesBookEvent';

export type PlinkoSessionMeters = {
	spinMeter: number;
	bonusMeter: number;
	bonusLevel: number;
};

const STORAGE_PREFIX = 'plinko_session_meters_';

const emptyMeters = (): PlinkoSessionMeters => ({
	spinMeter: 0,
	bonusMeter: 0,
	bonusLevel: 0,
});

export function sessionMetersStorageKey(sessionID?: string): string {
	const id = sessionID?.trim() || stateUrlDerived.sessionID()?.trim() || 'local-dev';
	return `${STORAGE_PREFIX}${id}`;
}

export function loadSessionMeters(sessionID?: string): PlinkoSessionMeters {
	if (typeof sessionStorage === 'undefined') return emptyMeters();
	try {
		const raw = sessionStorage.getItem(sessionMetersStorageKey(sessionID));
		if (!raw) return emptyMeters();
		const parsed = JSON.parse(raw) as Partial<PlinkoSessionMeters>;
		return {
			spinMeter: Math.max(0, Math.floor(Number(parsed.spinMeter) || 0)),
			bonusMeter: Math.max(0, Math.floor(Number(parsed.bonusMeter) || 0)),
			bonusLevel: Math.max(0, Math.floor(Number(parsed.bonusLevel) || 0)),
		};
	} catch {
		return emptyMeters();
	}
}

export function saveSessionMeters(meters: PlinkoSessionMeters, sessionID?: string): void {
	if (typeof sessionStorage === 'undefined') return;
	try {
		sessionStorage.setItem(sessionMetersStorageKey(sessionID), JSON.stringify(meters));
	} catch {
		// Ignore quota / private-mode errors.
	}
}

/** Meters to send on the next RGS `play` request (session carry-over). */
export function getSessionMetersForBet(sessionID?: string): PlinkoSessionMeters {
	return loadSessionMeters(sessionID);
}

/** Meta fields for `/wallet/play` — RGS reads these as math `conditions` (see crimson_plinko INTEGRATION.md). */
export function buildBetMetaMeters(sessionID?: string): Record<string, number> {
	const meters = getSessionMetersForBet(sessionID);
	return {
		spin_meter_start: meters.spinMeter,
		spinMeter: meters.spinMeter,
		bonus_meter_start: meters.bonusMeter,
		bonusMeter: meters.bonusMeter,
		bonus_level_start: meters.bonusLevel,
		bonusLevel: meters.bonusLevel,
	};
}

export function readMetersFromGameState(): PlinkoSessionMeters {
	return {
		spinMeter: Math.max(0, Math.floor(stateGame.spinMeterValue)),
		bonusMeter: Math.max(0, Math.floor(stateGame.bonusMeterValue)),
		bonusLevel: Math.max(0, Math.floor(stateGame.bonusMeterLevel)),
	};
}

export function applySessionMetersToGameState(
	meters: PlinkoSessionMeters,
	options?: { spinMeterMax?: number; bonusMeterMax?: number },
): void {
	const spinMax = options?.spinMeterMax ?? stateGame.spinMeterMax ?? config.spinMeterMax;
	const bonusMax = options?.bonusMeterMax ?? stateGame.bonusMeterMax ?? config.bonusMeterMax;
	applyAuthoritativeMeterConfig({
		spinMeterMax: spinMax,
		bonusMeterMax: bonusMax,
		spinMeterStart: Math.min(meters.spinMeter, spinMax),
		bonusMeterStart: Math.min(meters.bonusMeter, bonusMax),
		bonusLevelStart: meters.bonusLevel,
	});
}

/** Derive end-of-round meter values from a played book (for session persistence). */
export function deriveMetersFromBookEvents(events: BookEvent[]): PlinkoSessionMeters {
	const meters = emptyMeters();
	for (const event of events) {
		if (event.type === 'plinkoDrop') {
			if (event.spinMeterStart != null) meters.spinMeter = event.spinMeterStart;
			if (event.bonusMeterStart != null) meters.bonusMeter = event.bonusMeterStart;
			if (event.bonusLevelStart != null) meters.bonusLevel = event.bonusLevelStart;
		}
		if (event.type === 'spinMeter') meters.spinMeter = event.value;
		if (event.type === 'freeSpinTrigger') meters.spinMeter = 0;
		if (event.type === 'bonusMeter') {
			meters.bonusMeter = event.value;
			meters.bonusLevel = event.level;
		}
	}
	return {
		spinMeter: Math.max(0, Math.floor(meters.spinMeter)),
		bonusMeter: Math.max(0, Math.floor(meters.bonusMeter)),
		bonusLevel: Math.max(0, Math.floor(meters.bonusLevel)),
	};
}

/** Load persisted session meters into HUD state (before first bet / after auth). */
export function hydrateSessionMetersFromStorage(sessionID?: string): PlinkoSessionMeters {
	const meters = loadSessionMeters(sessionID);
	applySessionMetersToGameState(meters);
	return meters;
}

/** Persist meters after a completed bet — prefer live game state, fall back to book replay. */
export function persistSessionMetersAfterBet(
	events: BookEvent[],
	sessionID?: string,
): PlinkoSessionMeters {
	const fromState = readMetersFromGameState();
	const fromBook = deriveMetersFromBookEvents(events);
	const meters: PlinkoSessionMeters =
		stateGame.authoritativeMeterFlow || events.some((e) => e.type === 'spinMeter')
			? fromState
			: fromBook;
	saveSessionMeters(meters, sessionID);
	return meters;
}

/** Resolve plinkoDrop start values: book/RGS authoritative, else session carry-over. */
export function resolvePlinkoDropMeterStarts(
	bookEvent: Extract<BookEvent, { type: 'plinkoDrop' }>,
	sessionID?: string,
): Pick<PlinkoDropMeterConfig, 'spinMeterStart' | 'bonusMeterStart' | 'bonusLevelStart'> {
	const session = getSessionMetersForBet(sessionID);
	return {
		spinMeterStart: bookEvent.spinMeterStart ?? session.spinMeter,
		bonusMeterStart: bookEvent.bonusMeterStart ?? session.bonusMeter,
		bonusLevelStart: bookEvent.bonusLevelStart ?? session.bonusLevel,
	};
}
