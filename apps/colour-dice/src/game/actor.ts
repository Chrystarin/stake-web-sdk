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
		// The roll is in flight from here until winInfo/finalWin settles it, which is what
		// locks the board (no re-chipping mid-roll — the mode is already committed).
		stateGame.rolling = true;
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
