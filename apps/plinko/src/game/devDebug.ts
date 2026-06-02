import { isBetControlsLocked, isDropBatchPending, isGameOngoing } from './gameOrchestrator';
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
	if (!import.meta.env.DEV) return;

	const w = window as Window & {
		plinkoDebugLocks?: () => PlinkoLockDebugSnapshot;
		plinkoForceUnlock?: () => PlinkoLockDebugSnapshot;
	};

	w.plinkoDebugLocks = snapshotPlinkoLocks;
	w.plinkoForceUnlock = () => {
		forceUnlockBettingControls();
		return snapshotPlinkoLocks();
	};
}
