import { stateBet } from 'state-shared';
import { createPlayBookUtils, recordBookEvent, type BookEventHandlerMap } from 'utils-book';

import { alignCoefficientSet, resolveOutcomeMultiplier } from '../game-logic/boardMultipliers';
import { isSpinSlotRateIndex } from '../game-logic/spinSlot';
import { eventEmitter } from './eventEmitter';
import { plinkoBallsPerDrop, plinkoStakePerBall, plinkoWagerAmount } from './plinkoBet';
import { resizePlinkoDropOutcomes } from './plinkoDropOutcomes';
import {
	startAuthoritativeBonusRound,
	waitForBonusRoundCompletion,
	waitForDropBatchCompletion,
} from './gameOrchestrator';
import {
	applyAuthoritativeMeterConfig,
	applyAuthoritativeSpinMeterMax,
} from './plinkoMeterConfig';
import {
	applyBonusMeterBookEvent,
	applySpinMeterBookEvent,
	bonusMeterBookValuesAreBetRelative,
	resolveRgsBonusLevelStart,
	resolveRgsBonusMeterStart,
	resolveRgsSpinMeterStart,
	spinMeterBookValuesAreBetRelative,
	syncBonusMeterAfterBet,
	syncSpinMeterAfterBet,
} from './plinkoSessionMeters';
import { meterController, stateGame } from './stateGame.svelte';
import {
	bookHasFreeSpinTrigger,
	ensureFreeSpinWhenSessionMeterFull,
	runFreeSpinTriggerFlow,
	sessionSpinMeterReachedMax,
} from '../features/freeSpin';
import {
	ensureBonusWhenSessionMeterFull,
	runBonusRouletteFlow,
	scheduleBonusRouletteIfMeterFullIdle,
} from '../features/bonus';
import { releaseRoundInteractionLocks } from './meterFlow';
import {
	bookRequiresBonusPlayCompletion,
	checkIsPlinkoDeferredSettlement,
} from './plinkoRoundSettlement';
import {
	authoritativeSettlementEvents,
	normalizeAuthoritativeBet,
	preludeEventsForPlayback,
} from './authoritativeRoundBet';
import { alignBookForPlayback } from './alignBookForPlayback';
import { applyRgsRoundWinFromBookEventAmount } from './rgsRoundWin';
import { snapshotBalanceAfterPlay } from './plinkoWalletSync';
import type { Bet, BookEvent, BookEventOfType, BookEventContext } from './typesBookEvent';

