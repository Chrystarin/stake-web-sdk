import { stateBet } from 'state-shared';
import { bookEventAmountToNormalisedAmount } from 'utils-shared/amount';
import { createPlayBookUtils, recordBookEvent, type BookEventHandlerMap } from 'utils-book';

import { alignCoefficientSet, resolveOutcomeMultiplier } from '../game-logic/boardMultipliers';
import { isSpinSlotRateIndex } from '../game-logic/spinSlot';
import { eventEmitter } from './eventEmitter';
import {
	plinkoBallsPerDrop,
	plinkoPlayAmount,
	plinkoStakePerBall,
	plinkoWagerAmount,
} from './plinkoBet';
import { resizePlinkoDropOutcomes } from './plinkoDropOutcomes';
import {
	beginRoundHistory,
	deferRapidSingleBallSettlement,
	enqueueAuthoritativeBonusLevel,
	isRapidSingleBallMode,
	isSingleBallMode,
	loadAuthoritativeBonusOutcomes,
	refreshRoundHistoryEntry,
	startAuthoritativeBonusRound,
	waitForBonusRoundCompletion,
	waitForDropBatchCompletion,
} from './gameOrchestrator';
import { isPlinkoBuyBonusMode, isPlinkoTriggerMode } from './plinkoBetMode';
import { applyAuthoritativeSpinMeterMax } from './plinkoMeterConfig';
import { runFreeSpinTriggerFlow } from '../features/freeSpin';
import { runBonusRouletteFlow } from '../features/bonus';
import { hasActiveRgsSession } from './plinkoSessionMeters';
import { meterController, stateGame } from './stateGame.svelte';
import { releaseRoundInteractionLocks } from './meterFlow';
import { checkIsPlinkoDeferredSettlement } from './plinkoRoundSettlement';
import {
	authoritativeSettlementEvents,
	normalizeAuthoritativeBet,
	preludeEventsForPlayback,
} from './authoritativeRoundBet';
import { alignBookForPlayback } from './alignBookForPlayback';
import { isPlinkoReplay } from './plinkoReplay';
import {
	bookBallsPerDrop as readBookBallsPerDrop,
	getPlinkoDropFromBet,
	plinkoDropMatchesUi,
	plinkoDropStratumMismatchMessage,
	readBetCriteria,
} from './plinkoDropBookShape';
import {
	applyBonusMeterBookEvent,
	applyBonusMeterDisplay,
	applySpinMeterBookEvent,
	applySpinMeterDisplay,
	bonusMeterBookValuesAreBetRelative,
	buildBetMetaPlayConditions,
	resolveRgsBonusLevelStart,
	resolveRgsBonusMeterStart,
	resolveRgsSpinMeterStart,
	spinMeterBookValuesAreBetRelative,
	syncBonusMeterAfterBet,
	syncSpinMeterAfterBet,
} from './plinkoSessionMeters';
import { applyRgsRoundWinFromBookEventAmount } from './rgsRoundWin';
import {
	logPlinkoWinMismatchIfNeeded,
	resetWinReconciliation,
	snapshotExpectedWinFromPlaybackOutcomes,
} from './plinkoWinReconciliation';
import { snapshotBalanceAfterPlay } from './plinkoWalletSync';
import { showToast } from './gameOrchestrator';
import type { Bet, BookEvent, BookEventOfType, BookEventContext } from './typesBookEvent';

const FEATURE_EVENT_TYPES = new Set<BookEvent['type']>([
	'spinMeter',
	'bonusMeter',
	'freeSpinTrigger',
	'bonusRoulette',
	'bonusRound',
]);

/** True when the served book carries authoritative meter / feature events. */
function bookHasFeatureEvents(events: BookEvent[]): boolean {
	return events.some((event) => FEATURE_EVENT_TYPES.has(event.type));
}

