import { stateBet } from 'state-shared';
import { createPrimaryMachines, createIntermediateMachines, createGameActor } from 'utils-xstate';

import { stateGame } from './stateGame.svelte';
import { canAffordPlinkoWager, plinkoWagerAmount } from './plinkoBet';
import {
	applySpinMeterDisplay,
	buildBetMetaPlayConditions,
	deriveSpinMeterFromBookEvents,
} from './plinkoSessionMeters';
import { checkIsPlinkoDeferredSettlement } from './plinkoRoundSettlement';
import { getPlinkoBetType, syncPlinkoWalletAfterRound } from './plinkoWalletSync';
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
	checkIsBonusGame: (bet) =>
		stateGame.bonusRoundActive || checkIsPlinkoDeferredSettlement(bet),
	getBetType: ({ bet }) => getPlinkoBetType(bet),
	afterEndGameSettle: async ({ bet }) => {
		await syncPlinkoWalletAfterRound(bet);
	},
	getBetMeta: () => ({
		ballsPerDrop: stateGame.ballPerDrop,
		stakePerBall: stateBet.betAmount,
		rowCount: stateGame.rowCount,
		...buildBetMetaPlayConditions(),
	}),
	getWagerAmount: plinkoWagerAmount,
});

const intermediateMachines = createIntermediateMachines(primaryMachines, {
	isBetCostAvailable: canAffordPlinkoWager,
});

export const gameActor = createGameActor(intermediateMachines);
