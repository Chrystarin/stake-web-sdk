import {
	awardBonusBalls,
	clearBonusMeterDrainTimer,
	onBonusMeterFilledDuringRound,
	scheduleBonusMeterDrainDuringRoll,
	waitForDropBatchCompletion,
} from './gameOrchestrator';
import { seedBonusMeterForCurrentTier, seedSpinMeterForCurrentTier } from './plinkoSessionMeters';
import { meterController } from './stateGame.svelte';
import { stateGame } from './stateGame.svelte';

function resetBonusMeterForRouletteIfNeeded() {
	if (stateGame.bonusRoundActive) return;
	meterController.resetBonusMeterForRoulette();
}

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

export function notifyRouletteClosed() {
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
			stateGame.freeSpinRouletteOpen = true;
			return;
		}
		stateGame.bonusRouletteOpen = true;
		scheduleBonusMeterDrainDuringRoll();
	})();
}

export function onCoinPegHit(ballId: number) {
	if (stateGame.authoritativeMeterFlow && !stateGame.dropRoundActive) return;
	if (stateGame.bonusPegMeterCreditedBallIds.has(ballId)) return;
	if (stateGame.rouletteFlowInProgress && stateGame.activeRouletteSource === 'bonus') return;
	stateGame.bonusPegMeterCreditedBallIds.add(ballId);

	if (stateGame.authoritativeMeterFlow) {
		if (stateGame.bonusRoundActive) {
			// IN-BONUS energy meter: fill smoothly from the bonus balls' coin-peg hits. On reaching max,
			// HOLD at max (do NOT reset) so the bar reads "ready to level up" and the next-level node
			// blinks (`bonusPendingLevelHighlight`). The actual level-up + meter drain happens once the
			// current level's balls finish dropping (`applyAuthoritativeBonusLevel` resets it to 0). Max =
			// the level-up threshold (set by the single in-bonus `bonusMeter` event). The level number +
			// extra balls stay server-authoritative (book `bonusRound` events); this only drives the
			// visual fill so "bar fills → blink → balls finish → level up" reads correctly.
			const max = stateGame.bonusMeterMax > 0 ? stateGame.bonusMeterMax : 1;
			if (stateGame.bonusMeterValue < max) {
				stateGame.bonusMeterValue = Math.min(max, stateGame.bonusMeterValue + 1);
			}
		} else {
			// TRIGGER drop: provisional fill toward the per-tier max (authoritative `bonusMeter` events
			// confirm it).
			meterController.bumpBonusMeterVisual(1);
		}
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
		// Provisional animation only — authoritative value comes from RGS `spinMeter` book events.
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

export function onBonusRouletteResultReady(wheelFreeBallCount?: number) {
	if (stateGame.activeRouletteSource !== 'bonus') return;
	if (stateGame.bonusRouletteResultAppliedEarly) return;
	const freeBallCount = Math.max(
		1,
		Math.floor(stateGame.serverBonusFreeBalls ?? wheelFreeBallCount ?? 0),
	);
	if (freeBallCount <= 0) return;
	// Activate bonus mode as soon as the wheel announcement is shown (crimson parity).
	resetBonusMeterForRouletteIfNeeded();
	awardBonusBalls(freeBallCount);
	stateGame.bonusRouletteResultAppliedEarly = true;
}

export function onBonusRouletteFinished(wheelFreeBallCount?: number) {
	const source = stateGame.activeRouletteSource;
	const hadOpenWheel = stateGame.bonusRouletteOpen;
	clearBonusMeterDrainTimer();
	stateGame.bonusRouletteOpen = false;
	if (source === 'bonus' && !stateGame.bonusRouletteResultAppliedEarly) {
		resetBonusMeterForRouletteIfNeeded();
		const freeBallCount = Math.max(
			1,
			Math.floor(stateGame.serverBonusFreeBalls ?? wheelFreeBallCount ?? 0),
		);
		if (freeBallCount > 0) awardBonusBalls(freeBallCount);
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

export function syncBallPerDropTier() {
	// Free-spin meter is PER-DROP: always re-seed the HUD to the selected tier's start + max so the
	// meter UI matches the new balls-per-drop tier immediately on switch (independent of the
	// server-authoritative bonus-meter flow).
	seedSpinMeterForCurrentTier();
	// Bonus meter is a PER-TIER SESSION meter: re-seed the HUD to the selected tier's stored value (or
	// its tier base start). Skip during an active bonus round (the HUD shows the in-round level meter).
	if (!stateGame.bonusRoundActive) seedBonusMeterForCurrentTier();
	if (stateGame.authoritativeMeterFlow || stateGame.serverMeterLimitsActive) return;
	meterController.setBallPerDrop(stateGame.ballPerDrop);
}
