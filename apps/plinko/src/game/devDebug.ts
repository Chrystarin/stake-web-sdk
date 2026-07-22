import { stateBet } from 'state-shared';

import { buildPlinkoPlayPayloadPreview } from './plinkoPlayDebug';
import {
	isBetControlsLocked,
	isDropBatchPending,
	isGameOngoing,
	pushRapidWinSparkle,
} from './gameOrchestrator';
import { forceUnlockBettingControls } from './meterFlow';
import { stateGame } from './stateGame.svelte';

export type PlinkoLockDebugSnapshot = {
	controlsLocked: boolean;
	isSubmitting: boolean;
	dropRoundActive: boolean;
	isAnimating: boolean;
	expectedOutcomes: number;
	pendingSpacedSpawnTimers: number;
	isDropBatchPending: boolean;
	isGameOngoing: boolean;
	bonusBallsRemaining: number;
	freeSpinRouletteOpen: boolean;
	bonusRouletteOpen: boolean;
	rouletteFlowInProgress: boolean;
	activeRouletteSource: string | null;
	pendingRouletteSource: string | null;
};

export function snapshotPlinkoLocks(): PlinkoLockDebugSnapshot {
	return {
		controlsLocked: isBetControlsLocked(),
		isSubmitting: stateGame.isSubmitting,
		dropRoundActive: stateGame.dropRoundActive,
		isAnimating: stateGame.isAnimating,
		expectedOutcomes: stateGame.expectedOutcomeByBallId.size,
		pendingSpacedSpawnTimers: stateGame.pendingSpacedSpawnTimers,
		isDropBatchPending: isDropBatchPending(),
		isGameOngoing: isGameOngoing(),
		bonusBallsRemaining: stateGame.bonusBallsRemaining,
		freeSpinRouletteOpen: stateGame.freeSpinRouletteOpen,
		bonusRouletteOpen: stateGame.bonusRouletteOpen,
		rouletteFlowInProgress: stateGame.rouletteFlowInProgress,
		activeRouletteSource: stateGame.activeRouletteSource,
		pendingRouletteSource: stateGame.pendingRouletteSource,
	};
}

/** Dev-only: expose lock diagnostics on `window.plinkoDebugLocks()` / `window.plinkoForceUnlock()`. */
export function installPlinkoDevDebug() {
	const w = window as Window & {
		plinkoDebugLocks?: () => PlinkoLockDebugSnapshot;
		plinkoPlayMeta?: () => Record<string, unknown>;
		plinkoForceUnlock?: () => PlinkoLockDebugSnapshot;
		plinkoTestWin?: (amount?: number, multiplier?: number, balls?: number) => void;
		plinkoTestRapidSparkle?: (amount?: number, multiplier?: number, count?: number) => void;
	};

	w.plinkoPlayMeta = buildPlinkoPlayPayloadPreview;

	if (!import.meta.env.DEV) return;

	w.plinkoDebugLocks = snapshotPlinkoLocks;
	w.plinkoForceUnlock = () => {
		forceUnlockBettingControls();
		return snapshotPlinkoLocks();
	};

	// Dev-only: fire the full-screen win celebration on demand (multi-ball tiers only) without having
	// to actually win a round — e.g. `plinkoTestWin(1234.56, 30)` for an Epic Bounty. `multiplier`
	// picks the tier (Massive < 5 ≤ Epic < 25 ≤ Captain) and scales the coin count.
	w.plinkoTestWin = (amount = 1234.56, multiplier = 30, balls = 10) => {
		stateGame.ballPerDrop = balls <= 1 ? 10 : balls;
		stateGame.winPopupAmount = amount;
		stateGame.winPopupMultiplier = multiplier;
		// Mirror the real finalWin flow: pin the pre-win balance, show the popup, then credit the win a
		// beat later — so the celebration holds the balance and counts it up (rather than it being there
		// from the start).
		stateGame.balanceWinHold = stateBet.balanceAmount;
		stateGame.showWinPopup = true;
		setTimeout(() => {
			stateBet.balanceAmount += amount;
		}, 60);
	};

	// Dev-only: pop the small 1-ball rapid win sparkles on demand (switches to 1-ball first) — e.g.
	// `plinkoTestRapidSparkle(12.34, 15, 3)` fires 3 sparkles sized for a 15× win. `multiplier` sizes the
	// burst (1× small / 2× mid / 10× big); `count` (max 3 shown) exercises the cap + random scatter.
	w.plinkoTestRapidSparkle = (amount = 12.34, multiplier = 5, count = 3) => {
		stateGame.ballPerDrop = 1;
		for (let i = 0; i < count; i++) {
			setTimeout(() => pushRapidWinSparkle(amount, multiplier), i * 220);
		}
	};
}
