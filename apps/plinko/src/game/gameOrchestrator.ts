import { BONUS_LEVEL_LABELS } from '../game-logic/constants';
import { meterController } from './stateGame.svelte';
import { stateGame, stateGameDerived } from './stateGame.svelte';
import { triggerRoulette } from './meterFlow';
import type { PlinkoBallOutcome } from './typesBookEvent';

const BONUS_LEVEL_ACTIVATION_DELAY_MS = 250;
const BONUS_LEVEL_UP_OVERLAY_DURATION_MS = 1700;
const BONUS_LEVEL_UP_FADE_DURATION_MS = 280;
const BONUS_METER_DRAIN_DELAY_MS = 1700;

let bonusMeterDrainTimer: ReturnType<typeof setTimeout> | null = null;
let bonusLevelUpOverlayTimer: ReturnType<typeof setTimeout> | null = null;
let bonusLevelUpOverlayHideTimer: ReturnType<typeof setTimeout> | null = null;
let autoBetTimer: ReturnType<typeof setTimeout> | null = null;

type DropRequest = { type: 'bonusBall'; stake: number };

let dropRequestHandler: ((req: DropRequest) => void) | null = null;
let betRequestHandler: (() => void) | null = null;

function setExpectedOutcome(ballId: number, outcome: PlinkoBallOutcome) {
	const next = new Map(stateGame.expectedOutcomeByBallId);
	next.set(ballId, outcome);
	stateGame.expectedOutcomeByBallId = next;
}

function takeExpectedOutcome(ballId: number): PlinkoBallOutcome | undefined {
	const current = stateGame.expectedOutcomeByBallId;
	if (!current.has(ballId)) return undefined;
	const next = new Map(current);
	const pending = next.get(ballId);
	next.delete(ballId);
	stateGame.expectedOutcomeByBallId = next;
	return pending;
}

export function setDropRequestHandler(handler: (req: DropRequest) => void) {
	dropRequestHandler = handler;
}

export function setBetRequestHandler(handler: () => void) {
	betRequestHandler = handler;
}

export function addSettledWinAmount(amount: number) {
	const safe = Number(amount) || 0;
	if (safe <= 0) return;
	stateGame.pendingDropWinAmount += safe;
	if (stateGame.bonusRoundActive) {
		stateGame.bonusSessionWinAmount += safe;
		stateGame.winAmount = stateGame.bonusSessionWinAmount;
		return;
	}
	stateGame.winAmount = stateGame.pendingDropWinAmount;
}

export function isGameOngoing(): boolean {
	return (
		stateGame.isAnimating ||
		stateGame.expectedOutcomeByBallId.size > 0 ||
		stateGame.pendingSpacedSpawnTimers > 0
	);
}

export function isPlayActionBlockedByFreeSpinRoulette(): boolean {
	if (stateGame.freeSpinRouletteOpen) return true;
	return (
		stateGame.activeRouletteSource === 'spin' || stateGame.pendingRouletteSource === 'spin'
	);
}

export function isPlayActionBlockedByBonusRoulette(): boolean {
	if (stateGame.bonusRoundActive) return false;
	if (stateGame.activeRouletteSource === 'bonus' || stateGame.pendingRouletteSource === 'bonus') {
		return true;
	}
	const max = stateGame.bonusMeterMax || 20;
	return stateGame.bonusMeterValue >= max;
}

export function isBonusPlayButtonDisabled(): boolean {
	return (
		!stateGameDerived.hasPendingBonusBalls ||
		stateGame.bonusRouletteOpen ||
		isPlayActionBlockedByFreeSpinRoulette() ||
		isPlayActionBlockedByBonusRoulette()
	);
}

export function isBetControlsLocked(): boolean {
	return (
		stateGame.isSubmitting ||
		isGameOngoing() ||
		stateGame.bonusRoundActive ||
		isPlayActionBlockedByBonusRoulette() ||
		isPlayActionBlockedByFreeSpinRoulette()
	);
}

export function awardBonusBalls(count: number) {
	const amount = Math.max(1, Math.floor(count || 1));
	if (!stateGame.bonusRoundActive) {
		stateGame.bonusRoundActive = true;
		stateGame.bonusLevelProgress = 1;
		stateGame.spinMeterValue = 0;
		stateGame.bonusMeterValue = 0;
		stateGame.bonusMeterOverflowValue = 0;
		stateGame.bonusSessionWinAmount = 0;
		stateGame.winAmount = 0;
	}
	if (
		!stateGameDerived.hasPendingBonusBalls &&
		!stateGame.bonusRoundSettlementInProgress &&
		!isGameOngoing()
	) {
		stateGame.pendingDropWinAmount = 0;
		stateGame.expectedOutcomeByBallId = new Map<number, PlinkoBallOutcome>();
		stateGame.nextBallSpawnAtMs = Date.now();
		stateGame.pendingSpacedSpawnTimers = 0;
	}
	stateGame.bonusBallsRemaining += amount;
}

