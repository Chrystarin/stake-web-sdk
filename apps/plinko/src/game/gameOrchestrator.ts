import { stateBet, stateI18nDerived } from 'state-shared';

import { isPlinkoReplay } from './plinkoReplay';
import { isPlinkoOffline } from './plinkoConnection';
import { clearBonusProgress, saveBonusProgress } from './plinkoBonusProgress';
import {
	BONUS_HOLD_ACTIVATION_DELAY_MS,
	BONUS_HOLD_DROP_INTERVAL_MS,
	BONUS_LEVEL_LABELS,
	BONUS_STREAM_DENSIFY_ABOVE_BALLS,
	BONUS_STREAM_MAX_BALLS_PER_SECOND,
	BONUS_STREAM_TARGET_TICKS,
	FREE_SPIN_SEGMENTS,
	IN_BONUS_SPIN_BANK_DRAIN_BUDGET_MS,
	IN_BONUS_SPIN_BANK_RESET_READ_MS,
	SIM_SPEED,
	bonusLevelBalls,
	bonusLevelupPegs,
} from '../game-logic/constants';
import { waitForBonusMeterRenderedFull } from '../features/bonus/bonusMeterVisual';
import { isSpinSlotRateIndex, spinPocketActiveForBallsPerDrop } from '../game-logic/spinSlot';
import { boardMultiplierAtIndex, resolveOutcomeMultiplier } from '../game-logic/boardMultipliers';
import { formatCoefficientLabel, formatHistoryDate, formatHistoryMultiplier } from '../lib/format';
import { meterController } from './stateGame.svelte';
import { stateGame, stateGameDerived, type HistoryChip, type HistoryEntry } from './stateGame.svelte';
import { onCoinPegHit, onSpinSlotLand, triggerRoulette } from './meterFlow';
import { traceBonusMeterWrite } from './plinkoMeterTrace';
import { stateXstateDerived } from './stateXstate';
import {
	activeMeterTierBalls,
	bonusMeterTierStart,
	hasActiveRgsSession,
	updateRgsSessionBonusMeter,
} from './plinkoSessionMeters';
import { isPlinkoTriggerMode } from './plinkoBetMode';
import {
	canAffordPlinkoWager,
	plinkoBallsPerDrop,
	plinkoStakePerBall,
	plinkoWagerAmount,
} from './plinkoBet';
import { applyRgsRoundWinDisplayFromCurrencyWin } from './rgsRoundWin';
import { applyAuthoritativeSpinMeterMax } from './plinkoMeterConfig';
import type { PlinkoBallOutcome } from './typesBookEvent';

const BONUS_LEVEL_ACTIVATION_DELAY_MS = 250;
/** How long the COMPLETED energy bar is held on screen before the level-up card covers it, so the player
 * reads "bar filled → level up" rather than being shown the reward over a bar still on its way up. */
const BONUS_METER_FULL_HOLD_MS = 260;
const BONUS_LEVEL_UP_OVERLAY_DURATION_MS = 1700;
const BONUS_LEVEL_UP_FADE_DURATION_MS = 280;
const BONUS_METER_DRAIN_DELAY_MS = 1700;
/** How long after a level-up the full-bar pin is force-released if its own frame callback never ran. */
const BONUS_METER_PIN_FAILSAFE_MS = 2000;

/** True while a level-up is filling its bar out / holding it full, before its reward has been awarded. */
let bonusLevelUpRevealInProgress = false;
/** Coin-peg hits that landed while the bar was pinned full for a level-up — see `bankBonusPegDuringLevelUp`. */
let bonusPegsBankedDuringLevelUp = 0;
/** An in-bonus free-spin wheel has been dequeued and is waiting for the level-up card to clear. */
let bonusFreeSpinOpenPending = false;

/**
 * ── IN-BONUS FREE-SPIN METER: BOOK-DRIVEN, PER BATCH ────────────────────────────────────────────
 *
 * The bar used to be a free-running client counter (one bump per spin-pocket land, capped at max,
 * reset only when a wheel CLOSED) while the wheel itself was fired from the book's
 * `freeSpinTrigger.level` tag at a bonus LEVEL BOUNDARY. Nothing kept the two in step, and QA saw
 * exactly what that implies:
 *   • the bar completed mid-level and then sat there — the wheel was waiting for a level-up, which
 *     the combine can push a long way out (or which never comes);
 *   • the bar completed on a level whose book carried no trigger at all — no wheel, ever;
 *   • the math fired TWICE (its counter resets per fire, the client's did not, so the pinned-full bar
 *     swallowed the second fill invisibly) and two wheels ran off one visible fill.
 *
 * The book now publishes the meter: `bonusRound.spinMeterStart` is the carry INTO that batch, the
 * math clamps the fill at `spinMeterMax` and fires the instant it completes, and at most one free
 * spin exists per batch (see the one-per-batch note in `simulate_bonus_round` — that ceiling is what
 * keeps this EV-exact). Reproducing that here needs one thing the outcome list alone can't give:
 * which BATCH a landing ball belongs to, because `combineNextBonusLevelNow` merges the next level's
 * balls onto the end of the live pool and they drop interleaved with the leftovers of the last one.
 * So each outcome is stamped with its batch as it is handed out, and the bar re-seats when a landing
 * ball reports a batch we haven't seen yet.
 */
const bonusOutcomeBatchOrdinal = new WeakMap<PlinkoBallOutcome, number>();
/**
 * Per-batch spin-meter carry-in, indexed by batch ordinal (book `bonusRound.spinMeterStart`).
 *
 * `undefined` = a LEGACY book that predates the field. Those must NOT be re-seated per batch: the old
 * math ran the same running counter but only ever published its trigger, so the carry into a batch is
 * simply wherever the previous batch left the bar. Zeroing it instead would strand any free spin the
 * book earned across two batches (measured: 6 of 1767 on the currently published library), so the
 * legacy path deliberately carries and only the lock is re-armed.
 */
let bonusSpinBatchStarts: (number | undefined)[] = [];
/**
 * Per-batch spin-meter MAX (book `bonusRound.spinMeterMax`), parallel to `bonusSpinBatchStarts`.
 *
 * The math sizes this bar from the round's ball supply at that batch's LEVEL
 * (`in_bonus_spin_meter_max_at_level`), so unlike before it GROWS as the round climbs — a nine-level
 * climb runs 3 → 536 on the 10-ball entry. It is kept per batch rather than applied when the event is
 * read because EVERY `bonusRound` of the round is read before the first bonus ball leaves the funnel:
 * applying it at read time would leave the whole round measured against the DEEPEST level's bar and the
 * level-1 balls unable to fill it. `applyBonusSpinBatch` applies it as each batch becomes current.
 *
 * `undefined` on a legacy book (one fixed bar per round) → leave the running max alone.
 */
let bonusSpinBatchMaxes: (number | undefined)[] = [];
/** Batch ordinal the LANDED balls are currently in (-1 before the first bonus ball lands). */
let bonusSpinBatchLanded = -1;
/**
 * LEGACY BOOKS ONLY: this batch has already fired, so its remaining spin hits are dropped.
 *
 * A book that predates `spinMeterStart` was authored under the old rule — at most ONE in-bonus free spin
 * per `bonusRound`, with the batch's surplus centre-pocket hits thrown away. The current rule fires on
 * every refill, and running it against those books completes the bar 4x more often than they carry
 * triggers (measured: 7,460 completions against 1,767 authored on the published library), so all but the
 * first would find nothing to open and read as the very "meter full, no wheel" fault this work fixes.
 *
 * So the fire rule follows the BOOK, not the build. This keeps the client correct on whatever is being
 * served while a republish is in flight, instead of making the two deploys land in the same minute.
 */
let bonusSpinLegacyBatchFired = false;
/** Spin-pocket lands banked behind that pinned bar, re-credited when the wheel is done. */
let bonusSpinBankedOutcomes: PlinkoBallOutcome[] = [];
/** Paces that re-credit one land at a time, so a big bank can't chain wheels — `startInBonusSpinBankDrain`. */
let bonusSpinBankDrainTimer: ReturnType<typeof setTimeout> | null = null;
/**
 * Coin-peg hits the CURRENT in-bonus level must collect from its OWN balls to level up (the book's
 * `bonusRound.levelupPegs`). Kept apart from `bonusMeterMax`, which is this plus the carry described in
 * `sizeBonusMeterForLevel` — so the next level's threshold is always re-derived from the book value and
 * never compounds the previous level's carry.
 */
let bonusLevelPegThreshold = 0;
/** Coin-peg hits the CURRENT level's OWN balls will deliver (book `hitBonusPeg` flags). */
let bonusLevelOwnPegs = 0;
/** Coin-peg hits still owed by balls that were already in the pool when this level was entered. */
let bonusLevelCarryPegs = 0;
/** Bumped per level-up so a stale failsafe can never release a NEWER level-up's full-bar pin. */
let bonusLevelUpGeneration = 0;

/**
 * A bonus ball hit a coin peg while the energy bar was pinned full for a level-up. The completed bar
 * can't take it, so bank it for the NEXT level's bar rather than dropping it: the pin lasts as long as
 * the fill-out + hold (a few hundred ms), which is long enough for a held drop-stream to land real hits.
 */
export function bankBonusPegDuringLevelUp() {
	bonusPegsBankedDuringLevelUp += 1;
}

/**
 * Coin-peg hits still to come from balls ALREADY in the pool — i.e. the book-authored `hitBonusPeg`
 * flags on the outcomes that have not been dropped yet. Every bonus ball drops deterministically on its
 * book outcome (`bonusBallDrop` passes `hitBonusPeg` into the engine), so this is exactly how many more
 * times the energy bar will be credited by the balls already awarded.
 */
function undroppedBonusPegsInPool(): number {
	const outcomes = stateGame.authoritativeBonusOutcomes;
	let pegs = 0;
	for (let i = stateGame.authoritativeBonusOutcomeIndex; i < outcomes.length; i++) {
		if (outcomes[i]?.hitBonusPeg) pegs += 1;
	}
	return pegs;
}

/** Book-authored coin-peg hits carried by one level's own balls. */
function countBonusPegs(outcomes: PlinkoBallOutcome[]): number {
	let pegs = 0;
	for (const outcome of outcomes) if (outcome?.hitBonusPeg) pegs += 1;
	return pegs;
}

/**
 * Size the energy bar for the level being ENTERED — see `applyBonusMeterLevelMax` for the rule.
 * `ownPegs` is how many coin-peg hits this level's OWN balls will deliver; `carryPegs` how many are
 * still owed by balls already in the pool (the previous level's leftovers, which drop first).
 *
 * The threshold comes from the book (`bonusRound.levelupPegs`) whenever it is present — it is the same
 * escalating ladder in every mode, so `bonusLevelupPegs(level)` is an exact stand-in for a book that
 * omits the field. Only if the level is unknown too does this keep the previous level's threshold.
 */
function sizeBonusMeterForLevel(
	levelupPegs: number,
	bonusLevel: number,
	ownPegs: number,
	carryPegs: number,
) {
	const mirrored = bonusLevel > 0 ? bonusLevelupPegs(bonusLevel) : 0;
	const threshold =
		levelupPegs > 0 ? levelupPegs : mirrored || bonusLevelPegThreshold || stateGame.bonusMeterMax;
	bonusLevelPegThreshold = Math.max(1, Math.floor(threshold || 1));
	bonusLevelOwnPegs = Math.max(0, Math.floor(ownPegs));
	bonusLevelCarryPegs = Math.max(0, Math.floor(carryPegs));
	applyBonusMeterLevelMax();
}