export const bookEventHandlerMap: BookEventHandlerMap<import('./typesBookEvent').BookEvent, BookEventContext> = {
	plinkoDrop: async (bookEvent: BookEventOfType<'plinkoDrop'>) => {
		const outcomes = Array.isArray(bookEvent.outcomes) ? bookEvent.outcomes : [];
		const ballsPerDrop = plinkoBallsPerDrop();
		const bookBallsPerDrop = readBookBallsPerDrop(bookEvent);
		// A BUY BONUS book is bonus-only and the math generates it at a FIXED reference balls-per-drop
		// (`BUY_BONUS_BALLS_PER_DROP_REF`) regardless of the player's selector — the buy's cost and EV are
		// balls-per-drop independent. So a mismatch here is by design, not a mis-served stratum, and
		// warning about it every buy is pure noise.
		const stratumMismatch =
			bookBallsPerDrop !== ballsPerDrop && !isPlinkoBuyBonusMode(stateBet.activeBetModeKey);
		if (stratumMismatch) {
			console.warn(
				`[plinko] book ballsPerDrop (${bookBallsPerDrop}) does not match UI (${ballsPerDrop}); check play meta / lookup stratum`,
				{
					servedCriteria: readBetCriteria(stateGame.activeRoundBet),
					expectedMeta: buildBetMetaPlayConditions(),
					hasRgsSession: hasActiveRgsSession(),
				},
			);
		}
		// `authoritativeMeterFlow` is set once per round in `playBet` from the book contents.
		stateGame.rowCount = bookEvent.rowCount;
		if (bookEvent.coefficients?.length) {
			// Align onto the board the BOOK's tier plays — the feature-free 1-ball tier has its own
			// table (paying center pocket), so aligning it to the shared board would zero that pocket.
			stateGame.coefficients = alignCoefficientSet(
				bookEvent.coefficients,
				bookEvent.ballsPerDrop ?? plinkoBallsPerDrop(),
			);
		}
		if (bookEvent.spinMeterMax && bookEvent.spinMeterMax > 0) {
			stateGame.spinMeterBaseMax = bookEvent.spinMeterMax;
			stateGame.spinMeterMax = bookEvent.spinMeterMax;
		}
		if (bookEvent.bonusMeterMax && bookEvent.bonusMeterMax > 0) {
			stateGame.bonusMeterBaseMax = bookEvent.bonusMeterMax;
			stateGame.bonusMeterMax = bookEvent.bonusMeterMax;
		}
		if (!stateGame.serverMeterLimitsActive) {
			meterController.setBallPerDrop(ballsPerDrop);
		}
		// Carry the session meters into this bet so they accumulate across rounds instead of
		// resetting. `betSpinMeterStart` = served book start, or the persisted session value when
		// the served (random) book ships start 0. Book meter values are then applied relative to it.
		if (!stateGame.bonusRoundActive) {
			const roundEvents = stateGame.activeBookEvents;
			stateGame.betSpinMeterStart = resolveRgsSpinMeterStart(bookEvent);
			stateGame.betBonusMeterStart = resolveRgsBonusMeterStart(bookEvent);
			stateGame.betBonusLevelStart = resolveRgsBonusLevelStart(bookEvent);
			stateGame.spinMeterBookValuesAreBetRelative = spinMeterBookValuesAreBetRelative(
				roundEvents,
				stateGame.betSpinMeterStart,
			);
			stateGame.bonusMeterBookValuesAreBetRelative = bonusMeterBookValuesAreBetRelative(
				roundEvents,
				stateGame.betBonusMeterStart,
			);
			// Show the carried-over value at the start of the round (animates upward from here).
			applySpinMeterDisplay(stateGame.betSpinMeterStart);
			// A bought bonus (trigger mode) is bonus-only and jumps straight to the bonus round; its book
			// opens with a FULL bonus_meter_start. Displaying that would flash the "Free Bonus" bar full and
			// then snap it to empty when the level-1 in-bonus meter starts, so keep it at the empty baseline.
			if (isPlinkoTriggerMode(stateBet.activeBetModeKey)) {
				applyBonusMeterDisplay(0, stateGame.betBonusLevelStart);
			} else {
				applyBonusMeterDisplay(stateGame.betBonusMeterStart, stateGame.betBonusLevelStart);
			}
		}
		const stakePerBall = plinkoStakePerBall();
		const bookStake = bookEvent.stakePerBall > 0 ? bookEvent.stakePerBall : 1;
		stateGame.lastBookStakePerBall = bookStake;
		const stakeScale =
			bookStake > 0 && Math.abs(stakePerBall - bookStake) > 1e-9
				? stakePerBall / bookStake
				: 1;
		const coeffs = stateGame.coefficients;
		// Never trim a mismatched RGS book to the UI ball count — that hides the wrong stratum.
		const outcomeBatch = stateGame.plinkoDropStratumMismatch
			? outcomes
			: resizePlinkoDropOutcomes(outcomes, ballsPerDrop);
		stateGame.pendingOutcomes = outcomeBatch.map((outcome) => {
			const hitSpinSlot =
				outcome.hitSpinSlot ??
				(coeffs.length > 0 && isSpinSlotRateIndex(outcome.rateIndex, coeffs.length));
			const normalized = {
				...outcome,
				amount: outcome.amount * stakeScale,
				hitSpinSlot,
			};
			return {
				...normalized,
				multiplier: hitSpinSlot ? 0 : resolveOutcomeMultiplier(normalized, coeffs),
			};
		});
		snapshotExpectedWinFromPlaybackOutcomes(stateGame.pendingOutcomes);
		stateGame.showWinPopup = false;
		if (isPlinkoTriggerMode(stateBet.activeBetModeKey)) {
			// BONUS trigger mode: its book carries an EMPTY initial drop (the bonus balls arrive via
			// `bonusRound`), so there's nothing to animate here. The free spin is NOT a trigger mode —
			// it fires in-drop inside the normal base book, whose real drop animates below.
			stateGame.isAnimating = false;
			return;
		}
		stateGame.isAnimating = true;
		await eventEmitter.broadcastAsync({
			type: 'plinkoDrop',
			outcomes: stateGame.pendingOutcomes,
			fastMode: stateGame.fastGameEnabled,
		});
		// Rapid 1-ball mode: the ball is spawned (above) and now animates on its own. DON'T await its
		// landing — settle the round immediately so the player can drop the next ball while this one is
		// still falling. This drop's win + balance are revealed when the ball lands (see `finalWin`'s
		// `deferRapidSingleBallSettlement` + `onBallLanded`), not here.
		if (isRapidSingleBallMode()) {
			stateGame.isAnimating = false;
			return;
		}
		await waitForDropBatchCompletion();
		stateGame.isAnimating = false;
	},
	spinMeter: async (bookEvent: BookEventOfType<'spinMeter'>) => {
		stateGame.authoritativeMeterFlow = true;
		if (bookEvent.max > 0) applyAuthoritativeSpinMeterMax(bookEvent.max);
		// Map the book value onto the carried session meter (bet-relative when the served book
		// starts at 0), updating both the HUD and the persisted session value.
		applySpinMeterBookEvent(bookEvent.value);
	},
	bonusMeter: async (bookEvent: BookEventOfType<'bonusMeter'>) => {
		stateGame.authoritativeMeterFlow = true;
		applyBonusMeterBookEvent(
			bookEvent.value,
			bookEvent.level ?? stateGame.bonusMeterLevel,
			(bookEvent as { max?: number }).max,
		);
	},
	freeSpinTrigger: async (bookEvent: BookEventOfType<'freeSpinTrigger'>) => {
		// 1-ball is a feature-free mode: never run a free spin, even if a served book carries the event
		// (in production the onedrop math should not emit one — warn so a mis-published book is visible).
		if (isSingleBallMode()) {
			if (import.meta.env.DEV) {
				console.warn('[plinko] freeSpinTrigger ignored — 1-ball tier is feature-free');
			}
			return;
		}
		await waitForDropBatchCompletion();
		const payload = {
			segment: bookEvent.segment,
			multiplier: bookEvent.multiplier,
			amount: bookEvent.amount,
		};
		// In-bonus free spin: this event is tagged with the bonus `level` whose balls it follows. The
		// bonus balls are still dropping (player/auto-driven), so QUEUE it and let
		// `settleBonusRoundWhenFinished` run the wheel at that level's boundary — AFTER the level's balls
		// finish but BEFORE the level-up — adding `stake × M` to the bonus total. A book can carry one
		// per level (the spin meter re-fills per level), so multiple queue up. A base in-drop free spin
		// (no bonus active) runs the wheel immediately.
		if (stateGame.bonusRoundActive || stateGame.bonusBallsRemaining > 0) {
			const level = Math.max(1, Math.floor(bookEvent.level ?? stateGame.bonusLevelProgress ?? 1));
			stateGame.pendingBonusFreeSpins = [
				...stateGame.pendingBonusFreeSpins,
				{ level, ...payload },
			];
			stateGame.pendingBonusFreeSpinPayload = payload;
			stateGame.pendingSpinRouletteAfterBonusLevelDepletion = true;
			return;
		}
		// Run the free-spin wheel; it lands on the math-authored segment and awaits close.
		await runFreeSpinTriggerFlow(payload);
	},
	bonusRoulette: async (bookEvent: BookEventOfType<'bonusRoulette'>) => {
		// 1-ball is a feature-free mode: never open the bonus wheel / start a bonus here.
		if (isSingleBallMode()) {
			if (import.meta.env.DEV) {
				console.warn('[plinko] bonusRoulette ignored — 1-ball tier is feature-free');
			}
			return;
		}
		// BUY BONUS resume: the entry wheel already played when the bonus was purchased. Re-showing it
		// on resume is wrong — skip straight to the bonus round. The `bonusRound` event that follows sees
		// `!bonusRoundActive` and runs its documented resume path (`startAuthoritativeBonusRound`), which
		// drops only the remaining balls and then shows the congratulations announcement.
		if (stateGame.resumingActiveRound && isPlinkoTriggerMode(stateBet.activeBetModeKey)) {
			return;
		}
		// Bonus wheel: awards the level-1 entry free balls (`onBonusRouletteFinished`).
		await waitForDropBatchCompletion();
		await runBonusRouletteFlow(bookEvent.freeBalls);
	},
	bonusRound: async (bookEvent: BookEventOfType<'bonusRound'>) => {
		// 1-ball is a feature-free mode: never play out a bonus round here.
		if (isSingleBallMode()) {
			if (import.meta.env.DEV) {
				console.warn('[plinko] bonusRound ignored — 1-ball tier is feature-free');
			}
			return;
		}
		await waitForDropBatchCompletion();
		const outcomes = Array.isArray(bookEvent.outcomes) ? bookEvent.outcomes : [];
		const level = Math.max(1, Math.floor(bookEvent.level ?? 1));
		const freeBalls = Math.max(0, Math.floor(bookEvent.freeBalls ?? outcomes.length));
		const ballsPlayed = Math.max(0, Math.floor(bookEvent.ballsPlayed ?? 0));
		// Escalating per-level energy-bar threshold (pegs to leave THIS level). 0 = legacy book → keep the
		// flat meter max from the `bonusMeter` event.
		const levelupPegs = Math.max(0, Math.floor(bookEvent.levelupPegs ?? 0));
		if (!stateGame.bonusRoundActive) {
			// No preceding wheel award (e.g. resume) — start the round and award balls.
			startAuthoritativeBonusRound(freeBalls, outcomes, level, ballsPlayed, levelupPegs);
			return;
		}
		if (level <= stateGame.bonusLevelProgress) {
			// Entry level: balls were just awarded by the bonus wheel; load their outcomes.
			loadAuthoritativeBonusOutcomes(outcomes, ballsPlayed);
			return;
		}
		// True level-up: play after the current level's balls finish (book-driven, no RNG).
		enqueueAuthoritativeBonusLevel(freeBalls, outcomes, level, levelupPegs);
	},
	setTotalWin: async (bookEvent: BookEventOfType<'setTotalWin'>) => {
		// Rapid 1-ball mode reveals the win on ball-land (see `finalWin`), so don't apply a partial win
		// to the HUD here — it would show before the ball reaches a slot.
		if (isRapidSingleBallMode()) return;
		await waitForDropBatchCompletion();
		logPlinkoWinMismatchIfNeeded(bookEvent.amount, 'setTotalWin');
		applyRgsRoundWinFromBookEventAmount(bookEvent.amount);
		refreshRoundHistoryEntry();
	},
	finalWin: async (bookEvent: BookEventOfType<'finalWin'>) => {
		recordBookEvent({ bookEvent });
		// Rapid 1-ball mode: settle now (don't wait for the ball) but DEFER the visible win + balance to
		// when the ball lands. Keep `winBookEventAmount` so the authoritative balance still credits the
		// win (dev-local reads it; RGS is authoritative in production); the shadow balance holds it back.
		if (isRapidSingleBallMode()) {
			stateBet.winBookEventAmount = bookEvent.amount;
			deferRapidSingleBallSettlement(
				stateGame.pendingOutcomes[0],
				bookEventAmountToNormalisedAmount(bookEvent.amount),
			);
			return;
		}
		await waitForDropBatchCompletion();
		logPlinkoWinMismatchIfNeeded(bookEvent.amount, 'finalWin');
		// One book, one settlement: `finalWin` = drop + (free spin's stake×M, if it fired in-drop).
		const payoutMultiplier = bookEvent.amount / 100;
		if (payoutMultiplier > 0) {
			applyRgsRoundWinFromBookEventAmount(bookEvent.amount);
			stateGame.winPopupMultiplier = payoutMultiplier;
			// Only celebrate a genuine profit. NOTE: `payoutMultiplier` is normalized to the PER-BALL
			// stake (e.g. 8.1× on a 10-ball drop), NOT win ÷ total-bet — so it can't gate this. Compare
			// the round's currency win (`winPopupAmount`, set by the call above) against the total amount
			// wagered this drop (per-ball stake × balls). A sub-stake return skips the modal but still
			// updates the HUD Win field.
			const winCoversTotalBet = stateGame.winPopupAmount >= plinkoWagerAmount();
			// A round that played a bonus is presented by the post-bonus congratulations screen, which is
			// still covering the view at this point and already shows the round's total (`bonusEndWinAmount`).
			// A full-screen celebration on top of it would be the same number a second time, so this round
			// gets NO win presentation here. Skipping it also drops the `balanceWinHold` pin, so the balance
			// credits behind that screen (see `isBonusRoundBlockingSettlement`) rather than being held back
			// for a celebration that never runs.
			if (!stateGame.bonusAwardedThisRound) {
				if (winCoversTotalBet && !stateGame.showWinPopup) {
					// Pin the DISPLAYED balance at its pre-win value BEFORE this win is credited (the credit
					// lands after playBet resolves). The WinCelebration holds it here, then counts it up once
					// the coins have merged and the "+win" float has slid — so it never jumps ahead of the
					// animation. Cleared by the count-up in Game.svelte (or the celebration's teardown safety).
					stateGame.balanceWinHold = stateBet.balanceAmount;
					stateGame.showWinPopup = true;
					eventEmitter.broadcast({ type: 'soundOnce', name: 'win' });
				} else if (!winCoversTotalBet) {
					// Sub-stake multi-ball win: no win modal, but the round still PAID — throw a small skull→
					// balance coin burst so the credit still feels collected. (Rapid 1-ball already returned
					// above with its own per-land bursts, so this only fires for 10/20/50-ball drops.)
					stateGame.minorWinCoinBurstAmount = stateGame.winPopupAmount;
					stateGame.minorWinCoinBurstTick++;
				}
			}
		}
		// Settle the round's My Bet History row to the authoritative total (base + bonus + free spin).
		refreshRoundHistoryEntry();
	},
};

