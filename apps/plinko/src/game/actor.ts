import { stateBet } from 'state-shared';
import { createPrimaryMachines, createIntermediateMachines, createGameActor } from 'utils-xstate';

import { stateGame } from './stateGame.svelte';
import { canAffordPlinkoWager, plinkoWagerAmount } from './plinkoBet';
import {
	applySpinMeterDisplay,
	buildBetMetaSpinMeter,
	deriveSpinMeterFromBookEvents,
} from './plinkoSessionMeters';
import type { Bet } from './typesBookEvent';
import { playBet } from './bookEventHandlerMap';

const primaryMachines = createPrimaryMachines<Bet>({
	onResumeGameActive: async (betToResume) => {
		if (betToResume.state?.length) {
			applySpinMeterDisplay(deriveSpinMeterFromBookEvents(betToResume.state));
		}
		return betToResume;
	},
	onResumeGameInactive: () => {},
	onNewGameStart: async () => {
		stateBet.winBookEventAmount = 0;
	},
	onNewGameError: () => {},
	onPlayGame: async (bet) => await playBet(bet),
	checkIsBonusGame: () => stateGame.bonusRoundActive,
	getBetMeta: () => ({
		ballsPerDrop: stateGame.ballPerDrop,
		stakePerBall: stateBet.betAmount,
		rowCount: stateGame.rowCount,
		difficulty: stateGame.difficultyLevelId,
		// Hint for RGS to inject `plinkoDrop.spinMeterStart` on the served book.
		...buildBetMetaSpinMeter(),
	}),
	getWagerAmount: plinkoWagerAmount,
});

const intermediateMachines = createIntermediateMachines(primaryMachines, {
	isBetCostAvailable: canAffordPlinkoWager,
});

export const gameActor = createGameActor(intermediateMachines);
