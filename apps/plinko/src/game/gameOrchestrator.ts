import { stateBet } from 'state-shared';

import { BONUS_LEVEL_LABELS, FREE_SPIN_SEGMENTS, bonusLevelBalls } from '../game-logic/constants';
import { isSpinSlotRateIndex } from '../game-logic/spinSlot';
import { boardMultiplierAtIndex, resolveOutcomeMultiplier } from '../game-logic/boardMultipliers';
import { formatHistoryDate } from '../lib/format';
import { slotColorForRateIndex } from '../game-logic/slotColors';
import { meterController } from './stateGame.svelte';
import { stateGame, stateGameDerived } from './stateGame.svelte';
import { onCoinPegHit, onSpinSlotLand, triggerRoulette } from './meterFlow';
import { stateXstateDerived } from './stateXstate';
import { bonusMeterTierStart, hasActiveRgsSession } from './plinkoSessionMeters';
import { plinkoStakePerBall } from './plinkoBet';
import { applyRgsRoundWinDisplayFromCurrencyWin } from './rgsRoundWin';
import type { PlinkoBallOutcome } from './typesBookEvent';

const BONUS_LEVEL_ACTIVATION_DELAY_MS = 250;
const BONUS_LEVEL_UP_OVERLAY_DURATION_MS = 1700;
const BONUS_LEVEL_UP_FADE_DURATION_MS = 280;
const BONUS_METER_DRAIN_DELAY_MS = 1700;

let bonusMeterDrainTimer: ReturnType<typeof setTimeout> | null = null;
let bonusLevelUpOverlayTimer: ReturnType<typeof setTimeout> | null = null;
let bonusLevelUpOverlayHideTimer: ReturnType<typeof setTimeout> | null = null;
let autoBetTimer: ReturnType<typeof setTimeout> | null = null;
const AUTO_BET_INTER_ROUND_DELAY_MS = 200;
const AUTO_BET_ROUND_START_TIMEOUT_MS = 5000;
const AUTO_BET_ROUND_IDLE_TIMEOUT_MS = 120_000;

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

export function getCombinedRoundWinAmount(): number {
	if (stateGame.bonusAwardedThisRound || stateGame.bonusRoundActive) {
		return stateGame.baseRoundDropWinAmount + stateGame.bonusSessionWinAmount;
	}
	return stateGame.pendingDropWinAmount;
}

const BONUS_ROUND_COMPLETION_TIMEOUT_MS = 600_000;

function isBonusRoundBlockingSettlement(): boolean {
	if (stateGame.bonusBallsRemaining > 0 || stateGame.bonusRoundActive) return true;
	if (stateGame.bonusEndAnnouncementOpen) return true;
	if (stateGame.pendingSpinRouletteAfterBonusLevelDepletion) return true;
	if (stateGame.freeSpinRouletteOpen) return true;
	if (stateGame.rouletteFlowInProgress && stateGame.activeRouletteSource === 'spin') {
		return true;
	}
	return false;
}

/** Wait until bonus balls are played, any follow-up wheel closes, and the end screen is dismissed. */
export function waitForBonusRoundCompletion(): Promise<void> {
	if (!isBonusRoundBlockingSettlement()) return Promise.resolve();
	return new Promise((resolve) => {
		const started = Date.now();
		const check = () => {
			if (!isBonusRoundBlockingSettlement() || Date.now() - started >= BONUS_ROUND_COMPLETION_TIMEOUT_MS) {
				resolve();
				return;
			}
			requestAnimationFrame(check);
		};
		check();
	});
}

export function addSettledWinAmount(amount: number, updateDisplay = true) {
	const safe = Number(amount) || 0;
	if (safe <= 0) return;
	if (stateGame.bonusRoundActive) {
		stateGame.bonusSessionWinAmount += safe;
	} else {
		stateGame.pendingDropWinAmount += safe;
	}
	// `updateDisplay = false` accumulates the win (for the wheel base) without touching the HUD —
	// used by the silent feature-trigger re-drop so the HUD holds the carried filling-round win
	// until the roulette resolves (no flicker / no visible second drop).
	if (updateDisplay) applyRgsRoundWinDisplayFromCurrencyWin(getCombinedRoundWinAmount());
}

