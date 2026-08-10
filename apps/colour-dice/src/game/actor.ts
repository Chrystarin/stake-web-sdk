import { stateBet } from 'state-shared';
import { createPrimaryMachines, createIntermediateMachines, createGameActor } from 'utils-xstate';

import type { Bet } from './typesBookEvent';
import { playBet, convertTorResumableBet } from './utils';
import { stateGame } from './stateGame.svelte';

const primaryMachines = createPrimaryMachines<Bet>({
	onResumeGameActive: (betToResume) => convertTorResumableBet(betToResume),
	onResumeGameInactive: () => {},
	onNewGameStart: async () => {
		stateBet.winBookEventAmount = 0;
		stateGame.rolling = false;
		stateGame.resultReady = false;
	},
	onNewGameError: () => {
		stateGame.rolling = false;
	},
	onPlayGame: async (bet) => await playBet(bet),
	checkIsBonusGame: () => false,
});

const intermediateMachines = createIntermediateMachines(primaryMachines);

export const gameActor = createGameActor(intermediateMachines);
