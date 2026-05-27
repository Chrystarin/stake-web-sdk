import { stateBet } from 'state-shared';
import { createPlayBookUtils, type BookEventHandlerMap } from 'utils-book';

import { eventEmitter } from './eventEmitter';
import { plinkoStakePerBall, plinkoWagerAmount } from './plinkoBet';
import { waitForDropBatchCompletion } from './gameOrchestrator';
import { stateGame } from './stateGame.svelte';
import { freeSpinSegmentIndexForMultiplier, triggerRoulette, waitForRouletteClose } from './meterFlow';
import type { BookEvent, BookEventOfType, BookEventContext } from './typesBookEvent';

export const bookEventHandlerMap: BookEventHandlerMap<BookEvent, BookEventContext> = {
	plinkoDrop: async (bookEvent: BookEventOfType<'plinkoDrop'>) => {
		stateGame.difficultyLevelId = bookEvent.difficulty;
		stateGame.rowCount = bookEvent.rowCount;
		stateGame.ballPerDrop = bookEvent.ballsPerDrop;
		const bookStake = bookEvent.stakePerBall > 0 ? bookEvent.stakePerBall : 1;
		const stakeScale = plinkoStakePerBall() / bookStake;
		stateGame.pendingOutcomes = bookEvent.outcomes.map((outcome) => ({
			...outcome,
			amount: outcome.amount * stakeScale,
		}));
		stateGame.isAnimating = true;
		stateGame.pendingDropWinAmount = 0;
		stateGame.winAmount = 0;
		stateGame.showWinPopup = false;
		await eventEmitter.broadcastAsync({
			type: 'plinkoDrop',
			outcomes: bookEvent.outcomes,
			fastMode: stateGame.fastGameEnabled,
		});
		stateGame.isAnimating = false;
	},
	bonusMeter: async (bookEvent: BookEventOfType<'bonusMeter'>) => {
		stateGame.bonusMeterValue = bookEvent.value;
		stateGame.bonusMeterLevel = bookEvent.level;
		eventEmitter.broadcast({
			type: 'bonusMeterUpdate',
			value: bookEvent.value,
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
	freeSpinTrigger: async (bookEvent: BookEventOfType<'freeSpinTrigger'>) => {
		stateGame.serverFreeSpinSegment = freeSpinSegmentIndexForMultiplier(bookEvent.multiplier);
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
	await playBookEvents(bet.state);
};
