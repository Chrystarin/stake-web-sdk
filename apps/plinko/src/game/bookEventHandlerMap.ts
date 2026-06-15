import { stateBet } from 'state-shared';
import { createPlayBookUtils, recordBookEvent, type BookEventHandlerMap } from 'utils-book';

import { alignCoefficientSet, resolveOutcomeMultiplier } from '../game-logic/boardMultipliers';
import { isSpinSlotRateIndex } from '../game-logic/spinSlot';
import { eventEmitter } from './eventEmitter';
import { plinkoBallsPerDrop, plinkoStakePerBall, plinkoWagerAmount } from './plinkoBet';
import { resizePlinkoDropOutcomes } from './plinkoDropOutcomes';
import { waitForDropBatchCompletion } from './gameOrchestrator';
import { hasActiveRgsSession } from './plinkoSessionMeters';
import { meterController, stateGame } from './stateGame.svelte';
import { releaseRoundInteractionLocks } from './meterFlow';
import { checkIsPlinkoDeferredSettlement } from './plinkoRoundSettlement';
import {
	authoritativeSettlementEvents,
	normalizeAuthoritativeBet,
	preludeEventsForPlayback,
} from './authoritativeRoundBet';
import { alignBookForPlayback } from './alignBookForPlayback';
import {
	bookBallsPerDrop as readBookBallsPerDrop,
	getPlinkoDropFromBet,
	plinkoDropMatchesUi,
	plinkoDropStratumMismatchMessage,
	readBetCriteria,
} from './plinkoDropBookShape';
import { buildBetMetaPlayConditions } from './plinkoSessionMeters';
import { applyRgsRoundWinFromBookEventAmount } from './rgsRoundWin';
import {
	logPlinkoWinMismatchIfNeeded,
	resetWinReconciliation,
	snapshotExpectedWinFromPlaybackOutcomes,
} from './plinkoWinReconciliation';
import { snapshotBalanceAfterPlay } from './plinkoWalletSync';
import { showToast } from './gameOrchestrator';
import type { Bet, BookEventOfType, BookEventContext } from './typesBookEvent';

export const bookEventHandlerMap: BookEventHandlerMap<import('./typesBookEvent').BookEvent, BookEventContext> = {
	plinkoDrop: async (bookEvent: BookEventOfType<'plinkoDrop'>) => {
		const outcomes = Array.isArray(bookEvent.outcomes) ? bookEvent.outcomes : [];
		const ballsPerDrop = plinkoBallsPerDrop();
		const bookBallsPerDrop = readBookBallsPerDrop(bookEvent);
		const stratumMismatch = bookBallsPerDrop !== ballsPerDrop;
		if (stratumMismatch) {
			console.warn(
				`[plinko] book ballsPerDrop (${bookBallsPerDrop}) does not match UI (${ballsPerDrop}); check play meta / lookup stratum`,
				{
					servedCriteria: readBetCriteria(stateGame.activeRoundBet),
					expectedMeta: buildBetMetaPlayConditions(),
					hasRgsSession: hasActiveRgsSession(),
				},
			);
		}
		stateGame.authoritativeMeterFlow = false;
		stateGame.rowCount = bookEvent.rowCount;
		if (bookEvent.coefficients?.length) {
			stateGame.coefficients = alignCoefficientSet(bookEvent.coefficients);
		}
		if (bookEvent.spinMeterMax && bookEvent.spinMeterMax > 0) {
			stateGame.spinMeterBaseMax = bookEvent.spinMeterMax;
			stateGame.spinMeterMax = bookEvent.spinMeterMax;
		}
		if (bookEvent.bonusMeterMax && bookEvent.bonusMeterMax > 0) {
			stateGame.bonusMeterBaseMax = bookEvent.bonusMeterMax;
			stateGame.bonusMeterMax = bookEvent.bonusMeterMax;
		}
		if (!stateGame.serverMeterLimitsActive) {
			meterController.setBallPerDrop(ballsPerDrop);
		}
		const stakePerBall = plinkoStakePerBall();
		const bookStake = bookEvent.stakePerBall > 0 ? bookEvent.stakePerBall : 1;
		stateGame.lastBookStakePerBall = bookStake;
		const stakeScale =
			bookStake > 0 && Math.abs(stakePerBall - bookStake) > 1e-9
				? stakePerBall / bookStake
				: 1;
		const coeffs = stateGame.coefficients;
		// Never trim a mismatched RGS book to the UI ball count — that hides the wrong stratum.
		const outcomeBatch = stateGame.plinkoDropStratumMismatch
			? outcomes
			: resizePlinkoDropOutcomes(outcomes, ballsPerDrop);
		stateGame.pendingOutcomes = outcomeBatch.map((outcome) => {
			const hitSpinSlot =
				outcome.hitSpinSlot ??
				(coeffs.length > 0 && isSpinSlotRateIndex(outcome.rateIndex, coeffs.length));
			const normalized = {
				...outcome,
				amount: outcome.amount * stakeScale,
				hitSpinSlot,
			};
			return {
				...normalized,
				multiplier: hitSpinSlot ? 0 : resolveOutcomeMultiplier(normalized, coeffs),
			};
		});
		snapshotExpectedWinFromPlaybackOutcomes(stateGame.pendingOutcomes);
		stateGame.isAnimating = true;
		stateGame.showWinPopup = false;
		await eventEmitter.broadcastAsync({
			type: 'plinkoDrop',
			outcomes: stateGame.pendingOutcomes,
			fastMode: stateGame.fastGameEnabled,
		});
		await waitForDropBatchCompletion();
		stateGame.isAnimating = false;
	},
	bonusMeter: async () => {},
	bonusRoulette: async () => {},
	spinMeter: async () => {},
	freeSpinTrigger: async () => {},
	bonusRound: async () => {},
	setTotalWin: async (bookEvent: BookEventOfType<'setTotalWin'>) => {
		await waitForDropBatchCompletion();
		logPlinkoWinMismatchIfNeeded(bookEvent.amount, 'setTotalWin');
		applyRgsRoundWinFromBookEventAmount(bookEvent.amount);
	},
	finalWin: async (bookEvent: BookEventOfType<'finalWin'>) => {
		recordBookEvent({ bookEvent });
		await waitForDropBatchCompletion();
		logPlinkoWinMismatchIfNeeded(bookEvent.amount, 'finalWin');
		const payoutMultiplier = bookEvent.amount / 100;
		if (payoutMultiplier > 0) {
			applyRgsRoundWinFromBookEventAmount(bookEvent.amount);
			stateGame.winPopupMultiplier = payoutMultiplier;
			if (!stateGame.showWinPopup) {
				stateGame.showWinPopup = true;
				eventEmitter.broadcast({ type: 'soundOnce', name: 'win' });
			}
		}
	},
};

