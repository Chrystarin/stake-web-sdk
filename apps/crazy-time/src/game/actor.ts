import { stateBet } from 'state-shared';
import { createPrimaryMachines, createIntermediateMachines, createGameActor } from 'utils-xstate';

import type { Bet } from './typesBookEvent';
import { playBet, convertTorResumableBet } from './utils';
import { stateGame, stateGameDerived } from './stateGame.svelte';
import { backedSpotsForResume, buyModeForResume, forgetCommittedSpots } from './activeRound';

const primaryMachines = createPrimaryMachines<Bet>({
	onResumeGameActive: (betToResume) => {
		// Rebuild the board before playback so the replay lights up the right tiles.
		stateGameDerived.applyResumedSelection(backedSpotsForResume(betToResume.state), buyModeForResume());
		return convertTorResumableBet(betToResume);
	},
	onResumeGameInactive: () => {},
	onNewGameStart: async () => {
		stateBet.winBookEventAmount = 0;
		// The spin is in flight from here until winInfo/finalWin settles it, which is what locks
		// the board (no re-chipping mid-spin: the mode is already committed).
		stateGame.rolling = true;
		stateGame.resultReady = false;
	},
	onNewGameError: () => {
		stateGame.rolling = false;
	},
	onPlayGame: async (bet) => await playBet(bet),
	checkIsBonusGame: () => false,
	afterEndGameSettle: async () => {
		forgetCommittedSpots();
		stateGame.rolling = false;
	},
});

const intermediateMachines = createIntermediateMachines(primaryMachines);

export const gameActor = createGameActor(intermediateMachines);