export function playOneBonusBall() {
	if (isBonusPlayButtonDisabled()) return;
	stateGame.bonusBallsRemaining = Math.max(0, stateGame.bonusBallsRemaining - 1);
	const stake = Math.max(0, Number(stateGame.pendingOutcomes[0]?.amount) || 0);
	stateGame.nextBallSpawnAtMs = Date.now();
	dropRequestHandler?.({ type: 'bonusBall', stake });
	if (stateGame.bonusBallsRemaining <= 0) {
		void settleBonusRoundWhenFinished();
	}
}

function queueBonusLevelUpsFromOverflow(safeMax: number) {
	if (safeMax <= 0 || !stateGame.bonusRoundActive) {
		stateGame.bonusMeterOverflowValue = 0;
		return;
	}
	const additional = Math.floor(stateGame.bonusMeterOverflowValue / safeMax);
	if (additional <= 0) return;
	stateGame.bonusMeterOverflowValue -= additional * safeMax;
	handleBonusRoundMeterFilled(additional);
}

function handleBonusRoundMeterFilled(levelUpCount = 1) {
	const maxLevels = BONUS_LEVEL_LABELS.length;
	if (maxLevels <= 0 || stateGame.bonusLevelProgress >= maxLevels || levelUpCount <= 0) return;
	const available = Math.max(
		0,
		maxLevels -
			stateGame.bonusLevelProgress -
			stateGame.pendingBonusLevelUpCount -
			stateGame.deferredBonusLevelUpCount,
	);
	if (available <= 0) return;
	stateGame.deferredBonusLevelUpCount += Math.min(available, levelUpCount);
}

export function onBonusMeterFilledDuringRound(overflow = 0) {
	const safeMax = stateGame.bonusMeterMax || 20;
	handleBonusRoundMeterFilled(1);
	if (overflow > 0) {
		stateGame.bonusMeterOverflowValue += overflow;
		queueBonusLevelUpsFromOverflow(safeMax);
	}
}

function flushDeferredBonusLevelUp() {
	if (!stateGame.bonusRoundActive) return;
	if (stateGame.bonusBallsRemaining > 0) return;
	if (isGameOngoing()) return;
	if (stateGame.deferredBonusLevelUpCount <= 0) return;
	const maxLevels = BONUS_LEVEL_LABELS.length;
	const add = stateGame.deferredBonusLevelUpCount;
	stateGame.deferredBonusLevelUpCount = 0;
	const available = Math.max(
		0,
		maxLevels - stateGame.bonusLevelProgress - stateGame.pendingBonusLevelUpCount,
	);
	if (available <= 0) return;
	stateGame.pendingBonusLevelUpCount += Math.min(available, add);
}

function consumePendingBonusLevelUp(): boolean {
	if (!stateGame.bonusRoundActive) return false;
	if (stateGame.bonusBallsRemaining > 0) return false;
	if (stateGame.pendingBonusLevelUpCount <= 0) return false;
	const maxLevels = BONUS_LEVEL_LABELS.length;
	if (maxLevels <= 0 || stateGame.bonusLevelProgress >= maxLevels) {
		stateGame.pendingBonusLevelUpCount = 0;
		stateGame.deferredBonusLevelUpCount = 0;
		return false;
	}
	stateGame.pendingBonusLevelUpCount = Math.max(0, stateGame.pendingBonusLevelUpCount - 1);
	const nextLevel = Math.max(1, stateGame.bonusLevelProgress + 1);
	const levelValue = Number(BONUS_LEVEL_LABELS[nextLevel - 1] ?? nextLevel);
	const addedBalls = Math.max(1, Math.floor(levelValue * 10));
	setTimeout(
		() => applyBonusLevelUpWhenPipelineIdle(nextLevel, addedBalls),
		BONUS_LEVEL_ACTIVATION_DELAY_MS,
	);
	return true;
}

