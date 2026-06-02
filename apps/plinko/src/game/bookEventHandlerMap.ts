import { stateBet } from 'state-shared';
import { createPlayBookUtils, type BookEventHandlerMap } from 'utils-book';

import { eventEmitter } from './eventEmitter';
import { plinkoStakePerBall, plinkoWagerAmount } from './plinkoBet';
import { startAuthoritativeBonusRound, waitForDropBatchCompletion } from './gameOrchestrator';
import {
	applyAuthoritativeMeterConfig,
	applyAuthoritativeSpinMeterMax,
} from './plinkoMeterConfig';
import {
	applySpinMeterBookEvent,
	resolveRgsSpinMeterStart,
	spinMeterBookValuesAreBetRelative,
	syncSpinMeterAfterBet,
} from './plinkoSessionMeters';
import { meterController, stateGame } from './stateGame.svelte';
import {
	freeSpinSegmentIndexForSegment,
	releaseRoundInteractionLocks,
	triggerRoulette,
	waitForRouletteClose,
} from './meterFlow';
import type { BookEvent, BookEventOfType, BookEventContext } from './typesBookEvent';

export const bookEventHandlerMap: BookEventHandlerMap<BookEvent, BookEventContext> = {
	plinkoDrop: async (bookEvent: BookEventOfType<'plinkoDrop'>) => {
		const hasAuthoritativeOutcomes = bookEvent.outcomes.some(
			(outcome) => outcome.hitBonusPeg != null || outcome.hitSpinSlot != null,
		);
		stateGame.authoritativeMeterFlow = hasAuthoritativeOutcomes;
		stateGame.difficultyLevelId = bookEvent.difficulty;
		stateGame.rowCount = bookEvent.rowCount;
		stateGame.ballPerDrop = bookEvent.ballsPerDrop;
		if (bookEvent.coefficients?.length) {
			stateGame.coefficients = [...bookEvent.coefficients];
		}
		if (hasAuthoritativeOutcomes) {
			const spinMeterStart = resolveRgsSpinMeterStart(bookEvent);
			stateGame.betSpinMeterStart = spinMeterStart;
			stateGame.spinMeterBookValuesAreBetRelative = spinMeterBookValuesAreBetRelative(
				stateGame.activeBookEvents,
			);
			applyAuthoritativeMeterConfig({
				spinMeterMax: bookEvent.spinMeterMax,
				bonusMeterMax: bookEvent.bonusMeterMax,
				spinMeterStart,
				bonusMeterStart: bookEvent.bonusMeterStart ?? 0,
				bonusLevelStart: bookEvent.bonusLevelStart,
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
				meterController.setBallPerDrop(stateGame.ballPerDrop);
			}
		}
		const bookStake = bookEvent.stakePerBall > 0 ? bookEvent.stakePerBall : 1;
		stateGame.lastBookStakePerBall = bookStake;
		const stakeScale = plinkoStakePerBall() / bookStake;
		stateGame.bonusPegMeterCreditedBallIds = new Set();
		stateGame.spinSlotMeterCreditedBallIds = new Set();
		stateGame.pendingOutcomes = bookEvent.outcomes.map((outcome) => ({
			...outcome,
			amount: outcome.amount * stakeScale,
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
			stateGame.bonusMeterValue = nextValue;
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
				meterController.setBallPerDrop(stateGame.ballPerDrop);
			}
		}
	},
	freeSpinTrigger: async (bookEvent: BookEventOfType<'freeSpinTrigger'>) => {
		const segment =
			bookEvent.segment ??
			(bookEvent.multiplier > 0 ? `${bookEvent.multiplier}X` : 'BONUS');
		stateGame.serverFreeSpinSegmentLabel = segment;
		stateGame.serverFreeSpinSegment = freeSpinSegmentIndexForSegment(segment);
		const bookStake = stateGame.lastBookStakePerBall > 0 ? stateGame.lastBookStakePerBall : 1;
		const stakeScale = plinkoStakePerBall() / bookStake;
		const authoredAmount = bookEvent.amount ?? 0;
		stateGame.serverFreeSpinWinAmount =
			authoredAmount > 0
				? authoredAmount * stakeScale
				: bookEvent.multiplier > 0
					? plinkoWagerAmount() * bookEvent.multiplier
					: 0;
		stateGame.showFreeSpinRoulette = true;
		triggerRoulette('spin');
		await eventEmitter.broadcastAsync({
			type: 'freeSpinShow',
			multiplier: bookEvent.multiplier,
		});
		await waitForRouletteClose();
	},
	bonusRound: async (bookEvent: BookEventOfType<'bonusRound'>) => {
		const bookStake =
			bookEvent.outcomes[0]?.amount > 0
				? bookEvent.outcomes[0].amount
				: stateGame.lastBookStakePerBall > 0
					? stateGame.lastBookStakePerBall
					: 1;
		const stakeScale = plinkoStakePerBall() / bookStake;
		const scaledOutcomes = bookEvent.outcomes.map((outcome) => ({
			...outcome,
			amount: outcome.amount * stakeScale,
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
		stateBet.winBookEventAmount = bookEvent.amount;
		const payoutMultiplier = bookEvent.amount / 100;
		if (payoutMultiplier > 0) {
			await waitForDropBatchCompletion();
			stateGame.winPopupAmount =
				stateGame.pendingDropWinAmount || payoutMultiplier * stateBet.wageredBetAmount;
			stateGame.winPopupMultiplier = payoutMultiplier;
			stateGame.showWinPopup = true;
			eventEmitter.broadcast({ type: 'soundOnce', name: 'win' });
		}
	},
};

export const { playBookEvent, playBookEvents } = createPlayBookUtils({ bookEventHandlerMap });

export const playBet = async (bet: { state: BookEvent[] }) => {
	stateBet.winBookEventAmount = 0;
	stateBet.wageredBetAmount = plinkoWagerAmount();
	stateGame.pendingDropWinAmount = 0;
	stateGame.winAmount = 0;
	stateGame.dropRoundActive = true;
	stateGame.bonusPegMeterCreditedBallIds = new Set();
	stateGame.spinSlotMeterCreditedBallIds = new Set();
	stateGame.serverFreeSpinWinAmount = undefined;
	stateGame.authoritativeBonusOutcomes = [];
	stateGame.authoritativeBonusOutcomeIndex = 0;
	stateGame.activeBookEvents = bet.state;
	stateGame.authoritativeMeterFlow = bet.state.some(
		(event) =>
			event.type === 'spinMeter' ||
			event.type === 'bonusMeter' ||
			event.type === 'bonusRoulette' ||
			event.type === 'bonusRound' ||
			event.type === 'freeSpinTrigger' ||
			(event.type === 'plinkoDrop' &&
				event.outcomes.some(
					(outcome) => outcome.hitBonusPeg != null || outcome.hitSpinSlot != null,
				)),
	);
	try {
		await playBookEvents(bet.state);
	} finally {
		await syncSpinMeterAfterBet(bet.state);
		stateGame.authoritativeMeterFlow = false;
		if (!stateGame.bonusRoundActive) {
			stateGame.authoritativeBonusOutcomes = [];
			stateGame.authoritativeBonusOutcomeIndex = 0;
		}
		await releaseRoundInteractionLocks();
	}
};
