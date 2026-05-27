import { stateBet } from 'state-shared';
import { createPlayBookUtils, type BookEventHandlerMap } from 'utils-book';

import { eventEmitter } from './eventEmitter';
import { plinkoStakePerBall, plinkoWagerAmount } from './plinkoBet';
import { waitForDropBatchCompletion } from './gameOrchestrator';
import { meterController, stateGame } from './stateGame.svelte';
import {
	freeSpinSegmentIndexForSegment,
	triggerRoulette,
	waitForRouletteClose,
} from './meterFlow';
import type { BookEvent, BookEventOfType, BookEventContext } from './typesBookEvent';

export const bookEventHandlerMap: BookEventHandlerMap<BookEvent, BookEventContext> = {
	plinkoDrop: async (bookEvent: BookEventOfType<'plinkoDrop'>) => {
		stateGame.authoritativeMeterFlow = bookEvent.outcomes.some(
			(outcome) => outcome.hitBonusPeg != null || outcome.hitSpinSlot != null,
		);
		stateGame.difficultyLevelId = bookEvent.difficulty;
		stateGame.rowCount = bookEvent.rowCount;
		stateGame.ballPerDrop = bookEvent.ballsPerDrop;
		if (bookEvent.coefficients?.length) {
			stateGame.coefficients = [...bookEvent.coefficients];
		}
		if (bookEvent.spinMeterMax && bookEvent.spinMeterMax > 0) {
			stateGame.spinMeterBaseMax = bookEvent.spinMeterMax;
		}
		if (bookEvent.bonusMeterMax && bookEvent.bonusMeterMax > 0) {
			stateGame.bonusMeterBaseMax = bookEvent.bonusMeterMax;
		}
		// Recompute tier-scaled maxima after any server-provided meter configuration.
		meterController.setBallPerDrop(stateGame.ballPerDrop);
		const bookStake = bookEvent.stakePerBall > 0 ? bookEvent.stakePerBall : 1;
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
		stateGame.isAnimating = false;
	},
	bonusMeter: async (bookEvent: BookEventOfType<'bonusMeter'>) => {
		// Meters should retain progress across bets until they trigger roulette.
		// Some dev/local books may start each bet at 0; ignore decreases unless we're in a flow
		// that legitimately resets the meter (roulette open or bonus round lifecycle).
		const nextValue = bookEvent.value;
		const shouldIgnoreDecrease =
			stateGame.authoritativeMeterFlow &&
			!stateGame.rouletteFlowInProgress &&
			!stateGame.bonusRoundActive &&
			nextValue < stateGame.bonusMeterValue;
		if (!shouldIgnoreDecrease) stateGame.bonusMeterValue = nextValue;
		stateGame.bonusMeterLevel = bookEvent.level;
		eventEmitter.broadcast({
			type: 'bonusMeterUpdate',
			value: stateGame.bonusMeterValue,
			level: bookEvent.level,
		});
		// Fallback: if server bonus meter reaches full but explicit `bonusRoulette`
		// event is missing/delayed, still open/queue bonus roulette.
		if (
			stateGame.authoritativeMeterFlow &&
			!stateGame.bonusRoundActive &&
			stateGame.bonusMeterMax > 0 &&
			stateGame.bonusMeterValue >= stateGame.bonusMeterMax
		) {
			stateGame.showBonusRoulette = true;
			triggerRoulette('bonus');
		}
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
		const shouldIgnoreDecrease =
			stateGame.authoritativeMeterFlow &&
			!stateGame.rouletteFlowInProgress &&
			nextValue < stateGame.spinMeterValue;
		if (!shouldIgnoreDecrease) stateGame.spinMeterValue = nextValue;
		if (bookEvent.max > 0) {
			stateGame.spinMeterBaseMax = bookEvent.max;
			meterController.setBallPerDrop(stateGame.ballPerDrop);
		}
		// Fallback: if server meter reaches full but no explicit `freeSpinTrigger` arrives,
		// still open/queue roulette so the UI never gets stuck at max.
		if (
			stateGame.authoritativeMeterFlow &&
			stateGame.spinMeterMax > 0 &&
			stateGame.spinMeterValue >= stateGame.spinMeterMax
		) {
			if (stateGame.bonusRoundActive) {
				stateGame.pendingSpinRouletteAfterBonusLevelDepletion = true;
			} else {
				stateGame.showFreeSpinRoulette = true;
				triggerRoulette('spin');
			}
		}
	},
	freeSpinTrigger: async (bookEvent: BookEventOfType<'freeSpinTrigger'>) => {
		const segment =
			bookEvent.segment ??
			(bookEvent.multiplier > 0 ? `${bookEvent.multiplier}X` : 'BONUS');
		stateGame.serverFreeSpinSegmentLabel = segment;
		stateGame.serverFreeSpinSegment = freeSpinSegmentIndexForSegment(segment);
		stateGame.showFreeSpinRoulette = true;
		triggerRoulette('spin');
		await eventEmitter.broadcastAsync({
			type: 'freeSpinShow',
			multiplier: bookEvent.multiplier,
		});
		await waitForRouletteClose();
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
	stateGame.bonusPegMeterCreditedBallIds = new Set();
	stateGame.spinSlotMeterCreditedBallIds = new Set();
	stateGame.authoritativeMeterFlow = bet.state.some(
		(event) =>
			event.type === 'spinMeter' ||
			event.type === 'bonusMeter' ||
			event.type === 'bonusRoulette' ||
			event.type === 'freeSpinTrigger' ||
			(event.type === 'plinkoDrop' &&
				event.outcomes.some(
					(outcome) => outcome.hitBonusPeg != null || outcome.hitSpinSlot != null,
				)),
	);
	try {
		await playBookEvents(bet.state);
	} finally {
		stateGame.authoritativeMeterFlow = false;
	}
};
