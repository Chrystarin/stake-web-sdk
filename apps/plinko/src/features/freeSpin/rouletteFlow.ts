import { stateBet } from 'state-shared';

import { FREE_SPIN_SEGMENTS } from '../../game-logic/constants';
import { eventEmitter } from '../../game/eventEmitter';
import { plinkoStakePerBall } from '../../game/plinkoBet';
import { resetSpinMeterSession } from '../../game/plinkoSessionMeters';
import { meterController, stateGame } from '../../game/stateGame.svelte';
import { notifyRouletteClosed, triggerRoulette } from '../../game/meterFlow';
import {
	addSettledWinAmount,
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

/** Guard so the wheel's win is credited exactly once (at land), not again on overlay close. */
let freeSpinWinAppliedForCurrentWheel = false;

function resolveFreeSpinSegmentLabel(wheelSegmentLabel?: string): string {
	return (
		wheelSegmentLabel ??
		stateGame.serverFreeSpinSegmentLabel ??
		FREE_SPIN_SEGMENTS[stateGame.serverFreeSpinSegment ?? 0] ??
		''
	);
}

/**
 * Reveal the free-spin win in the Win field the moment the wheel LANDS on its segment (issue #2) — so
 * the value updates in sync with seeing the multiplier, instead of only when the overlay fades out.
 *
 * IN-BONUS free spin: ADDITIVE — add `stake × M` on top of the running bonus total. More bonus balls /
 * level-ups can still drop after this (the wheel fires per level, before the level-up), so it must NOT
 * snap to the full book total. The book `finalWin` stays authoritative and reconciles at settlement.
 *
 * BASE (non-bonus) free spin: the whole round total is authoritative (`payoutMultiplier` × wager); apply
 * it. Idempotent within one wheel via `freeSpinWinAppliedForCurrentWheel`.
 */
export function applyFreeSpinWinOnLand(wheelSegmentLabel?: string) {
	if (freeSpinWinAppliedForCurrentWheel) return;
	freeSpinWinAppliedForCurrentWheel = true;

	const segmentLabel = resolveFreeSpinSegmentLabel(wheelSegmentLabel);
	// On a BONUS segment the bonus round owns the win (no numeric add here); nothing to reveal.
	if (isFreeSpinBonusSegment(segmentLabel)) return;
	const multiplier = freeSpinMultiplierFromSegment(segmentLabel);
	if (multiplier <= 0) return;

	const showFreeSpinPopup = () => {
		stateGame.freeSpinWinMultiplier = multiplier;
		stateGame.winPopupMultiplier = multiplier;
		const wasVisible = stateGame.showWinPopup;
		stateGame.showWinPopup = true;
		stateGame.deferWinPopupForFreeSpin = false;
		if (!wasVisible) eventEmitter.broadcast({ type: 'soundOnce', name: 'win' });
	};

	if (stateGame.bonusRoundActive) {
		const credit = plinkoStakePerBall() * multiplier;
		if (credit > 0) {
			stateGame.inBonusFreeSpinCreditTotal += credit;
			// → bonusSessionWinAmount + HUD (getCombinedRoundWinAmount). Additive: sums with the bonus
			// balls to the book `finalWin`, which reconciles the exact total at settlement.
			addSettledWinAmount(credit);
			recordFreeSpinWinHistory(multiplier);
			// IN-BONUS free spin: do NOT pop the win modal here. Its amount (`winPopupAmount`) is only
			// set by RGS settlement, so showing it mid-bonus flashes a $0 modal. The single win modal —
			// with the full base + bonus + free-spin total — is shown by the `finalWin` handler after the
			// bonus end screen (`waitForBonusRoundCompletion`). The credit above keeps the running HUD
			// Win field in sync in the meantime.
		}
		return;
	}

	const baseWin = getFreeSpinBaseRoundWin();
	const totalWin = applyRgsRoundWinFromBet(stateGame.activeRoundBet);
	if (multiplier > 0 && totalWin > 0) recordFreeSpinWinHistory(multiplier);
	if (multiplier > 0 && baseWin > 0 && totalWin > 0) {
		stateGame.pendingDropWinAmount = totalWin;
		showFreeSpinPopup();
	}
	if (stateGame.deferWinPopupForFreeSpin && stateBet.winBookEventAmount > 0) {
		stateGame.showWinPopup = true;
		stateGame.deferWinPopupForFreeSpin = false;
		eventEmitter.broadcast({ type: 'soundOnce', name: 'win' });
	}
}

export async function onFreeSpinRouletteFinished(wheelSegmentLabel?: string) {
	stateGame.freeSpinRouletteOpen = false;
	stateGame.autoPlayPausedByFreeSpin = false;
	const segmentLabel = resolveFreeSpinSegmentLabel(wheelSegmentLabel);

	const landedOnBonus = isFreeSpinBonusSegment(segmentLabel);
	let queuedRoulette: ReturnType<typeof meterController.completeRoulette> = null;

	try {
		// The win was already revealed when the wheel LANDED (`applyFreeSpinWinOnLand`, wired via the
		// wheel's `onLanded`). Call it once more as a safety net (idempotent) in case that fired late.
		if (!landedOnBonus) applyFreeSpinWinOnLand(segmentLabel);
	} finally {
		// Reset the per-wheel guard so the NEXT free spin (e.g. the next bonus level) credits again.
		freeSpinWinAppliedForCurrentWheel = false;
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