/** True while spawned balls are still in flight (not the `isAnimating` UI flag). */
export function isDropBatchPending(): boolean {
	return (
		stateGame.expectedOutcomeByBallId.size > 0 || stateGame.pendingSpacedSpawnTimers > 0
	);
}

export function isGameOngoing(): boolean {
	return stateGame.isAnimating || isDropBatchPending();
}

export function isPlayActionBlockedByFreeSpinRoulette(): boolean {
	if (stateGame.freeSpinRouletteOpen) return true;
	return stateGame.activeRouletteSource === 'spin' || stateGame.pendingRouletteSource === 'spin';
}

export function isPlayActionBlockedByBonusRoulette(): boolean {
	if (stateGame.bonusRoundActive) return false;
	// FOLDED-BONUS DESIGN: only an ACTIVELY animating/pending bonus roulette blocks Play. A FULL bonus
	// meter must NOT block — the bonus is fired by the served base book (math quota), not by the meter,
	// so there is nothing to "wait for". (Blocking on a full meter here soft-locked the game once the
	// auto-fire was removed.)
	return stateGame.activeRouletteSource === 'bonus' || stateGame.pendingRouletteSource === 'bonus';
}

/**
 * FOLDED-BONUS DESIGN: the bonus is never client-triggered (no auto-fire / no separate bonus mode), so
 * a full meter is never "imminent". Always false — kept so callers/imports stay stable.
 */
export function isFeatureTriggerImminent(): boolean {
	return false;
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
		stateGame.dropRoundActive ||
		stateGame.bonusBallsRemaining > 0 ||
		stateGame.freeSpinRouletteOpen ||
		stateGame.bonusRouletteOpen ||
		// An active Autobet session keeps wager config locked across the whole run, including the
		// idle gap between rounds where the per-round flags above all read false. Without this the
		// bet-per-ball / ball-per-drop steppers become interactive mid-session.
		stateGame.autoPlayStarted ||
		// Round not fully settled until the xstate machine is back to idle (deferred end-round
		// runs inside the `bet` state, after `playBet` already cleared the flags above). Without
		// this, fast clicks during settlement dispatch a BET the idle-only machine drops, leaving
		// `isSubmitting` stuck and the controls locked.
		stateXstateDerived.isPlaying() ||
		// Bonus meter full → keep betting locked until the auto-fired bonus trigger starts.
		isFeatureTriggerImminent()
	);
}

/**
 * Preserve each bonus ball's authoritative `hitSpinSlot` flag (from the book). A free ball that
 * lands on the center spin pocket then fills the free-spin meter in real time during the bonus
 * (via `onSpinSlotLand`), instead of the increase being deferred until after the round.
 */
function normalizeBonusOutcomes(outcomes: PlinkoBallOutcome[]): PlinkoBallOutcome[] {
	const slotCount = stateGame.coefficients.length;
	// Scale book amounts (authored at the book stake) to the player's stake — the same scaling
	// the base drop gets in the `plinkoDrop` handler. Without this, bonus balls accumulate at the
	// book stake while the credited `finalWin` is at the player stake, causing a big mismatch.
	const bookStake = stateGame.lastBookStakePerBall > 0 ? stateGame.lastBookStakePerBall : 1;
	const stakeScale = bookStake > 0 ? plinkoStakePerBall() / bookStake : 1;
	return (outcomes ?? []).map((outcome) => ({
		...outcome,
		amount: outcome.amount * stakeScale,
		hitSpinSlot:
			outcome.hitSpinSlot ?? (slotCount > 0 && isSpinSlotRateIndex(outcome.rateIndex, slotCount)),
	}));
}

/**
 * Load math `bonusRound` outcomes and grant remaining free balls (no client RNG).
 * Every free ball's landing pocket is authored by the book, so the on-screen result
 * always sums to the book `finalWin` / wallet payout.
 */
