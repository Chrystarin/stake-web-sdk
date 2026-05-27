import { stateBet } from 'state-shared';
import { createPrimaryMachines, createIntermediateMachines, createGameActor } from 'utils-xstate';

import { stateGame } from './stateGame.svelte';
import { canAffordPlinkoWager, plinkoWagerAmount } from './plinkoBet';
import type { Bet } from './typesBookEvent';
import { playBet } from './bookEventHandlerMap';

const primaryMachines = createPrimaryMachines<Bet>({
	onResumeGameActive: async (betToResume) => betToResume,
	onResumeGameInactive: () => {},
	onNewGameStart: async () => {
		stateBet.winBookEventAmount = 0;
	},
	onNewGameError: () => {},
	onPlayGame: async (bet) => await playBet(bet),
	checkIsBonusGame: () => stateGame.bonusRoundActive,
	getBetMeta: () => ({
		// UI-selected bet configuration used by the game server to build the book.
		// Server/math remain authoritative; client only supplies preferences.
		ballsPerDrop: stateGame.ballPerDrop,
		stakePerBall: stateBet.betAmount,
		rowCount: stateGame.rowCount,
		difficulty: stateGame.difficultyLevelId,
	}),
	getWagerAmount: plinkoWagerAmount,
});

const intermediateMachines = createIntermediateMachines(primaryMachines, {
	isBetCostAvailable: canAffordPlinkoWager,
});

export const gameActor = createGameActor(intermediateMachines);