export const { playBookEvent, playBookEvents } = createPlayBookUtils({ bookEventHandlerMap });

export const playBet = async (bet: Bet) => {
	const authoritativeBet = normalizeAuthoritativeBet(bet);
	const authoritativeEvents = authoritativeBet.state ?? [];
	const playbackBet = alignBookForPlayback(authoritativeBet);
	const playbackEvents = playbackBet.state ?? [];
	const prelude = preludeEventsForPlayback(authoritativeEvents, playbackEvents);
	const settlement = authoritativeSettlementEvents(authoritativeEvents);

	snapshotBalanceAfterPlay();
	const authoritativeDrop = getPlinkoDropFromBet(authoritativeBet);
	stateGame.plinkoDropStratumMismatch = !plinkoDropMatchesUi(authoritativeDrop);
	if (stateGame.plinkoDropStratumMismatch) {
		const message = plinkoDropStratumMismatchMessage(authoritativeDrop, undefined, authoritativeBet);
		if (message) showToast(message, 'error');
		if (import.meta.env.DEV) {
			console.error('[plinko] stratum mismatch', {
				uiBalls: plinkoBallsPerDrop(),
				bookBalls: readBookBallsPerDrop(authoritativeDrop),
				servedCriteria: readBetCriteria(authoritativeBet),
				playMeta: buildBetMetaPlayConditions(),
			});
		}
	}
	stateGame.activeRoundBet = authoritativeBet;
	stateBet.wageredBetAmount = plinkoWagerAmount();
	stateBet.winBookEventAmount = 0;
	resetWinReconciliation();
	stateGame.pendingDropWinAmount = 0;
	stateGame.baseRoundDropWinAmount = 0;
	stateGame.winAmount = 0;
	stateGame.deferWinPopupForFreeSpin = false;
	stateGame.dropRoundActive = true;

	try {
		stateGame.roundDeferredSettlement = checkIsPlinkoDeferredSettlement(authoritativeBet);
		stateGame.activeBookEvents = authoritativeEvents;
		stateGame.authoritativeMeterFlow = false;

		if (authoritativeEvents.length > 0) {
			await playBookEvents(prelude);
			if (settlement.length > 0) {
				await playBookEvents(settlement);
			}
		}
	} finally {
		stateGame.authoritativeMeterFlow = false;
		await releaseRoundInteractionLocks();
		stateGame.activeRoundBet = undefined;
	}
};
