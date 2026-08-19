import {
	awardBonusBalls,
	bankBonusPegDuringLevelUp,
	clearBonusMeterDrainTimer,
	combineNextBonusLevelNow,
	creditInBonusSpinMeter,
	hasPendingBonusLevelAward,
	isSingleBallMode,
	onBonusMeterFilledDuringRound,
	scheduleBonusMeterDrainDuringRoll,
	waitForDropBatchCompletion,
} from './gameOrchestrator';
import type { PlinkoBallOutcome } from './typesBookEvent';
import { coefficientsForTier } from '../game-logic/constants';
import config from './config';
import { traceBonusMeterWrite, traceBonusMeterWriteAfter } from './plinkoMeterTrace';
import {
	clampBonusMeterToTriggerCeiling,
	hasActiveRgsSession,
	seedBonusMeterForCurrentTier,
	seedSpinMeterForCurrentTier,
} from './plinkoSessionMeters';
import { meterController } from './stateGame.svelte';
import { stateGame } from './stateGame.svelte';

function resetBonusMeterForRouletteIfNeeded() {
	if (stateGame.bonusRoundActive) return;
	meterController.resetBonusMeterForRoulette();
}

export type RouletteSource = 'spin' | 'bonus';

/**
 * May a CLIENT-SIDE meter fill fire a feature wheel? Only when there is no live RGS session.
 *
 * On a live session every payout-affecting outcome must come from the served book — including the
 * wheel's landing segment. The client meter fallbacks below have no book behind them: they open a wheel
 * with no `serverBonusFreeBalls` / `serverFreeSpinSegment`, so `resolveWinnerIndex` finds no
 * authoritative segment and `assertAuthoritativeOutcome` fires (throws in DEV, degrades the session in
 * production). This is also what the folded-bonus design already states elsewhere — see
 * `isFeatureTriggerImminent` and `isPlayActionBlockedByBonusRoulette`: live, the bonus and the free spin
 * are fired by the served base book's `bonusRoulette` / `freeSpinTrigger` events, never by the meter.
 *
 * The fallbacks stay for dev / local-book / story playback, where there is no book to author an outcome
 * and a client roll is legitimate. On a live session the meters still FILL (the bar reads correctly);
 * they simply never trigger.
 *
 * This was masked until the wheel was made to survive settlement: the fallback's opener used to be
 * cancelled by `forceUnlockBettingControls` before it could mount a wheel, so the illegal spin never
 * actually happened — it just killed the Autobet run on its way past.
 */
const clientMeterMayTriggerFeature = () => !hasActiveRgsSession();

let rouletteCloseWaiters: Array<() => void> = [];
/** Bumped when a round ends so in-flight `triggerRoulette` openers are ignored. */
let rouletteOpenGeneration = 0;

const isDropPipelineBusy = () =>
	stateGame.expectedOutcomeByBallId.size > 0 || stateGame.pendingSpacedSpawnTimers > 0;

/**
 * Longest a wheel opener will sit on the drop pipeline before opening anyway.
 *
 * This wait is an rAF loop, and rAF is throttled/parked when the tab is hidden — so without a ceiling
 * a backgrounded tab can leave a roulette flow begun-but-never-opened indefinitely. That now matters
 * more than it used to: `isBonusRoundBlockingSettlement` holds the round open while a flow is in
 * progress, so a stalled opener would stall settlement with it.
 */
const DROP_PIPELINE_IDLE_TIMEOUT_MS = 15_000;

