import { FREE_SPIN_SEGMENTS } from '../game-logic/constants';
import {
	addSettledWinAmount,
	awardBonusBalls,
	clearBonusMeterDrainTimer,
	onBonusMeterFilledDuringRound,
	scheduleBonusMeterDrainDuringRoll,
	showResultOverlay,
	waitForDropBatchCompletion,
} from './gameOrchestrator';
import { plinkoWagerAmount } from './plinkoBet';
import { meterController } from './stateGame.svelte';
import { stateGame } from './stateGame.svelte';

export type RouletteSource = 'spin' | 'bonus';

let rouletteCloseWaiters: Array<() => void> = [];
/** Bumped when a round ends so in-flight `triggerRoulette` openers are ignored. */
let rouletteOpenGeneration = 0;

const isDropPipelineBusy = () =>
	stateGame.expectedOutcomeByBallId.size > 0 || stateGame.pendingSpacedSpawnTimers > 0;

const waitForDropPipelineIdle = (): Promise<void> =>
	new Promise((resolve) => {
		const check = () => {
			if (!isDropPipelineBusy()) resolve();
			else requestAnimationFrame(check);
		};
		check();
	});

export function waitForRouletteClose(): Promise<void> {
	return new Promise((resolve) => rouletteCloseWaiters.push(resolve));
}

function notifyRouletteClosed() {
	rouletteCloseWaiters.forEach((resolve) => resolve());
	rouletteCloseWaiters = [];
}

/** Drop stale roulette locks when a round ends without an active wheel overlay. */
export function releaseStuckRouletteFlow() {
	if (stateGame.freeSpinRouletteOpen || stateGame.bonusRouletteOpen) return;
	meterController.completeRoulette();
	stateGame.showFreeSpinRoulette = false;
	stateGame.showBonusRoulette = false;
	stateGame.autoPlayPausedByFreeSpin = false;
	notifyRouletteClosed();
}

/** Force-clear all betting-panel lock flags (safe after a book round finishes). */
export function forceUnlockBettingControls() {
	rouletteOpenGeneration += 1;
	stateGame.dropRoundActive = false;
	stateGame.isSubmitting = false;
	stateGame.isAnimating = false;
	stateGame.pendingSpacedSpawnTimers = 0;
	stateGame.expectedOutcomeByBallId = new Map();
	stateGame.freeSpinRouletteOpen = false;
	stateGame.bonusRouletteOpen = false;
	stateGame.showFreeSpinRoulette = false;
	stateGame.showBonusRoulette = false;
	stateGame.autoPlayPausedByFreeSpin = false;
	meterController.completeRoulette();
	notifyRouletteClosed();
}

/** @deprecated alias — always performs a synchronous force-unlock. */
export function releaseRoundInteractionLocks() {
	forceUnlockBettingControls();
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
	const openGeneration = rouletteOpenGeneration;
	void (async () => {
		await waitForDropPipelineIdle();
		if (openGeneration !== rouletteOpenGeneration) return;
		// Ignore stale opener attempts if roulette source changed in-between.
		if (!stateGame.rouletteFlowInProgress || stateGame.activeRouletteSource !== source) return;
		if (source === 'spin') {
			stateGame.spinMeterValue = 0;
			stateGame.freeSpinRouletteOpen = true;
			return;
		}
		stateGame.bonusRouletteOpen = true;
		if (!stateGame.bonusRoundActive) meterController.resetBonusMeterForRoulette();
		scheduleBonusMeterDrainDuringRoll();
	})();
}

export function onCoinPegHit(ballId: number) {
	if (stateGame.authoritativeMeterFlow && !stateGame.dropRoundActive) return;
	if (stateGame.bonusPegMeterCreditedBallIds.has(ballId)) return;
	if (stateGame.rouletteFlowInProgress && stateGame.activeRouletteSource === 'bonus') return;
	stateGame.bonusPegMeterCreditedBallIds.add(ballId);

	if (stateGame.authoritativeMeterFlow) {
		meterController.bumpBonusMeterVisual(1);
		return;
	}

	const onMeterFull = (source: RouletteSource) => {
		if (stateGame.rouletteFlowInProgress) {
			stateGame.pendingRouletteSource = 'bonus';
			return;
		}
		stateGame.showBonusRoulette = true;
		triggerRoulette(source);
	};

	meterController.addBonusMeterValue(1, onMeterFull, {
		onBonusRoundFilled: (overflow) => onBonusMeterFilledDuringRound(overflow),
	});
}

