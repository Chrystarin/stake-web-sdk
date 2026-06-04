import { PUBLIC_CHROMATIC } from 'envs';
import { stateUrlDerived } from 'state-shared';
import { requestBetAction } from 'rgs-requests';

import { eventEmitter } from '../../game/eventEmitter';
import { triggerRoulette, waitForRouletteClose } from '../../game/meterFlow';
import { deriveSpinMeterFromBookEvents, hasActiveRgsSession } from '../../game/plinkoSessionMeters';
import { stateGame } from '../../game/stateGame.svelte';
import type { BookEvent, BookEventOfType, Bet } from '../../game/typesBookEvent';
import { bookHasFreeSpinTrigger } from './bookAugmentation';
import { applyFreeSpinActionBalance, resolveFreeSpinPayoutAmount } from './payout';
import { freeSpinSegmentIndexForSegment } from './rouletteFlow';
import { fallbackFreeSpinSegmentFromRound } from './wallet';

const RGS_FREE_SPIN_ACTIONS = ['freeSpinTrigger', 'free_spin_trigger', 'freeSpinSettle'] as const;

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

function parseFreeSpinTriggerFromActionResponse(data: unknown): FreeSpinTriggerPayload | null {
	const round = (data as { action?: { state?: unknown; meta?: unknown } })?.action;
	const state = round?.state;
	if (Array.isArray(state)) {
		const event = state.find(
			(item): item is BookEventOfType<'freeSpinTrigger'> =>
				typeof item === 'object' &&
				item != null &&
				(item as BookEvent).type === 'freeSpinTrigger',
		);
		if (event) {
			return {
				segment: event.segment,
				multiplier: event.multiplier,
				amount: event.amount,
			};
		}
	}

	const meta = (round?.meta ?? (data as { meta?: unknown })?.meta) as
		| Record<string, unknown>
		| undefined;
	if (!meta) return null;

	const segment =
		(typeof meta.segment === 'string' && meta.segment) ||
		(typeof meta.free_spin_segment === 'string' && meta.free_spin_segment) ||
		undefined;
	const multiplier = Number(meta.multiplier ?? meta.free_spin_multiplier);
	const amount = Number(meta.amount ?? meta.free_spin_amount);
	if (segment || (Number.isFinite(multiplier) && multiplier > 0)) {
		return {
			segment,
			multiplier: Number.isFinite(multiplier) ? multiplier : 0,
			amount: Number.isFinite(amount) ? amount : undefined,
		};
	}
	return null;
}

/** Ask RGS for an authoritative free-spin wheel result when lookup books omit the event. */
async function requestRgsFreeSpinTrigger(): Promise<FreeSpinTriggerPayload | null> {
	if (PUBLIC_CHROMATIC || stateUrlDerived.replay() || !hasActiveRgsSession()) return null;
	for (const action of RGS_FREE_SPIN_ACTIONS) {
		try {
			const response = await requestBetAction({
				rgsUrl: stateUrlDerived.rgsUrl(),
				sessionID: stateUrlDerived.sessionID(),
				action,
				meta: {
					spin_meter_full: true,
					spinMeterFull: true,
				},
			});
			applyFreeSpinActionBalance(response);
			const parsed = parseFreeSpinTriggerFromActionResponse(response);
			if (parsed) return parsed;
		} catch {
			// Try next action name.
		}
	}
	return null;
}

export async function runFreeSpinTriggerFlow(payload: FreeSpinTriggerPayload): Promise<void> {
	const segment =
		payload.segment ??
		(payload.multiplier > 0 ? `${payload.multiplier}X` : 'BONUS');
	stateGame.freeSpinAwardedThisRound = true;
	stateGame.serverFreeSpinSegmentLabel = segment;
	stateGame.serverFreeSpinSegment = freeSpinSegmentIndexForSegment(segment);
	stateGame.serverFreeSpinWinAmount = resolveFreeSpinPayoutAmount(payload);
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
	const rgsPayload = await requestRgsFreeSpinTrigger();
	const fallback = fallbackFreeSpinSegmentFromRound(roundBet);
	const payload: FreeSpinTriggerPayload = rgsPayload ?? {
		segment: fallback.segment,
		multiplier: fallback.multiplier,
		amount: fallback.amount,
	};
	await runFreeSpinTriggerFlow(payload);
}
