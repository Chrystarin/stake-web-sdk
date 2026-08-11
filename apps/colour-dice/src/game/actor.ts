import { stateBet } from 'state-shared';
import { createPrimaryMachines, createIntermediateMachines, createGameActor } from 'utils-xstate';

import type { Bet } from './typesBookEvent';
import { playBet, convertTorResumableBet } from './utils';
import { stateGame, stateGameDerived } from './stateGame.svelte';
import { backedColoursForResume, forgetCommittedColours } from './activeRound';

const primaryMachines = createPrimaryMachines<Bet>({
	onResumeGameActive: (betToResume) => {
		// A resumed round only tells us HOW MANY colours were backed, never which — that choice
		// never leaves the client. Rebuild the board before playback so the replay lights up the
		// right boxes (from the stashed selection, or canonical colours after a cold start).
		stateGameDerived.applyResumedSelection(backedColoursForResume(betToResume.state));
		return convertTorResumableBet(betToResume);
	},
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
	// The round is closed by the time this runs, so the stashed selection has served its
	// purpose — drop it rather than let it resurface against an unrelated later round.
	afterEndGameSettle: async () => {
		forgetCommittedColours();
		stateGame.rolling = false;
	},
});

const intermediateMachines = createIntermediateMachines(primaryMachines);

export const gameActor = createGameActor(intermediateMachines);
