import { stateBet } from 'state-shared';
import { createPlayBookUtils, recordBookEvent, type BookEventHandlerMap } from 'utils-book';

import { alignCoefficientSet, resolveOutcomeMultiplier } from '../game-logic/boardMultipliers';
import { isSpinSlotRateIndex } from '../game-logic/spinSlot';
import { eventEmitter } from './eventEmitter';
import { plinkoBallsPerDrop, plinkoPlayAmount, plinkoStakePerBall } from './plinkoBet';
import { resizePlinkoDropOutcomes } from './plinkoDropOutcomes';
import {
	enqueueAuthoritativeBonusLevel,
	loadAuthoritativeBonusOutcomes,
	startAuthoritativeBonusRound,
	waitForBonusRoundCompletion,
	waitForDropBatchCompletion,
} from './gameOrchestrator';
import { isPlinkoTriggerMode } from './plinkoBetMode';
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
		const stratumMismatch = bookBallsPerDrop !== ballsPerDrop;
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
			stateGame.coefficients = alignCoefficientSet(bookEvent.coefficients);
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
			applyBonusMeterDisplay(stateGame.betBonusMeterStart, stateGame.betBonusLevelStart);
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
		applyBonusMeterBookEvent(bookEvent.value, bookEvent.level ?? stateGame.bonusMeterLevel);
	},
	freeSpinTrigger: async (bookEvent: BookEventOfType<'freeSpinTrigger'>) => {
		await waitForDropBatchCompletion();
		const payload = {
			segment: bookEvent.segment,
			multiplier: bookEvent.multiplier,
			amount: bookEvent.amount,
		};
		// In-bonus free spin: this event is appended AFTER the bonus-round events, so the bonus balls
		// are still dropping (player/auto-driven). Stash the math-authored segment and let
		// `settleBonusRoundWhenFinished` run the wheel once the bonus balls finish — its win adds to the
		// bonus total. A base in-drop free spin (no bonus active) runs the wheel immediately.
		if (stateGame.bonusRoundActive || stateGame.bonusBallsRemaining > 0) {
			stateGame.pendingBonusFreeSpinPayload = payload;
			stateGame.pendingSpinRouletteAfterBonusLevelDepletion = true;
			return;
		}
		// Run the free-spin wheel; it lands on the math-authored segment and awaits close.
		await runFreeSpinTriggerFlow(payload);
	},
	bonusRoulette: async (bookEvent: BookEventOfType<'bonusRoulette'>) => {
		// Bonus wheel: awards the level-1 entry free balls (`onBonusRouletteFinished`).
		await waitForDropBatchCompletion();
		await runBonusRouletteFlow(bookEvent.freeBalls);
	},
	bonusRound: async (bookEvent: BookEventOfType<'bonusRound'>) => {
		await waitForDropBatchCompletion();
		const outcomes = Array.isArray(bookEvent.outcomes) ? bookEvent.outcomes : [];
		const level = Math.max(1, Math.floor(bookEvent.level ?? 1));
		const freeBalls = Math.max(0, Math.floor(bookEvent.freeBalls ?? outcomes.length));
		const ballsPlayed = Math.max(0, Math.floor(bookEvent.ballsPlayed ?? 0));
		if (!stateGame.bonusRoundActive) {
			// No preceding wheel award (e.g. resume) — start the round and award balls.
			startAuthoritativeBonusRound(freeBalls, outcomes, level, ballsPlayed);
			return;
		}
		if (level <= stateGame.bonusLevelProgress) {
			// Entry level: balls were just awarded by the bonus wheel; load their outcomes.
			loadAuthoritativeBonusOutcomes(outcomes, ballsPlayed);
			return;
		}
		// True level-up: play after the current level's balls finish (book-driven, no RNG).
		enqueueAuthoritativeBonusLevel(freeBalls, outcomes, level);
	},
	setTotalWin: async (bookEvent: BookEventOfType<'setTotalWin'>) => {
		await waitForDropBatchCompletion();
		logPlinkoWinMismatchIfNeeded(bookEvent.amount, 'setTotalWin');
		applyRgsRoundWinFromBookEventAmount(bookEvent.amount);
	},
	finalWin: async (bookEvent: BookEventOfType<'finalWin'>) => {
		recordBookEvent({ bookEvent });
		await waitForDropBatchCompletion();
		logPlinkoWinMismatchIfNeeded(bookEvent.amount, 'finalWin');
		// One book, one settlement: `finalWin` = drop + (free spin's stake×M, if it fired in-drop).
		const payoutMultiplier = bookEvent.amount / 100;
		if (payoutMultiplier > 0) {
			applyRgsRoundWinFromBookEventAmount(bookEvent.amount);
			stateGame.winPopupMultiplier = payoutMultiplier;
			if (!stateGame.showWinPopup) {
				stateGame.showWinPopup = true;
				eventEmitter.broadcast({ type: 'soundOnce', name: 'win' });
			}
		}
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
	stateGame.plinkoDropStratumMismatch = !plinkoDropMatchesUi(authoritativeDrop);
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
	stateGame.winAmount = 0;
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
		await releaseRoundInteractionLocks();
		stateGame.activeRoundBet = undefined;
	}
};
