import { API_AMOUNT_MULTIPLIER } from 'constants-shared/bet';
import { stateBet } from 'state-shared';
import { createPrimaryMachines, createIntermediateMachines, createGameActor } from 'utils-xstate';
import { getRgsErrorBalanceApiAmount, isInsufficientBalanceError } from 'utils-shared/rgsError';

import { stateGame } from './stateGame.svelte';
import { canAffordPlinkoWager, syncPlinkoPlayAmountFromBetLevels } from './plinkoBet';
import { syncPlinkoBetModeFromUi } from './plinkoBetMode';
import {
	applySpinMeterDisplay,
	buildBetMetaPlayConditions,
	deriveSpinMeterFromBookEvents,
} from './plinkoSessionMeters';
import { checkIsPlinkoDeferredSettlement } from './plinkoRoundSettlement';
import {
	getPlinkoBetType,
	refreshWalletBalanceFromRgs,
	syncPlinkoWalletAfterRound,
} from './plinkoWalletSync';
import type { Bet } from './typesBookEvent';
import { closeActiveRgsRound } from './plinkoActiveRound';
import { alignPlinkoUiToReplayBook, isPlinkoReplay } from './plinkoReplay';
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
	// MUST stay synchronous: the shared `resumeGame` does `bet: onResumeGameActive(betToResume)`
	// WITHOUT awaiting, so returning a Promise here would make `context.bet` an unresolved Promise —
	// `playBet` then reads `.state` off the Promise (undefined), skips the whole drop animation, and the
	// round/replay settles with no balls. Everything below is sync, so keep it sync.
	onResumeGameActive: (betToResume) => {
		const state = Array.isArray(betToResume.state) ? betToResume.state : [];
		// Replay: align the UI tier/stake to the served book so playback reproduces it exactly (no-op
		// for a genuine active-round resume, which carries no replay URL params).
		alignPlinkoUiToReplayBook(state);
		const normalizedBet: Bet = { ...betToResume, state };
		if (state.length > 0) {
			applySpinMeterDisplay(deriveSpinMeterFromBookEvents(state));
		}
		if (isPlinkoReplay()) {
			console.info('[plinko][replay] starting playback', {
				events: state.length,
				ballsPerDrop: stateGame.ballPerDrop,
				stakePerBall: stateBet.betAmount,
			});
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
		if (isInsufficientBalanceError(error)) {
			// Recoverable: the rejected play was never debited. Stop autoplay so the loop doesn't keep
			// re-firing the same unaffordable bet, and re-sync the authoritative balance (from the error
			// payload if present, else a fresh wallet read) so the HUD shows the true funds. No fatal
			// error modal — the shared handler shows the friendly "insufficient funds" message instead.
			stateGame.autoPlayStopping = true;
			stateGame.autoMode = false;
			stateGame.pendingFeatureTrigger = null;
			const balanceApi = getRgsErrorBalanceApiAmount(error);
			if (balanceApi !== undefined) {
				stateBet.balanceAmount = balanceApi / API_AMOUNT_MULTIPLIER;
			} else {
				await refreshWalletBalanceFromRgs();
			}
			return;
		}
		const payload = error as { error?: string; message?: string } | undefined;
		if (payload?.error === 'ERR_VAL' && String(payload?.message ?? '').toLowerCase().includes('amount')) {
			console.error('[plinko] /wallet/play rejected — republish math with tier modes (onedrop/tendrop/…) if mode is not `base`', {
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