export const bookEventHandlerMap: BookEventHandlerMap<BookEvent, BookEventContext> = {
	plinkoDrop: async (bookEvent: BookEventOfType<'plinkoDrop'>) => {
		const outcomes = Array.isArray(bookEvent.outcomes) ? bookEvent.outcomes : [];
		const hasAuthoritativeOutcomes = outcomes.some(
			(outcome) => outcome.hitBonusPeg != null || outcome.hitSpinSlot != null,
		);
		const ballsPerDrop = plinkoBallsPerDrop();
		const bookBallsPerDrop = Math.max(1, bookEvent.ballsPerDrop ?? outcomes.length);
		if (bookBallsPerDrop !== ballsPerDrop) {
			console.warn(
				`[plinko] book ballsPerDrop (${bookBallsPerDrop}) does not match UI (${ballsPerDrop}); check play meta / lookup stratum`,
			);
		}
		stateGame.authoritativeMeterFlow = hasAuthoritativeOutcomes;
		stateGame.rowCount = bookEvent.rowCount;
		if (bookEvent.coefficients?.length) {
			stateGame.coefficients = alignCoefficientSet(bookEvent.coefficients);
		}
		if (hasAuthoritativeOutcomes) {
			const spinMeterStart = resolveRgsSpinMeterStart(bookEvent);
			const bonusMeterStart = resolveRgsBonusMeterStart(bookEvent);
			const bonusLevelStart = resolveRgsBonusLevelStart(bookEvent);
			stateGame.betSpinMeterStart = spinMeterStart;
			stateGame.betBonusMeterStart = bonusMeterStart;
			stateGame.betBonusLevelStart = bonusLevelStart;
			stateGame.spinMeterBookValuesAreBetRelative = spinMeterBookValuesAreBetRelative(
				stateGame.activeBookEvents,
				spinMeterStart,
			);
			stateGame.bonusMeterBookValuesAreBetRelative = bonusMeterBookValuesAreBetRelative(
				stateGame.activeBookEvents,
				bonusMeterStart,
			);
			applyAuthoritativeMeterConfig({
				spinMeterMax: bookEvent.spinMeterMax,
				bonusMeterMax: bookEvent.bonusMeterMax,
				spinMeterStart,
				bonusMeterStart,
				bonusLevelStart,
			});
		} else {
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
		}
		const stakePerBall = plinkoStakePerBall();
		const bookStake = bookEvent.stakePerBall > 0 ? bookEvent.stakePerBall : 1;
		stateGame.lastBookStakePerBall = bookStake;
		// Playback may scale legacy dev books; settlement stays on the served book.
		const stakeScale =
			bookStake > 0 && Math.abs(stakePerBall - bookStake) > 1e-9
				? stakePerBall / bookStake
				: 1;
		stateGame.bonusPegMeterCreditedBallIds = new Set();
		stateGame.spinSlotMeterCreditedBallIds = new Set();
		const coeffs = stateGame.coefficients;
		const scaledOutcomes = resizePlinkoDropOutcomes(outcomes, ballsPerDrop);
		stateGame.pendingOutcomes = scaledOutcomes.map((outcome) => {
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
		stateGame.isAnimating = true;
		stateGame.showWinPopup = false;
		await eventEmitter.broadcastAsync({
			type: 'plinkoDrop',
			outcomes: stateGame.pendingOutcomes,
			fastMode: stateGame.fastGameEnabled,
		});
		// Wait for every ball to land before spin/bonus meter book events run.
		await waitForDropBatchCompletion();
		stateGame.isAnimating = false;
	},
	bonusMeter: async (bookEvent: BookEventOfType<'bonusMeter'>) => {
		const nextValue = bookEvent.value;
		if (stateGame.authoritativeMeterFlow) {
			applyBonusMeterBookEvent(nextValue, bookEvent.level);
		} else {
			const shouldIgnoreDecrease =
				!stateGame.rouletteFlowInProgress &&
				!stateGame.bonusRoundActive &&
				nextValue < stateGame.bonusMeterValue;
			if (!shouldIgnoreDecrease) stateGame.bonusMeterValue = nextValue;
		}
		stateGame.bonusMeterLevel = bookEvent.level;
		eventEmitter.broadcast({
			type: 'bonusMeterUpdate',
			value: stateGame.bonusMeterValue,
			level: bookEvent.level,
		});
	},
	bonusRoulette: async (bookEvent: BookEventOfType<'bonusRoulette'>) => {
		await runBonusRouletteFlow(bookEvent.freeBalls);
	},
	spinMeter: async (bookEvent: BookEventOfType<'spinMeter'>) => {
		const nextValue = bookEvent.value;
		if (stateGame.authoritativeMeterFlow) {
			applySpinMeterBookEvent(nextValue);
		} else {
			const shouldIgnoreDecrease =
				!stateGame.rouletteFlowInProgress && nextValue < stateGame.spinMeterValue;
			if (!shouldIgnoreDecrease) stateGame.spinMeterValue = nextValue;
		}
		if (bookEvent.max > 0) {
			if (stateGame.authoritativeMeterFlow) {
				applyAuthoritativeSpinMeterMax(bookEvent.max);
			} else {
				stateGame.spinMeterBaseMax = bookEvent.max;
				meterController.setBallPerDrop(plinkoBallsPerDrop());
			}
		}
	},
	freeSpinTrigger: async (bookEvent: BookEventOfType<'freeSpinTrigger'>) => {
		recordBookEvent({ bookEvent });
		stateGame.freeSpinSettledFromBook = true;
		await runFreeSpinTriggerFlow(bookEvent);
	},
	bonusRound: async (bookEvent: BookEventOfType<'bonusRound'>) => {
		const bookStake =
			bookEvent.outcomes[0]?.amount > 0
				? bookEvent.outcomes[0].amount
				: stateGame.lastBookStakePerBall > 0
					? stateGame.lastBookStakePerBall
					: 1;
		const stakeScale = plinkoStakePerBall() / bookStake;
		const coeffs = stateGame.coefficients;
		const scaledOutcomes = bookEvent.outcomes.map((outcome) => ({
			...outcome,
			amount: outcome.amount * stakeScale,
			multiplier: resolveOutcomeMultiplier(outcome, coeffs),
		}));
		startAuthoritativeBonusRound(
			bookEvent.freeBalls,
			scaledOutcomes,
			bookEvent.level,
			bookEvent.ballsPlayed ?? 0,
		);
	},
	setTotalWin: async (bookEvent: BookEventOfType<'setTotalWin'>) => {
		applyRgsRoundWinFromBookEventAmount(bookEvent.amount);
	},
	finalWin: async (bookEvent: BookEventOfType<'finalWin'>) => {
		recordBookEvent({ bookEvent });
		const payoutMultiplier = bookEvent.amount / 100;
		if (payoutMultiplier > 0) {
			await waitForDropBatchCompletion();
			applyRgsRoundWinFromBookEventAmount(bookEvent.amount);
			stateGame.winPopupMultiplier =
				stateGame.freeSpinWinMultiplier > 0
					? stateGame.freeSpinWinMultiplier
					: payoutMultiplier;
			const deferForSessionFreeSpin =
				stateGame.authoritativeMeterFlow &&
				!stateGame.freeSpinAwardedThisRound &&
				!bookHasFreeSpinTrigger(stateGame.activeBookEvents) &&
				sessionSpinMeterReachedMax(stateGame.activeBookEvents);
			stateGame.deferWinPopupForFreeSpin = deferForSessionFreeSpin;
			if (!deferForSessionFreeSpin && !stateGame.showWinPopup) {
				stateGame.showWinPopup = true;
				eventEmitter.broadcast({ type: 'soundOnce', name: 'win' });
			}
		}
	},
};

export const { playBookEvent, playBookEvents } = createPlayBookUtils({ bookEventHandlerMap });

function bookEventsUseAuthoritativeMeterFlow(events: BookEvent[]): boolean {
	return events.some(
		(event) =>
			event.type === 'spinMeter' ||
			event.type === 'bonusMeter' ||
			event.type === 'bonusRoulette' ||
			event.type === 'bonusRound' ||
			event.type === 'freeSpinTrigger' ||
			(event.type === 'plinkoDrop' &&
				Array.isArray(event.outcomes) &&
				event.outcomes.some(
					(outcome) => outcome.hitBonusPeg != null || outcome.hitSpinSlot != null,
				)),
	);
}

export const playBet = async (bet: Bet) => {
	const authoritativeBet = normalizeAuthoritativeBet(bet);
	const authoritativeEvents = authoritativeBet.state ?? [];
	const playbackBet = alignBookForPlayback(authoritativeBet);
	const playbackEvents = playbackBet.state ?? [];
	const prelude = preludeEventsForPlayback(authoritativeEvents, playbackEvents);
	const settlement = authoritativeSettlementEvents(authoritativeEvents);

	snapshotBalanceAfterPlay();
	stateGame.activeRoundBet = authoritativeBet;
	stateBet.wageredBetAmount = plinkoWagerAmount();
	stateBet.winBookEventAmount = 0;
	stateGame.pendingDropWinAmount = 0;
	stateGame.baseRoundDropWinAmount = 0;
	stateGame.bonusAwardedThisRound = false;
	stateGame.winAmount = 0;
	stateGame.bonusSessionWinAmount = 0;
	stateGame.freeSpinWinMultiplier = 0;
	stateGame.freeSpinBaseRoundWin = 0;
	stateGame.freeSpinTriggerPayload = undefined;
	stateGame.deferWinPopupForFreeSpin = false;
	stateGame.dropRoundActive = true;
	stateGame.bonusPegMeterCreditedBallIds = new Set();
	stateGame.spinSlotMeterCreditedBallIds = new Set();
	stateGame.serverFreeSpinWinAmount = undefined;
	stateGame.freeSpinAwardedThisRound = false;
	stateGame.freeSpinSettledFromBook = false;
	stateGame.authoritativeBonusOutcomes = [];
	stateGame.authoritativeBonusOutcomeIndex = 0;

	try {
		stateGame.roundDeferredSettlement = checkIsPlinkoDeferredSettlement(authoritativeBet);
		stateGame.activeBookEvents = authoritativeEvents;
		stateGame.authoritativeMeterFlow = bookEventsUseAuthoritativeMeterFlow(authoritativeEvents);

		if (authoritativeEvents.length > 0) {
			// Prelude may use dev playback alignment; settlement always from the served book.
			await playBookEvents(prelude);
			await ensureBonusWhenSessionMeterFull(authoritativeEvents, authoritativeBet);
			const needsBonusCompletion =
				stateGame.bonusBallsRemaining > 0 ||
				stateGame.bonusRoundActive ||
				bookRequiresBonusPlayCompletion(authoritativeEvents);
			if (needsBonusCompletion) {
				await waitForBonusRoundCompletion();
			}
			await ensureFreeSpinWhenSessionMeterFull(authoritativeEvents, authoritativeBet);
			if (settlement.length > 0) {
				await playBookEvents(settlement);
			}
		}
	} finally {
		await syncSpinMeterAfterBet(authoritativeEvents);
		await syncBonusMeterAfterBet(authoritativeEvents);
		scheduleBonusRouletteIfMeterFullIdle();
		stateGame.freeSpinSettledFromBook = false;
		stateGame.authoritativeMeterFlow = false;
		if (!stateGame.bonusRoundActive) {
			stateGame.authoritativeBonusOutcomes = [];
			stateGame.authoritativeBonusOutcomeIndex = 0;
		}
		stateGame.baseRoundDropWinAmount = 0;
		stateGame.bonusAwardedThisRound = false;
		await releaseRoundInteractionLocks();
		stateGame.activeRoundBet = undefined;
	}
};
