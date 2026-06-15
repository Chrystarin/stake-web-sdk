import { API_AMOUNT_MULTIPLIER } from 'constants-shared/bet';
import { stateBet } from 'state-shared';
import { createPrimaryMachines, createIntermediateMachines, createGameActor } from 'utils-xstate';

import { stateGame } from './stateGame.svelte';
import { canAffordPlinkoWager, syncPlinkoPlayAmountFromBetLevels } from './plinkoBet';
import { syncPlinkoBetModeFromUi } from './plinkoBetMode';
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
import { buildPlinkoPlayPayloadPreview } from './plinkoPlayDebug';
import { installPlinkoDevDebug } from './devDebug';

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
		syncPlinkoBetModeFromUi();
		const playAmount = syncPlinkoPlayAmountFromBetLevels();
		console.info('[plinko] /wallet/play request', {
			...buildPlinkoPlayPayloadPreview(),
			amountApi: Math.round(playAmount * API_AMOUNT_MULTIPLIER),
		});
		stateBet.winBookEventAmount = 0;
	},
	onNewGameError: async (error) => {
		releaseRoundInteractionLocks();
		const payload = error as { error?: string; message?: string } | undefined;
		if (payload?.error === 'ERR_VAL' && String(payload?.message ?? '').toLowerCase().includes('amount')) {
			console.error('[plinko] /wallet/play rejected — republish math with tier modes (baseone/baseten/…) if mode is not `base`', {
				...buildPlinkoPlayPayloadPreview(),
				error: payload,
			});
		}
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
	getBetMeta: () => buildBetMetaPlayConditions(),
	getWagerAmount: syncPlinkoPlayAmountFromBetLevels,
});

const intermediateMachines = createIntermediateMachines(primaryMachines, {
	isBetCostAvailable: canAffordPlinkoWager,
});

export const gameActor = createGameActor(intermediateMachines);

syncPlinkoBetModeFromUi();
installPlinkoDevDebug();