export function startAuthoritativeBonusRound(
	freeBalls: number,
	outcomes: PlinkoBallOutcome[],
	level: number,
	ballsPlayed = 0,
) {
	const played = Math.max(0, Math.floor(ballsPlayed || 0));
	stateGame.authoritativeBonusOutcomes = normalizeBonusOutcomes(outcomes);
	stateGame.authoritativeBonusOutcomeIndex = played;
	const remaining = Math.max(0, Math.floor(freeBalls || 0) - played);
	if (level > 0) {
		stateGame.bonusLevelProgress = Math.max(stateGame.bonusLevelProgress, level);
	}
	if (remaining <= 0) return;
	if (!stateGame.bonusRoundActive) {
		awardBonusBalls(remaining);
		return;
	}
	stateGame.bonusBallsRemaining = remaining;
}

/** Queue a book-authored bonus level-up (played after the current level's balls finish). */
export function enqueueAuthoritativeBonusLevel(
	freeBalls: number,
	outcomes: PlinkoBallOutcome[],
	level: number,
) {
	stateGame.authoritativeBonusLevelQueue = [
		...stateGame.authoritativeBonusLevelQueue,
		{
			freeBalls: Math.max(0, Math.floor(freeBalls || 0)),
			outcomes: normalizeBonusOutcomes(outcomes),
			level: Math.max(1, Math.floor(level || 1)),
		},
	];
}

/** True when the entry-level bonus balls (already awarded by the wheel) just need their outcomes. */
export function loadAuthoritativeBonusOutcomes(outcomes: PlinkoBallOutcome[], ballsPlayed = 0) {
	stateGame.authoritativeBonusOutcomes = normalizeBonusOutcomes(outcomes);
	stateGame.authoritativeBonusOutcomeIndex = Math.max(0, Math.floor(ballsPlayed || 0));
}

/** Pull the next book-authored level off the queue, show the level-up, and award its balls. */
function consumeAuthoritativeBonusLevel(): boolean {
	const next = stateGame.authoritativeBonusLevelQueue[0];
	if (!next) return false;
	stateGame.authoritativeBonusLevelQueue = stateGame.authoritativeBonusLevelQueue.slice(1);
	setTimeout(
		() => applyAuthoritativeBonusLevel(next),
		BONUS_LEVEL_ACTIVATION_DELAY_MS,
	);
	return true;
}

async function applyAuthoritativeBonusLevel(level: {
	freeBalls: number;
	outcomes: PlinkoBallOutcome[];
	level: number;
}) {
	await waitForDropBatchCompletion();
	if (!stateGame.bonusRoundActive || stateGame.bonusBallsRemaining > 0) return;
	stateGame.bonusLevelProgress = Math.max(stateGame.bonusLevelProgress, level.level);
	showBonusLevelUpOverlay(level.level, level.freeBalls);
	stateGame.authoritativeBonusOutcomes = level.outcomes;
	stateGame.authoritativeBonusOutcomeIndex = 0;
	// Level-up applied: DRAIN the (held-full) meter so the new level's bar visibly re-fills from
	// empty as its balls drop. The meter held at max while the previous level's balls finished (the
	// "ready to level up" blink); now that we've advanced, start the next fill fresh.
	stateGame.bonusMeterValue = 0;
	awardBonusBalls(level.freeBalls);
}

export function takeAuthoritativeBonusOutcome(): PlinkoBallOutcome | undefined {
	const outcomes = stateGame.authoritativeBonusOutcomes;
	const index = stateGame.authoritativeBonusOutcomeIndex;
	if (!outcomes.length || index >= outcomes.length) return undefined;
	stateGame.authoritativeBonusOutcomeIndex = index + 1;
	return outcomes[index];
}

