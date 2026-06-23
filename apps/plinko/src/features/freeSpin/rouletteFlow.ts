import { stateBet } from 'state-shared';

import { FREE_SPIN_SEGMENTS } from '../../game-logic/constants';
import { eventEmitter } from '../../game/eventEmitter';
import { resetSpinMeterSession } from '../../game/plinkoSessionMeters';
import { meterController, stateGame } from '../../game/stateGame.svelte';
import { notifyRouletteClosed, triggerRoulette } from '../../game/meterFlow';
import {
	getCombinedRoundWinAmount,
	recordFreeSpinWinHistory,
	settleBonusRoundWhenFinished,
} from '../../game/gameOrchestrator';
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

	let landedOnBonus = isFreeSpinBonusSegment(segmentLabel);
	let queuedRoulette: ReturnType<typeof meterController.completeRoulette> = null;

	try {
		// On a BONUS segment the bonus round owns the win (base drop + bonus balls). Applying the
		// round payout here would briefly overwrite the HUD win with the full-round value before
		// the free balls drop, then get re-corrected on the first ball — a visible value jump.
		if (!landedOnBonus) {
			const baseWin = getFreeSpinBaseRoundWin();
			const multiplier = freeSpinMultiplierFromSegment(segmentLabel);
			const totalWin = applyRgsRoundWinFromBet(stateGame.activeRoundBet);
			let appliedFeatureWin = false;

			if (stateGame.bonusRoundActive) {
				// IN-BONUS free spin: `totalWin` is the whole round; the bonus portion is total − base
				// drop. The bonus trigger book ships an EMPTY base drop, so `baseWin` is 0 here and must
				// NOT gate this (that was dropping the in-bonus free-spin win from the history total).
				// Fold the credit into the bonus session AND log it as its own "Free Spin N×" row;
				// track the credit so the consolidated "Bonus" row excludes it (no double-count).
				if (multiplier > 0 && totalWin > 0) {
					const bonusPortion = Math.max(0, totalWin - stateGame.baseRoundDropWinAmount);
					const credit = bonusPortion - stateGame.bonusSessionWinAmount;
					if (credit > 0) {
						recordFreeSpinWinHistory(multiplier, credit, stateGame.bonusSessionWinAmount);
						stateGame.inBonusFreeSpinCreditTotal += credit;
						stateGame.bonusSessionWinAmount = bonusPortion;
					}
					stateGame.pendingDropWinAmount = totalWin;
					appliedFeatureWin = true;
				}
			} else if (multiplier > 0 && baseWin > 0 && totalWin > 0) {
				// Snapshot the win already logged ball-by-ball (base lands) before the wheel multiplier
				// replaces the round total, so we log only the incremental free-spin credit and keep
				// the history sum equal to the displayed total.
				const winBeforeFeature = getCombinedRoundWinAmount();
				stateGame.pendingDropWinAmount = totalWin;
				recordFreeSpinWinHistory(
					multiplier,
					getCombinedRoundWinAmount() - winBeforeFeature,
					winBeforeFeature,
				);
				appliedFeatureWin = true;
			}

			if (appliedFeatureWin) {
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
		}
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

	// IN-BONUS free spin: this wheel was the trailing in-bonus free spin (fired by
	// `settleBonusRoundWhenFinished` after the bonus balls depleted). The bonus round is still active and
	// its payout is now folded into `bonusSessionWinAmount`, so re-invoke the settler to CONTINUE the
	// round: it advances to any remaining level-up or, with nothing pending, ends the bonus round and
	// releases settlement. Without this the round stayed stuck (bonus never ended → `finalWin` blocked).
	if (stateGame.bonusRoundActive && stateGame.bonusBallsRemaining <= 0) {
		void settleBonusRoundWhenFinished();
	}

	// Persist meter reset without blocking roulette close or round unlock.
	void resetSpinMeterSession();
}

/** Map math/RGS free-spin wheel segment label to wheel index (no client RNG). The wheel is
 * zero-sum and has no BONUS segment, so every label resolves to a numeric `NX` multiplier. */
export function freeSpinSegmentIndexForSegment(segment: string): number {
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
	return 0;
}
