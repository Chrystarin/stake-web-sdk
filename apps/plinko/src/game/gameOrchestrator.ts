import { stateBet, stateI18nDerived } from 'state-shared';

import { isPlinkoReplay } from './plinkoReplay';
import { isPlinkoOffline } from './plinkoConnection';
import { clearBonusProgress, saveBonusProgress } from './plinkoBonusProgress';
import {
	BONUS_HOLD_DROP_INTERVAL_MS,
	BONUS_LEVEL_LABELS,
	FREE_SPIN_SEGMENTS,
	SIM_SPEED,
	bonusLevelBalls,
} from '../game-logic/constants';
import { waitForBonusMeterRenderedFull } from '../features/bonus/bonusMeterVisual';
import { isSpinSlotRateIndex, spinPocketActiveForBallsPerDrop } from '../game-logic/spinSlot';
import { boardMultiplierAtIndex, resolveOutcomeMultiplier } from '../game-logic/boardMultipliers';
import { formatCoefficientLabel, formatHistoryDate, formatHistoryMultiplier } from '../lib/format';
import { meterController } from './stateGame.svelte';
import { stateGame, stateGameDerived, type HistoryChip, type HistoryEntry } from './stateGame.svelte';
import { onCoinPegHit, onSpinSlotLand, triggerRoulette } from './meterFlow';
import { stateXstateDerived } from './stateXstate';
import { bonusMeterTierStart, hasActiveRgsSession } from './plinkoSessionMeters';
import { isPlinkoTriggerMode } from './plinkoBetMode';
import { plinkoBallsPerDrop, plinkoStakePerBall, plinkoWagerAmount } from './plinkoBet';
import { applyRgsRoundWinDisplayFromCurrencyWin } from './rgsRoundWin';
import type { PlinkoBallOutcome } from './typesBookEvent';

const BONUS_LEVEL_ACTIVATION_DELAY_MS = 250;
/** How long the COMPLETED energy bar is held on screen before the level-up card covers it, so the player
 * reads "bar filled → level up" rather than being shown the reward over a bar still on its way up. */
const BONUS_METER_FULL_HOLD_MS = 260;
const BONUS_LEVEL_UP_OVERLAY_DURATION_MS = 1700;
const BONUS_LEVEL_UP_FADE_DURATION_MS = 280;
const BONUS_METER_DRAIN_DELAY_MS = 1700;

/** True while a level-up is filling its bar out / holding it full, before its reward has been awarded. */
let bonusLevelUpRevealInProgress = false;
/** Coin-peg hits that landed while the bar was pinned full for a level-up — see `bankBonusPegDuringLevelUp`. */
let bonusPegsBankedDuringLevelUp = 0;
/** An in-bonus free-spin wheel has been dequeued and is waiting for the level-up card to clear. */
let bonusFreeSpinOpenPending = false;

/**
 * A bonus ball hit a coin peg while the energy bar was pinned full for a level-up. The completed bar
 * can't take it, so bank it for the NEXT level's bar rather than dropping it: the pin lasts as long as
 * the fill-out + hold (a few hundred ms), which is long enough for a held drop-stream to land real hits.
 */
export function bankBonusPegDuringLevelUp() {
	bonusPegsBankedDuringLevelUp += 1;
}

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

/** Bonus (free) balls dropped so far in the active round — persisted so a reload/reconnect resumes
 * from the remaining count (see plinkoBonusProgress). Reset per round; seeded from the resumed count. */
let roundBonusBallsPlayed = 0;

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
	// `bonusRoundActive` covers the post-bonus congratulations screen on its way DOWN (it is only torn
	// down at full cover, in `onBonusEndAnnouncementCovered`). Deliberately NOT gated on
	// `bonusEndAnnouncementOpen` as well: settlement — and with it the RGS balance credit — must land
	// while that screen is still on the player's view, so the balance is already updated behind it rather
	// than jumping some time after they dismiss it.
	if (stateGame.bonusBallsRemaining > 0 || stateGame.bonusRoundActive) return true;
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
		// A level-up is committed but not yet celebrated: no more free balls may leave the funnel until the
		// balls already falling have landed and the energy bar has visibly completed (see
		// `completeBonusMeterThenLevelUp`). Without this the player keeps dropping into a full bar.
		stateGame.bonusLevelUpPending ||
		stateGame.bonusRouletteOpen ||
		isPlayActionBlockedByFreeSpinRoulette() ||
		isPlayActionBlockedByBonusRoulette()
	);
}

/** True when the round is being deterministically replayed (no human input — see Stake replay reqs). */
export function isReplayMode(): boolean {
	return isPlinkoReplay();
}

/**
 * "Rapid" single-ball play: the 1-ball tier lets the player keep clicking Bet so balls keep dropping,
 * with each drop's animation DECOUPLED from round settlement (the round settles as soon as the book is
 * processed, the ball animates independently). Only the plain 1-ball base game qualifies — never a
 * bonus round, a buy-bonus purchase, or replay playback (those keep the serialized, animation-gated
 * flow). The 1-ball tier has no meters / bonus / free spin, so decoupling here is display-only; the
 * balance stays RGS-authoritative and rounds remain sequential server-side.
 */
export function isRapidSingleBallMode(): boolean {
	return (
		plinkoBallsPerDrop() === 1 &&
		!isReplayMode() &&
		!stateGame.bonusRoundActive &&
		!stateGame.pendingBuyBonusMode
	);
}

/**
 * True while the player is on the plain 1-ball tier — which is a FEATURE-FREE mode: it must never
 * trigger a free spin or a bonus, from either the client meter fallback (`onSpinSlotLand` /
 * `onCoinPegHit`, where the 1-ball meter max is tiny) or a served book's feature events. Excludes
 * replay (must reproduce a recorded round faithfully) and buy-bonus (an explicit bonus purchase). No
 * `bonusRoundActive` check on purpose — the whole point is to stop a bonus from ever starting here.
 */
export function isSingleBallMode(): boolean {
	return (
		plinkoBallsPerDrop() === 1 && !isReplayMode() && !stateGame.pendingBuyBonusMode
	);
}