const waitForDropPipelineIdle = (): Promise<void> =>
	new Promise((resolve) => {
		const started = Date.now();
		const check = () => {
			if (!isDropPipelineBusy() || Date.now() - started >= DROP_PIPELINE_IDLE_TIMEOUT_MS) resolve();
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

/**
 * Force-clear all betting-panel lock flags (safe after a book round finishes).
 *
 * `preserveInFlightBalls` keeps the still-falling ball's outcome map + spawn counters intact — used by
 * the rapid 1-ball flow, where the round settles WHILE its ball is still animating so the player can
 * drop the next one. Wiping those here would strip the in-flight ball of its authoritative outcome
 * (breaking its win/history credit on landing). Default false = the normal full reset.
 */
export function forceUnlockBettingControls(preserveInFlightBalls = false) {
	rouletteOpenGeneration += 1;
	stateGame.dropRoundActive = false;
	stateGame.isSubmitting = false;
	stateGame.isAnimating = false;
	if (!preserveInFlightBalls) {
		stateGame.pendingSpacedSpawnTimers = 0;
		stateGame.expectedOutcomeByBallId = new Map();
		// No rapid balls to reveal → drop the held-back balance shadow (revert to authoritative).
		stateGame.rapidBalanceShadow = null;
	}
	stateGame.freeSpinRouletteOpen = false;
	stateGame.bonusRouletteOpen = false;
	stateGame.showFreeSpinRoulette = false;
	stateGame.showBonusRoulette = false;
	stateGame.autoPlayPausedByFreeSpin = false;
	meterController.completeRoulette();
	notifyRouletteClosed();
}

/** @deprecated alias — always performs a synchronous force-unlock. */
export function releaseRoundInteractionLocks(preserveInFlightBalls = false) {
	forceUnlockBettingControls(preserveInFlightBalls);
}

/**
 * Undo the Autobet pause a `triggerRoulette` latched when its wheel then never opened.
 *
 * The pause is set SYNCHRONOUSLY (so nothing can slip a wager in between) but the wheel opens from a
 * detached async body that can still bail. Leaving the pause behind after a bail parks the run on a
 * wheel that will never appear — which is exactly how a full bonus meter used to end an Autobet run
 * with no bonus to show for it.
 */
function releaseAutoPlayRoulettePause(source: RouletteSource) {
	if (source === 'spin') stateGame.autoPlayPausedByFreeSpin = false;
}

export function triggerRoulette(source: RouletteSource) {
	if (stateGame.rouletteFlowInProgress) {
		stateGame.pendingRouletteSource = source;
		return;
	}
	// Both features PAUSE Autobet rather than end it. A free spin parks the loop on this flag and resumes
	// once the wheel closes; a bonus needs no flag — it is played out INSIDE the round the loop is already
	// waiting on (`isAutoBetRoundBusy` covers its whole life) and the run drives its free balls itself,
	// see `syncAutoBetBonusBallDriver`. Stopping the run mid-bonus stays possible and hands the remaining
	// free balls back to the player.
	if (stateGame.autoPlayStarted && source === 'spin') stateGame.autoPlayPausedByFreeSpin = true;
	meterController.beginRoulette(source);
	const openGeneration = rouletteOpenGeneration;
	void (async () => {
		await waitForDropPipelineIdle();
		if (openGeneration !== rouletteOpenGeneration) {
			releaseAutoPlayRoulettePause(source);
			return;
		}
		// Ignore stale opener attempts if roulette source changed in-between.
		if (!stateGame.rouletteFlowInProgress || stateGame.activeRouletteSource !== source) {
			releaseAutoPlayRoulettePause(source);
			return;
		}
		if (source === 'spin') {
			stateGame.freeSpinRouletteOpen = true;
			return;
		}
		stateGame.bonusRouletteOpen = true;
		scheduleBonusMeterDrainDuringRoll();
	})();
}

export function onCoinPegHit(ballId: number) {
	// 1-ball is a feature-free mode: never let a coin-peg hit fill the bonus meter (its tiny/cosmetic
	// max could otherwise fire a bonus). No meter is even shown on this tier.
	if (isSingleBallMode()) return;
	if (stateGame.authoritativeMeterFlow && !stateGame.dropRoundActive) return;
	if (stateGame.bonusPegMeterCreditedBallIds.has(ballId)) return;
	if (stateGame.rouletteFlowInProgress && stateGame.activeRouletteSource === 'bonus') return;
	stateGame.bonusPegMeterCreditedBallIds.add(ballId);

	if (stateGame.authoritativeMeterFlow) {
		if (stateGame.bonusRoundActive) {
			// IN-BONUS energy meter: fill smoothly from the bonus balls' coin-peg hits. The instant it
			// reaches max, LEVEL UP RIGHT AWAY — `combineNextBonusLevelNow` pops the next book-authored
			// level, pours its free balls into the still-remaining pool (they drop combined, not as a
			// separate wave after depletion) and drains the bar so it re-fills for the next level. Max =
			// the level-up threshold (set by the single in-bonus `bonusMeter` event). The level count +
			// award stay server-authoritative (book `bonusRound` events feed the level queue); this only
			// drives WHEN the combine fires. No-op once the book's levels are exhausted / at the ladder
			// top, so the bar simply holds full there (the depletion path in `settleBonusRoundWhenFinished`
			// remains a safety net for any level not combined in-drop).
			// The bar is pinned full while a level-up finishes filling it out and holds it on screen; a hit
			// landing in that window belongs to the NEXT level's bar, so bank it instead of losing it.
			if (stateGame.bonusMeterHoldFull) {
				bankBonusPegDuringLevelUp();
				return;
			}
			const max = stateGame.bonusMeterMax > 0 ? stateGame.bonusMeterMax : 1;
			// A COMPLETED bar with no level-up behind it is a dead end: nothing consumes it, and every
			// further hit is then rejected by the `< ceiling` test below — the meter simply stops for the
			// rest of the round. The bar is sized so the book's own levels complete it (see
			// `sizeBonusMeterForLevel`); this is the backstop for anything that doesn't fit that model
			// (legacy books with no `levelupPegs`, the top of the ladder), holding the bar one notch short
			// of the top so it still reads as progress rather than as a level-up that never arrives.
			const ceiling = hasPendingBonusLevelAward() ? max : Math.max(0, max - 1);
			if (stateGame.bonusMeterValue < ceiling) {
				stateGame.bonusMeterValue = Math.min(ceiling, stateGame.bonusMeterValue + 1);
				if (stateGame.bonusMeterValue >= max) combineNextBonusLevelNow();
			}
		} else {
			// TRIGGER drop: provisional fill toward the per-tier max (authoritative `bonusMeter` events
			// confirm it) — but never past the ceiling: a round the book will not fire on must not show a
			// completed bar. See `triggerPhaseBonusMeterCeiling`.
			const beforeAuthoritativeBump = stateGame.bonusMeterValue;
			meterController.bumpBonusMeterVisual(1);
			clampBonusMeterToTriggerCeiling();
			traceBonusMeterWriteAfter('onCoinPegHit:authoritativeBump', beforeAuthoritativeBump);
		}
		return;
	}

	// LIVE RGS SESSION: fill the bar, never TRIGGER from it. See `clientMeterMayTriggerFeature`.
	if (!clientMeterMayTriggerFeature()) {
		const beforeLiveBump = stateGame.bonusMeterValue;
		meterController.bumpBonusMeterVisual(1);
		// Same ceiling as the authoritative branch above — this path was missing it, so a book the RGS
		// never fires on could still be filled to a completed bar from peg hits alone.
		clampBonusMeterToTriggerCeiling();
		traceBonusMeterWriteAfter('onCoinPegHit:liveRgsBump', beforeLiveBump);
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

export function onSpinSlotLand(ballId?: number, outcome?: PlinkoBallOutcome) {
	// 1-ball is a feature-free mode: never let a spin-slot land fill the spin meter (max is 1 on this
	// tier, so a single center land would otherwise fire a free spin). No meter is shown here.
	if (isSingleBallMode()) return;
	if (stateGame.authoritativeMeterFlow && !stateGame.dropRoundActive) return;
	// Count the ball ONCE, before any gate below can drop it — a land is a land whether or not the meter
	// is in a position to show it right now.
	if (ballId != null) {
		if (stateGame.spinSlotMeterCreditedBallIds.has(ballId)) return;
		stateGame.spinSlotMeterCreditedBallIds.add(ballId);
	}

	// IN-BONUS: the bar is BOOK-DRIVEN (per-batch carry-in + fire on completion), not a free-running
	// visual counter — that mismatch is what let a completed bar sit with no wheel behind it, and let
	// two book free spins run off one visible fill. See `creditInBonusSpinMeter`.
	//
	// ⚠️ THIS MUST STAY ABOVE THE ROULETTE-FLOW GATE BELOW. `beginRoulette('spin')` raises
	// `rouletteFlowInProgress` synchronously on the very ball that completes the bar, so that gate would
	// swallow exactly the in-flight lands the bar is waiting to bank — the balls that were already
	// falling when the wheel was called, which the book counts and which must be credited once the bar
	// resets. `creditInBonusSpinMeter` decides for itself whether to fill, bank, or ignore.
	if (stateGame.bonusRoundActive) {
		creditInBonusSpinMeter(outcome);
		return;
	}

	if (stateGame.rouletteFlowInProgress && stateGame.activeRouletteSource === 'spin') return;
	// BASE DROP: the meter is per-drop and the book clamps it at max, so a land once the bar is full is
	// genuinely worth nothing — the round is about to reset it to the tier start either way.
	if (stateGame.spinMeterMax > 0 && stateGame.spinMeterValue >= stateGame.spinMeterMax) return;

	if (stateGame.authoritativeMeterFlow) {
		// Provisional animation only — authoritative value comes from RGS `spinMeter` book events.
		meterController.bumpSpinMeterVisual(1);
		return;
	}

	// LIVE RGS SESSION: fill the bar, never TRIGGER from it. Same reasoning as the bonus meter above —
	// `FreeSpinRoulette` would spin with no authoritative `targetSegmentIndex` and trip the same guard.
	if (!clientMeterMayTriggerFeature()) {
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
	// The BOARD is per-tier (the feature-free 1-ball tier pays its center pocket instead of using it as
	// the 0× spin pocket), so re-seed the displayed coefficients on switch. Without this the board would
	// keep showing the previous tier's slot values until the next book arrived. Skipped mid-bonus (the
	// bonus plays out on the tier that triggered it).
	if (!stateGame.bonusRoundActive) {
		stateGame.coefficients = coefficientsForTier(
			config.coefficientSets as number[][],
			config.coefficientSetsByBalls,
			stateGame.rowCount,
			stateGame.ballPerDrop,
		);
	}
	// ⚠️ `meterController` shares the `stateGame` object, so `setBallPerDrop` ASSIGNS `ballPerDrop` —
	// it must always be the player's SELECTED tier. Passing a resolved/override tier here (e.g. the
	// buy-bonus reference) silently changes the selector out from under the player.
	//
	// ⚠️⚠️ SKIPPED while a buy is pending, and that is NOT an optimization. `setBallPerDrop` rebuilds
	// both meter maxima from the SELECTED tier while the seeds below deliberately use the buy-bonus
	// REFERENCE tier, so running both makes this function write two DIFFERENT values for `spinMeterMax`
	// on every pass. `rebuildMeterTierMaxima` also READS the meter values/maxima (to clamp them), so
	// this runs as a self-invalidating `$effect` (Game.svelte calls it from one) and Svelte tears itself
	// apart with `effect_update_depth_exceeded` — which presents as the game hanging on buy activation.
	// The call is a no-op for `ballPerDrop` here anyway (it assigns the value it just read), so during a
	// buy the seeds below are left as the single writer of the maxima.
	if (
		!stateGame.authoritativeMeterFlow &&
		!stateGame.serverMeterLimitsActive &&
		!stateGame.pendingBuyBonusMode
	) {
		meterController.setBallPerDrop(stateGame.ballPerDrop);
	}
	// Free-spin meter is PER-DROP: always re-seed the HUD to the tier's start + max so the meter UI
	// matches the balls-per-drop tier immediately on switch (independent of the server-authoritative
	// bonus-meter flow). Runs AFTER `setBallPerDrop` so that during a pending buy the resolved tier
	// wins — see `activeMeterTierBalls`.
	seedSpinMeterForCurrentTier();
	// Bonus meter is a PER-TIER SESSION meter: re-seed the HUD to the selected tier's stored value (or
	// its tier base start). Skip during an active bonus round (the HUD shows the in-round level meter).
	if (!stateGame.bonusRoundActive) seedBonusMeterForCurrentTier();
}
