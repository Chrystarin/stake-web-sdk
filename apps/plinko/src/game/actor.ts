import { stateBet } from 'state-shared';
import { createPrimaryMachines, createIntermediateMachines, createGameActor } from 'utils-xstate';

import { stateGame } from './stateGame.svelte';
import { canAffordPlinkoWager, plinkoWagerAmount } from './plinkoBet';
import { buildBetMetaMeters, deriveMetersFromBookEvents, applySessionMetersToGameState } from './plinkoSessionMeters';
import type { Bet } from './typesBookEvent';
import { playBet } from './bookEventHandlerMap';

const primaryMachines = createPrimaryMachines<Bet>({
	onResumeGameActive: async (betToResume) => {
		if (betToResume.state?.length) {
			applySessionMetersToGameState(deriveMetersFromBookEvents(betToResume.state));
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
		// UI-selected bet configuration used by the game server to build the book.
		ballsPerDrop: stateGame.ballPerDrop,
		stakePerBall: stateBet.betAmount,
		rowCount: stateGame.rowCount,
		difficulty: stateGame.difficultyLevelId,
		// Session meter carry-over for RGS (authoritative meter state lives on server).
		...buildBetMetaMeters(),
	}),
	getWagerAmount: plinkoWagerAmount,
});

const intermediateMachines = createIntermediateMachines(primaryMachines, {
	isBetCostAvailable: canAffordPlinkoWager,
});

export const gameActor = createGameActor(intermediateMachines);