export function awardBonusBalls(count: number) {
	const amount = Math.max(1, Math.floor(count || 1));
	if (!stateGame.bonusRoundActive) {
		stateGame.bonusAwardedThisRound = true;
		stateGame.baseRoundDropWinAmount = stateGame.pendingDropWinAmount;
		stateGame.bonusRoundActive = true;
		stateGame.bonusLevelProgress = 1;
		stateGame.spinMeterValue = 0;
		// The bonus fires in-drop from a base book (the persistent session meter is a visual indicator,
		// not the exact trigger), so snap the meter to FULL as the bonus starts — the "fill → fire"
		// reads coherently regardless of the served book / where the session meter actually was. The
		// bonus-round level meter then sits at max (level-ups re-assert max); it resets to the tier
		// start when the round ends (`resetBonusRoundVisualState` / `syncBonusMeterAfterBet`).
		stateGame.bonusMeterValue = stateGame.bonusMeterMax;
		stateGame.bonusMeterOverflowValue = 0;
		stateGame.bonusSessionWinAmount = 0;
		stateGame.inBonusFreeSpinCreditTotal = 0;
	}
	if (
		!stateGameDerived.hasPendingBonusBalls &&
		!stateGame.bonusRoundSettlementInProgress &&
		!isGameOngoing()
	) {
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
	// Session-meter fallback only (production levels come from book `bonusRound` events).
	const addedBalls = Math.max(1, bonusLevelBalls(nextLevel));
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

export function waitForDropBatchCompletion(maxMs = 30_000): Promise<void> {
	return new Promise((resolve) => {
		const started = Date.now();
		const check = () => {
			if (!isDropBatchPending() || Date.now() - started >= maxMs) resolve();
			else requestAnimationFrame(check);
		};
		check();
	});
}

export async function settleBonusRoundWhenFinished() {
	if (stateGame.bonusRoundSettlementInProgress) return;
	stateGame.bonusRoundSettlementInProgress = true;
	try {
		await waitForDropBatchCompletion();
		flushDeferredBonusLevelUp();
		// Book-authored level-ups take priority over the client session-meter fallback — and over the
		// trailing in-bonus free spin: ALL levels' balls must drop (and level up) before the free spin
		// fires (the `freeSpinTrigger` event is appended AFTER every `bonusRound` level in the book).
		if (stateGame.bonusBallsRemaining <= 0 && consumeAuthoritativeBonusLevel()) {
			return;
		}
		if (stateGame.bonusBallsRemaining <= 0 && consumePendingBonusLevelUp()) {
			return;
		}
		if (
			stateGame.bonusBallsRemaining <= 0 &&
			stateGame.pendingSpinRouletteAfterBonusLevelDepletion
		) {
			// The spin meter filled during the bonus round → fire the in-bonus FREE SPIN now that every
			// level's balls have dropped. The book authors the landed segment (`pendingBonusFreeSpinPayload`);
			// set it so the wheel lands on it (its `stake × M` is already in the RGS finalWin). Without this
			// the wheel would land on a random fallback segment. After the wheel closes,
			// `onFreeSpinRouletteFinished` re-invokes this settler so the round actually ends (or advances).
			stateGame.pendingSpinRouletteAfterBonusLevelDepletion = false;
			const inBonusFreeSpin = stateGame.pendingBonusFreeSpinPayload;
			stateGame.pendingBonusFreeSpinPayload = undefined;
			if (inBonusFreeSpin?.segment) {
				stateGame.serverFreeSpinSegmentLabel = inBonusFreeSpin.segment;
				const idx = FREE_SPIN_SEGMENTS.indexOf(
					inBonusFreeSpin.segment as (typeof FREE_SPIN_SEGMENTS)[number],
				);
				stateGame.serverFreeSpinSegment = idx >= 0 ? idx : 0;
			}
			stateGame.bonusRoundSettlementInProgress = false;
			triggerRoulette('spin');
			return;
		}
		if (stateGame.bonusBallsRemaining <= 0) {
			stateGame.bonusEndWinAmount = Math.max(0, getCombinedRoundWinAmount());
			// Fold the bonus-ball wins into one My Bet History row (per-ball bonus lands were skipped
			// in `onBallLanded`). Exclude any in-bonus free-spin credit — it's already logged as its
			// own "Free Spin N×" row — so the two rows don't double-count. Capture before the reset.
			recordBonusWinHistory(
				stateGame.bonusSessionWinAmount - stateGame.inBonusFreeSpinCreditTotal,
			);
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
	// Bonus consumed: reset to the tier base start (0 on 1/10-ball, 1/8 on 20-ball, 1/4 on 50-ball).
	stateGame.bonusMeterValue = Math.min(bonusMeterTierStart(), stateGame.bonusMeterMax || bonusMeterTierStart());
	stateGame.bonusMeterOverflowValue = 0;
	stateGame.pendingBonusLevelUpCount = 0;
	stateGame.deferredBonusLevelUpCount = 0;
	stateGame.pendingSpinRouletteAfterBonusLevelDepletion = false;
	stateGame.bonusSessionWinAmount = 0;
	stateGame.inBonusFreeSpinCreditTotal = 0;
	stateGame.authoritativeBonusOutcomes = [];
	stateGame.authoritativeBonusOutcomeIndex = 0;
	stateGame.authoritativeBonusLevelQueue = [];
}

export function onBonusEndAnnouncementClosed() {
	stateGame.bonusEndAnnouncementOpen = false;
}

export function scheduleBonusMeterDrainDuringRoll() {
	if (bonusMeterDrainTimer) clearTimeout(bonusMeterDrainTimer);
	bonusMeterDrainTimer = setTimeout(() => {
		bonusMeterDrainTimer = null;
		if (!stateGame.bonusRouletteOpen || stateGame.activeRouletteSource !== 'bonus') return;
		meterController.resetBonusMeterForRoulette();
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
	_isSpinSlotFromEngine: boolean,
	slotIndex = -1,
) {
	const pending = takeExpectedOutcome(ballId);
	const slotCount = stateGame.coefficients.length;
	const isSpinSlot = pending
		? stateGame.authoritativeMeterFlow
			? pending.hitSpinSlot === true
			: (pending.hitSpinSlot ??
				(slotCount > 0 && isSpinSlotRateIndex(pending.rateIndex, slotCount)))
		: _isSpinSlotFromEngine;

	// Server bonus peg: credit when the ball hits the peg (path emit) or on land as failsafe.
	if (pending?.hitBonusPeg === true) {
		onCoinPegHit(ballId);
	}

	const coeffs =
		stateGame.coefficients.length > 0 ? stateGame.coefficients : [];
	const rateIndex = pending?.rateIndex ?? slotIndex;
	const resolvedMultiplier = pending
		? resolveOutcomeMultiplier(pending, coeffs)
		: coeffs.length > 0 && slotIndex >= 0
			? boardMultiplierAtIndex(slotIndex, coeffs)
			: multiplier;

	if (pending && !isSpinSlot && !stateGame.plinkoDropStratumMismatch) {
		addSettledWinAmount(pending.amount * resolvedMultiplier);
	}
	// Bonus-round ball lands are folded into ONE consolidated "Bonus" row at settlement
	// (`recordBonusWinHistory`), so skip per-ball logging here to avoid double-counting.
	if (!stateGame.bonusRoundActive) {
		const bet = pending?.amount ?? stateBet.betAmount;
		if (isSpinSlot) {
			// A spin-slot land has no pocket payout (it fills the free-spin meter), so log it with a
			// blue "spin" pill and a 0 win — the resulting free-spin payout is its own row later.
			recordSpinSlotHistory(bet);
		} else {
			stateGame.history.unshift({
				date: formatHistoryDate(new Date()),
				bet,
				multiplier: resolvedMultiplier,
				win: bet * resolvedMultiplier,
				color:
					coeffs.length && rateIndex >= 0
						? slotColorForRateIndex(coeffs, rateIndex)
						: '#64748b',
			});
		}
	}
	if (pending && isSpinSlot) {
		onSpinSlotLand(ballId);
	}
	if (!stateGame.bonusBallsRemaining && stateGame.bonusRoundActive && !isGameOngoing()) {
		void settleBonusRoundWhenFinished();
	}
}

/** Distinct My Bet History accents for consolidated feature payout rows. */
const FREE_SPIN_HISTORY_COLOR = '#A855F7';
const BONUS_HISTORY_COLOR = '#FFB801';
const SPIN_SLOT_HISTORY_COLOR = '#3B82F6';

/** Spin-slot land: a real per-ball wager with no pocket payout (0 win), shown as a blue "spin". */
export function recordSpinSlotHistory(bet: number) {
	stateGame.history.unshift({
		date: formatHistoryDate(new Date()),
		bet,
		multiplier: 0,
		win: 0,
		color: SPIN_SLOT_HISTORY_COLOR,
		label: 'Spin',
	});
}

/**
 * Record a consolidated feature payout (free-spin wheel multiplier, or a whole bonus round) in My
 * Bet History. Feature wins are authoritative-round wins that DON'T map to a single base-board ball
 * land — left unrecorded, the per-ball rows would undercount the displayed total. Each call adds one
 * labelled row so the recorded rows sum to the on-screen total.
 */
export function recordFeatureWinHistory(params: {
	label: string;
	multiplier: number;
	win: number;
	bet: number;
	color: string;
}) {
	if (!(params.win > 0)) return;
	stateGame.history.unshift({
		date: formatHistoryDate(new Date()),
		bet: params.bet,
		multiplier: params.multiplier,
		win: params.win,
		color: params.color,
		label: params.label,
		// Free Spin / Bonus aren't a single per-ball wager, so blank the Bet column.
		betPlaceholder: true,
	});
}

/** Free-spin wheel payout: `win` is the INCREMENTAL credit (round total − pre-feature win). */
export function recordFreeSpinWinHistory(multiplier: number, win: number, bet: number) {
	recordFeatureWinHistory({
		label: `Free Spin ${formatFeatureMultiplier(multiplier)}`,
		multiplier,
		win,
		bet,
		color: FREE_SPIN_HISTORY_COLOR,
	});
}

/** Whole bonus round folded into one row; `win` is the full bonus-session win. */
export function recordBonusWinHistory(win: number) {
	const bet = plinkoStakePerBall();
	recordFeatureWinHistory({
		label: 'Bonus',
		multiplier: bet > 0 ? win / bet : 0,
		win,
		bet,
		color: BONUS_HISTORY_COLOR,
	});
}

function formatFeatureMultiplier(multiplier: number): string {
	const rounded = Math.round(multiplier * 100) / 100;
	return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(2)}×`;
}

/**
 * True while a round is still in progress. Critically this includes the xstate `bet` machine
 * settling (deferred `/wallet/end-round` runs inside that state), so autobet does not place the
 * next bet until the RGS round is fully closed — otherwise the next `BET` collides with the
 * still-active round and is dropped, soft-locking the game. `isPlaying()` is idle in dev-local
 * play (the actor is bypassed), so flag checks still cover that path.
 */
function isAutoBetRoundBusy(): boolean {
	return (
		stateGame.isSubmitting ||
		stateGame.dropRoundActive ||
		stateGame.bonusBallsRemaining > 0 ||
		isGameOngoing() ||
		stateGame.freeSpinRouletteOpen ||
		stateGame.bonusRouletteOpen ||
		stateGame.rouletteFlowInProgress ||
		stateXstateDerived.isPlaying()
	);
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function autoBetDelay(ms: number): Promise<void> {
	return new Promise((resolve) => {
		autoBetTimer = setTimeout(() => {
			autoBetTimer = null;
			resolve();
		}, ms);
	});
}

/** Wait until the current autobet round fully settles (balls, wheels, wallet). */
async function waitForAutoBetRoundIdle(): Promise<boolean> {
	const started = Date.now();
	let sawActiveRound = false;

	while (Date.now() - started < AUTO_BET_ROUND_IDLE_TIMEOUT_MS) {
		if (isAutoBetRoundBusy()) sawActiveRound = true;
		if (sawActiveRound && !isAutoBetRoundBusy()) {
			await autoBetDelay(AUTO_BET_INTER_ROUND_DELAY_MS);
			if (!isAutoBetRoundBusy()) return true;
		}
		if (!sawActiveRound && Date.now() - started >= AUTO_BET_ROUND_START_TIMEOUT_MS) {
			return false;
		}
		await sleep(60);
	}
	return false;
}

async function placeAutoBetRound(onBet: () => void): Promise<boolean> {
	if (isAutoBetRoundBusy()) return false;
	onBet();
	return waitForAutoBetRoundIdle();
}

export function startAutoBet(onBet: () => void) {
	if (isGameOngoing()) return;
	stateGame.autoPlayStarted = true;
	stateGame.autoPlayStopping = false;
	stateGame.autoPlayPausedByFreeSpin = false;
	const selected = stateGame.autoRoundsLeft <= 0 ? 99999 : stateGame.autoRoundsLeft;
	stateGame.autoRoundsDisplay = selected;
	showToast('Autobet Started');
	const firstRoundLeft = selected >= 1000 ? selected : selected - 1;
	void playAutoRounds(firstRoundLeft, onBet);
}

export function stopAutoBet() {
	stateGame.autoPlayStopping = true;
	stateGame.autoMode = false;
}

async function playAutoRounds(roundsLeft: number, onBet: () => void): Promise<void> {
	if (autoBetTimer) {
		clearTimeout(autoBetTimer);
		autoBetTimer = null;
	}
	if (!stateGame.autoPlayStarted || stateGame.autoPlayStopping) {
		finishAutoBet();
		return;
	}
	if (stateGame.autoPlayPausedByFreeSpin || stateGame.freeSpinRouletteOpen) {
		await autoBetDelay(AUTO_BET_INTER_ROUND_DELAY_MS);
		void playAutoRounds(roundsLeft, onBet);
		return;
	}

	const placed = await placeAutoBetRound(onBet);
	if (!stateGame.autoPlayStarted || stateGame.autoPlayStopping) {
		finishAutoBet();
		return;
	}
	if (!placed) {
		finishAutoBet();
		return;
	}

	if (roundsLeft < 1000) {
		stateGame.autoRoundsLeft = roundsLeft;
		stateGame.autoRoundsDisplay = roundsLeft;
	}

	if (roundsLeft <= 0 || stateGame.autoPlayStopping) {
		finishAutoBet();
		return;
	}

	await autoBetDelay(AUTO_BET_INTER_ROUND_DELAY_MS);
	if (!stateGame.autoPlayStarted || stateGame.autoPlayStopping) {
		finishAutoBet();
		return;
	}
	void playAutoRounds(roundsLeft - 1, onBet);
}

function finishAutoBet() {
	if (autoBetTimer) {
		clearTimeout(autoBetTimer);
		autoBetTimer = null;
	}
	stateGame.autoPlayStarted = false;
	stateGame.autoPlayStopping = false;
	stateGame.autoPlayPausedByFreeSpin = false;
	stateGame.autoMode = false;
	// Soft-lock recovery: if no round is actually in flight, clear any stuck submit/round lock
	// so the Play button stays responsive. Never clears while a round is still settling.
	if (
		!stateXstateDerived.isPlaying() &&
		!isGameOngoing() &&
		stateGame.bonusBallsRemaining <= 0
	) {
		stateGame.isSubmitting = false;
		stateGame.dropRoundActive = false;
	}
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

/**
 * FOLDED-BONUS DESIGN: NO auto-fire. The bonus is FREE and fires IN-DROP inside the base book on the
 * math's per-tier quota (there is no separate bonus mode to play). The client just animates the book's
 * `bonusRoulette`/`bonusRound` events; the bonus meter is a pure visual. Kept as a no-op so the
 * Game.svelte effect + imports stay stable.
 */
export function maybeAutoFireFeatureTrigger(_dispatchBet: () => void): void {
	// intentionally empty — see doc comment.
}
