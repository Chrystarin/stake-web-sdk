import { stateBet } from 'state-shared';

import { FREE_SPIN_SEGMENTS } from '../../game-logic/constants';
import { eventEmitter } from '../../game/eventEmitter';
import { resetSpinMeterSession } from '../../game/plinkoSessionMeters';
import { meterController, stateGame } from '../../game/stateGame.svelte';
import { notifyRouletteClosed, triggerRoulette } from '../../game/meterFlow';
import { applyRgsRoundWinFromBet } from '../../game/rgsRoundWin';
import {
	freeSpinMultiplierFromSegment,
	getFreeSpinBaseRoundWin,
	isFreeSpinBonusWheelSegment,
} from './payout';

export function isFreeSpinBonusSegment(segmentLabel: string): boolean {
	return isFreeSpinBonusWheelSegment(segmentLabel);
}

export async function onFreeSpinRouletteFinished(wheelSegmentLabel?: string) {
	stateGame.freeSpinRouletteOpen = false;
	stateGame.autoPlayPausedByFreeSpin = false;
	const segmentLabel =
		wheelSegmentLabel ??
		stateGame.serverFreeSpinSegmentLabel ??
		FREE_SPIN_SEGMENTS[stateGame.serverFreeSpinSegment ?? 0] ??
		'';

	let landedOnBonus = false;
	let queuedRoulette: ReturnType<typeof meterController.completeRoulette> = null;

	try {
		const baseWin = getFreeSpinBaseRoundWin();
		const multiplier = freeSpinMultiplierFromSegment(segmentLabel);
		const totalWin = applyRgsRoundWinFromBet(stateGame.activeRoundBet);

		if (multiplier > 0 && baseWin > 0 && totalWin > 0) {
			stateGame.pendingDropWinAmount = totalWin;
			if (stateGame.bonusRoundActive) {
				stateGame.bonusSessionWinAmount = totalWin;
			}
			stateGame.freeSpinWinMultiplier = multiplier;
			stateGame.winPopupMultiplier = multiplier;
			const wasWinPopupVisible = stateGame.showWinPopup;
			stateGame.showWinPopup = true;
			stateGame.deferWinPopupForFreeSpin = false;
			if (!wasWinPopupVisible) {
				eventEmitter.broadcast({ type: 'soundOnce', name: 'win' });
			}
		}

		if (stateGame.deferWinPopupForFreeSpin && stateBet.winBookEventAmount > 0) {
			stateGame.showWinPopup = true;
			stateGame.deferWinPopupForFreeSpin = false;
			eventEmitter.broadcast({ type: 'soundOnce', name: 'win' });
		}

		landedOnBonus = isFreeSpinBonusSegment(segmentLabel);
	} finally {
		stateGame.serverFreeSpinWinAmount = undefined;
		queuedRoulette = meterController.completeRoulette();
		if (landedOnBonus) queuedRoulette = 'bonus';
		stateGame.showFreeSpinRoulette = false;
		stateGame.serverFreeSpinSegment = undefined;
		stateGame.serverFreeSpinSegmentLabel = undefined;
		// Always unblock book playback / playBet even if payout logic throws.
		notifyRouletteClosed();
	}

	if (!stateGame.authoritativeMeterFlow && queuedRoulette) {
		triggerRoulette(queuedRoulette);
	}

	// Persist meter reset without blocking roulette close or round unlock.
	void resetSpinMeterSession();
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