export function onSpinSlotLand(ballId?: number) {
	if (stateGame.authoritativeMeterFlow && !stateGame.dropRoundActive) return;
	if (stateGame.rouletteFlowInProgress && stateGame.activeRouletteSource === 'spin') return;
	if (stateGame.spinMeterMax > 0 && stateGame.spinMeterValue >= stateGame.spinMeterMax) return;
	if (ballId != null) {
		if (stateGame.spinSlotMeterCreditedBallIds.has(ballId)) return;
		stateGame.spinSlotMeterCreditedBallIds.add(ballId);
	}

	if (stateGame.authoritativeMeterFlow) {
		meterController.bumpSpinMeterVisual(1);
		return;
	}

	const onSpinMeterFull = (source: RouletteSource) => {
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
		// Ensure overlay is mountable even when spin trigger comes from meter-fill fallback.
		stateGame.showFreeSpinRoulette = true;
		triggerRoulette(source);
	};

	meterController.addSpinMeterValue(1, onSpinMeterFull);
}

export function isFreeSpinBonusSegment(segmentLabel: string): boolean {
	const normalized = String(segmentLabel || '')
		.toUpperCase()
		.replace(/[^A-Z0-9]/g, '');
	return normalized === 'FREEBONUS' || normalized === 'BONUS';
}

export function onFreeSpinRouletteFinished(_wheelSegmentLabel?: string) {
	const hadOpenWheel = stateGame.freeSpinRouletteOpen;
	stateGame.freeSpinRouletteOpen = false;
	stateGame.autoPlayPausedByFreeSpin = false;
	const segmentLabel = stateGame.authoritativeMeterFlow
		? (stateGame.serverFreeSpinSegmentLabel ??
			FREE_SPIN_SEGMENTS[stateGame.serverFreeSpinSegment ?? 0] ??
			'')
		: (_wheelSegmentLabel ?? '');
	if (stateGame.authoritativeMeterFlow) {
		const serverWin = stateGame.serverFreeSpinWinAmount ?? 0;
		if (serverWin > 0) {
			addSettledWinAmount(serverWin);
			showResultOverlay(serverWin, serverWin / Math.max(plinkoWagerAmount(), 0.000_001));
		}
		stateGame.serverFreeSpinWinAmount = undefined;
	} else {
		const numericMultiplier = Number.parseFloat(String(segmentLabel).replace(/[^0-9.]/g, ''));
		if (Number.isFinite(numericMultiplier) && numericMultiplier > 0) {
			addSettledWinAmount(plinkoWagerAmount() * numericMultiplier);
		}
	}
	const landedOnBonus = isFreeSpinBonusSegment(
		stateGame.authoritativeMeterFlow
			? (stateGame.serverFreeSpinSegmentLabel ?? segmentLabel)
			: segmentLabel,
	);
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

export function onBonusRouletteResultReady(_wheelFreeBallCount?: number) {
	if (stateGame.activeRouletteSource !== 'bonus') return;
	if (stateGame.bonusRouletteResultAppliedEarly) return;
	// Authoritative bonus balls are granted from the following `bonusRound` book event.
	if (stateGame.authoritativeMeterFlow) return;
	const freeBallCount = Math.max(1, Math.floor(_wheelFreeBallCount ?? 0));
	if (freeBallCount <= 0) return;
	stateGame.bonusRouletteResultAppliedEarly = true;
	void (async () => {
		await waitForDropBatchCompletion();
		// Ignore stale activation attempts if roulette source changed.
		if (stateGame.activeRouletteSource !== 'bonus') return;
		if (!stateGame.bonusRoundActive) meterController.resetBonusMeterForRoulette();
		awardBonusBalls(freeBallCount);
	})();
}

export function onBonusRouletteFinished() {
	const hadOpenWheel = stateGame.bonusRouletteOpen;
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
	if (stateGame.showBonusRoulette || hadOpenWheel) {
		stateGame.showBonusRoulette = false;
		stateGame.serverBonusFreeBalls = undefined;
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

export function syncBallPerDropTier() {
	meterController.setBallPerDrop(stateGame.ballPerDrop);
}