/** The ladder is out of rungs — level 9, the last one `BONUS_LEVEL_LABELS` defines. */
function isAtBonusLadderTop(): boolean {
	return stateGame.bonusLevelProgress >= BONUS_LEVEL_LABELS.length;
}

/**
 * Settle the bar a level-up just completed, for whatever the round does next.
 *
 * THE TOP OF THE LADDER DOES NOT DRAIN. At level 9 there is no rung left for any round to climb to, so
 * the bar has nothing left to measure — and `onCoinPegHit` already turns every subsequent coin-peg hit
 * away, since `hasPendingBonusLevelAward()` is false there and drops the fill ceiling to `max - 1`,
 * which a completed bar is never under. Draining would restart a climb that cannot finish: the player
 * watches the bar creep back up toward a level-up that is never coming and reads their remaining hits
 * as progress they are not making. Left standing at max it says the true thing — topped out.
 *
 * The pegs banked behind the pin go with it: `completeBonusMeterThenLevelUp` only hands those to a bar
 * that starts from empty, and there is no bar left for them to move.
 *
 * ⚠️ THE TOP OF THE LADDER, NOT THE TOP OF THIS ROUND. A round that simply runs out of book-authored
 * levels below level 9 still drains and re-sizes: level 9 is a fixed ceiling every round shares and the
 * player can read off the arch, whereas "this book had no more levels" is invisible to them and differs
 * bet to bet — a bar parked full on level 3 just looks broken. Those rounds keep the older behaviour,
 * where `applyBonusMeterLevelMax` holds the max above anything the pool can deliver so the bar fills
 * honestly but never completes.
 *
 * Otherwise: re-size to the level being ENTERED and drain, so its new, taller bar visibly re-fills from
 * empty as that level's balls drop.
 */
function settleBonusMeterForEnteredLevel(
	levelupPegs: number,
	bonusLevel: number,
	ownPegs: number,
	carryPegs: number,
): void {
	// Runs from `completeBonusMeterThenLevelUp`'s settle step — the queue entry is already consumed and
	// `bonusLevelProgress` already advanced, so this reads the ladder as it stands AFTER the level-up.
	if (isAtBonusLadderTop()) return;
	sizeBonusMeterForLevel(levelupPegs, bonusLevel, ownPegs, carryPegs);
	if (stateGame.bonusRoundActive) stateGame.bonusMeterValue = 0;
}

/**
 * THE BAR MUST BE FILLABLE. Set the current level's `bonusMeterMax` from what the BOOK will actually
 * deliver, not from a threshold picked independently of it.
 *
 * The bar is credited once per ball whose book outcome carries `hitBonusPeg` (bonus balls drop
 * deterministically on their outcome, so that count is fixed the moment the level is awarded). The
 * threshold it was being sized to — the per-drop `bonusMeter.max`, e.g. 16 — has nothing to do with that
 * count: a real level carried 8 peg flags against a max of 16, so the bar could reach at most 50% and
 * filling it was ARITHMETICALLY IMPOSSIBLE. Every level-up therefore had to come from the depletion
 * catch-all in `settleBonusRoundWhenFinished`, which snaps the bar full on its way past — which is what
 * a level-up "on a meter that wasn't full" actually was. (The snap lands on whatever the last ball did,
 * so it can look like an unrelated event — e.g. a spin-slot landing — filled the bar.)
 *
 * So: when the book still owes a level-up, the bar completes on the LAST coin-peg hit that level's own
 * balls deliver — `ownPegs` (capped by `levelupPegs` when the math publishes one, so a future republish
 * lands the level-up on the math-exact hit instead of the last one). `carryPegs` is folded in on top so
 * the leftovers still visibly move the bar without bringing the level-up closer.
 *
 * When the book owes nothing, the bar must never complete — so the max is held strictly above everything
 * the pool can still deliver. It keeps the book's own threshold as a floor, so a level that collects few
 * pegs ends at a low, honest fraction rather than always finishing a whisker short.
 */
function applyBonusMeterLevelMax(): void {
	const own = bonusLevelOwnPegs;
	const carry = bonusLevelCarryPegs;
	if (hasPendingBonusLevelAward()) {
		const target = bonusLevelPegThreshold > 0 ? Math.min(bonusLevelPegThreshold, own) : own;
		stateGame.bonusMeterMax = Math.max(1, target + carry);
		return;
	}
	stateGame.bonusMeterMax = Math.max(1, bonusLevelPegThreshold, own + carry + 1);
}

/**
 * True while the book still has a level-up left to award (and the ladder has room for it).
 *
 * The in-bonus bar is only a "level up when full" meter while this holds. Once it goes false the bar can
 * no longer complete anything, so `onCoinPegHit` stops it one notch short of the top rather than letting
 * it fill and then refuse every further hit.
 */
export function hasPendingBonusLevelAward(): boolean {
	if (stateGame.bonusLevelProgress >= BONUS_LEVEL_LABELS.length) return false;
	return stateGame.authoritativeBonusLevelQueue.length > 0;
}

let bonusMeterDrainTimer: ReturnType<typeof setTimeout> | null = null;
let bonusLevelUpOverlayTimer: ReturnType<typeof setTimeout> | null = null;
let bonusLevelUpOverlayHideTimer: ReturnType<typeof setTimeout> | null = null;
let autoBetTimer: ReturnType<typeof setTimeout> | null = null;
/**
 * Identity of the CURRENT Autobet run. Bumped when a run starts and again when one ends, so a loop
 * iteration belonging to a run that has already been finished elsewhere can recognise itself as stale
 * and return silently instead of finishing it a second time (which would fire a second toast).
 *
 * This matters now that a run can end from OUTSIDE the loop: a bonus trigger ends the run on the spot
 * (`endAutoBetForBonusRound`) while `playAutoRounds` is still parked in `waitForAutoBetRoundIdle`.
 */
let autoBetRunGeneration = 0;
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
	// ANY roulette flow holds settlement open, not just a free spin's.
	//
	// The book-driven bonus wheel awaits its own close (`runBonusRouletteFlow`), but the client
	// meter-fallback trigger (`onCoinPegHit` → `onMeterFull` → `triggerRoulette`) is fire-and-forget:
	// nothing awaited it, so `playBet` ran on to its `finally` → `forceUnlockBettingControls`, which
	// bumps `rouletteOpenGeneration` and clears the flow — cancelling the wheel's opener mid-flight (or
	// tearing the wheel down the instant it appeared). The player saw a bonus meter hit max with no
	// bonus, and the run stopped. `triggerRoulette` bounds its own wait, so a flow cannot park here.
	//
	// Deliberately NOT also gated on `bonusRouletteOpen`: the buy-bonus flow raises that flag directly
	// (Game.svelte, before the wager leaves) without ever beginning a flow, and a buy book that carried
	// no `bonusRoulette` event would then hold settlement open for the full completion timeout.
	if (stateGame.rouletteFlowInProgress) return true;
	return false;
}

/**
 * True anywhere inside a bonus round's life — from the wheel that awards it through the last free ball,
 * its level-up celebrations, and the congratulations screen on the way out.
 *
 * Broader than `isBonusRoundBlockingSettlement` on purpose: settlement must land BEHIND the end screen
 * (so the balance credits before the player dismisses it), but the Autobet loop must not treat any of
 * these as "the round is over".
 */
export function isBonusRoundInProgress(): boolean {
	return (
		stateGame.bonusRoundActive ||
		stateGame.bonusBallsRemaining > 0 ||
		stateGame.bonusLevelUpPending ||
		stateGame.bonusEndAnnouncementOpen ||
		stateGame.bonusRouletteOpen ||
		(stateGame.rouletteFlowInProgress && stateGame.activeRouletteSource === 'bonus')
	);
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
		// Same rule for the FREE-SPIN bar: it is complete and a wheel is owed, so nothing more should
		// leave the funnel until that wheel has played and the bar has reset. `activeRouletteSource`
		// below only covers the window once `triggerRoulette` has been called — a wheel waiting out a
		// level-up card has not reached that point yet, and balls dropped into it would just queue up
		// behind the wheel (banked, so nothing is lost — but spent on a bar that cannot move).
		stateGame.spinMeterHoldFull ||
		// ...and the same rule again, one beat EARLIER: the balls already in the air carry enough centre
		// pockets to finish the bar, so the wheel is coming whether or not it has landed yet. Waiting for
		// the bar itself lets a dozen more balls out of the funnel first, and those are what chain one
		// wheel straight into the next. See `isInBonusFreeSpinInevitable`.
		isInBonusFreeSpinInevitable() ||
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
	// Keyed to the tier the ROUND plays, not the selector: a bonus BOUGHT from the 1-ball tier is played
	// (and paid) on the math's reference tier, whose center IS the spin pocket feeding the in-bonus meter.
	const spinPocketActive = spinPocketActiveForBallsPerDrop(activeMeterTierBalls());
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
	spinMeterStart?: number,
	spinMeterMax?: number,
) {
	const played = Math.max(0, Math.floor(ballsPlayed || 0));
	// Seed the persisted-progress counter so continued play keeps saving the cumulative count
	// (a resume passes `played` > 0; a fresh entry passes 0).
	roundBonusBallsPlayed = played;
	stateGame.authoritativeBonusOutcomes = normalizeBonusOutcomes(outcomes);
	stateGame.authoritativeBonusOutcomeIndex = played;
	// This batch OWNS the outcome array (resume / no preceding wheel), so it restarts the batch ledger.
	registerBonusSpinBatch(stateGame.authoritativeBonusOutcomes, spinMeterStart, true, spinMeterMax);
	// Size the energy bar to what THIS (entry) level's own balls will actually deliver. No carry: the
	// entry level starts on an empty pool.
	sizeBonusMeterForLevel(
		levelupPegs,
		level,
		countBonusPegs(stateGame.authoritativeBonusOutcomes),
		0,
	);
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
	spinMeterStart?: number,
	spinMeterMax?: number,
) {
	stateGame.authoritativeBonusLevelQueue = [
		...stateGame.authoritativeBonusLevelQueue,
		{
			freeBalls: Math.max(0, Math.floor(freeBalls || 0)),
			outcomes: normalizeBonusOutcomes(outcomes),
			level: Math.max(1, Math.floor(level || 1)),
			// Pegs to leave the level this batch belongs to (escalating) — sizes the bar once combined in.
			levelupPegs: Math.max(0, Math.floor(levelupPegs || 0)),
			// Free-spin meter this batch opens on — carried until the batch's balls are actually poured
			// into the pool, which is where the bar re-seats (`registerBonusSpinBatch`).
			spinMeterStart: spinMeterStart == null ? undefined : Math.max(0, Math.floor(spinMeterStart)),
			spinMeterMax:
				spinMeterMax == null || spinMeterMax <= 0 ? undefined : Math.floor(spinMeterMax),
		},
	];
	// The book's `bonusRound` events arrive in level order, so the ENTRY level's bar is sized before this
	// one is queued — i.e. while `hasPendingBonusLevelAward()` still reads false, which sizes it as a bar
	// that must never complete. Re-apply now that we know a level-up is owed, so the entry bar is fillable
	// again. Safe: every level of a book is enqueued before its first bonus ball can drop.
	applyBonusMeterLevelMax();
}

