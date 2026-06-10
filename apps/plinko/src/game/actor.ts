import { stateBet } from 'state-shared';
import { createPrimaryMachines, createIntermediateMachines, createGameActor } from 'utils-xstate';

stateBet.activeBetModeKey = 'base';

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
import { closeActiveRgsRound } from './plinkoActiveRound';
import { releaseRoundInteractionLocks } from './meterFlow';
import { playBet } from './bookEventHandlerMap';

function isActiveRoundPlayError(error: unknown): boolean {
	const payload = error as { error?: string; message?: string } | undefined;
	const message = String(payload?.message ?? error ?? '').toLowerCase();
	return payload?.error === 'ERR_VAL' && message.includes('active round');
}

const primaryMachines = createPrimaryMachines<Bet>({
	onResumeGameActive: async (betToResume) => {
		const state = Array.isArray(betToResume.state) ? betToResume.state : [];
		const normalizedBet: Bet = { ...betToResume, state };
		if (state.length > 0) {
			applySpinMeterDisplay(deriveSpinMeterFromBookEvents(state));
		}
		return normalizedBet;
	},
	onResumeGameInactive: () => {},
	onNewGameStart: async () => {
		stateBet.winBookEventAmount = 0;
	},
	onNewGameError: async (error) => {
		releaseRoundInteractionLocks();
		if (isActiveRoundPlayError(error)) {
			await closeActiveRgsRound();
		}
	},
	onPlayGame: async (bet) => {
		try {
			await playBet(bet);
		} catch (error) {
			releaseRoundInteractionLocks();
			throw error;
		}
	},
	checkIsBonusGame: (bet) =>
		stateGame.bonusRoundActive ||
		stateGame.bonusAwardedThisRound ||
		checkIsPlinkoDeferredSettlement(bet),
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
