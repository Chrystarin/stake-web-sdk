import { eventEmitter } from '../../game/eventEmitter';
import { triggerRoulette, waitForRouletteClose } from '../../game/meterFlow';
import { deriveSpinMeterFromBookEvents } from '../../game/plinkoSessionMeters';
import { stateGame } from '../../game/stateGame.svelte';
import type { BookEvent, BookEventOfType, Bet } from '../../game/typesBookEvent';
import { bookHasFreeSpinTrigger } from './bookAugmentation';
import {
	getFreeSpinBaseRoundWin,
	multiplyRoundWinByFreeSpinSegment,
	resolveFreeSpinPayoutAmount,
} from './payout';
import { freeSpinSegmentIndexForSegment } from './rouletteFlow';
import { fallbackFreeSpinSegmentFromRound } from './wallet';

export { bookHasFreeSpinTrigger };

export function sessionSpinMeterReachedMax(events: BookEvent[]): boolean {
	const max = stateGame.spinMeterMax > 0 ? stateGame.spinMeterMax : 10;
	const peak = Math.max(
		stateGame.spinMeterValue,
		deriveSpinMeterFromBookEvents(events),
	);
	return peak >= max;
}

type FreeSpinTriggerPayload = Pick<
	BookEventOfType<'freeSpinTrigger'>,
	'segment' | 'multiplier' | 'amount'
>;

export async function runFreeSpinTriggerFlow(payload: FreeSpinTriggerPayload): Promise<void> {
	const segment =
		payload.segment ??
		(payload.multiplier > 0 ? `${payload.multiplier}X` : 'BONUS');
	stateGame.freeSpinBaseRoundWin = getFreeSpinBaseRoundWin();
	stateGame.freeSpinTriggerPayload = {
		segment,
		multiplier: payload.multiplier,
		amount: payload.amount,
	};
	stateGame.freeSpinAwardedThisRound = true;
	stateGame.serverFreeSpinSegmentLabel = segment;
	stateGame.serverFreeSpinSegment = freeSpinSegmentIndexForSegment(segment);
	stateGame.serverFreeSpinWinAmount = resolveFreeSpinPayoutAmount(
		stateGame.freeSpinTriggerPayload,
		stateGame.freeSpinBaseRoundWin,
	);
	stateGame.showFreeSpinRoulette = true;
	triggerRoulette('spin');
	await eventEmitter.broadcastAsync({
		type: 'freeSpinShow',
		multiplier: payload.multiplier,
	});
	await waitForRouletteClose();
}

/**
 * Lookup-table books only emit `freeSpinTrigger` when the meter fills from 0 within one bet.
 * When session carry-over fills the meter, run the wheel + reset from RGS or a safe fallback.
 */
export async function ensureFreeSpinWhenSessionMeterFull(
	events: BookEvent[],
	bet?: Bet,
): Promise<void> {
	if (!stateGame.authoritativeMeterFlow) return;
	if (bookHasFreeSpinTrigger(events)) return;
	if (!sessionSpinMeterReachedMax(events)) return;

	const roundBet = bet ?? stateGame.activeRoundBet;
	// When the served book omits `freeSpinTrigger`, use a deterministic presentation fallback;
	const fallback = fallbackFreeSpinSegmentFromRound(roundBet);
	const fallbackScaledWin = multiplyRoundWinByFreeSpinSegment(
		fallback.segment,
		getFreeSpinBaseRoundWin(),
	).totalWin;
	const payload: FreeSpinTriggerPayload = {
		segment: fallback.segment,
		multiplier: fallback.multiplier,
		amount: fallbackScaledWin,
	};
	await runFreeSpinTriggerFlow(payload);
}
