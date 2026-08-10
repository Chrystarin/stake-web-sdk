import { API_AMOUNT_MULTIPLIER } from 'constants-shared/bet';
import { stateBet } from 'state-shared';
import { createPrimaryMachines, createIntermediateMachines, createGameActor } from 'utils-xstate';
import {
	getRgsErrorBalanceApiAmount,
	isActiveRoundError,
	isInsufficientBalanceError,
} from 'utils-shared/rgsError';

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
import { alignPlinkoUiToResumeBook, closeActiveRgsRound } from './plinkoActiveRound';
import { applyResumeBonusProgressToBook } from './plinkoBonusProgress';
import { alignPlinkoUiToReplayBook, isPlinkoReplay } from './plinkoReplay';
import { releaseRoundInteractionLocks } from './meterFlow';
import { playBet } from './bookEventHandlerMap';
import { buildPlinkoPlayPayloadPreview } from './plinkoPlayDebug';
import { installPlinkoDevDebug } from './devDebug';
import { installPlinkoMeterTrace } from './plinkoMeterTrace';

const primaryMachines = createPrimaryMachines<Bet>({
	// MUST stay synchronous: the shared `resumeGame` does `bet: onResumeGameActive(betToResume)`
	// WITHOUT awaiting, so returning a Promise here would make `context.bet` an unresolved Promise —
	// `playBet` then reads `.state` off the Promise (undefined), skips the whole drop animation, and the
	// round/replay settles with no balls. Everything below is sync, so keep it sync.
	onResumeGameActive: (betToResume) => {
		const state = Array.isArray(betToResume.state) ? betToResume.state : [];
		// Mark this playback as a genuine active-round resume so book-event handlers can tell it apart
		// from a fresh bet (cleared in `playBet`'s finally). A BUY BONUS resume uses this to skip the
		// entry roulette — it already played when the bonus was purchased.
		stateGame.resumingActiveRound = true;
		// Replay: align the UI tier/stake to the served book so playback reproduces it exactly (no-op
		// for a genuine active-round resume, which carries no replay URL params).
		alignPlinkoUiToReplayBook(state);
		// Genuine active-round resume (not replay): align the UI balls-per-drop tier to the resumed
		// book. Launch defaults the tier to 10, but a resumed bonus round can be 20/50 — without this
		// `playBet`'s stratum check false-positives and pops an error toast across the top of the screen.
		alignPlinkoUiToResumeBook(state, (betToResume as { mode?: string }).mode);
		// Overlay the persisted bonus played count onto the resumed book's entry `bonusRound` event so
		// the resume drops only the REMAINING free balls (RGS reports `ballsPlayed: 0`, which would
		// otherwise re-award and re-drop the whole bonus wave). No-op for replay / non-bonus resumes.
		if (!isPlinkoReplay()) applyResumeBonusProgressToBook(state);
		const normalizedBet: Bet = { ...betToResume, state };
		if (state.length > 0) {
			applySpinMeterDisplay(deriveSpinMeterFromBookEvents(state));
		}
		return normalizedBet;
	},
	onResumeGameInactive: () => {},
	onNewGameStart: async () => {
		syncPlinkoBetModeFromUi();
		syncPlinkoPlayAmountFromBetLevels();
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
		if (isActiveRoundError(error)) {
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
installPlinkoMeterTrace();
