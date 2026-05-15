import { FREE_SPIN_SEGMENTS } from '../game-logic/constants';
import {
	awardBonusBalls,
	clearBonusMeterDrainTimer,
	onBonusMeterFilledDuringRound,
	scheduleBonusMeterDrainDuringRoll,
} from './gameOrchestrator';
import { meterController } from './stateGame.svelte';
import { stateGame } from './stateGame.svelte';

export type RouletteSource = 'spin' | 'bonus';

let rouletteCloseWaiters: Array<() => void> = [];

export function waitForRouletteClose(): Promise<void> {
	return new Promise((resolve) => rouletteCloseWaiters.push(resolve));
}

function notifyRouletteClosed() {
	rouletteCloseWaiters.forEach((resolve) => resolve());
	rouletteCloseWaiters = [];
}

export function triggerRoulette(source: RouletteSource) {
	if (stateGame.rouletteFlowInProgress) {
		stateGame.pendingRouletteSource = source;
		return;
	}
	if (stateGame.autoPlayStarted) {
		if (source === 'spin') stateGame.autoPlayPausedByFreeSpin = true;
		else stateGame.autoPlayStopping = true;
	}
	meterController.beginRoulette(source);
	if (source === 'spin') {
		stateGame.freeSpinRouletteOpen = true;
		return;
	}
	stateGame.bonusRouletteOpen = true;
	if (!stateGame.bonusRoundActive) meterController.resetBonusMeterForRoulette();
	scheduleBonusMeterDrainDuringRoll();
}

export function onCoinPegHit() {
	meterController.addBonusMeterValue(1, triggerRoulette, {
		onBonusRoundFilled: (overflow) => onBonusMeterFilledDuringRound(overflow),
	});
}

export function onSpinSlotLand() {
	meterController.addSpinMeterValue(1, (source) => {
		if (stateGame.bonusRoundActive) {
			stateGame.pendingSpinRouletteAfterBonusLevelDepletion = true;
			return;
		}
		if (stateGame.rouletteFlowInProgress) {
			if (stateGame.pendingRouletteSource === 'bonus') {
				stateGame.pendingSpinRouletteAfterQueuedBonus = true;
				return;
			}
			stateGame.pendingRouletteSource = 'spin';
			return;
		}
		triggerRoulette(source);
	});
}

export function isFreeSpinBonusSegment(segmentLabel: string): boolean {
	const normalized = String(segmentLabel || '')
		.toUpperCase()
		.replace(/[^A-Z0-9]/g, '');
	return normalized === 'FREEBONUS' || normalized === 'BONUS';
}

export function onFreeSpinRouletteFinished(segmentLabel: string) {
	stateGame.freeSpinRouletteOpen = false;
	stateGame.autoPlayPausedByFreeSpin = false;
	const landedOnBonus = isFreeSpinBonusSegment(segmentLabel);
	let queued = meterController.completeRoulette();
	if (landedOnBonus) queued = 'bonus';
	if (stateGame.showFreeSpinRoulette) {
		stateGame.showFreeSpinRoulette = false;
		stateGame.serverFreeSpinSegment = undefined;
		notifyRouletteClosed();
	}
	if (queued) triggerRoulette(queued);
}

export function onBonusRouletteResultReady(freeBallCount: number) {
	if (stateGame.activeRouletteSource !== 'bonus') return;
	if (stateGame.bonusRouletteResultAppliedEarly) return;
	if (!stateGame.bonusRoundActive) meterController.resetBonusMeterForRoulette();
	awardBonusBalls(freeBallCount);
	stateGame.bonusRouletteResultAppliedEarly = true;
}

export function onBonusRouletteFinished() {
	clearBonusMeterDrainTimer();
	stateGame.bonusRouletteOpen = false;
	if (
		stateGame.activeRouletteSource === 'bonus' &&
		!stateGame.bonusRouletteResultAppliedEarly
	) {
		if (!stateGame.bonusRoundActive) meterController.resetBonusMeterForRoulette();
	}
	stateGame.bonusRouletteResultAppliedEarly = false;
	let queued = meterController.completeRoulette();
	if (!queued && stateGame.pendingSpinRouletteAfterQueuedBonus) {
		queued = 'spin';
	}
	stateGame.pendingSpinRouletteAfterQueuedBonus = false;
	if (stateGame.showBonusRoulette) {
		stateGame.showBonusRoulette = false;
		stateGame.serverBonusFreeBalls = undefined;
		notifyRouletteClosed();
	}
	if (queued) triggerRoulette(queued);
}

export function freeSpinSegmentIndexForMultiplier(multiplier: number): number {
	const label = `${multiplier}X`;
	const idx = FREE_SPIN_SEGMENTS.indexOf(label as (typeof FREE_SPIN_SEGMENTS)[number]);
	if (idx >= 0) return idx;
	return Math.floor(Math.random() * FREE_SPIN_SEGMENTS.length);
}

export function syncBallPerDropTier() {
	meterController.setBallPerDrop(stateGame.ballPerDrop);
}
