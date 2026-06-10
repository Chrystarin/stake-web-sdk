import { BONUS_ROULETTE_SEGMENTS } from '../../game-logic/constants';
import { eventEmitter } from '../../game/eventEmitter';
import { isDropBatchPending, startAuthoritativeBonusRound } from '../../game/gameOrchestrator';
import { triggerRoulette, waitForRouletteClose } from '../../game/meterFlow';
import {
	bonusMeterBookValuesAreBetRelative,
	bonusMeterSessionValueFromBook,
	deriveBonusMeterFromBookEvents,
	resolveRgsBonusMeterStart,
} from '../../game/plinkoSessionMeters';
import { isBonusMeterFull, stateGame } from '../../game/stateGame.svelte';
import type { Bet, BookEvent } from '../../game/typesBookEvent';
import { bookHasBonusRoulette } from './bookAugmentation';

export { bookHasBonusRoulette };

let bonusMeterIdleTriggerRunning = false;

function getPlinkoDrop(events: BookEvent[]) {
	return events.find(
		(event): event is Extract<BookEvent, { type: 'plinkoDrop' }> => event.type === 'plinkoDrop',
	);
}

function bonusMeterPeakFromBookEvents(events: BookEvent[]): number {
	const drop = getPlinkoDrop(events);
	const max = stateGame.bonusMeterMax > 0 ? stateGame.bonusMeterMax : drop?.bonusMeterMax ?? 20;
	const betStart =
		stateGame.betBonusMeterStart ??
		(drop ? resolveRgsBonusMeterStart(drop) : 0);
	const betRelative = bonusMeterBookValuesAreBetRelative(events, betStart);

	let peak = betStart;
	for (const event of events) {
		if (event.type === 'bonusMeter') {
			peak = bonusMeterSessionValueFromBook(event.value, betStart, betRelative);
		}
	}
	return Math.min(Math.max(peak, deriveBonusMeterFromBookEvents(events).value), max);
}

/** True when this book's bonus-meter events will reach max (before `playBet` mutates HUD). */
export function bookEventsReachBonusMeterMax(events: BookEvent[]): boolean {
	if (bookHasBonusRoulette(events)) return true;
	const drop = getPlinkoDrop(events);
	const max =
		(drop?.bonusMeterMax != null && drop.bonusMeterMax > 0 ? drop.bonusMeterMax : 20) ||
		(stateGame.bonusMeterMax > 0 ? stateGame.bonusMeterMax : 20);
	return bonusMeterPeakFromBookEvents(events) >= max;
}

/** Peak session bonus meter implied by book events (including carry-over start). */
export function sessionBonusMeterReachedMax(events: BookEvent[]): boolean {
	const max = stateGame.bonusMeterMax > 0 ? stateGame.bonusMeterMax : 20;
	if (stateGame.bonusMeterValue >= max) return true;
	return bonusMeterPeakFromBookEvents(events) >= max;
}

/** Deterministic wheel segment for dev / session-meter fallback (no client RNG on production wallet). */
export function fallbackBonusFreeBallsFromRound(bet?: Bet): number {
	const segments = BONUS_ROULETTE_SEGMENTS;
	const seed = Number(bet?.id ?? bet?.payoutMultiplier ?? 0) || 0;
	const index = Math.abs(seed) % segments.length;
	return segments[index] ?? segments[0];
}

export async function runBonusRouletteFlow(freeBalls: number): Promise<void> {
	const balls = Math.max(1, Math.floor(freeBalls || 1));
	stateGame.serverBonusFreeBalls = balls;
	stateGame.showBonusRoulette = true;
	triggerRoulette('bonus');
	await eventEmitter.broadcastAsync({
		type: 'bonusRouletteShow',
		freeBalls: balls,
	});
	await waitForRouletteClose();
}

/**
 * Lookup-table books only emit `bonusRoulette` when the meter fills from 0 within one bet.
 * When session carry-over fills the meter, run the wheel before settlement.
 */
export async function ensureBonusWhenSessionMeterFull(
	events: BookEvent[],
	bet?: Bet,
): Promise<void> {
	if (bookHasBonusRoulette(events)) return;
	if (stateGame.bonusAwardedThisRound) return;
	if (!sessionBonusMeterReachedMax(events)) return;

	const roundBet = bet ?? stateGame.activeRoundBet;
	const freeBalls = fallbackBonusFreeBallsFromRound(roundBet);
	await runBonusRouletteFlow(freeBalls);
	if (stateGame.bonusBallsRemaining <= 0) {
		startAuthoritativeBonusRound(
			freeBalls,
			[],
			stateGame.bonusMeterLevel || 0,
			0,
		);
	}
}

export function shouldTriggerBonusRouletteForFullMeter(): boolean {
	if (!isBonusMeterFull()) return false;
	if (stateGame.bonusAwardedThisRound || stateGame.bonusRoundActive) return false;
	if (stateGame.bonusBallsRemaining > 0) return false;
	if (stateGame.showBonusRoulette || stateGame.bonusRouletteOpen) return false;
	if (stateGame.rouletteFlowInProgress) return false;
	if (stateGame.dropRoundActive || stateGame.isSubmitting) return false;
	if (isDropBatchPending()) return false;
	return true;
}

/** Unstick UI when session cache left the bonus meter full without a wheel (e.g. after reload). */
export function scheduleBonusRouletteIfMeterFullIdle(): void {
	if (bonusMeterIdleTriggerRunning || !shouldTriggerBonusRouletteForFullMeter()) return;
	bonusMeterIdleTriggerRunning = true;
	void (async () => {
		try {
			const freeBalls = fallbackBonusFreeBallsFromRound(stateGame.activeRoundBet);
			await runBonusRouletteFlow(freeBalls);
			if (stateGame.bonusBallsRemaining <= 0) {
				startAuthoritativeBonusRound(
					freeBalls,
					[],
					stateGame.bonusMeterLevel || 0,
					0,
				);
			}
		} finally {
			bonusMeterIdleTriggerRunning = false;
		}
	})();
}
