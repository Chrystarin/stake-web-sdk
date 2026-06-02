import { PUBLIC_CHROMATIC } from 'envs';
import { stateUrlDerived } from 'state-shared';
import { requestBetAction } from 'rgs-requests';

import { eventEmitter } from './eventEmitter';
import { plinkoStakePerBall, plinkoWagerAmount } from './plinkoBet';
import {
	freeSpinSegmentIndexForSegment,
	triggerRoulette,
	waitForRouletteClose,
} from './meterFlow';
import { deriveSpinMeterFromBookEvents, hasActiveRgsSession } from './plinkoSessionMeters';
import { stateGame } from './stateGame.svelte';
import type { BookEvent, BookEventOfType } from './typesBookEvent';

const RGS_FREE_SPIN_ACTION = 'freeSpinTrigger';

export function bookHasFreeSpinTrigger(events: BookEvent[]): boolean {
	return events.some((event) => event.type === 'freeSpinTrigger');
}

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
> & {
	/** When false, wheel is display-only (no client-computed payout). */
	authoritative?: boolean;
};

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
	try {
		const response = await requestBetAction({
			rgsUrl: stateUrlDerived.rgsUrl(),
			sessionID: stateUrlDerived.sessionID(),
			action: RGS_FREE_SPIN_ACTION,
			meta: {
				spin_meter_full: true,
				spinMeterFull: true,
			},
		});
		return parseFreeSpinTriggerFromActionResponse(response);
	} catch (error) {
		console.warn('[plinko] RGS free-spin action unavailable; wheel is presentation-only', error);
		return null;
	}
}

/** Presentation fallback when lookup-table books fill the session meter without `freeSpinTrigger`. */
function presentationOnlyFreeSpinTrigger(): FreeSpinTriggerPayload {
	return {
		segment: '5X',
		multiplier: 5,
		amount: 0,
		authoritative: false,
	};
}

export async function runFreeSpinTriggerFlow(payload: FreeSpinTriggerPayload): Promise<void> {
	const segment =
		payload.segment ??
		(payload.multiplier > 0 ? `${payload.multiplier}X` : 'BONUS');
	stateGame.freeSpinAwardedThisRound = true;
	stateGame.serverFreeSpinSegmentLabel = segment;
	stateGame.serverFreeSpinSegment = freeSpinSegmentIndexForSegment(segment);
	const bookStake = stateGame.lastBookStakePerBall > 0 ? stateGame.lastBookStakePerBall : 1;
	const stakeScale = plinkoStakePerBall() / bookStake;
	const authoredAmount = payload.amount ?? 0;
	const fromBook = payload.authoritative !== false;
	stateGame.serverFreeSpinWinAmount =
		authoredAmount > 0
			? authoredAmount * stakeScale
			: fromBook && payload.multiplier > 0
				? plinkoWagerAmount() * payload.multiplier
				: 0;
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
export async function ensureFreeSpinWhenSessionMeterFull(events: BookEvent[]): Promise<void> {
	if (!stateGame.authoritativeMeterFlow) return;
	if (bookHasFreeSpinTrigger(events)) return;
	if (!sessionSpinMeterReachedMax(events)) return;

	const payload = (await requestRgsFreeSpinTrigger()) ?? presentationOnlyFreeSpinTrigger();
	await runFreeSpinTriggerFlow(payload);
}
