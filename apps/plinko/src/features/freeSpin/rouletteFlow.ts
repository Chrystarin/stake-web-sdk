import { stateBet } from 'state-shared';

import { FREE_SPIN_SEGMENTS } from '../../game-logic/constants';
import {
	addSettledWinAmount,
	showResultOverlay,
} from '../../game/gameOrchestrator';
import { plinkoWagerAmount } from '../../game/plinkoBet';
import { hasActiveRgsSession, resetSpinMeterSession } from '../../game/plinkoSessionMeters';
import { meterController, stateGame } from '../../game/stateGame.svelte';
import { notifyRouletteClosed, triggerRoulette } from '../../game/meterFlow';
import {
	freeSpinMultiplierFromSegment,
	isFreeSpinBonusWheelSegment,
} from './payout';
import { queuePendingFreeSpinWalletCredit } from './walletSync';

export function isFreeSpinBonusSegment(segmentLabel: string): boolean {
	return isFreeSpinBonusWheelSegment(segmentLabel);
}

export async function onFreeSpinRouletteFinished(wheelSegmentLabel?: string) {
	const hadOpenWheel = stateGame.freeSpinRouletteOpen;
	stateGame.freeSpinRouletteOpen = false;
	stateGame.autoPlayPausedByFreeSpin = false;
	const segmentLabel =
		wheelSegmentLabel ??
		stateGame.serverFreeSpinSegmentLabel ??
		FREE_SPIN_SEGMENTS[stateGame.serverFreeSpinSegment ?? 0] ??
		'';

	const roundWager =
		stateBet.wageredBetAmount > 0 ? stateBet.wageredBetAmount : plinkoWagerAmount();
	let win = stateGame.serverFreeSpinWinAmount ?? 0;

	if (win <= 0 && segmentLabel && !isFreeSpinBonusWheelSegment(segmentLabel)) {
		const multiplier = freeSpinMultiplierFromSegment(segmentLabel);
		if (multiplier > 0) win = roundWager * multiplier;
	}

	if (win > 0) {
		addSettledWinAmount(win);
		showResultOverlay(win, win / Math.max(roundWager, 0.000_001));
	}

	// Only when the served book omitted `freeSpinTrigger` (old math). Books from republished
	// math include the event and payout; `/bet/action` is a best-effort fallback.
	const needsRgsFreeSpinCredit =
		hasActiveRgsSession() &&
		stateGame.freeSpinAwardedThisRound &&
		!stateGame.freeSpinSettledFromBook;
	if (win > 0 && needsRgsFreeSpinCredit) {
		const multiplier = freeSpinMultiplierFromSegment(segmentLabel);
		queuePendingFreeSpinWalletCredit({
			segment: segmentLabel,
			multiplier,
			winAmount: win,
		});
	}

	stateGame.serverFreeSpinWinAmount = undefined;
	stateGame.freeSpinSettledFromBook = false;

	await resetSpinMeterSession();
	const landedOnBonus = isFreeSpinBonusSegment(segmentLabel);
	let queued = meterController.completeRoulette();
	if (landedOnBonus) queued = 'bonus';
	if (stateGame.showFreeSpinRoulette || hadOpenWheel) {
		stateGame.showFreeSpinRoulette = false;
		stateGame.serverFreeSpinSegment = undefined;
		stateGame.serverFreeSpinSegmentLabel = undefined;
		notifyRouletteClosed();
	}
	if (!stateGame.authoritativeMeterFlow && queued) triggerRoulette(queued);
}

/** Map math/RGS free-spin wheel segment label to wheel index (no client RNG). */
export function freeSpinSegmentIndexForSegment(segment: string): number {
	const normalized = String(segment || '').toUpperCase();
	if (normalized === 'BONUS' || normalized === 'FREEBONUS') {
		const bonusIdx = FREE_SPIN_SEGMENTS.indexOf('BONUS');
		if (bonusIdx >= 0) return bonusIdx;
	}
	const direct = FREE_SPIN_SEGMENTS.indexOf(segment as (typeof FREE_SPIN_SEGMENTS)[number]);
	if (direct >= 0) return direct;
	const asLabel = `${segment}`.replace(/x$/i, 'X');
	const labelIdx = FREE_SPIN_SEGMENTS.indexOf(asLabel as (typeof FREE_SPIN_SEGMENTS)[number]);
	if (labelIdx >= 0) return labelIdx;
	const fromMultiplier = freeSpinSegmentIndexForMultiplier(
		Number.parseFloat(String(segment).replace(/[^0-9.]/g, '')) || 0,
	);
	return fromMultiplier;
}

export function freeSpinSegmentIndexForMultiplier(multiplier: number): number {
	const label = `${multiplier}X`;
	const idx = FREE_SPIN_SEGMENTS.indexOf(label as (typeof FREE_SPIN_SEGMENTS)[number]);
	if (idx >= 0) return idx;
	if (multiplier <= 0) {
		const bonusIdx = FREE_SPIN_SEGMENTS.indexOf('BONUS');
		if (bonusIdx >= 0) return bonusIdx;
	}
	return 0;
}