async function applyBonusLevelUpWhenPipelineIdle(nextLevel: number, addedBalls: number) {
	await waitForDropBatchCompletion();
	if (!stateGame.bonusRoundActive || stateGame.bonusBallsRemaining > 0) return;
	stateGame.bonusLevelProgress = Math.max(stateGame.bonusLevelProgress, nextLevel);
	showBonusLevelUpOverlay(nextLevel, addedBalls);
	awardBonusBalls(addedBalls);
	if (stateGame.pendingBonusLevelUpCount + stateGame.deferredBonusLevelUpCount > 0) {
		stateGame.bonusMeterValue = stateGame.bonusMeterMax;
	} else {
		const safeMax = stateGame.bonusMeterMax || 20;
		stateGame.bonusMeterValue = Math.max(
			0,
			Math.min(safeMax, stateGame.bonusMeterOverflowValue),
		);
	}
}

function clearBonusLevelUpOverlayTimer() {
	if (bonusLevelUpOverlayTimer) clearTimeout(bonusLevelUpOverlayTimer);
	bonusLevelUpOverlayTimer = null;
}

function clearBonusLevelUpOverlayHideTimer() {
	if (bonusLevelUpOverlayHideTimer) clearTimeout(bonusLevelUpOverlayHideTimer);
	bonusLevelUpOverlayHideTimer = null;
}

function showBonusLevelUpOverlay(levelNumber: number, addedBalls: number) {
	clearBonusLevelUpOverlayTimer();
	clearBonusLevelUpOverlayHideTimer();
	stateGame.bonusLevelUpLevel = Math.max(1, Math.floor(levelNumber || 1));
	stateGame.bonusLevelUpAddedBalls = Math.max(1, Math.floor(addedBalls || 1));
	stateGame.bonusLevelUpOverlayOpen = true;
	requestAnimationFrame(() => {
		stateGame.bonusLevelUpOverlayVisible = true;
	});
	bonusLevelUpOverlayTimer = setTimeout(() => {
		stateGame.bonusLevelUpOverlayVisible = false;
		bonusLevelUpOverlayTimer = null;
		bonusLevelUpOverlayHideTimer = setTimeout(() => {
			stateGame.bonusLevelUpOverlayOpen = false;
			bonusLevelUpOverlayHideTimer = null;
		}, BONUS_LEVEL_UP_FADE_DURATION_MS);
	}, BONUS_LEVEL_UP_OVERLAY_DURATION_MS);
}

export function waitForDropBatchCompletion(): Promise<void> {
	return new Promise((resolve) => {
		const check = () => {
			if (!isGameOngoing()) resolve();
			else requestAnimationFrame(check);
		};
		check();
	});
}

async function settleBonusRoundWhenFinished() {
	if (stateGame.bonusRoundSettlementInProgress) return;
	stateGame.bonusRoundSettlementInProgress = true;
	try {
		await waitForDropBatchCompletion();
		flushDeferredBonusLevelUp();
		if (
			stateGame.bonusBallsRemaining <= 0 &&
			stateGame.pendingSpinRouletteAfterBonusLevelDepletion
		) {
			stateGame.pendingSpinRouletteAfterBonusLevelDepletion = false;
			stateGame.bonusRoundSettlementInProgress = false;
			triggerRoulette('spin');
			return;
		}
		if (stateGame.bonusBallsRemaining <= 0 && consumePendingBonusLevelUp()) {
			return;
		}
		if (stateGame.bonusBallsRemaining <= 0) {
			stateGame.bonusEndWinAmount = Math.max(0, stateGame.winAmount);
			resetBonusRoundVisualState();
			stateGame.bonusEndAnnouncementOpen = true;
		}
	} finally {
		stateGame.bonusRoundSettlementInProgress = false;
	}
}

export function resetBonusRoundVisualState() {
	stateGame.bonusRoundActive = false;
	stateGame.bonusLevelProgress = 0;
	stateGame.bonusMeterValue = 0;
	stateGame.bonusMeterOverflowValue = 0;
	stateGame.pendingBonusLevelUpCount = 0;
	stateGame.deferredBonusLevelUpCount = 0;
	stateGame.pendingSpinRouletteAfterBonusLevelDepletion = false;
	stateGame.bonusSessionWinAmount = 0;
}

export function onBonusEndAnnouncementClosed() {
	stateGame.bonusEndAnnouncementOpen = false;
}

