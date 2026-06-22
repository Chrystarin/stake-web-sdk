import { stateBet } from 'state-shared';
import { bookEventAmountToNormalisedAmount } from 'utils-shared/amount';

import { getCombinedRoundWinAmount } from './gameOrchestrator';
import { plinkoDropRawWin } from './plinkoDropSettlement';
import { plinkoBallsPerDrop, plinkoStakePerBall } from './plinkoBet';
import { stateGame } from './stateGame.svelte';
import type { PlinkoBallOutcome } from './typesBookEvent';

/** Currency comparison tolerance (half-cent). */
const WIN_MISMATCH_EPSILON = 0.005;

function winsRoughlyEqual(a: number, b: number): boolean {
	return Math.abs(a - b) <= WIN_MISMATCH_EPSILON;
}

/** Sum of stake-per-ball × pocket multiplier for the scaled playback outcomes. */
export function snapshotExpectedWinFromPlaybackOutcomes(outcomes: PlinkoBallOutcome[]): void {
	stateGame.playbackExpectedWinFromOutcomes = plinkoDropRawWin(outcomes);
}

export function resetWinReconciliation(): void {
	stateGame.playbackExpectedWinFromOutcomes = 0;
	stateGame.winMismatchLoggedThisRound = false;
}

/**
 * Log when cumulative ball-land wins (stake × landed multiplier) disagree with RGS
 * `setTotalWin` / `finalWin` settlement. Call once per round after drops finish.
 */
export function logPlinkoWinMismatchIfNeeded(
	rgsBookEventAmount: number,
	source: 'setTotalWin' | 'finalWin',
): void {
	if (stateGame.winMismatchLoggedThisRound) return;

	const fromBallLands = getCombinedRoundWinAmount();
	const fromOutcomes = stateGame.playbackExpectedWinFromOutcomes;
	const actualFromRgs = bookEventAmountToNormalisedAmount(rgsBookEventAmount);

	if (
		rgsBookEventAmount <= 0 &&
		fromBallLands <= WIN_MISMATCH_EPSILON &&
		fromOutcomes <= WIN_MISMATCH_EPSILON
	) {
		return;
	}

	// FEATURE rounds (free spin / bonus) settle their win ASYNCHRONOUSLY: the wheel applies the
	// RGS-authoritative round total only when it closes (`onFreeSpinRouletteFinished`), and the bonus
	// balls credit as they drop — both can finish AFTER the `setTotalWin` / `finalWin` book events. So
	// the ball-land total is legitimately incomplete at this point, and the RGS value is authoritative
	// regardless. Skip the whole check for feature rounds (there is no client-computed total to
	// validate); only PLAIN drops must match here (the ball animation == RGS settlement).
	const featureRound =
		stateGame.freeSpinAwardedThisRound ||
		stateGame.bonusAwardedThisRound ||
		stateGame.bonusRoundActive;
	const rgsVsBallLands = !featureRound && !winsRoughlyEqual(actualFromRgs, fromBallLands);
	const ballLandsVsOutcomes = !featureRound && !winsRoughlyEqual(fromBallLands, fromOutcomes);
	const rgsVsOutcomes = !featureRound && !winsRoughlyEqual(actualFromRgs, fromOutcomes);

	if (!rgsVsBallLands && !ballLandsVsOutcomes && !rgsVsOutcomes) return;

	stateGame.winMismatchLoggedThisRound = true;

	console.error('[plinko] win mismatch: ball-land total !== RGS settlement', {
		source,
		expectedFromBallLands: fromBallLands,
		expectedFromBookOutcomes: fromOutcomes,
		actualFromRgs,
		rgsBookEventAmount,
		wageredBetAmount: stateBet.wageredBetAmount,
		stakePerBall: plinkoStakePerBall(),
		ballsPerDrop: plinkoBallsPerDrop(),
		stratumMismatch: stateGame.plinkoDropStratumMismatch,
		diffRgsMinusBallLands: actualFromRgs - fromBallLands,
		diffRgsMinusBookOutcomes: actualFromRgs - fromOutcomes,
		diffBallLandsMinusBookOutcomes: fromBallLands - fromOutcomes,
	});
}