export const { playBookEvent, playBookEvents } = createPlayBookUtils({ bookEventHandlerMap });

export const playBet = async (bet: Bet) => {
	const authoritativeBet = normalizeAuthoritativeBet(bet);
	const authoritativeEvents = authoritativeBet.state ?? [];
	const playbackBet = alignBookForPlayback(authoritativeBet);
	const playbackEvents = playbackBet.state ?? [];
	const prelude = preludeEventsForPlayback(authoritativeEvents, playbackEvents);
	const settlement = authoritativeSettlementEvents(authoritativeEvents);

	snapshotBalanceAfterPlay();
	const authoritativeDrop = getPlinkoDropFromBet(authoritativeBet);
	// Replay aligned the UI tier to the book (`alignPlinkoUiToReplayBook`), so the served drop is
	// authoritative — never treat it as a stratum mismatch (which would suppress the resize-to-UI and
	// pop an error toast over the replay). A BUY-BONUS (trigger mode) book carries an intentionally
	// EMPTY drop (balls arrive via `bonusRound`), so its drop resolves to 1 ball and would ALWAYS
	// mismatch the 10/20/50-ball UI tier the purchase was made on. That false mismatch then suppresses
	// the per-ball `addSettledWinAmount` in `onBallLanded` (WIN counter frozen at $0 through the whole
	// bonus) and lets the in-bonus free spin credit `stake×M` onto a $0 base. Skip the check for trigger
	// modes — the real balls are the `bonusRound` outcomes, not this placeholder drop.
	stateGame.plinkoDropStratumMismatch =
		isPlinkoReplay() || isPlinkoTriggerMode(stateBet.activeBetModeKey)
			? false
			: !plinkoDropMatchesUi(authoritativeDrop);
	if (stateGame.plinkoDropStratumMismatch) {
		const message = plinkoDropStratumMismatchMessage(authoritativeDrop, undefined, authoritativeBet);
		if (message) showToast(message, 'error');
		if (import.meta.env.DEV) {
			console.error('[plinko] stratum mismatch', {
				uiBalls: plinkoBallsPerDrop(),
				bookBalls: readBookBallsPerDrop(authoritativeDrop),
				servedCriteria: readBetCriteria(authoritativeBet),
				playMeta: buildBetMetaPlayConditions(),
			});
		}
	}
	stateGame.activeRoundBet = authoritativeBet;
	// `wageredBetAmount` is the amount `payoutMultiplier` multiplies for win display — it must
	// equal the RGS play `amount` (per-ball stake), not the total wager (amount × cost). RGS
	// credits `amount × payoutMultiplier`, so the displayed win then matches the balance credit.
	stateBet.wageredBetAmount = plinkoPlayAmount();
	stateBet.winBookEventAmount = 0;
	resetWinReconciliation();
	stateGame.pendingDropWinAmount = 0;
	stateGame.baseRoundDropWinAmount = 0;
	// Blank the Win field at bet time so every new drop starts from €0.00. The value is re-shown
	// only when the ball lands (`onBallLanded` reveals each ball's stashed win). The pending win lives
	// in `outcomeLandCredit` (a WeakMap keyed on the outcome), so this reset never drops it.
	// EXCEPTION — rapid 1-ball mode: do NOT clear here. The Win field keeps showing the previous ball's
	// win while the freshly dropped ball is still falling, and is overwritten only when the next ball
	// lands in a slot (`onBallLanded` sets `winAmount` to that ball's win, or 0 for a losing slot).
	if (!isRapidSingleBallMode()) {
		stateGame.winAmount = 0;
	}
	stateGame.deferWinPopupForFreeSpin = false;
	// Per-round feature flags MUST reset each bet, otherwise `syncSpinMeterAfterBet` /
	// `syncBonusMeterAfterBet` keep treating every later bet as "feature consumed" and wipe the
	// carried meter to 0 on every bet after a feature once fired.
	stateGame.freeSpinAwardedThisRound = false;
	stateGame.freeSpinSettledFromBook = false;
	if (!stateGame.bonusRoundActive) {
		stateGame.bonusAwardedThisRound = false;
	}
	// Per-ball meter-credit dedup is per drop. These sets were never cleared, so once the Pixi
	// engine is rebuilt (HMR / remount / orientation change) its ball IDs restart at 1 and collide
	// with stale IDs — which silently suppressed the live meter fill, freezing the meter during the
	// drop and then snapping it to the book value afterwards. Reset each round so every drop's
	// spin-slot / coin-peg hits credit the meter in real time.
	stateGame.spinSlotMeterCreditedBallIds = new Set();
	stateGame.bonusPegMeterCreditedBallIds = new Set();
	stateGame.dropRoundActive = true;
	// Open this round's single My Bet History row (base game + bonus + free spin fold into it).
	beginRoundHistory();
	stateGame.authoritativeBonusLevelQueue = [];
	// Stale in-bonus free-spin payload must not carry across bets (set later by this book's
	// `freeSpinTrigger` event if a free spin fires during the bonus round).
	stateGame.pendingBonusFreeSpinPayload = undefined;
	// The trigger mode was already captured into `activeBetModeKey`; clear so we don't re-fire it.
	stateGame.pendingFeatureTrigger = null;

	try {
		stateGame.roundDeferredSettlement = checkIsPlinkoDeferredSettlement(authoritativeBet);
		stateGame.activeBookEvents = authoritativeEvents;
		// Feature events (meters / wheels / bonus rounds) are authoritative when present.
		stateGame.authoritativeMeterFlow = bookHasFeatureEvents(authoritativeEvents);

		if (authoritativeEvents.length > 0) {
			await playBookEvents(prelude);
			// Player-driven bonus balls + feature wheels finish before book settlement so
			// `finalWin` reflects the full on-screen total.
			await waitForBonusRoundCompletion();
			if (settlement.length > 0) {
				await playBookEvents(settlement);
			}
		}
		// Persist the running meters so they carry into the next round (reset to 0 only when a
		// free spin / bonus consumed the meter this round).
		await syncSpinMeterAfterBet(authoritativeEvents);
		await syncBonusMeterAfterBet(authoritativeEvents);
	} finally {
		stateGame.authoritativeMeterFlow = false;
		// Resume playback is done — later fresh bets must not be treated as a resume.
		stateGame.resumingActiveRound = false;
		// Rapid 1-ball mode: keep the still-falling ball's outcome map intact so it credits on landing
		// (the round settles here while its ball is mid-drop). Other modes get the full reset.
		await releaseRoundInteractionLocks(isRapidSingleBallMode());
		stateGame.activeRoundBet = undefined;
	}
};