/** True when the entry-level bonus balls (already awarded by the wheel) just need their outcomes. */
export function loadAuthoritativeBonusOutcomes(
	outcomes: PlinkoBallOutcome[],
	ballsPlayed = 0,
	levelupPegs = 0,
	spinMeterStart?: number,
	spinMeterMax?: number,
) {
	const played = Math.max(0, Math.floor(ballsPlayed || 0));
	roundBonusBallsPlayed = played;
	stateGame.authoritativeBonusOutcomes = normalizeBonusOutcomes(outcomes);
	stateGame.authoritativeBonusOutcomeIndex = played;
	// Entry level: this batch owns the (fresh) outcome array, so it opens the batch ledger.
	registerBonusSpinBatch(stateGame.authoritativeBonusOutcomes, spinMeterStart, true, spinMeterMax);
	// Rescue an entry bar that is still sitting FULL. `awardBonusBalls` deliberately snaps the meter to max
	// as the wheel awards the entry balls, so the trigger reads as "fill → fire"; the book's in-bonus
	// `bonusMeter` event is what hands it over to the level-1 energy bar (value 0, max = the threshold). If
	// that event is missing the bar stays full — and a full bar can never be filled again, so level 1 could
	// never level up on it and every coin-peg hit for the rest of the round would be rejected. Deliberately
	// conditional on the bar actually being full: when the book DID size it, its `bonusMeter` max is left
	// alone rather than being second-guessed with `levelupPegs`.
	// Size the entry level's bar to the coin-peg hits its own balls carry (see `applyBonusMeterLevelMax`).
	// The wheel's `awardBonusBalls` snapped the meter to max a moment ago so the trigger reads as
	// "fill → fire"; this is also what hands it over to the level-1 energy bar, starting from empty.
	// This path only ever loads the ENTRY level's outcomes, so the fallback threshold is level 1's.
	sizeBonusMeterForLevel(levelupPegs, 1, countBonusPegs(stateGame.authoritativeBonusOutcomes), 0);
	stateGame.bonusMeterValue = 0;
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
	const generation = ++bonusLevelUpGeneration;
	// Locks the bonus Play button (`isBonusPlayButtonDisabled`) — which also pauses a held drop-stream via
	// `canDropBonusBallNow` — for the whole "finish the balls, finish the bar" window below.
	stateGame.bonusLevelUpPending = true;
	try {
		// A free-spin wheel already on screen owns the view — let it finish before the bar is pinned and
		// the card revealed, so the two celebrations never play over each other.
		await waitForFreeSpinRouletteClosed();
		stateGame.bonusMeterHoldFull = true;
		// Keep the logical value in step with the pinned display: the "ready to level up" tile blink and the
		// in-bonus fill guard in `onCoinPegHit` both read `bonusMeterValue >= bonusMeterMax`.
		if (stateGame.bonusMeterMax > 0) {
			traceBonusMeterWrite('completeBonusMeterThenLevelUp', stateGame.bonusMeterMax);
			stateGame.bonusMeterValue = stateGame.bonusMeterMax;
		}
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
		// ⚠️ RE-CHECK THE WHEEL HERE — the gate on entry is not enough, and this is the collision QA sees.
		//
		// Everything between that gate and this line is a WAIT: the balls already in the air have to land,
		// the bar has to render full, and the hold beat has to play. Those landing balls are exactly the
		// ones that can complete the SPIN bar, and a completed spin bar commits a wheel
		// (`creditInBonusSpinMeter` → `fireBonusFreeSpinOnMeterComplete`). So the common case is not a tight
		// race at all — the level-up checks for a wheel, then deliberately waits through the window in which
		// one is most likely to be committed, and reveals its card on top of it.
		//
		// One ball can even carry both flags: `hitBonusPeg` and `hitSpinSlot` are sampled independently, so
		// the same landing can fill the energy bar and the spin bar together.
		//
		// Deadlock-free for the same reason the entry gate is: the wheel's own gate
		// (`waitForBonusLevelUpCardHidden`) waits only on an already-DRAWN card, and this card is by
		// definition not drawn yet — it is still here, waiting.
		// ⚠️ A LOOP, NOT A SINGLE WAIT. Closing one wheel can immediately commit the next: the spin-slot
		// lands that arrived while the bar was pinned are BANKED, and `releaseInBonusSpinMeterHold` drains
		// them back through `creditInBonusSpinMeter` the moment the wheel closes — enough of them refill the
		// bar and open another. A deep round queues several of these back to back, so the card has to wait
		// out the whole run of them, not just the first. Bounded so a wheel that never reports closed can
		// only delay the card, never strand it.
		for (let guard = 0; guard < 8 && isFreeSpinWheelOwningScreen(); guard += 1) {
			await waitForFreeSpinRouletteClosed();
			// Don't reveal on the frame the wheel clears; give the card the beat it would normally open on.
			// Re-checked at the top of the loop, because a banked hit can commit the next wheel inside it.
			await sleep(BONUS_METER_FULL_HOLD_MS);
			if (!stateGame.bonusRoundActive) {
				stateGame.bonusMeterHoldFull = false;
				return;
			}
		}
		// `reveal` runs the game-facing side of the level-up (award, card, this level's free spin). Whatever
		// it does, the bar MUST be settled and un-pinned afterwards: a pin left on displays a permanently
		// full bar AND makes `onCoinPegHit` bank every further hit instead of crediting it, which kills the
		// meter for the rest of the bonus round. So the frame callback is scheduled from a `finally`.
		try {
			reveal();
		} finally {
			requestAnimationFrame(() => {
				settleBar();
				// Hand the new level's bar the pegs banked during the pin (only when it starts from empty —
				// the fallback path can deliberately leave the bar full for a level-up queued behind this one).
				// They were collected by the level we just LEFT, so — exactly like the combine's leftover
				// carry — they are added to the max as well as the value: the bar shows them, but the new
				// level still needs its own full `levelupPegs` hits to complete.
				if (
					bonusPegsBankedDuringLevelUp > 0 &&
					stateGame.bonusRoundActive &&
					stateGame.bonusMeterValue === 0
				) {
					const banked = Math.max(0, Math.floor(bonusPegsBankedDuringLevelUp));
					// Folded into the carry rather than added straight onto the max, so a later
					// `applyBonusMeterLevelMax` recompute keeps them instead of dropping them.
					bonusLevelCarryPegs += banked;
					applyBonusMeterLevelMax();
					stateGame.bonusMeterValue = banked;
				}
				bonusPegsBankedDuringLevelUp = 0;
				stateGame.bonusMeterHoldFull = false;
			});
		}
	} finally {
		bonusLevelUpRevealInProgress = false;
		// Hand the Play-button lock over to the level-up card itself (`bonusLevelUpOverlayOpen` keeps it
		// disabled for the card's whole on-screen life), so there is no gap where a drop could slip through.
		stateGame.bonusLevelUpPending = false;
		// Last-resort release of the full-bar pin, in case the sequence above bailed before scheduling the
		// frame callback. Generation-guarded so it can only ever release ITS OWN level-up's pin — a newer
		// level-up that has since re-pinned the bar is left alone.
		setTimeout(() => {
			if (generation !== bonusLevelUpGeneration) return;
			stateGame.bonusMeterHoldFull = false;
		}, BONUS_METER_PIN_FAILSAFE_MS);
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
	spinMeterStart?: number;
	spinMeterMax?: number;
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
			// Depletion path: this level REPLACES the outcome array (nothing is left of the last batch),
			// so the batch ledger restarts on its published spin-meter carry-in.
			registerBonusSpinBatch(level.outcomes, level.spinMeterStart, true, level.spinMeterMax);
			awardBonusBalls(level.freeBalls);
			// NOTHING free-spin related fires here any more. A level-up is an ENERGY-bar event; the free
			// spin belongs to the SPIN bar and is fired the instant that one completes
			// (`creditInBonusSpinMeter`). Firing a queued trigger at this boundary instead is exactly what
			// decoupled the wheel from its meter — it opened on a spin bar that was nowhere near full, or
			// left a full one waiting for a level-up that never came.
		},
		() => {
			// Re-size the bar to the new level's escalating threshold (mirrors the mid-drop combine path),
			// then drain so the new, taller bar visibly re-fills from empty as its balls drop — unless this
			// was the last level, which keeps its completed bar (see `settleBonusMeterForEnteredLevel`).
			// This path only runs once the level's balls have DEPLETED, so there is no leftover carry.
			settleBonusMeterForEnteredLevel(
				level.levelupPegs ?? 0,
				level.level,
				countBonusPegs(level.outcomes),
				0,
			);
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
	// Coin-peg hits still owed by the balls ALREADY in the pool — i.e. the leftovers of the level we are
	// leaving, which drop before the ones we're about to pour in. Measured BEFORE the merge below so it
	// covers only those, and folded into the new bar's max by `sizeBonusMeterForLevel`.
	const carryPegs = undroppedBonusPegsInPool();
	stateGame.authoritativeBonusLevelQueue = stateGame.authoritativeBonusLevelQueue.slice(1);
	// Merge the new level's outcomes onto the END of the live stream — the remaining current-level balls
	// and these new ones now drop as ONE combined pool (the read index is untouched, so nothing replays).
	// Safe to do before the reveal: no ball can leave the funnel during the fill-out (the Play button and
	// the held stream are both locked by `bonusLevelUpPending`, set synchronously below).
	stateGame.authoritativeBonusOutcomes = [
		...stateGame.authoritativeBonusOutcomes,
		...next.outcomes,
	];
	// APPEND, so the earlier batches stay in the ledger: the leftover balls of the level we are leaving
	// still land after this point and must keep reporting their own batch, or they would be credited
	// against the new level's spin-meter carry-in — or, now that the bar grows per level, against the
	// new level's taller max while they are still the old level's balls (`bonusSpinBatchMaxes`).
	registerBonusSpinBatch(next.outcomes, next.spinMeterStart, false, next.spinMeterMax);
	// Reaching max is the TRIGGER, not the visual: the fill is animated and can be well behind the value
	// that just tripped it, so hand the celebration to the shared "finish the bar first" step. It reveals
	// the +N reward on a completed bar, then re-sizes to the new level's threshold and drains.
	//
	// ⚠️ EVERYTHING the player can read as "levelled up" belongs in `reveal`, which only runs once the bar
	// has visibly COMPLETED. Advancing the arch (`bonusLevelProgress` → `activeLevels`) or the free-ball
	// count (`awardBonusBalls`) out here instead lit the next arch tile and jumped the ball counter at the
	// LOGICAL crossing — several hundred ms before the drawn bar got there — so the level-up read as having
	// fired on a part-full meter. Awarding late is safe: `completeBonusMeterThenLevelUp` sets
	// `bonusLevelUpRevealInProgress` + `bonusLevelUpPending` synchronously (an async body runs to its first
	// `await`), so the round cannot settle, end, or drop another ball inside that window.
	void completeBonusMeterThenLevelUp(
		() => {
			stateGame.bonusLevelProgress = Math.max(stateGame.bonusLevelProgress, next.level);
			showBonusLevelUpOverlay(next.level, next.freeBalls);
			// Pour the awarded free balls into the still-remaining pool — this is the "combine".
			awardBonusBalls(next.freeBalls);
			// NOT the free spin's moment — see the matching note in `applyAuthoritativeBonusLevel`. The
			// spin bar fires its own wheel when it completes; this level-up only owns the energy bar.
		},
		() => {
			settleBonusMeterForEnteredLevel(
				next.levelupPegs ?? 0,
				next.level,
				countBonusPegs(next.outcomes),
				carryPegs,
			);
		},
	);
	return true;
}

export function takeAuthoritativeBonusOutcome(): PlinkoBallOutcome | undefined {
	const outcomes = stateGame.authoritativeBonusOutcomes;
	const index = stateGame.authoritativeBonusOutcomeIndex;
	if (!outcomes.length || index >= outcomes.length) return undefined;
	stateGame.authoritativeBonusOutcomeIndex = index + 1;
	const outcome = outcomes[index];
	// This ball's pocket is book-authored, so the instant it LEAVES the funnel we already know whether
	// it will fill the free-spin bar — long before it lands. See `isInBonusFreeSpinInevitable`.
	if (outcome?.hitSpinSlot) bonusSpinHitsInFlight += 1;
	return outcome;
}

/**
 * Book centre pockets that have been RELEASED but have not landed yet.
 *
 * The bar only moves on a LANDING, so between a ball leaving the funnel and reaching its pocket the
 * meter reads lower than the round has already committed to. This closes that gap.
 */
let bonusSpinHitsInFlight = 0;

/** One in-flight centre pocket has landed and been counted by the bar. */
export function noteInBonusSpinHitLanded(): void {
	bonusSpinHitsInFlight = Math.max(0, bonusSpinHitsInFlight - 1);
}

/**
 * IS A FREE SPIN ALREADY UNAVOIDABLE? True once the balls in the air carry enough centre pockets to
 * finish the bar, whether or not any of them has landed yet.
 *
 * ⚠️ THIS IS WHAT KEEPS TWO WHEELS APART, and it works by stopping the round a beat EARLIER than the
 * bar does. `spinMeterHoldFull` only locks the Play button once the bar has actually completed — by
 * which point ~8-13 more balls have already been released and cannot be recalled. They land behind the
 * wheel, get banked, and that bank is what used to re-complete the bar the instant the wheel closed:
 * two full-screen wheels with no play between them (tendrop event 1199026 — centre pockets on balls
 * 1,3,6,7,8,12,13,17,18 against a 3-notch bar, firing after 6, 12 and 18).
 *
 * Locking on the RELEASE instead means the ball that completes the bar is the last one out of the
 * funnel, so it is also the last one to land: the pipeline is empty when the wheel opens, nothing is
 * banked, and the next fill has to come from balls dropped after the wheel — real gameplay the player
 * watches. The book's ball order and pocket assignments are untouched; only the moment the Play button
 * greys out moves.
 *
 * Reads the CURRENT batch's bar, so it re-arms per batch exactly as the meter does.
 */
export function isInBonusFreeSpinInevitable(): boolean {
	if (!stateGame.bonusRoundActive) return false;
	// NOTHING TO CHAIN INTO AT THIS LEVEL → DON'T LOCK. Covers every end: no trigger left at all (the bar
	// can still complete — a legacy book carries fewer triggers than its centre pockets fill), the LAST
	// trigger of the level, and a queue holding only triggers tagged for levels the round has not reached.
	// In none of those can a second wheel follow HERE, so holding the funnel shut buys nothing and costs
	// the player a stalled round.
	if (!hasBonusFreeSpinBeyondTheNext()) return false;
	// ⚠️ CLAMPED TO THE BALLS ACTUALLY IN THE AIR, and that clamp is load-bearing rather than tidy. This
	// gate DISABLES Play, so a counter that over-counts even once leaves the round unplayable with no way
	// back. The count is incremented on release and decremented on landing, and a ball can leave without
	// ever arriving — the board being torn down mid-drop, a forced settle, a land that took an early
	// return. The pipeline map is authoritative about what is still falling, so a stale count can never
	// outlive the balls it was counting: an empty board reads zero in flight and the button comes back.
	const inFlight = Math.min(bonusSpinHitsInFlight, stateGame.expectedOutcomeByBallId.size);
	if (inFlight <= 0) return false;
	const max = stateGame.spinMeterMax > 0 ? stateGame.spinMeterMax : 1;
	return stateGame.spinMeterValue + inFlight >= max;
}

export function awardBonusBalls(count: number) {
	const amount = Math.max(1, Math.floor(count || 1));
	if (!stateGame.bonusRoundActive) {
		// A bonus round ends an Autobet run and goes manual. Normally the wheel's `triggerRoulette`
		// already ended it well before this point; this covers the starts that have no wheel in front of
		// them — a buy-bonus (which raises `bonusRouletteOpen` directly) and a resume that skips straight
		// to `startAuthoritativeBonusRound`. No-op when the run is already over.
		endAutoBetForBonusRound();
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
		traceBonusMeterWrite('awardBonusBalls:snapFull', isPlinkoTriggerMode(stateBet.activeBetModeKey) ? 0 : stateGame.bonusMeterMax);
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
/** Pending "is this press actually a hold?" window — see `startBonusBallHoldDrop`. */
let bonusHoldActivationTimer: ReturnType<typeof setTimeout> | null = null;
/** In-flight stagger timers for a densified tick (see `streamBonusBallsForTick`). */
const bonusStreamStaggerTimers = new Set<ReturnType<typeof setTimeout>>();

/** Cadence of a held free-ball stream, compressed in Fast Game like the board's own spawn spread. */
function bonusHoldDropIntervalMs(): number {
	const speedUp = stateGame.fastGameEnabled ? SIM_SPEED.normal / SIM_SPEED.fast : 1;
	return Math.round(BONUS_HOLD_DROP_INTERVAL_MS * speedUp);
}

/**
 * Balls the held stream releases on THIS tick.
 *
 * One, for every round the live library can serve — see `BONUS_STREAM_DENSIFY_ABOVE_BALLS`. Past that
 * the stream widens rather than speeding up, so the ×10 ladder's deep rounds (up to 5,100 balls at
 * level 9) finish in tens of seconds instead of tens of minutes without the balls themselves reading
 * any faster. Recomputed every tick, so it tapers back to a single ball as the pool drains and the
 * round always ENDS on the normal cadence.
 */
function bonusHoldBallsPerTick(): number {
	const remaining = Math.max(0, Math.floor(stateGame.bonusBallsRemaining));
	if (remaining <= BONUS_STREAM_DENSIFY_ABOVE_BALLS) return 1;
	// The ceiling is balls per SECOND, converted against THIS tick — Fast Game halves the tick, so a
	// per-tick ceiling would quietly double the spawn rate and the on-board ball count with it. See
	// `BONUS_STREAM_MAX_BALLS_PER_SECOND`.
	const ceilingThisTick = Math.max(
		1,
		Math.round((BONUS_STREAM_MAX_BALLS_PER_SECOND * bonusHoldDropIntervalMs()) / 1000),
	);
	return Math.max(1, Math.min(ceilingThisTick, Math.ceil(remaining / BONUS_STREAM_TARGET_TICKS)));
}

/**
 * Release one tick's worth of free balls: the first now, the rest staggered evenly across the tick.
 *
 * Staggered rather than looped, for two reasons. Visually, `playOneBonusBall` spawns immediately, so a
 * loop would put all of them in the funnel on the same frame and they would fall as one clump instead
 * of a stream. Mechanically, each staggered ball re-checks `canDropBonusBallNow`, so a level-up card or
 * a free-spin wheel that opens mid-tick stops the rest of the tick just as it stops the next one —
 * without that, a densified tick could push balls into a bar that is already full and owed a wheel.
 */
function streamBonusBallsForTick(): void {
	const count = bonusHoldBallsPerTick();
	playOneBonusBall();
	if (count <= 1) return;
	const spreadMs = bonusHoldDropIntervalMs();
	for (let i = 1; i < count; i++) {
		const timer = setTimeout(
			() => {
				bonusStreamStaggerTimers.delete(timer);
				if (!stateGame.bonusRoundActive) return;
				if (stateGame.bonusBallsRemaining <= 0) return;
				if (!canDropBonusBallNow()) return;
				playOneBonusBall();
			},
			Math.round((i / count) * spreadMs),
		);
		bonusStreamStaggerTimers.add(timer);
	}
}

/** Drop any stagger timers still pending — the hold ended, or the round did. */
function clearBonusStreamStaggerTimers(): void {
	for (const timer of bonusStreamStaggerTimers) clearTimeout(timer);
	bonusStreamStaggerTimers.clear();
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
 * A press only becomes a hold after `BONUS_HOLD_ACTIVATION_DELAY_MS`. Without that window a merely
 * unhurried click — a long tap on mobile, a press held while the player watches the ball leave —
 * lands inside the drop interval and silently spends a second free ball. So the first ball still
 * drops on press, and the stream is armed separately; release before the window closes and exactly
 * one ball was dropped. `holdAlreadyQualified` is for callers that measured the hold themselves
 * (`OnHotkey`'s Space hold), which must not wait out a second identical window.
 *
 * The stream only ever drops BONUS balls — it calls `playOneBonusBall` directly rather than the
 * shared play action, so running out of free balls mid-hold can never fall through to a real wager.
 *
 * Safe to call while already pressed or streaming: `OnHotkey` fires `onhold` twice, and a pointer
 * press can overlap it.
 */
export function startBonusBallHoldDrop(options?: { holdAlreadyQualified?: boolean }): void {
	if (bonusHoldDropTimer !== null || bonusHoldActivationTimer !== null) return;
	if (isReplayMode() || !stateGameDerived.hasPendingBonusBalls) return;
	if (canDropBonusBallNow()) playOneBonusBall();
	if (options?.holdAlreadyQualified) {
		beginBonusBallHoldStream();
		return;
	}
	bonusHoldActivationTimer = setTimeout(() => {
		bonusHoldActivationTimer = null;
		beginBonusBallHoldStream();
	}, BONUS_HOLD_ACTIVATION_DELAY_MS);
}

/** The press outlived the activation window (or was pre-qualified) — stream from here on. */
function beginBonusBallHoldStream(): void {
	if (bonusHoldDropTimer !== null) return;
	// The round can end inside the activation window (that first ball may have been the last one).
	if (!stateGame.bonusRoundActive) return;
	bonusHoldDropTimer = setInterval(() => {
		// Bonus fully played out — nothing left to stream, so don't leave a timer idling behind a
		// hold the player may never "release" (e.g. the button went `disabled` under their finger).
		if (!stateGame.bonusRoundActive) {
			stopBonusBallHoldDrop();
			return;
		}
		if (canDropBonusBallNow()) streamBonusBallsForTick();
	}, bonusHoldDropIntervalMs());
}

/** Idempotent — every path that can end a hold calls this, and several can fire for one release. */
export function stopBonusBallHoldDrop(): void {
	if (bonusHoldActivationTimer !== null) {
		clearTimeout(bonusHoldActivationTimer);
		bonusHoldActivationTimer = null;
	}
	// A densified tick has balls scheduled across it; the release must take those with it, or the player
	// keeps spending free balls for up to a tick after letting go.
	clearBonusStreamStaggerTimers();
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
	// The level-up card and the free-spin wheel are the two full-screen celebrations of a bonus round and
	// they must never share the screen. The card yields to the wheel (`completeBonusMeterThenLevelUp`
	// waits it out) and the wheel yields to a drawn card (`waitForBonusLevelUpCardHidden`), so reaching
	// here with a wheel up means one of those gates has been bypassed — surface it rather than letting it
	// show up as a QA screenshot.
	if (import.meta.env.DEV && isFreeSpinWheelOwningScreen()) {
		console.error(
			'[plinko] level-up card drawn while a free-spin wheel owns the screen — the two celebrations are overlapping',
			{
				level: levelNumber,
				freeSpinRouletteOpen: stateGame.freeSpinRouletteOpen,
				bonusFreeSpinOpenPending,
				spinMeterHoldFull: stateGame.spinMeterHoldFull,
				rouletteFlowInProgress: stateGame.rouletteFlowInProgress,
				activeRouletteSource: stateGame.activeRouletteSource,
			},
		);
	}
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
 * Resolves once a level-up CARD is off the screen. Narrower than `waitForBonusLevelUpIdle`: it ignores
 * the "committed, bar still filling out" phase, because the in-bonus free-spin wheel now LEADS the
 * level-up and the card waits on the wheel (`waitForFreeSpinRouletteClosed`). Waiting on that phase from
 * both sides would deadlock; a card that is actually DRAWN still has to clear first, since a wheel
 * sliding down over one is the collision this gate exists for. The card's life is timer-driven
 * (`showBonusLevelUpOverlay`), so this always resolves on its own.
 */
function waitForBonusLevelUpCardHidden(maxMs = 8000): Promise<void> {
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

/**
 * Resolves once no free-spin wheel owns the screen — INCLUDING one that has been committed but has not
 * drawn itself yet. `triggerRoulette` raises `rouletteFlowInProgress` synchronously and only opens the
 * overlay after the drop pipeline goes idle, so checking `freeSpinRouletteOpen` alone let a level-up
 * sail through that gap and land on top of the wheel a moment later.
 *
 * A level-up that becomes due while a wheel is up holds its reveal until the wheel has gone: the wheel
 * leads, the card follows. Deadlock-free — the wheel's own gate waits only on an already-DRAWN card
 * (`waitForBonusLevelUpCardHidden`), whose lifetime is driven by its own timers.
 */
function waitForFreeSpinRouletteClosed(maxMs = 30_000): Promise<void> {
	return new Promise((resolve) => {
		const started = Date.now();
		const check = () => {
			if (!isFreeSpinWheelOwningScreen() || Date.now() - started >= maxMs) resolve();
			else requestAnimationFrame(check);
		};
		check();
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
 * Land every ball still in the air WITHOUT its animation, then clear the spawn backlog.
 *
 * Recovery for a board that disappears mid-drop: the Pixi engine owns the balls, so once it is
 * destroyed the `onBallDropped` callbacks that settle them can never fire. Left alone,
 * `isDropBatchPending()` stays true for the rest of the session — the round never settles, the Play
 * button is stuck showing its loading spinner, an Autobet run stalls, and only a page reload gets the
 * game back.
 *
 * Every ball is settled through the normal `onBallLanded` path, so its authoritative outcome still
 * credits the win, the round's history row and the meters. Balls whose spawn timer died before they
 * were created never registered an outcome, so they can only be dropped from the counter — the
 * round's total is re-asserted from the book's `finalWin` at settlement either way.
 */
export function settleInFlightBallsWithoutAnimation() {
	const coeffs = stateGame.coefficients.length > 0 ? stateGame.coefficients : [];
	// Snapshot the ids first: `onBallLanded` takes each outcome off the map as it settles it.
	for (const ballId of [...stateGame.expectedOutcomeByBallId.keys()]) {
		const outcome = stateGame.expectedOutcomeByBallId.get(ballId);
		if (!outcome) continue;
		onBallLanded(
			ballId,
			resolveOutcomeMultiplier(outcome, coeffs),
			outcome.hitSpinSlot === true,
			outcome.rateIndex,
		);
	}
	stateGame.pendingSpacedSpawnTimers = 0;
	// Nothing is falling any more — hand the displayed balance back to the authoritative value.
	maybeReleaseRapidBalanceShadow();
}

/**
 * Register one book batch of bonus balls (`bonusRound`) and stamp every outcome with its ordinal, so a
 * landing ball can say which batch it came from however the pool was merged. `replace` is the depletion
 * path (the outcome array is swapped wholesale); the combine APPENDS and keeps the earlier batches.
 */
function registerBonusSpinBatch(
	outcomes: PlinkoBallOutcome[],
	spinMeterStart: number | undefined,
	replace = false,
	spinMeterMax?: number,
) {
	if (replace) {
		bonusSpinBatchStarts = [];
		bonusSpinBatchMaxes = [];
		bonusSpinBatchLanded = -1;
		bonusSpinLegacyBatchFired = false;
	}
	const ordinal = bonusSpinBatchStarts.length;
	bonusSpinBatchStarts.push(
		spinMeterStart == null ? undefined : Math.max(0, Math.floor(spinMeterStart)),
	);
	bonusSpinBatchMaxes.push(
		spinMeterMax == null || spinMeterMax <= 0 ? undefined : Math.floor(spinMeterMax),
	);
	for (const outcome of outcomes) bonusOutcomeBatchOrdinal.set(outcome, ordinal);
	// The very first batch seats the bar directly: no ball has landed yet to carry the stamp in.
	if (ordinal === 0) applyBonusSpinBatch(0);
}

/**
 * Re-assert `ordinal`'s published bar as the one the meter is measured against.
 *
 * ⚠️ THIS HAS TO RUN ON EVERY CREDIT, not just when a batch becomes current, because the `spinMeter`
 * handler applies the `max` off every in-bonus event it READS — and the whole round is read before a
 * single bonus ball leaves the funnel. On a book whose bar grows per level (the math sizes it from the
 * round's ball supply) that leaves `stateGame.spinMeterMax` sitting on the DEEPEST batch's value by the
 * time anything drops: seating batch 0 at register time is immediately overwritten, and its balls then
 * credit against a bar up to 500+ notches tall instead of 3. Replaying real books through the client
 * rule put 1,881 of 8,400 bonus rounds short of the wheels their book had already paid for.
 *
 * No-op on a legacy book (no per-batch max) and whenever the bar is already right, so the common path
 * costs one comparison.
 */
function ensureBonusSpinBatchMax(ordinal: number): void {
	const batchMax = bonusSpinBatchMaxes[ordinal];
	if (batchMax != null && batchMax > 0 && stateGame.spinMeterMax !== batchMax) {
		applyAuthoritativeSpinMeterMax(batchMax);
	}
}

/** Seat the in-bonus bar on `ordinal`'s published max + carry-in, and re-arm the legacy one-shot lock. */
function applyBonusSpinBatch(ordinal: number) {
	bonusSpinBatchLanded = ordinal;
	bonusSpinLegacyBatchFired = false;
	// The bar THIS batch fills against, applied as the batch becomes current — see `bonusSpinBatchMaxes`
	// for why it cannot be applied when the event is read. It only ever grows, so the carry seated below
	// is always within it.
	ensureBonusSpinBatchMax(ordinal);
	const start = bonusSpinBatchStarts[ordinal];
	// Legacy book (no `spinMeterStart`): leave the bar where the previous batch left it — see the note
	// on `bonusSpinBatchStarts`. Only the fire lock re-arms.
	if (start == null) return;
	const max = stateGame.spinMeterMax > 0 ? stateGame.spinMeterMax : 1;
	stateGame.spinMeterValue = Math.min(max, start);
}

/**
 * Credit one spin-pocket land to the IN-BONUS free-spin bar, and fire the wheel the moment it completes.
 *
 * This is the client half of the book-driven meter described at `bonusOutcomeBatchOrdinal`: it walks the
 * same balls in the same order as the math's own walk and clamps at the same max, so the bar completes on
 * exactly the ball the book completed it on and "bar full" and "wheel opens" are the same event.
 *
 * The bar empties on the completing ball, exactly as the math's counter does, rather than waiting for the
 * wheel to close. That is what lets it fill AGAIN inside the same batch: balls already in the air when
 * the wheel was called land before it can open (`triggerRoulette` waits out the drop pipeline), and their
 * spin pockets have to count — the math counts them, so a bar still pinned full here would swallow them
 * and drift straight back out of step with the book.
 */
export function creditInBonusSpinMeter(outcome?: PlinkoBallOutcome) {
	// A FREE SPIN OWNS THE SCREEN — the bar is pinned full waiting for its wheel, or a wheel is up.
	//
	// The completed bar is the reward the wheel is celebrating, so it stays full for the wheel's whole
	// life and only empties once the win is allocated (`releaseInBonusSpinMeterHold`). Every land that
	// arrives in that window is BANKED, not dropped: `triggerRoulette` waits for the drop pipeline
	// before it opens, so every ball still falling when the bar completed lands behind the wheel, and
	// the book counts each of their centre pockets. Dropping them would put the bar permanently behind
	// the book — and would visibly lose the player meter progress they watched land.
	//
	// Banked as OUTCOMES rather than a tally so each one still carries its batch stamp when re-credited.
	if (isFreeSpinWheelOwningScreen()) {
		if (outcome) bonusSpinBankedOutcomes.push(outcome);
		return;
	}
	const batch = outcome ? bonusOutcomeBatchOrdinal.get(outcome) : undefined;
	// First land from a LATER batch — re-seat the bar on that batch's published carry-in. Deliberately
	// forward-only: the pool is read in book order, but two balls in the air can still land out of order,
	// and re-seating backwards on a straggler would replay a batch's carry-in.
	if (batch != null && batch > bonusSpinBatchLanded) applyBonusSpinBatch(batch);
	// Already on this batch — but the bar may have been stomped by a later batch's read-ahead
	// `spinMeter` event, so re-assert it before crediting. See `ensureBonusSpinBatchMax`.
	else if (batch != null) ensureBonusSpinBatchMax(batch);
	// A legacy batch pays one free spin and then drops the rest of its hits, exactly as the book that
	// authored it did — see `bonusSpinLegacyBatchFired`.
	const legacyBatch = batch != null && bonusSpinBatchStarts[batch] == null;
	if (legacyBatch && bonusSpinLegacyBatchFired) return;
	const max = stateGame.spinMeterMax > 0 ? stateGame.spinMeterMax : 1;
	stateGame.spinMeterValue = Math.min(max, stateGame.spinMeterValue + 1);
	if (stateGame.spinMeterValue < max) return;
	if (legacyBatch) bonusSpinLegacyBatchFired = true;
	// THE BAR JUST COMPLETED. Hold it full and fire the book-authored free spin.
	stateGame.spinMeterHoldFull = true;
	if (fireBonusFreeSpinOnMeterComplete()) return;
	// Nothing queued to open — don't strand the bar pinned on a wheel that will never come.
	stateGame.spinMeterHoldFull = false;
	stateGame.spinMeterValue = 0;
	if (import.meta.env.DEV) {
		console.warn(
			'[plinko] in-bonus spin meter completed with no book freeSpinTrigger behind it — the book and the bar disagree',
			{
				batch,
				level: stateGame.bonusLevelProgress,
				queued: stateGame.pendingBonusFreeSpins.map((fs) => fs.level),
			},
		);
	}
}

/**
 * The wheel is done and its win is allocated — empty the completed bar and hand back the hits that
 * landed behind it. Re-credited through the normal path, so a banked run long enough to complete the bar
 * again opens its own wheel rather than being silently absorbed.
 *
 * The hand-back is PACED while the round still has balls to drop (`startInBonusSpinBankDrain`) and
 * synchronous once it doesn't — so the caller's rule is unchanged: when the round is out of balls this
 * still completes the bar, and any wheel it earns is committed, before it returns.
 */
export function releaseInBonusSpinMeterHold() {
	// Drop the pin FIRST: the bank is drained through `creditInBonusSpinMeter`, which banks straight back
	// while a wheel still owns the screen. It also un-blocks the round's own ball stream
	// (`isBonusPlayButtonDisabled`), so real balls start falling again alongside the paced drain below.
	if (stateGame.spinMeterHoldFull) {
		stateGame.spinMeterHoldFull = false;
		stateGame.spinMeterValue = 0;
	}
	// Drained even when nothing was pinned — a wheel opened by the depletion catch-all (rather than by
	// the bar completing) still banks whatever lands behind it, and those hits are owed to the bar.
	if (bonusSpinBankedOutcomes.length === 0) return;
	startInBonusSpinBankDrain();
}

/**
 * Hand the bank back ONE land at a time, at the cadence of a falling free ball.
 *
 * ⚠️ THIS IS WHAT STOPS TWO WHEELS CHAINING. The bar is pinned the instant it completes, which stops the
 * stream — but the balls already falling cannot be recalled, so their centre pockets land behind the
 * wheel and are banked (the math counts them, so the bar must too). Draining that bank in one loop
 * re-completed the bar on the frame the wheel closed and opened the next wheel on the same beat: two
 * full-screen wheels welded together with no play between them.
 *
 * Real example — tendrop event 1199026, a 20-ball level-1 batch whose centre pockets land on balls
 * 1,3,6,7,8,12,13,17,18 against a 3-notch bar. The book fires after balls 6, 12 and 18. The client
 * pinned on ball 6 with ~8 balls in flight, banked 7/8/12/13, and cashed all four out at once.
 *
 * Paced, one banked land reads exactly like one ball landing, so the bar visibly re-fills at the rhythm
 * the player already knows before the next wheel is earned.
 *
 * ⚠️ ALWAYS PACED — never "only while balls are left to drop". `bonusBallsRemaining` counts balls not yet
 * RELEASED, not balls still falling, and the replay driver (and a held stream) release far faster than
 * balls land: measured on 1199026, all 20 were out of the funnel before the first one touched a pocket,
 * so the bar completed with `bonusBallsRemaining` already 0. Gating on it sent every chained wheel down
 * the synchronous path — the exact case this exists to fix. When there really is nothing left to drop
 * the pacing is still what separates the wheels; it just separates them with a re-filling bar rather
 * than with falling balls.
 *
 * NOT a change to the ACCOUNTING: every banked land is still credited, in order, through the one path
 * (`creditInBonusSpinMeter`). Only WHEN they arrive moves, so the book's wheel count is untouched.
 */
function startInBonusSpinBankDrain() {
	if (bonusSpinBankDrainTimer != null) return;
	// One beat per land, but never so many beats that the round sits waiting on them — see
	// `IN_BONUS_SPIN_BANK_DRAIN_BUDGET_MS`. Floored at a frame so every land still gets its own tick.
	const stepMs = Math.max(
		Math.round(1000 / 60),
		Math.min(
			bonusHoldDropIntervalMs(),
			Math.round(IN_BONUS_SPIN_BANK_DRAIN_BUDGET_MS / Math.max(1, bonusSpinBankedOutcomes.length)),
		),
	);
	const step = (): void => {
		bonusSpinBankDrainTimer = null;
		if (!stateGame.bonusRoundActive) return;
		// Checked BEFORE the shift as well as after: `creditInBonusSpinMeter` banks straight back while a
		// wheel owns the screen, so handing it a land here would only move that land to the BACK of the
		// bank — losing the book order the batch stamps are read in. A real ball landing can complete the
		// bar between two ticks, so this is not a rare path.
		if (isFreeSpinWheelOwningScreen()) return;
		const outcome = bonusSpinBankedOutcomes.shift();
		if (outcome) creditInBonusSpinMeter(outcome);
		// That land may have completed the bar and committed the next wheel. The next
		// `releaseInBonusSpinMeterHold` restarts the drain once that wheel is done.
		if (isFreeSpinWheelOwningScreen()) return;
		if (bonusSpinBankedOutcomes.length > 0) {
			bonusSpinBankDrainTimer = setTimeout(step, stepMs);
			return;
		}
		// Bank empty and no wheel taken the screen. The settler bailed out while this was running (see
		// its drain guard), so nothing else is going to end the round — re-invoke it. No-op unless the
		// round is genuinely out of balls.
		if (stateGame.bonusBallsRemaining <= 0) void settleBonusRoundWhenFinished();
	};
	// The FIRST land waits longer than the rest — long enough for the emptied bar to visibly reach zero
	// before it starts climbing again. See `IN_BONUS_SPIN_BANK_RESET_READ_MS`.
	bonusSpinBankDrainTimer = setTimeout(step, IN_BONUS_SPIN_BANK_RESET_READ_MS);
}

function clearInBonusSpinBankDrain() {
	if (bonusSpinBankDrainTimer == null) return;
	clearTimeout(bonusSpinBankDrainTimer);
	bonusSpinBankDrainTimer = null;
}

/**
 * Diagnostics for the banked centre pockets (`plinkoDebugLocks`). A bank that never drains is a bar
 * permanently behind the book; one that empties in a single frame is the wheel-chaining fault above.
 */
export function snapshotInBonusSpinBank(): { banked: number; draining: boolean } {
	return { banked: bonusSpinBankedOutcomes.length, draining: bonusSpinBankDrainTimer != null };
}

/**
 * True while an in-bonus free spin owns the screen — from the completed bar, through the wheel being
 * committed but not yet drawn, to the wheel itself. The bonus round must not end, and a level-up card
 * must not reveal, inside this window.
 */
function isFreeSpinWheelOwningScreen(): boolean {
	return (
		stateGame.freeSpinRouletteOpen ||
		bonusFreeSpinOpenPending ||
		stateGame.spinMeterHoldFull ||
		(stateGame.rouletteFlowInProgress && stateGame.activeRouletteSource === 'spin')
	);
}

/**
 * Take the queued in-bonus free spin the completed bar has earned and open its wheel. Prefers a trigger
 * tagged for a level we have reached; falls back to the head of the queue (a book tag can sit a level
 * ahead of `bonusLevelProgress` when the combine merged that level's balls in early).
 */
/**
 * Book free spins queued that THIS level can fire — the same eligibility test
 * `fireBonusFreeSpinOnMeterComplete` selects on.
 *
 * `<=` rather than `===` on purpose: a trigger tagged for an EARLIER level that never got fired is still
 * fireable now and still chains, so it has to count. Only tags sitting ahead of the level the round has
 * actually reached are excluded.
 */
function bonusFreeSpinsFirableAtCurrentLevel(): number {
	const level = stateGame.bonusLevelProgress;
	return stateGame.pendingBonusFreeSpins.filter((fs) => fs.level <= level).length;
}

/**
 * Is there a second free spin THIS LEVEL can still fire after the one a completing bar is about to open?
 *
 * The Play-button lock exists to stop two wheels running into each other, so what it needs to know is not
 * "will a wheel open" but "will another one follow it here". With one trigger left for this level there
 * is nothing to chain into: the balls that carry on falling land behind that last wheel and are banked,
 * and when the bank drains it finds nothing this level can fire, so `fireBonusFreeSpinOnMeterComplete`
 * either returns false or the round has moved on. Locking there would stall play to prevent a collision
 * that cannot happen.
 *
 * ⚠️ SCOPED TO THE LEVEL, which is narrower than what the firing rule will actually accept. That rule
 * prefers a trigger tagged for a level already REACHED but falls back to the head of the queue, so a
 * level-2 tag CAN fire while the round still reads level 1 — the combine merges the next level's balls in
 * before `bonusLevelProgress` catches up. In that window this reports "nothing to chain into" and the
 * button stays live even though a wheel may open. That is the deliberate trade: a lock that fires on
 * triggers belonging to a level the player has not reached yet reads as the button jamming for no
 * visible reason, and the bank + its paced drain still handle anything that lands behind such a wheel.
 */
function hasBonusFreeSpinBeyondTheNext(): boolean {
	return bonusFreeSpinsFirableAtCurrentLevel() > 1;
}

function fireBonusFreeSpinOnMeterComplete(): boolean {
	const queue = stateGame.pendingBonusFreeSpins;
	if (queue.length === 0) return false;
	const reached = queue.findIndex((fs) => fs.level <= stateGame.bonusLevelProgress);
	const index = reached >= 0 ? reached : 0;
	const entry = queue[index];
	stateGame.pendingBonusFreeSpins = [...queue.slice(0, index), ...queue.slice(index + 1)];
	beginInBonusFreeSpin(entry);
	return true;
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
	// A wheel cannot open on top of another roulette flow — `triggerRoulette` would silently downgrade to
	// `pendingRouletteSource`, which the authoritative flow never re-triggers, and this free spin would be
	// gone for good. Hand the entry back to the queue instead; the next ball-land or the depletion
	// catch-all retries it once the current flow has closed.
	if (stateGame.rouletteFlowInProgress || bonusFreeSpinOpenPending) {
		stateGame.pendingBonusFreeSpins = [entry, ...stateGame.pendingBonusFreeSpins];
		stateGame.pendingSpinRouletteAfterBonusLevelDepletion = true;
		return;
	}
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
	// The wheel now leads and the level-up card follows it (`completeBonusMeterThenLevelUp` waits this
	// out), so the only card it still has to wait for is one ALREADY on screen — sliding a wheel over a
	// visible card is the collision this gate was added for. Deliberately narrower than
	// `isBonusLevelUpOnScreen`: waiting on the "committed but not yet drawn" phase as well would deadlock
	// against the card's own wait on this wheel.
	bonusFreeSpinOpenPending = true;
	void waitForBonusLevelUpCardHidden().then(() => {
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
		// (1) Level-ups first. A level-up card no longer has to share this boundary with a free spin: the
		// spin bar fires its own wheel the moment it completes (`creditInBonusSpinMeter`), which is
		// normally well before the balls run out, and `completeBonusMeterThenLevelUp` holds the card
		// behind any wheel still on screen.
		if (stateGame.bonusBallsRemaining <= 0 && consumeAuthoritativeBonusLevel()) {
			return;
		}
		if (stateGame.bonusBallsRemaining <= 0 && consumePendingBonusLevelUp()) {
			return;
		}
		// (1b) Centre pockets that landed behind the last wheel are still being handed back to the bar one
		// at a time (`startInBonusSpinBankDrain`). Those lands are what earns the NEXT book free spin, so
		// running on from here would fire it from the safety net below — instantly, on a bar the player
		// never saw fill — which is the wheel-chaining this pacing exists to stop. It would also end the
		// round on a bar still short of the book. The drain re-invokes this settler once it empties.
		if (bonusSpinBankDrainTimer != null) return;
		// (2)+(3) SAFETY NET ONLY, and it should now find nothing. Every book free spin is fired by its own
		// bar completing; what can still land here is a trigger whose bar never completed — a legacy book
		// whose meter the client could not reproduce, or a wheel `beginInBonusFreeSpin` handed back because
		// another roulette flow held the screen. Firing them at depletion is worse presentation than
		// firing them on the fill, but it is the difference between a late wheel and a lost one.
		if (stateGame.bonusBallsRemaining <= 0 && fireBonusFreeSpinForReachedLevel()) {
			return;
		}
		if (stateGame.bonusBallsRemaining <= 0 && fireRemainingBonusFreeSpin()) {
			return;
		}
		// The last ball can complete the spin bar and end the round in the same breath: `onBallLanded`
		// credits the meter (which calls the wheel) and then invokes this settler. The wheel is committed
		// synchronously but only DRAWS itself once the drop pipeline is idle, so without this the
		// congratulations screen opened into that gap and the two played over each other. The wheel's own
		// close handler re-invokes this settler, so the round still ends — just after the wheel, not on
		// top of it.
		if (isFreeSpinWheelOwningScreen()) return;
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
	bonusPegsBankedDuringLevelUp = 0;
	// A round can end mid-tick (the last ball of a densified tick settles it), so drop any stagger
	// timers still queued behind it before the next round can inherit them.
	clearBonusStreamStaggerTimers();
	// Next bonus rebuilds its own batch ledger from that round's book (`registerBonusSpinBatch`).
	bonusSpinBatchStarts = [];
	bonusSpinBatchMaxes = [];
	bonusSpinBatchLanded = -1;
	bonusSpinLegacyBatchFired = false;
	stateGame.spinMeterHoldFull = false;
	// Drop the paced hand-back with the bank it was feeding — a timer left armed would credit this
	// round's leftover lands into the next one's bar.
	clearInBonusSpinBankDrain();
	// Next round counts its own balls out of the funnel (`takeAuthoritativeBonusOutcome`).
	bonusSpinHitsInFlight = 0;
	bonusSpinBankedOutcomes = [];
	// Next bonus re-derives its own per-level threshold from that round's book.
	bonusLevelPegThreshold = 0;
	bonusLevelOwnPegs = 0;
	bonusLevelCarryPegs = 0;
	// Put the bar's MAX back to the base-game one before resetting its value.
	//
	// In-bonus, `sizeBonusMeterForLevel` repurposes `bonusMeterMax` as the current level's peg threshold.
	// Nothing here used to restore it, so the base-game bar kept measuring itself against that leftover
	// threshold until some later book happened to carry `bonusMeterMax` (the `plinkoDrop` handler only
	// assigns it when present) or a tier switch re-seeded it. Whenever the leftover was SMALLER than the
	// tier's hits-to-fill, the bar read FULL before the math's trigger count was reached — the player saw
	// a full meter with no bonus. `bonusMeterBaseMax` is never touched by the in-bonus sizing, so it is
	// the base-game value to come back to.
	if (stateGame.bonusMeterBaseMax > 0) stateGame.bonusMeterMax = stateGame.bonusMeterBaseMax;
	// Bonus consumed: reset to the tier base start (0 on 1/10-ball, 1/8 on 20-ball, 1/4 on 50-ball).
	// Persisted as well as displayed: a display-only reset leaves the in-bonus value in the session store,
	// and the next balance change re-runs `applyRgsSessionMetersToDisplay`, which would snap the bar back
	// up to it moments after the bonus ended.
	traceBonusMeterWrite('resetBonusRoundVisualState', Math.min(bonusMeterTierStart(), stateGame.bonusMeterMax || bonusMeterTierStart()));
	stateGame.bonusMeterValue = Math.min(bonusMeterTierStart(), stateGame.bonusMeterMax || bonusMeterTierStart());
	updateRgsSessionBonusMeter(stateGame.bonusMeterValue, 0);
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
	// Pin the DISPLAYED balance at its pre-win value, the same way `finalWin` does for a win celebration.
	// This is the last moment it CAN be pinned: the reset below clears `bonusRoundActive`, which is what
	// unblocks settlement — and with it the round's balance credit — behind this screen. Pinning any later
	// (e.g. when the screen closes) would read a balance that already includes the win, and the number
	// would visibly snap DOWN, since the screen spends its last ~320ms of slide-up with the balance in view.
	// Released by the post-bonus coin collect once the coins reach the balance coin, so the number climbs
	// with them. DISPLAY-ONLY — affordability still reads the authoritative balance (plinkoSpendableBalance).
	if (stateGame.bonusEndWinAmount > 0 && stateGame.balanceWinHold === null) {
		stateGame.balanceWinHold = stateBet.balanceAmount;
	}
	resetBonusRoundVisualState();
}

/**
 * Hand the balance the treasure screen pinned over to its count-up (Game.svelte drives it), and drop the
 * backstop timer below. No-op if nothing is held.
 *
 * ⚠️ Clearing the timer is not tidiness — it is the point. A timer left armed after the coins have already
 * released would come due up to a full round later and release whatever hold was current THEN, cutting a
 * following round's win celebration short. Every path out of the collect goes through here.
 */
export function releaseBonusEndBalanceHold() {
	if (bonusEndBalanceReleaseTimer) {
		clearTimeout(bonusEndBalanceReleaseTimer);
		bonusEndBalanceReleaseTimer = null;
	}
	if (stateGame.balanceWinHold !== null) stateGame.balanceWinReleaseTick++;
}

/**
 * Backstop for the hold: however the collect ends — coins landed, no balance coin on screen to collect
 * into, the renderer not ready — the displayed balance must never be left pinned at its pre-win value.
 * CoinFountain covers all three synchronously, so this only ever fires if the collect never ran at all.
 * Well past the coins' ~1.5s of travel, even on a device slow enough to stretch it (the renderer clamps
 * its step to 48ms, so anything above ~21fps tracks wall clock exactly).
 */
const BONUS_END_BALANCE_RELEASE_FALLBACK_MS = 8000;
let bonusEndBalanceReleaseTimer: ReturnType<typeof setTimeout> | null = null;

export function onBonusEndAnnouncementClosed() {
	// Safety net: the reset normally runs at full cover (above). If that screen was ever torn down before
	// it got there, run it here so the game can't be left dressed as a bonus round with no bonus left.
	// `resetBonusRoundVisualState` is idempotent, so the normal path just re-applies the same values.
	resetBonusRoundVisualState();
	stateGame.bonusEndAnnouncementOpen = false;
	fireBonusEndCoinCollect();
}

/**
 * The treasure screen has slid away and the game is back in view — pour the bonus total out of the skull's
 * mouth into the balance coin (CoinFountain watches `bonusEndCoinBurstTick`).
 *
 * A bonus round is deliberately given NO win modal (`finalWin` skips the celebration because the treasure
 * screen already showed the total), which also meant it was the one paying round with no coins collected
 * into the balance at all. This is that collect, moved to after the screen rather than under it — the
 * screen covers the whole view, so coins thrown while it is down would simply not be seen.
 */
export function fireBonusEndCoinCollect() {
	const amount = stateGame.bonusEndWinAmount;
	if (amount <= 0) {
		// Nothing to collect — don't strand the display on a hold no animation will lift.
		releaseBonusEndBalanceHold();
		return;
	}
	// One frame of headroom: this runs in the same tick that unmounts the screen, so the balance coin's
	// rect (which the burst aims at) is measured after that removal has been laid out.
	requestAnimationFrame(() => {
		stateGame.bonusEndCoinBurstAmount = amount;
		stateGame.bonusEndCoinBurstTick++;
		// CONSUME the total. Nothing else clears `bonusEndWinAmount` — it is only overwritten by the next
		// bonus to finish — so leaving it set would let a later bonus that paid nothing pin the balance
		// (see `onBonusEndAnnouncementCovered`) and collect this round's amount all over again. Safe to do
		// a frame late: the treasure screen that renders it unmounted with `bonusEndAnnouncementOpen`.
		stateGame.bonusEndWinAmount = 0;
	});
	if (bonusEndBalanceReleaseTimer) clearTimeout(bonusEndBalanceReleaseTimer);
	bonusEndBalanceReleaseTimer = setTimeout(
		releaseBonusEndBalanceHold,
		BONUS_END_BALANCE_RELEASE_FALLBACK_MS,
	);
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

export function onBallLanded(
	ballId: number,
	multiplier: number,
	_isSpinSlotFromEngine: boolean,
	slotIndex = -1,
) {
	const pending = takeExpectedOutcome(ballId);
	const slotCount = stateGame.coefficients.length;
	// No free-spin meter on this tier (1-ball) ⇒ no spin pocket: the center is an ordinary paying slot.
	// A bought bonus plays on the reference tier even from 1-ball, so ask the round's tier (see
	// `activeMeterTierBalls`) rather than the selector.
	const spinPocketActive = spinPocketActiveForBallsPerDrop(activeMeterTierBalls());
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
			// The sparkle is the whole of this tier's land feedback. No coin is thrown at the balance:
			// rapid play lands a ball every few hundred ms, so a coin per land read as a constant
			// trickle into the balance coin rather than as a reward for any particular land.
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
		// The outcome goes with the ball: in a bonus round it carries the batch stamp that tells the
		// free-spin bar which level's balls this land belongs to (see `bonusOutcomeBatchOrdinal`).
		onSpinSlotLand(ballId, pending);
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
 *
 * RAPID 1-BALL is the exception to `isGameOngoing()`. That flag also covers a ball that is merely still
 * FALLING, and on the 1-ball tier the round is already closed by then — settlement is decoupled from the
 * animation (see `isRapidSingleBallMode`), so `placeBet` lets a human press Bet again immediately. Waiting
 * on it here paced Autobet at the drop animation (~3s/bet) rather than at the round, which is not what
 * "1 ball per drop" is for. So there we gate on exactly what `placeBet` itself gates on — the round-closure
 * flags — and let the previous ball finish falling on its own. The tier is feature-free (no bonus / free
 * spin / win popup), so none of the other conditions can be true there anyway.
 */
function isAutoBetRoundBusy(): boolean {
	return (
		stateGame.isSubmitting ||
		stateGame.dropRoundActive ||
		stateGame.bonusBallsRemaining > 0 ||
		// A bonus ENDS the run (`endAutoBetForBonusRound`), so in practice the loop is already gone by
		// the time any of these are set — `waitForAutoBetRoundIdle` bails on the generation change rather
		// than sitting out a hand-played bonus. They stay as the backstop for the ordering: the flags are
		// raised from several places and this is what guarantees no wager can slip out over a bonus in
		// the window before the run is torn down (settlement lands BEHIND the congratulations screen, see
		// `isBonusRoundBlockingSettlement`, which releases the round's own locks early).
		stateGame.bonusRoundActive ||
		stateGame.bonusLevelUpPending ||
		stateGame.bonusEndAnnouncementOpen ||
		// A still-falling ball does not hold the round open on the rapid 1-ball tier — see above.
		(!isRapidSingleBallMode() && isGameOngoing()) ||
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

/** Resolver of the delay `autoBetTimer` is currently counting down, so a cancel can settle it. */
let autoBetDelayResolve: (() => void) | null = null;

function autoBetDelay(ms: number): Promise<void> {
	return new Promise((resolve) => {
		autoBetDelayResolve = resolve;
		autoBetTimer = setTimeout(() => {
			autoBetTimer = null;
			autoBetDelayResolve = null;
			resolve();
		}, ms);
	});
}

/**
 * Cancel the pending inter-round delay AND settle its promise.
 *
 * Resolving matters as much as clearing: the run can now be ended from outside the loop (a bonus
 * trigger), and the loop can be sitting on this delay when that happens — inside `waitForAutoBetRoundIdle`'s
 * settle-confirm as well as between rounds. Clearing the timeout alone leaves that `await` waiting on a
 * promise nothing will ever resolve, stranding the whole call chain and its closures. Resolving instead
 * lets each `await` return normally and immediately fall out on its generation check.
 */
function cancelAutoBetDelay() {
	if (autoBetTimer) {
		clearTimeout(autoBetTimer);
		autoBetTimer = null;
	}
	const resolve = autoBetDelayResolve;
	autoBetDelayResolve = null;
	resolve?.();
}

/**
 * Wait until the current autobet round fully settles (balls, wheels, wallet).
 *
 * `runId` is the generation of the run that started this wait. A bonus trigger ends the run from
 * outside the loop and hands the board to the player, who may then take as long as they like over the
 * free balls — so bail the moment this wait no longer belongs to the live run rather than sit on a
 * round nobody is waiting for.
 */
async function waitForAutoBetRoundIdle(runId: number): Promise<boolean> {
	let started = Date.now();
	let sawActiveRound = false;

	while (Date.now() - started < AUTO_BET_ROUND_IDLE_TIMEOUT_MS) {
		if (runId !== autoBetRunGeneration) return false;
		// The idle timeout is a stall backstop for a BASE drop, which is over in seconds; a bonus round
		// is legitimately far longer and must not be measured against that budget, so keep the clock
		// parked while one is running. Normally moot — a bonus ends the run and the generation check
		// above has already returned — but it still covers the beat between the bonus flags going up and
		// the tear-down, and any bonus that reaches the board without an Autobet stop in front of it.
		if (isBonusRoundInProgress()) started = Date.now();
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

/**
 * Whether the NEXT autobet round can actually be paid for.
 *
 * A run is funded DROP BY DROP, not up front: the player may select any round count regardless of what
 * the balance covers, and the run simply plays until the wallet can't pay for the next drop (that is
 * where it stops, with the "Insufficient Balance" toast). Checked immediately before each wager, so it
 * always sees the balance the round before it just settled.
 *
 * A pending free bonus ball costs nothing — the play press drops one instead of wagering — so it can
 * never be the drop that ends a run.
 */
function canFundNextAutoBetRound(): boolean {
	if (stateGameDerived.hasPendingBonusBalls) return true;
	return canAffordPlinkoWager();
}

async function placeAutoBetRound(onBet: () => void, runId: number): Promise<boolean> {
	if (isAutoBetRoundBusy()) return false;
	onBet();
	return waitForAutoBetRoundIdle(runId);
}

/**
 * Arms and starts an Autobet run. Returns FALSE when the run could not start (balls still in flight, or
 * a win celebration still on screen) — callers must then clear `stateGame.autoMode` rather than leave
 * Autobet armed-but-idle. An armed-idle Autobet turns the main Play button into a "start autobet"
 * control, so the next ordinary Play press silently fires the whole run: see `selectAutoBetCount` in
 * GameHud.
 *
 * The `showWinPopup` guard mirrors `isAutoBetRoundBusy` below: refusing a start the loop is about to
 * abandon anyway is what keeps the two toasts honest. Without it a start during the celebration
 * announced "Autobet Started", failed its first `placeAutoBetRound`, and fell straight through to
 * `finishAutoBet`'s "Autobet Finished" — a completed-run notification for a run that never placed a bet.
 * The UI gate (`autoBetConfigLocked`) already keeps the count menu shut during the popup; this is the
 * backstop for the paths that don't consult it — notably `startArmedAutoBetRun`, which re-validates only
 * after the confirm prompt is answered, and the prompt can be answered while the reveal is up.
 */
export function startAutoBet(onBet: () => void): boolean {
	// A bonus round already on the board belongs to the round that paid for it, and it is the player's to
	// finish by hand (a bonus is what ENDS a run, see `endAutoBetForBonusRound` — starting one back up
	// over the top of it would undo that on the spot). Let them play it out, then start.
	if (isGameOngoing() || stateGame.showWinPopup || isBonusRoundInProgress()) return false;
	stateGame.autoPlayStarted = true;
	stateGame.autoPlayStopping = false;
	stateGame.autoPlayPausedByFreeSpin = false;
	const selected = stateGame.autoRoundsLeft <= 0 ? 99999 : stateGame.autoRoundsLeft;
	stateGame.autoRoundsDisplay = selected;
	showToast('Autobet Started');
	const firstRoundLeft = selected >= 1000 ? selected : selected - 1;
	const runId = ++autoBetRunGeneration;
	void playAutoRounds(firstRoundLeft, onBet, runId);
	return true;
}

/**
 * A BONUS ROUND ENDS THE RUN. The bonus is the part of the game the player came for, so the moment one
 * is triggered inside an Autobet round the run stops there and the whole bonus — the entry wheel, every
 * free ball, each level-up, the congratulations screen — is played out by hand.
 *
 * Ends it IMMEDIATELY rather than flagging it `autoPlayStopping` and letting the loop wind down, because
 * the loop's exit is parked behind the whole bonus: `isAutoBetRoundBusy` holds for every free ball and
 * every overlay, and the player takes as long as they like over those. A wind-down would leave the HUD
 * showing a stopping-but-not-stopped run for the entire bonus and then fire "Autobet Finished" minutes
 * later, on top of the congratulations screen — announcing the end of a run that plainly ended when the
 * bonus began. Bumping the generation lets `playAutoRounds`, still parked in `waitForAutoBetRoundIdle`,
 * recognise itself as stale and return without a second toast.
 *
 * The round itself is untouched: the free balls were paid for by the wager the run already placed, so
 * this forfeits nothing — it only stops the NEXT wager from going out. Called from the bonus wheel's
 * trigger (`triggerRoulette('bonus')`) and, for the paths that award balls with no wheel in front of
 * them (resume, buy-bonus), from `awardBonusBalls` as the round opens. Idempotent and a no-op when no
 * run is live.
 */
export function endAutoBetForBonusRound(): void {
	if (!stateGame.autoPlayStarted) return;
	// Already winding down from a deliberate Stop press. The run places no further wagers either way and
	// both endings show the same toast, so there is nothing to add here — leave the exit to the loop,
	// which owns it.
	if (stateGame.autoPlayStopping) return;
	finishAutoBet('bonusTriggered');
}

/**
 * Stop the run — the player's own Stop press. The loop finishes without placing another wager
 * (`playAutoRounds` checks `autoPlayStopping` on the way out).
 *
 * Never reaches a bonus round: one of those ends the run outright the moment it triggers
 * (`endAutoBetForBonusRound`), so by the time free balls are on the board there is no run left to stop.
 */
export function stopAutoBet() {
	stateGame.autoPlayStopping = true;
	stateGame.autoMode = false;
}

async function playAutoRounds(roundsLeft: number, onBet: () => void, runId: number): Promise<void> {
	// This iteration belongs to a run that has already been ended elsewhere — a bonus trigger
	// (`endAutoBetForBonusRound`) or a fresh run started over the top of it. It is not ours to finish:
	// `finishAutoBet` has already run, so calling it again would only fire a duplicate toast.
	if (runId !== autoBetRunGeneration) return;
	cancelAutoBetDelay();
	if (!stateGame.autoPlayStarted || stateGame.autoPlayStopping) {
		finishAutoBet();
		return;
	}
	if (stateGame.autoPlayPausedByFreeSpin || stateGame.freeSpinRouletteOpen) {
		await autoBetDelay(AUTO_BET_INTER_ROUND_DELAY_MS);
		void playAutoRounds(roundsLeft, onBet, runId);
		return;
	}

	// The wallet can no longer cover this drop — the run has played as far as the balance goes. End it
	// here, on the "Insufficient Balance" toast, BEFORE dispatching a wager the bet path would only
	// refuse anyway (that refusal would stall until the round-start timeout and then report the run as
	// normally "Finished", telling the player nothing about why it stopped).
	if (!canFundNextAutoBetRound()) {
		finishAutoBet('insufficientBalance');
		return;
	}

	const placed = await placeAutoBetRound(onBet, runId);
	// Re-check first: a bonus fired inside the round we just waited on and ended the run mid-await.
	if (runId !== autoBetRunGeneration) return;
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
	if (runId !== autoBetRunGeneration) return;
	if (!stateGame.autoPlayStarted || stateGame.autoPlayStopping) {
		finishAutoBet();
		return;
	}
	void playAutoRounds(roundsLeft - 1, onBet, runId);
}

function finishAutoBet(
	reason: 'completed' | 'insufficientBalance' | 'bonusTriggered' = 'completed',
) {
	// Retire this run's identity so any loop iteration still in flight for it returns silently instead
	// of finishing it again — see `playAutoRounds`.
	autoBetRunGeneration += 1;
	cancelAutoBetDelay();
	stateGame.autoPlayStarted = false;
	stateGame.autoPlayStopping = false;
	stateGame.autoPlayPausedByFreeSpin = false;
	stateGame.autoMode = false;
	// Soft-lock recovery: if no round is actually in flight, clear any stuck submit/round lock
	// so the Play button stays responsive. Never clears while a round is still settling.
	//
	// ⚠️ NOT on a bonus stop. That run is ending INTO a live round — the wager is placed, the book is
	// mid-playback and the bonus is about to take the board — so there is by definition nothing stuck to
	// recover, and the guards below cannot see that yet: the flow's own flags are raised in the same
	// synchronous breath as this call (`beginRoulette`), and `bonusRoundActive` / `bonusBallsRemaining`
	// only follow once the player dismisses the wheel. Clearing `dropRoundActive` here would strip the
	// round mid-flight — `onCoinPegHit` ignores every peg without it, so the bonus's own energy meter
	// would stop filling.
	if (
		reason !== 'bonusTriggered' &&
		!stateXstateDerived.isPlaying() &&
		!isGameOngoing() &&
		!isBonusRoundInProgress() &&
		stateGame.bonusBallsRemaining <= 0
	) {
		stateGame.isSubmitting = false;
		stateGame.dropRoundActive = false;
	}
	// One toast slot, and only the balance earns its own wording: "Autobet Finished" tells a player whose
	// funds ran out nothing about why it stopped with rounds still on the counter. Every other ending —
	// ran its course, stopped by hand, ended by a bonus — reads as the same event to the player and says
	// so. A bonus stop needs no explaining here: the wheel arriving on the very next beat is the
	// explanation, and `reason` still separates it from the rest for the soft-lock guard above.
	showToast(reason === 'insufficientBalance' ? 'Insufficient Balance' : 'Autobet Finished');
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
