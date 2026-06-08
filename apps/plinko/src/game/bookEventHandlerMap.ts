import { stateBet } from 'state-shared';
import { createPlayBookUtils, recordBookEvent, type BookEventHandlerMap } from 'utils-book';

import { alignCoefficientSet, resolveOutcomeMultiplier } from '../game-logic/boardMultipliers';
import { eventEmitter } from './eventEmitter';
import { plinkoBallsPerDrop, plinkoStakePerBall, plinkoWagerAmount } from './plinkoBet';
import { resizePlinkoDropOutcomes } from './plinkoDropOutcomes';
import { startAuthoritativeBonusRound, waitForDropBatchCompletion } from './gameOrchestrator';
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
	flushPendingFreeSpinWalletBeforeEndRound,
	runFreeSpinTriggerFlow,
	sessionSpinMeterReachedMax,
} from '../features/freeSpin';
import { releaseRoundInteractionLocks, triggerRoulette, waitForRouletteClose } from './meterFlow';
import { checkIsPlinkoDeferredSettlement } from './plinkoRoundSettlement';
import { snapshotBalanceAfterPlay } from './plinkoWalletSync';
import type { Bet, BookEvent, BookEventOfType, BookEventContext } from './typesBookEvent';

export const bookEventHandlerMap: BookEventHandlerMap<BookEvent, BookEventContext> = {
	plinkoDrop: async (bookEvent: BookEventOfType<'plinkoDrop'>) => {
		const outcomes = Array.isArray(bookEvent.outcomes) ? bookEvent.outcomes : [];
		const hasAuthoritativeOutcomes = outcomes.some(
			(outcome) => outcome.hitBonusPeg != null || outcome.hitSpinSlot != null,
		);
		const ballsPerDrop = plinkoBallsPerDrop();
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
		const bookStake = bookEvent.stakePerBall > 0 ? bookEvent.stakePerBall : 1;
		stateGame.lastBookStakePerBall = bookStake;
		const stakeScale = plinkoStakePerBall() / bookStake;
		stateGame.bonusPegMeterCreditedBallIds = new Set();
		stateGame.spinSlotMeterCreditedBallIds = new Set();
		const coeffs = stateGame.coefficients;
		const scaledOutcomes = resizePlinkoDropOutcomes(outcomes, ballsPerDrop);
		stateGame.pendingOutcomes = scaledOutcomes.map((outcome) => ({
			...outcome,
			amount: outcome.amount * stakeScale,
			multiplier: resolveOutcomeMultiplier(outcome, coeffs),
		}));
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
		stateGame.serverBonusFreeBalls = bookEvent.freeBalls;
		stateGame.showBonusRoulette = true;
		triggerRoulette('bonus');
		await eventEmitter.broadcastAsync({
			type: 'bonusRouletteShow',
			freeBalls: bookEvent.freeBalls,
		});
		await waitForRouletteClose();
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
		stateBet.winBookEventAmount = bookEvent.amount;
	},
	finalWin: async (bookEvent: BookEventOfType<'finalWin'>) => {
		recordBookEvent({ bookEvent });
		stateBet.winBookEventAmount = bookEvent.amount;
		const payoutMultiplier = bookEvent.amount / 100;
		if (payoutMultiplier > 0) {
			await waitForDropBatchCompletion();
			stateGame.winPopupAmount =
				stateGame.pendingDropWinAmount || payoutMultiplier * stateBet.wageredBetAmount;
			stateGame.winPopupMultiplier =
				stateGame.freeSpinWinMultiplier > 0
					? stateGame.freeSpinWinMultiplier
					: payoutMultiplier;
			const deferForSessionFreeSpin =
				stateGame.authoritativeMeterFlow &&
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
	const events = Array.isArray(bet.state) ? bet.state : [];
	const normalizedBet: Bet = { ...bet, state: events };

	snapshotBalanceAfterPlay();
	stateGame.activeRoundBet = normalizedBet;
	stateBet.winBookEventAmount = 0;
	stateBet.wageredBetAmount = plinkoWagerAmount();
	stateGame.pendingDropWinAmount = 0;
	stateGame.winAmount = 0;
	stateGame.freeSpinWinMultiplier = 0;
	stateGame.deferWinPopupForFreeSpin = false;
	stateGame.dropRoundActive = true;
	stateGame.bonusPegMeterCreditedBallIds = new Set();
	stateGame.spinSlotMeterCreditedBallIds = new Set();
	stateGame.serverFreeSpinWinAmount = undefined;
	stateGame.freeSpinAwardedThisRound = false;
	stateGame.freeSpinSettledFromBook = false;
	stateGame.pendingFreeSpinWalletCredit = undefined;
	stateGame.authoritativeBonusOutcomes = [];
	stateGame.authoritativeBonusOutcomeIndex = 0;

	try {
		stateGame.roundDeferredSettlement = checkIsPlinkoDeferredSettlement(normalizedBet);
		stateGame.activeBookEvents = events;
		stateGame.authoritativeMeterFlow = bookEventsUseAuthoritativeMeterFlow(events);

		if (events.length > 0) {
			await playBookEvents(events);
			await ensureFreeSpinWhenSessionMeterFull(events, normalizedBet);
		}
	} finally {
		await syncSpinMeterAfterBet(events);
		await syncBonusMeterAfterBet(events);
		await flushPendingFreeSpinWalletBeforeEndRound();
		stateGame.freeSpinSettledFromBook = false;
		stateGame.authoritativeMeterFlow = false;
		if (!stateGame.bonusRoundActive) {
			stateGame.authoritativeBonusOutcomes = [];
			stateGame.authoritativeBonusOutcomeIndex = 0;
		}
		await releaseRoundInteractionLocks();
		stateGame.activeRoundBet = undefined;
	}
};