export function scheduleBonusMeterDrainDuringRoll() {
	if (bonusMeterDrainTimer) clearTimeout(bonusMeterDrainTimer);
	bonusMeterDrainTimer = setTimeout(() => {
		bonusMeterDrainTimer = null;
		if (!stateGame.bonusRouletteOpen || stateGame.activeRouletteSource !== 'bonus') return;
		if (!stateGame.bonusRoundActive) meterController.resetBonusMeterForRoulette();
	}, BONUS_METER_DRAIN_DELAY_MS);
}

export function clearBonusMeterDrainTimer() {
	if (bonusMeterDrainTimer) clearTimeout(bonusMeterDrainTimer);
	bonusMeterDrainTimer = null;
}

export function showToast(message: string, type: 'info' | 'error' = 'info') {
	stateGame.toastMessage = message;
	stateGame.toastType = type;
	setTimeout(() => {
		if (stateGame.toastMessage === message) stateGame.toastMessage = '';
	}, 4000);
}

export function showMsgBox(cfg: {
	text: string;
	confirmText?: string;
	cancelText?: string;
	onConfirm?: () => void;
	onCancel?: () => void;
}) {
	stateGame.msgBox = cfg;
}

export function hideMsgBox() {
	stateGame.msgBox = null;
}

export function showResultOverlay(amount: number, rate: number, timeout = 3000) {
	stateGame.resultAmount = amount;
	stateGame.resultRate = rate;
	stateGame.resultVisible = true;
	setTimeout(() => {
		stateGame.resultVisible = false;
	}, timeout);
}

export function registerBonusBallOutcome(ballId: number, outcome: PlinkoBallOutcome) {
	setExpectedOutcome(ballId, outcome);
}

export function onBallLanded(
	ballId: number,
	multiplier: number,
	isSpinSlot: boolean,
	slotColor: string,
) {
	const pending = takeExpectedOutcome(ballId);
	if (pending && !isSpinSlot) {
		addSettledWinAmount(pending.amount * pending.multiplier);
	}
	if (!isSpinSlot) {
		stateGame.history.push({ result: multiplier, color: slotColor });
		if (stateGame.history.length > 8) stateGame.history.shift();
	}
	if (isSpinSlot) {
		meterController.addSpinMeterValue(1, (source) => {
			if (stateGame.bonusRoundActive) {
				stateGame.pendingSpinRouletteAfterBonusLevelDepletion = true;
				return;
			}
			triggerRoulette(source);
		});
	}
	if (!stateGame.bonusBallsRemaining && stateGame.bonusRoundActive && !isGameOngoing()) {
		void settleBonusRoundWhenFinished();
	}
}

export function startAutoBet(onBet: () => void) {
	if (isGameOngoing()) return;
	stateGame.autoPlayStarted = true;
	stateGame.autoPlayStopping = false;
	stateGame.autoPlayPausedByFreeSpin = false;
	showToast('Autobet Started');
	playAutoRounds(stateGame.autoRoundsLeft === 0 ? 99999 : stateGame.autoRoundsLeft, onBet);
}

export function stopAutoBet() {
	stateGame.autoPlayStopping = true;
	stateGame.autoMode = false;
}

function playAutoRounds(roundsLeft: number, onBet: () => void) {
	if (autoBetTimer) clearTimeout(autoBetTimer);
	if (!stateGame.autoPlayStarted || stateGame.autoPlayStopping) {
		finishAutoBet();
		return;
	}
	stateGame.autoRoundsDisplay = roundsLeft;
	onBet();
	const next = roundsLeft - 1;
	autoBetTimer = setTimeout(() => {
		if (!stateGame.autoPlayStarted) return;
		if (stateGame.autoPlayPausedByFreeSpin || stateGame.freeSpinRouletteOpen) {
			playAutoRounds(roundsLeft, onBet);
			return;
		}
		if (next <= 0 || stateGame.autoPlayStopping) {
			finishAutoBet();
			return;
		}
		playAutoRounds(next, onBet);
	}, 400);
}

function finishAutoBet() {
	stateGame.autoPlayStarted = false;
	stateGame.autoPlayStopping = false;
	stateGame.autoPlayPausedByFreeSpin = false;
	stateGame.autoMode = false;
	showToast('Autobet Finished');
}

export function onPageHidden() {
	if (!stateGame.autoPlayStarted && !stateGame.autoPlayStopping) return;
	finishAutoBet();
	showToast('Autobet Finished — game was left');
}

export function onMainPlayClick(onRegularBet: () => void) {
	if (stateGameDerived.hasPendingBonusBalls) {
		playOneBonusBall();
		return;
	}
	onRegularBet();
}