export function isBetControlsLocked(): boolean {
	return (
		// Replay is a passive playback of a recorded round — all wager/bet controls stay locked.
		isReplayMode() ||
		stateGame.isSubmitting ||
		stateGame.dropRoundActive ||
		stateGame.bonusBallsRemaining > 0 ||
		// A bonus level-up is committed and playing out (in-flight balls landing, energy bar completing).
		// On the depletion path `bonusBallsRemaining` is already 0, so without this the betting controls
		// would briefly come back to life in the gap before the level-up card.
		stateGame.bonusLevelUpPending ||
		// The post-bonus congratulations screen is still on the view. The round now settles behind it (so
		// the balance credits before the player dismisses it), which releases the round's own locks — this
		// keeps betting shut until they actually dismiss the screen.
		stateGame.bonusEndAnnouncementOpen ||
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
	// A tier without a free-spin meter (1-ball) has no spin pocket to flag — its center just pays.
	const spinPocketActive = spinPocketActiveForBallsPerDrop(plinkoBallsPerDrop());
	return (outcomes ?? []).map((outcome) => ({
		...outcome,
		amount: outcome.amount * stakeScale,
		hitSpinSlot:
			spinPocketActive &&
			(outcome.hitSpinSlot ??
				(slotCount > 0 && isSpinSlotRateIndex(outcome.rateIndex, slotCount))),
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
	levelupPegs = 0,
) {
	const played = Math.max(0, Math.floor(ballsPlayed || 0));
	// Seed the persisted-progress counter so continued play keeps saving the cumulative count
	// (a resume passes `played` > 0; a fresh entry passes 0).
	roundBonusBallsPlayed = played;
	stateGame.authoritativeBonusOutcomes = normalizeBonusOutcomes(outcomes);
	stateGame.authoritativeBonusOutcomeIndex = played;
	// Size the energy bar to THIS (entry) level's escalating threshold (0 = keep the `bonusMeter` event's
	// flat max, for legacy books).
	if (levelupPegs > 0) stateGame.bonusMeterMax = levelupPegs;
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

/** Queue a book-authored bonus level-up (combined into the pool the instant the energy bar fills). */
export function enqueueAuthoritativeBonusLevel(
	freeBalls: number,
	outcomes: PlinkoBallOutcome[],
	level: number,
	levelupPegs = 0,
) {
	stateGame.authoritativeBonusLevelQueue = [
		...stateGame.authoritativeBonusLevelQueue,
		{
			freeBalls: Math.max(0, Math.floor(freeBalls || 0)),
			outcomes: normalizeBonusOutcomes(outcomes),
			level: Math.max(1, Math.floor(level || 1)),
			// Pegs to leave the level this batch belongs to (escalating) — sizes the bar once combined in.
			levelupPegs: Math.max(0, Math.floor(levelupPegs || 0)),
		},
	];
}

/** True when the entry-level bonus balls (already awarded by the wheel) just need their outcomes. */
export function loadAuthoritativeBonusOutcomes(outcomes: PlinkoBallOutcome[], ballsPlayed = 0) {
	const played = Math.max(0, Math.floor(ballsPlayed || 0));
	roundBonusBallsPlayed = played;
	stateGame.authoritativeBonusOutcomes = normalizeBonusOutcomes(outcomes);
	stateGame.authoritativeBonusOutcomeIndex = played;
	// RESUME: the wheel just re-awarded the FULL entry count; drop the already-played balls so the
	// player continues from the remaining count (fresh play passes 0 → no reduction).
	if (played > 0) {
		stateGame.bonusBallsRemaining = Math.max(0, stateGame.bonusBallsRemaining - played);
	}
}

/**
 * THE ONE WAY a bonus level-up reaches the screen: complete the energy bar first, visibly, then reveal.
 *
 * Every level-up path used to rewrite the meter in a single synchronous block — top `bonusMeterValue` to
 * `bonusMeterMax`, show the reward, re-size `bonusMeterMax` to the next level's (taller) threshold, drain
 * on the next frame. Svelte flushes only the FINAL state of that block, so the "topped to max" step was
 * never rendered at all: the ratio handed to the meter went straight from the part-filled value to
 * `oldMax / newMax`, and the level-up card appeared over a bar sitting at ~2/3. On top of that the fill is
 * ANIMATED (`BONUS_METER_FILL_SPEED_PER_SECOND`, ~556ms for a full sweep), so even a correctly-topped
 * value needs drawing time before it reads as complete.
 *
 * So the sequence is: lock the Play button (`bonusLevelUpPending`) so no further free balls are dropped
 * into a full bar → let the balls already falling LAND → pin the displayed bar full (`bonusMeterHoldFull`,
 * immune to whatever value/max do underneath) and wait for the meter to actually DRAW itself full → hold
 * that for a readable beat → only then run `reveal`. `settleBar` (the new level's threshold + the drain)
 * runs a frame later, in the same tick the pin is released, so the bar goes full → empty in one clean step
 * instead of sliding partway back.
 */
async function completeBonusMeterThenLevelUp(reveal: () => void, settleBar: () => void) {
	// A level-up is committed the moment this starts (its queue entry is already consumed), but on the
	// depletion path its balls are only awarded in `reveal` — so for the length of the fill-out the round
	// looks "finished" (0 balls remaining). Block `settleBonusRoundWhenFinished` for that window or a
	// trailing ball-land could pop the NEXT queued level, or end the bonus outright, mid-celebration.
	bonusLevelUpRevealInProgress = true;
	bonusPegsBankedDuringLevelUp = 0;
	// Locks the bonus Play button (`isBonusPlayButtonDisabled`) — which also pauses a held drop-stream via
	// `canDropBonusBallNow` — for the whole "finish the balls, finish the bar" window below.
	stateGame.bonusLevelUpPending = true;
	try {
		stateGame.bonusMeterHoldFull = true;
		// Keep the logical value in step with the pinned display: the "ready to level up" tile blink and the
		// in-bonus fill guard in `onCoinPegHit` both read `bonusMeterValue >= bonusMeterMax`.
		if (stateGame.bonusMeterMax > 0) stateGame.bonusMeterValue = stateGame.bonusMeterMax;
		const startedAt = Date.now();
		// Play out the balls already in the air first — the level-up card must not cover a board that is
		// still resolving the drop that earned it. (No-op on the depletion path: nothing is left falling.)
		await waitForDropBatchCompletion();
		await waitForBonusMeterRenderedFull();
		// Hold the completed bar on screen. The activation beat is the floor, so a bar that was already near
		// full still gets the same pacing the reward always had.
		const elapsedMs = Date.now() - startedAt;
		await sleep(Math.max(BONUS_METER_FULL_HOLD_MS, BONUS_LEVEL_ACTIVATION_DELAY_MS - elapsedMs));
		if (!stateGame.bonusRoundActive) {
			stateGame.bonusMeterHoldFull = false;
			return;
		}
		reveal();
		requestAnimationFrame(() => {
			settleBar();
			// Hand the new level's bar the pegs banked during the pin (only when it starts from empty —
			// the fallback path can deliberately leave the bar full for a level-up queued behind this one).
			// Capped one short of the threshold: a carry must never COMPLETE the new bar, or the next level
			// would start already-full with nothing left to fill it and no `onCoinPegHit` crossing to trigger.
			if (
				bonusPegsBankedDuringLevelUp > 0 &&
				stateGame.bonusRoundActive &&
				stateGame.bonusMeterValue === 0
			) {
				stateGame.bonusMeterValue = Math.max(
					0,
					Math.min(stateGame.bonusMeterMax - 1, bonusPegsBankedDuringLevelUp),
				);
			}
			bonusPegsBankedDuringLevelUp = 0;
			stateGame.bonusMeterHoldFull = false;
		});
	} finally {
		bonusLevelUpRevealInProgress = false;
		// Hand the Play-button lock over to the level-up card itself (`bonusLevelUpOverlayOpen` keeps it
		// disabled for the card's whole on-screen life), so there is no gap where a drop could slip through.
		stateGame.bonusLevelUpPending = false;
	}
}

/** Pull the next book-authored level off the queue, show the level-up, and award its balls. */
function consumeAuthoritativeBonusLevel(): boolean {
	const next = stateGame.authoritativeBonusLevelQueue[0];
	if (!next) return false;
	stateGame.authoritativeBonusLevelQueue = stateGame.authoritativeBonusLevelQueue.slice(1);
	void applyAuthoritativeBonusLevel(next);
	return true;
}

async function applyAuthoritativeBonusLevel(level: {
	freeBalls: number;
	outcomes: PlinkoBallOutcome[];
	level: number;
	levelupPegs?: number;
}) {
	await waitForDropBatchCompletion();
	if (!stateGame.bonusRoundActive || stateGame.bonusBallsRemaining > 0) return;
	// The +N free balls must only ever be awarded on a FULLY filled progress meter (parity with the
	// session-meter path + the "ready to level up" blink, both gated on a full bar).
	await completeBonusMeterThenLevelUp(
		() => {
			stateGame.bonusLevelProgress = Math.max(stateGame.bonusLevelProgress, level.level);
			showBonusLevelUpOverlay(level.level, level.freeBalls);
			stateGame.authoritativeBonusOutcomes = level.outcomes;
			stateGame.authoritativeBonusOutcomeIndex = 0;
			awardBonusBalls(level.freeBalls);
		},
		() => {
			// Re-size the bar to the new level's escalating threshold (mirrors the mid-drop combine path),
			// then drain so the new, taller bar visibly re-fills from empty as its balls drop.
			if (level.levelupPegs && level.levelupPegs > 0) stateGame.bonusMeterMax = level.levelupPegs;
			if (stateGame.bonusRoundActive) stateGame.bonusMeterValue = 0;
		},
	);
}

/**
 * COMBINE-ON-METER-FULL: the instant the in-bonus energy bar fills (mid-drop), level up RIGHT AWAY and
 * pour the newly-awarded free balls into the balls still waiting to drop — instead of holding the bar
 * full and waiting for the current level's balls to deplete before awarding the next level.
 *
 * The new level's outcomes are APPENDED to the END of the live authoritative stream (never replacing it,
 * and the read index keeps advancing), so the balls already dropped stay consumed and every remaining +
 * newly-awarded ball still lands on its exact book-authored pocket. Because every book ball is still
 * dropped, the settled `finalWin` is byte-for-byte unchanged → EV-exact, RTP untouched.
 *
 * Anchored to the book's `authoritativeBonusLevelQueue` (fully populated up-front from the `bonusRound`
 * events, before any bonus ball drops), so the client can never award more/fewer levels than the book
 * authored: this is a no-op once the queue is exhausted or the ladder top is reached. Returns true if a
 * level was combined in.
 */
export function combineNextBonusLevelNow(): boolean {
	if (!stateGame.bonusRoundActive) return false;
	if (stateGame.bonusLevelProgress >= BONUS_LEVEL_LABELS.length) return false;
	const next = stateGame.authoritativeBonusLevelQueue[0];
	if (!next) return false;
	// The level we're LEAVING (its balls just filled the energy bar) — its book-authored free spin, if
	// any, fires at this level-up moment (below).
	const leavingLevel = stateGame.bonusLevelProgress;
	stateGame.authoritativeBonusLevelQueue = stateGame.authoritativeBonusLevelQueue.slice(1);
	stateGame.bonusLevelProgress = Math.max(stateGame.bonusLevelProgress, next.level);
	// Merge the new level's outcomes onto the END of the live stream — the remaining current-level balls
	// and these new ones now drop as ONE combined pool (the read index is untouched, so nothing replays).
	stateGame.authoritativeBonusOutcomes = [
		...stateGame.authoritativeBonusOutcomes,
		...next.outcomes,
	];
	// Pour the awarded free balls into the still-remaining pool (this is the "combine"). Done NOW, not
	// behind the reveal below, so the pool can never empty during the bar's fill-out and let
	// `settleBonusRoundWhenFinished` end the bonus out from under a level-up that is already committed.
	awardBonusBalls(next.freeBalls);
	// Reaching max is the TRIGGER, not the visual: the fill is animated and can be well behind the value
	// that just tripped it, so hand the celebration to the shared "finish the bar first" step. It reveals
	// the +N reward on a completed bar, then re-sizes to the new level's threshold and drains.
	void completeBonusMeterThenLevelUp(
		() => {
			showBonusLevelUpOverlay(next.level, next.freeBalls);
			// Fire the completed level's in-bonus free spin at THIS level-up moment (the wheel opens once
			// the in-flight balls land — via the roulette flow's pipeline-idle wait — so it naturally
			// follows the level-up card, then pauses the drop until it closes). Book-anchored: fires a
			// queued `freeSpinTrigger` tagged for the level we just left. Any not fired here (the top
			// level's, or one skipped because a wheel was already open) are fired by the depletion
			// catch-all in `settleBonusRoundWhenFinished`. TIMING-ONLY — the same book free spins still
			// each fire exactly once, so RTP is unchanged.
			fireBonusFreeSpinForLevel(leavingLevel);
		},
		() => {
			if (next.levelupPegs && next.levelupPegs > 0) stateGame.bonusMeterMax = next.levelupPegs;
			if (stateGame.bonusRoundActive) stateGame.bonusMeterValue = 0;
		},
	);
	return true;
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
		// EXCEPTION — a bought bonus (trigger mode) has no trigger fill-up: it opens straight on the
		// empty level-1 in-bonus meter, so snapping to full here would flash the bar full → empty on
		// entry. Start it EMPTY instead and let the in-bonus fill take over.
		stateGame.bonusMeterValue = isPlinkoTriggerMode(stateBet.activeBetModeKey)
			? 0
			: stateGame.bonusMeterMax;
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
	// Every awarded free ball (entry round + level-ups) feeds the round's "N Bonus" chip.
	roundBonusBallCount += amount;
	refreshRoundHistoryEntry();
}

export function playOneBonusBall() {
	// Suspend bonus-ball drops while offline — the ball's outcome is already known (pre-fetched book),
	// so it would otherwise animate normally and hide the lost connection until end-round settlement.
	if (isPlinkoOffline()) return;
	if (isBonusPlayButtonDisabled()) return;
	stateGame.bonusBallsRemaining = Math.max(0, stateGame.bonusBallsRemaining - 1);
	// Persist the running played count so a reload/reconnect resumes from the remaining drop count.
	roundBonusBallsPlayed += 1;
	saveBonusProgress(roundBonusBallsPlayed);
	const stake = Math.max(0, Number(stateGame.pendingOutcomes[0]?.amount) || 0);
	stateGame.nextBallSpawnAtMs = Date.now();
	dropRequestHandler?.({ type: 'bonusBall', stake });
	if (stateGame.bonusBallsRemaining <= 0) {
		void settleBonusRoundWhenFinished();
	}
}

let bonusHoldDropTimer: ReturnType<typeof setInterval> | null = null;

/** Cadence of a held free-ball stream, compressed in Fast Game like the board's own spawn spread. */
function bonusHoldDropIntervalMs(): number {
	const speedUp = stateGame.fastGameEnabled ? SIM_SPEED.normal / SIM_SPEED.fast : 1;
	return Math.round(BONUS_HOLD_DROP_INTERVAL_MS * speedUp);
}

/**
 * True while a free ball may leave the funnel right now. The held stream re-checks this every tick
 * instead of stopping, so it PAUSES for a level-up reward / wheel / end-of-level gap and resumes on
 * its own once the next batch of free balls is awarded — the player just keeps holding.
 */
function canDropBonusBallNow(): boolean {
	if (stateGame.bonusLevelUpOverlayOpen || stateGame.bonusEndAnnouncementOpen) return false;
	return !isBonusPlayButtonDisabled();
}

/**
 * BONUS HOLD-TO-DROP. A bonus round drops its free balls one per Play press; holding Play instead
 * streams them out continuously (first ball on press, then one every `bonusHoldDropIntervalMs`)
 * until `stopBonusBallHoldDrop`. Wired to both HUD play buttons (pointer) and the Space hotkey.
 *
 * The stream only ever drops BONUS balls — it calls `playOneBonusBall` directly rather than the
 * shared play action, so running out of free balls mid-hold can never fall through to a real wager.
 *
 * Safe to call while already streaming: `OnHotkey` fires `onhold` twice, and a pointer press can
 * overlap it.
 */
export function startBonusBallHoldDrop(): void {
	if (bonusHoldDropTimer !== null) return;
	if (isReplayMode() || !stateGameDerived.hasPendingBonusBalls) return;
	if (canDropBonusBallNow()) playOneBonusBall();
	bonusHoldDropTimer = setInterval(() => {
		// Bonus fully played out — nothing left to stream, so don't leave a timer idling behind a
		// hold the player may never "release" (e.g. the button went `disabled` under their finger).
		if (!stateGame.bonusRoundActive) {
			stopBonusBallHoldDrop();
			return;
		}
		if (canDropBonusBallNow()) playOneBonusBall();
	}, bonusHoldDropIntervalMs());
}

/** Idempotent — every path that can end a hold calls this, and several can fire for one release. */
export function stopBonusBallHoldDrop(): void {
	if (bonusHoldDropTimer === null) return;
	clearInterval(bonusHoldDropTimer);
	bonusHoldDropTimer = null;
}

/**
 * REPLAY DRIVER — one step. In Stake's deterministic replay there is no player to click, but this
 * Plinko's bonus round drops its free balls on player Play presses. So during replay we auto-drop the
 * next pending bonus ball on a fixed cadence (`REPLAY_TICK_MS`), streaming them out rather than waiting
 * for each ball to fully land — this mirrors the live hold-to-drop stream and keeps a multi-ball bonus
 * from crawling. Everything else self-resolves: the bonus wheel via `BonusRoulette`'s `autoDismiss`
 * prop, the free-spin wheel auto-finishes, and the bonus-end announcement auto-dismisses. No-op
 * outside replay.
 */
export function tickReplayBonusBalls(): void {
	if (!isReplayMode()) return;
	if (!stateGame.bonusRoundActive || stateGame.bonusBallsRemaining <= 0) return;
	if (stateGame.bonusRouletteOpen || stateGame.freeSpinRouletteOpen) return;
	if (stateGame.bonusEndAnnouncementOpen) return;
	// Pause the stream (don't stop it) while a level-up reward is on screen — awarded balls resume the
	// stream on the next tick, exactly like the live hold-to-drop stream.
	if (stateGame.bonusLevelUpOverlayOpen) return;
	// NOTE: intentionally no `isGameOngoing()` idle guard — we stream one ball per tick regardless of
	// whether the prior ball has landed. `playOneBonusBall` applies its own `isBonusPlayButtonDisabled`
	// guard (roulette / no pending balls).
	playOneBonusBall();
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
	void applyBonusLevelUpWhenPipelineIdle(nextLevel, addedBalls);
	return true;
}

async function applyBonusLevelUpWhenPipelineIdle(nextLevel: number, addedBalls: number) {
	await waitForDropBatchCompletion();
	if (!stateGame.bonusRoundActive || stateGame.bonusBallsRemaining > 0) return;
	// Match the authoritative path: the +N reward never appears before the meter is visibly full.
	await completeBonusMeterThenLevelUp(
		() => {
			stateGame.bonusLevelProgress = Math.max(stateGame.bonusLevelProgress, nextLevel);
			showBonusLevelUpOverlay(nextLevel, addedBalls);
			awardBonusBalls(addedBalls);
		},
		() => {
			// Another level-up is already queued behind this one — leave the bar full for it rather than
			// draining and immediately re-filling. Otherwise hand the next level whatever overflowed.
			if (stateGame.pendingBonusLevelUpCount + stateGame.deferredBonusLevelUpCount > 0) {
				stateGame.bonusMeterValue = stateGame.bonusMeterMax;
				return;
			}
			const safeMax = stateGame.bonusMeterMax || 20;
			stateGame.bonusMeterValue = Math.max(
				0,
				Math.min(safeMax, stateGame.bonusMeterOverflowValue),
			);
		},
	);
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

/**
 * Resolves once the level-up card has finished its whole on-screen life — reveal, hold, fade-out — and is
 * fully hidden (`bonusLevelUpOverlayOpen` false). Used to keep the in-bonus free-spin wheel from sliding
 * down over a card that is still showing. The wall-clock cap is a safety net only.
 */
function waitForBonusLevelUpOverlayClosed(maxMs = 6000): Promise<void> {
	return new Promise((resolve) => {
		if (!stateGame.bonusLevelUpOverlayOpen) {
			resolve();
			return;
		}
		let settled = false;
		const finish = () => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			resolve();
		};
		// setTimeout rather than a deadline inside the rAF loop: rAF stops in a backgrounded tab, but the
		// overlay's own hide timers keep running, so the wheel must still be able to open.
		const timer = setTimeout(finish, maxMs);
		const check = () => {
			if (settled) return;
			if (!stateGame.bonusLevelUpOverlayOpen) finish();
			else requestAnimationFrame(check);
		};
		requestAnimationFrame(check);
	});
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

/**
 * Open the in-bonus free-spin wheel for `entry` (a queued `freeSpinTrigger` payload). The wheel lands
 * on the math-authored segment; its `stake × M` is added to the bonus total when the wheel LANDS
 * (`onFreeSpinRouletteFinished` → additive credit). After it closes, that handler re-invokes this
 * settler so the round continues (next level-up) or ends.
 */
function beginInBonusFreeSpin(entry: {
	level: number;
	segment?: string;
	multiplier?: number;
	amount?: number;
}) {
	// Kept for the additive win credit (multiplier) applied when the wheel lands.
	stateGame.pendingBonusFreeSpinPayload = entry;
	if (entry.segment) {
		stateGame.serverFreeSpinSegmentLabel = entry.segment;
		const idx = FREE_SPIN_SEGMENTS.indexOf(entry.segment as (typeof FREE_SPIN_SEGMENTS)[number]);
		stateGame.serverFreeSpinSegment = idx >= 0 ? idx : 0;
	}
	// Blocking flag stays true while any in-bonus free spin is still queued (the active wheel itself is
	// covered by `freeSpinRouletteOpen`); it clears once the queue drains.
	stateGame.pendingSpinRouletteAfterBonusLevelDepletion = stateGame.pendingBonusFreeSpins.length > 0;
	// The wheel must never slide down over a level-up card that is still on screen: wait for that card to
	// finish showing and be fully hidden first. No-op when no card is up (the depletion / end-of-round
	// paths), so those wheels still open immediately.
	bonusFreeSpinOpenPending = true;
	void waitForBonusLevelUpOverlayClosed().then(() => {
		bonusFreeSpinOpenPending = false;
		triggerRoulette('spin');
	});
}

/**
 * Fire the in-bonus free spin queued for a level we have ALREADY reached (`fs.level <= progress`), if
 * any — this runs at the end of that level's balls, BEFORE its level-up. Returns true if a wheel opened.
 */
function fireBonusFreeSpinForReachedLevel(): boolean {
	// A wheel is already on its way (waiting out a level-up card). Report it as handled so the settler
	// stops here instead of dequeuing a second spin or ending the round behind its back.
	if (bonusFreeSpinOpenPending) return true;
	const queue = stateGame.pendingBonusFreeSpins;
	const index = queue.findIndex((fs) => fs.level <= stateGame.bonusLevelProgress);
	if (index < 0) return false;
	const entry = queue[index];
	stateGame.pendingBonusFreeSpins = [...queue.slice(0, index), ...queue.slice(index + 1)];
	beginInBonusFreeSpin(entry);
	return true;
}

/**
 * Fire the in-bonus free spin queued for a level we've completed (`fs.level <= level`) — called at the
 * combine-level-up moment so each level's free spin fires as that level levels up, not batched at the
 * end. No-op while a wheel is already open (the combine's own re-entrancy / an in-flight-ball level-up):
 * the still-queued spin is picked up by the next combine or the depletion catch-all, so it's never lost.
 */
function fireBonusFreeSpinForLevel(level: number): boolean {
	if (stateGame.rouletteFlowInProgress || bonusFreeSpinOpenPending) return false;
	const queue = stateGame.pendingBonusFreeSpins;
	const index = queue.findIndex((fs) => fs.level <= level);
	if (index < 0) return false;
	const entry = queue[index];
	stateGame.pendingBonusFreeSpins = [...queue.slice(0, index), ...queue.slice(index + 1)];
	beginInBonusFreeSpin(entry);
	return true;
}

/**
 * Safety net after all level-ups: fire any free spin still queued (e.g. tagged for a level beyond the
 * one the round actually ended on) or the untagged session-meter fallback. Returns true if a wheel opened.
 */
function fireRemainingBonusFreeSpin(): boolean {
	// Same as `fireBonusFreeSpinForReachedLevel`: a deferred open counts as handled.
	if (bonusFreeSpinOpenPending) return true;
	if (stateGame.pendingBonusFreeSpins.length > 0) {
		const [entry, ...rest] = stateGame.pendingBonusFreeSpins;
		stateGame.pendingBonusFreeSpins = rest;
		beginInBonusFreeSpin(entry);
		return true;
	}
	// Session-meter fallback (no per-level tag): fire once using the stashed payload if present.
	if (stateGame.pendingSpinRouletteAfterBonusLevelDepletion) {
		const entry = stateGame.pendingBonusFreeSpinPayload;
		stateGame.pendingSpinRouletteAfterBonusLevelDepletion = false;
		if (entry) beginInBonusFreeSpin({ level: stateGame.bonusLevelProgress, ...entry });
		else triggerRoulette('spin');
		return true;
	}
	return false;
}

export async function settleBonusRoundWhenFinished() {
	if (stateGame.bonusRoundSettlementInProgress) return;
	// A level-up is mid-reveal (bar filling out / held full): its balls land when the reward does.
	if (bonusLevelUpRevealInProgress) return;
	// The round already ended and its total-win screen is up. The bonus state is only torn down when that
	// screen covers the view, so `bonusRoundActive` is still true meanwhile — without this guard a late
	// re-entry (e.g. a trailing `onBallLanded`) would fall through and re-run the end branch.
	if (stateGame.bonusEndAnnouncementOpen) return;
	stateGame.bonusRoundSettlementInProgress = true;
	try {
		await waitForDropBatchCompletion();
		flushDeferredBonusLevelUp();
		// (1) IN-BONUS FREE SPIN fires at the END of each level whose spin meter filled, BEFORE that
		// level's level-up. The book tags each `freeSpinTrigger` with its `level`; we fire the one for a
		// level we've already reached first, so "level balls finish → free spin → level up" reads right.
		if (stateGame.bonusBallsRemaining <= 0 && fireBonusFreeSpinForReachedLevel()) {
			return;
		}
		// (2) Then the book-authored level-up (or the client session-meter fallback level-up).
		if (stateGame.bonusBallsRemaining <= 0 && consumeAuthoritativeBonusLevel()) {
			return;
		}
		if (stateGame.bonusBallsRemaining <= 0 && consumePendingBonusLevelUp()) {
			return;
		}
		// (3) Any free spin still queued (higher-level leftover) or the untagged fallback fires last.
		if (stateGame.bonusBallsRemaining <= 0 && fireRemainingBonusFreeSpin()) {
			return;
		}
		if (stateGame.bonusBallsRemaining <= 0) {
			stateGame.bonusEndWinAmount = Math.max(0, getCombinedRoundWinAmount());
			// Bonus play is finished: fold its total into the round's single history row (the "N Bonus"
			// chip + the running round win) before the bonus state resets.
			refreshRoundHistoryEntry();
			// Open the total-win treasure screen, but DON'T tear the bonus look down yet: that screen
			// slides down over a second, and resetting here made the game visibly revert to the base art
			// (background, level arch, HUD) in front of the player while it was still on its way. The
			// reset now runs from `onBonusEndAnnouncementCovered`, once the screen hides the whole view —
			// the mirror image of how the ENTRY congratulations screen switches bonus mode ON.
			stateGame.bonusEndAnnouncementOpen = true;
		}
	} finally {
		stateGame.bonusRoundSettlementInProgress = false;
	}
}

export function resetBonusRoundVisualState() {
	// Bonus fully played out — drop the persisted progress so a later reload doesn't try to resume it.
	roundBonusBallsPlayed = 0;
	clearBonusProgress();
	stateGame.bonusRoundActive = false;
	stateGame.bonusLevelProgress = 0;
	// Drop any level-up's full-bar pin / Play lock — the meter is going back to its base-game reading.
	stateGame.bonusMeterHoldFull = false;
	stateGame.bonusLevelUpPending = false;
	bonusFreeSpinOpenPending = false;
	// Bonus consumed: reset to the tier base start (0 on 1/10-ball, 1/8 on 20-ball, 1/4 on 50-ball).
	stateGame.bonusMeterValue = Math.min(bonusMeterTierStart(), stateGame.bonusMeterMax || bonusMeterTierStart());
	stateGame.bonusMeterOverflowValue = 0;
	stateGame.pendingBonusLevelUpCount = 0;
	stateGame.deferredBonusLevelUpCount = 0;
	stateGame.pendingSpinRouletteAfterBonusLevelDepletion = false;
	stateGame.pendingBonusFreeSpins = [];
	stateGame.pendingBonusFreeSpinPayload = undefined;
	stateGame.bonusSessionWinAmount = 0;
	stateGame.inBonusFreeSpinCreditTotal = 0;
	stateGame.authoritativeBonusOutcomes = [];
	stateGame.authoritativeBonusOutcomeIndex = 0;
	stateGame.authoritativeBonusLevelQueue = [];
}

/** The bonus-end treasure screen now hides the whole view — drop the bonus look behind it. */
export function onBonusEndAnnouncementCovered() {
	resetBonusRoundVisualState();
}

export function onBonusEndAnnouncementClosed() {
	// Safety net: the reset normally runs at full cover (above). If that screen was ever torn down before
	// it got there, run it here so the game can't be left dressed as a bonus round with no bonus left.
	// `resetBonusRoundVisualState` is idempotent, so the normal path just re-applies the same values.
	resetBonusRoundVisualState();
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
	// Translate at this single chokepoint so every toast follows the URL `lang`. Known catalog
	// keys are localized; dynamic/interpolated messages have no key and pass through unchanged.
	const text = stateI18nDerived.translate(message);
	stateGame.toastMessage = text;
	stateGame.toastType = type;
	setTimeout(() => {
		if (stateGame.toastMessage === text) stateGame.toastMessage = '';
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

/** Per-ball win/history/balance held back until the ball lands (rapid 1-ball mode). */
type RapidLandCredit = { win: number; multiplier: number; entry: HistoryEntry | undefined };
const outcomeLandCredit = new WeakMap<PlinkoBallOutcome, RapidLandCredit>();

/**
 * Rapid 1-ball mode settles a round WHILE its ball is still falling. The player wants the Win field and
 * Balance to update WHEN the ball drops into a slot, not on click — so instead of applying the win at
 * settle, we stash it against the in-flight ball (`onBallLanded` reveals it on land). The win stays
 * RGS-authoritative (`finalWin` passes its settled amount); balance stays authoritative too but its
 * VISIBLE value is held at the post-wager figure via `rapidBalanceShadow` until the ball lands.
 */
export function deferRapidSingleBallSettlement(
	outcome: PlinkoBallOutcome | undefined,
	currencyWin: number,
) {
	const win = Math.max(0, Number(currencyWin) || 0);
	// Anchor the visible balance on the first pending bet of a burst to the current (post-wager,
	// pre-win) authoritative balance; mirror each additional overlapping bet's wager into the shadow.
	// The held-back win is then revealed one ball at a time as they land.
	if (stateGame.rapidBalanceShadow === null) {
		stateGame.rapidBalanceShadow = stateBet.balanceAmount;
	} else {
		stateGame.rapidBalanceShadow -= plinkoWagerAmount();
	}
	const coeffs = stateGame.coefficients.length > 0 ? stateGame.coefficients : [];
	const multiplier = outcome ? resolveOutcomeMultiplier(outcome, coeffs) : 0;
	if (!outcome) {
		// No ball to reveal on (shouldn't happen for a paying round) — reveal immediately.
		stateGame.winAmount = win;
		if (stateGame.rapidBalanceShadow !== null) stateGame.rapidBalanceShadow += win;
		return;
	}
	outcomeLandCredit.set(outcome, { win, multiplier, entry: stateGame.history[0] });
}

/** Revert the held-back balance to the authoritative value once no rapid ball is in flight. */
function maybeReleaseRapidBalanceShadow() {
	if (stateGame.rapidBalanceShadow === null) return;
	if (isDropBatchPending() || stateGame.isSubmitting || stateGame.dropRoundActive) return;
	stateGame.rapidBalanceShadow = null;
}

/** 1-ball rapid tier: each paying drop pops a small shine-ray sparkle with the win value + tier label
 * printed over it, at the skull's mouth. It floats slowly upward across its lifetime then shrinks +
 * fades away. Capped to 3; a mode switch clears them via `clearRapidWinSparkles`. The art + animations
 * live in RapidWinSparkles.svelte. */
const RAPID_WIN_SPARKLE_MAX = 3;
const RAPID_WIN_SPARKLE_TTL_MS = 1500;
let rapidWinSparkleSeq = 0;
const rapidWinSparkleTimers = new Map<number, ReturnType<typeof setTimeout>>();

function forgetRapidWinSparkleTimer(id: number) {
	const timer = rapidWinSparkleTimers.get(id);
	if (timer) clearTimeout(timer);
	rapidWinSparkleTimers.delete(id);
}

function dismissRapidWinSparkle(id: number) {
	forgetRapidWinSparkleTimer(id);
	const removed = stateGame.rapidWinSparkles.find((s) => s.id === id);
	const removedIdx = removed?.stackIndex ?? -1;
	// Drop the dismissed sparkle and slide every sparkle that was ABOVE it down by one slot — so an
	// older (higher) sparkle disappearing pulls the newer stack down, and no gaps open up between slots.
	stateGame.rapidWinSparkles = stateGame.rapidWinSparkles
		.filter((s) => s.id !== id)
		.map((s) => (removedIdx >= 0 && s.stackIndex > removedIdx ? { ...s, stackIndex: s.stackIndex - 1 } : s));
}

export function pushRapidWinSparkle(amount: number, multiplier: number) {
	const id = ++rapidWinSparkleSeq;
	const mult = Number(multiplier) || 0;
	// Newest always sits at the mouth (slot 0); every existing sparkle's stackIndex increments so the
	// column stays tightly packed newest-at-bottom / oldest-at-top. This is what keeps them from
	// overlapping when several wins land in quick succession.
	const bumped = stateGame.rapidWinSparkles.map((s) => ({ ...s, stackIndex: s.stackIndex + 1 }));
	const sparkle = { id, amount, multiplier: mult, stackIndex: 0 };
	let next = [sparkle, ...bumped];
	// Cap at 3. The oldest (tail) entries are dropped — they still play their shrink+fade (the keyed
	// each in RapidWinSparkles animates any removed sparkle) — and we cancel their pending time-up timers.
	if (next.length > RAPID_WIN_SPARKLE_MAX) {
		next.slice(RAPID_WIN_SPARKLE_MAX).forEach((s) => forgetRapidWinSparkleTimer(s.id));
		next = next.slice(0, RAPID_WIN_SPARKLE_MAX);
	}
	stateGame.rapidWinSparkles = next;
	rapidWinSparkleTimers.set(id, setTimeout(() => dismissRapidWinSparkle(id), RAPID_WIN_SPARKLE_TTL_MS));
}

export function clearRapidWinSparkles() {
	rapidWinSparkleTimers.forEach((timer) => clearTimeout(timer));
	rapidWinSparkleTimers.clear();
	if (stateGame.rapidWinSparkles.length > 0) stateGame.rapidWinSparkles = [];
}

/** 1-ball rapid tier: how many coins the small on-land burst throws, scaled by the landed multiplier
 * (1 for low pays, 2 for mid, 3 for the big multipliers). */
export function rapidCoinBurstCountForMultiplier(multiplier: number): number {
	const m = Number(multiplier) || 0;
	if (m >= 10) return 3;
	if (m >= 2) return 2;
	return 1;
}

export function onBallLanded(
	ballId: number,
	multiplier: number,
	_isSpinSlotFromEngine: boolean,
	slotIndex = -1,
) {
	const pending = takeExpectedOutcome(ballId);
	const slotCount = stateGame.coefficients.length;
	// No free-spin meter on this tier (1-ball) ⇒ no spin pocket: the center is an ordinary paying slot.
	const spinPocketActive = spinPocketActiveForBallsPerDrop(plinkoBallsPerDrop());
	const isSpinSlot =
		spinPocketActive &&
		(pending
			? stateGame.authoritativeMeterFlow
				? pending.hitSpinSlot === true
				: (pending.hitSpinSlot ??
					(slotCount > 0 && isSpinSlotRateIndex(pending.rateIndex, slotCount)))
			: _isSpinSlotFromEngine);

	// Server bonus peg: credit when the ball hits the peg (path emit) or on land as failsafe.
	if (pending?.hitBonusPeg === true) {
		onCoinPegHit(ballId);
	}

	const coeffs =
		stateGame.coefficients.length > 0 ? stateGame.coefficients : [];
	const resolvedMultiplier = pending
		? resolveOutcomeMultiplier(pending, coeffs)
		: coeffs.length > 0 && slotIndex >= 0
			? boardMultiplierAtIndex(slotIndex, coeffs)
			: multiplier;

	// Rapid 1-ball mode deferred this drop's win to ball-land (the round settled while the ball fell).
	// Now that it has landed, REVEAL its win in the Win field, its own history row, and release the
	// held-back balance — this is what makes the Win value + Balance update when the ball drops into a
	// slot, then again when the next ball lands.
	const landCredit = pending ? outcomeLandCredit.get(pending) : undefined;
	if (landCredit) {
		outcomeLandCredit.delete(pending!);
		stateGame.winAmount = landCredit.win;
		if (landCredit.entry) {
			landCredit.entry.win = landCredit.win;
			const rounded = Math.round(landCredit.multiplier * 100) / 100;
			landCredit.entry.chips = [
				{ label: formatHistoryMultiplier(rounded), color: BASE_HISTORY_COLOR },
			];
		}
		if (stateGame.rapidBalanceShadow !== null) {
			stateGame.rapidBalanceShadow += landCredit.win;
		}
		// Rapid 1-ball tier pops a small win sparkle (max 3) around the skull + hat, revealed as the
		// ball lands rather than on the settling click — see RapidWinSparkles.svelte.
		if (landCredit.win > 0) {
			pushRapidWinSparkle(landCredit.win, landCredit.multiplier);
				// Also throw a SMALL coin burst (1-3 coins, scaled by the landed multiplier) into the
				// balance coin — the 1-ball equivalent of the multi-ball win fountain. CoinFountain
				// watches `rapidCoinBurstTick`.
				stateGame.rapidCoinBurstCount = rapidCoinBurstCountForMultiplier(landCredit.multiplier);
				stateGame.rapidCoinBurstTick++;
		}
	} else {
		if (pending && !isSpinSlot && !stateGame.plinkoDropStratumMismatch) {
			addSettledWinAmount(pending.amount * resolvedMultiplier);
		}
		// History is ONE row per round, not per ball. Each base-drop ball's pocket multiplier accumulates
		// into the round's base-game total chip; bonus-round balls are covered by the "N Bonus" chip
		// instead (`awardBonusBalls`). Spin-slot lands pay nothing (they fill the meter), so they add 0×.
		if (!stateGame.bonusRoundActive && !isSpinSlot) {
			roundBaseMultiplierTotal += resolvedMultiplier;
		}
		refreshRoundHistoryEntry();
	}
	if (pending && isSpinSlot) {
		onSpinSlotLand(ballId);
	}
	// Once the last rapid ball has landed, drop the shadow so the HUD tracks the authoritative balance.
	maybeReleaseRapidBalanceShadow();
	if (!stateGame.bonusBallsRemaining && stateGame.bonusRoundActive && !isGameOngoing()) {
		void settleBonusRoundWhenFinished();
	}
}

// ── My Bet History — ONE consolidated row per round ──────────────────────────
// Fixed accents per chip type (NOT keyed to the multiplier value): blue = base game,
// orange = bonus, green = free spin.
const BASE_HISTORY_COLOR = '#3B82F6';
const BONUS_HISTORY_COLOR = '#F97316';
const FREE_SPIN_HISTORY_COLOR = '#22C55E';

/** Sum of base-game per-ball pocket multipliers for the active round. */
let roundBaseMultiplierTotal = 0;
/** Total bonus (free) balls awarded across the active round (entry + level-ups). */
let roundBonusBallCount = 0;
/** Free-spin wheel multipliers won during the active round (one "Free Spin xN" chip each). */
let roundFreeSpinMultipliers: number[] = [];
/** True once `beginRoundHistory` has created the active round's row at `history[0]`. */
let roundHistoryActive = false;

/** Build the round's multiplier chips: base-game total, optional "N Bonus", and "Free Spin xN"s. */
function buildRoundHistoryChips(): HistoryChip[] {
	const baseTotal = Math.round(roundBaseMultiplierTotal * 100) / 100;
	const chips: HistoryChip[] = [
		{ label: formatHistoryMultiplier(baseTotal), color: BASE_HISTORY_COLOR },
	];
	if (roundBonusBallCount > 0) {
		chips.push({ label: `${roundBonusBallCount} Bonus`, color: BONUS_HISTORY_COLOR });
	}
	for (const multiplier of roundFreeSpinMultipliers) {
		chips.push({
			label: `Free Spin x${formatCoefficientLabel(multiplier)}`,
			color: FREE_SPIN_HISTORY_COLOR,
		});
	}
	return chips;
}

/** Push the current win + chips onto the active round's row. No-op before the round starts. */
export function refreshRoundHistoryEntry() {
	if (!roundHistoryActive) return;
	const entry = stateGame.history[0];
	if (!entry) return;
	entry.win = Math.max(0, Number(stateGame.winAmount) || 0);
	entry.chips = buildRoundHistoryChips();
}

/**
 * Start a new round's My Bet History row. Records ONE row per round (not per ball): the base-game
 * total multiplier, plus a "N Bonus" chip and a "Free Spin xN" chip per feature, with the round's
 * total win (base + bonus + free spin). The row updates live as the round resolves. Called once per
 * round from `playBet`.
 */
export function beginRoundHistory() {
	roundBaseMultiplierTotal = 0;
	roundBonusBallCount = 0;
	// Reset the per-round bonus played counter; a resume re-seeds it from the book's `ballsPlayed`
	// (via startAuthoritativeBonusRound / loadAuthoritativeBonusOutcomes) once its bonusRound replays.
	roundBonusBallsPlayed = 0;
	roundFreeSpinMultipliers = [];
	roundHistoryActive = true;
	stateGame.history.unshift({
		date: formatHistoryDate(new Date()),
		bet: plinkoWagerAmount(),
		betPerBall: plinkoStakePerBall(),
		ballPerDrop: plinkoBallsPerDrop(),
		win: 0,
		chips: buildRoundHistoryChips(),
	});
}

/** Record a free-spin wheel multiplier as its own "Free Spin xN" chip on the round row. */
export function recordFreeSpinWinHistory(multiplier: number) {
	if (!(multiplier > 0)) return;
	roundFreeSpinMultipliers = [...roundFreeSpinMultipliers, multiplier];
	refreshRoundHistoryEntry();
}

/**
 * True while a round is still in progress. Critically this includes the xstate `bet` machine
 * settling (deferred `/wallet/end-round` runs inside that state), so autobet does not place the
 * next bet until the RGS round is fully closed — otherwise the next `BET` collides with the
 * still-active round and is dropped, soft-locking the game. `isPlaying()` is idle in dev-local
 * play (the actor is bypassed), so flag checks still cover that path.
 *
 * Also holds while the full-screen win celebration (`showWinPopup`) is still playing. The next
 * drop's `plinkoDrop` handler clears `showWinPopup`, so without this the next auto-bet would tear
 * the banner + payout count-up down mid-animation. This is what was breaking in Fast Mode: the
 * compressed drop settles the round almost immediately, so the ~WIN_CELEBRATION_TOTAL_MS reveal
 * never got to finish before the next ball dropped. (In normal speed the slower drop happened to
 * mask it.) Gating here lets the presentation play out; the celebration auto-dismisses itself.
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
		stateGame.showWinPopup ||
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

export function onMainPlayClick(onRegularBet: () => void) {
	// Replay drives itself (see `runReplayBonusBallDrops`); ignore any human Play input.
	if (isReplayMode()) return;
	// Offline: gameplay is suspended behind the "No Internet Connection" overlay.
	if (isPlinkoOffline()) return;
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
