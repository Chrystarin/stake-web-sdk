import { stateBet } from 'state-shared';
import { createPrimaryMachines, createIntermediateMachines, createGameActor } from 'utils-xstate';

import { stateGame } from './stateGame.svelte';
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
});

const intermediateMachines = createIntermediateMachines(primaryMachines);

export const gameActor = createGameActor(intermediateMachines);
