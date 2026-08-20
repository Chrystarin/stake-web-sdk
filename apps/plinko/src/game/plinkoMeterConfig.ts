import { activeMeterTierBalls, rememberRgsSpinMeterMax } from './plinkoSessionMeters';
import { meterController, stateGame } from './stateGame.svelte';

export type PlinkoDropMeterConfig = {
	spinMeterMax?: number;
	bonusMeterMax?: number;
	spinMeterStart?: number;
	bonusMeterStart?: number;
	bonusLevelStart?: number;
};

/** Apply server/math meter limits and starting values from `plinkoDrop` (no client tier scaling). */
export function applyAuthoritativeMeterConfig(config: PlinkoDropMeterConfig) {
	stateGame.serverMeterLimitsActive = true;
	if (config.spinMeterMax != null && config.spinMeterMax > 0) {
		stateGame.spinMeterBaseMax = config.spinMeterMax;
		stateGame.spinMeterMax = config.spinMeterMax;
	}
	if (config.bonusMeterMax != null && config.bonusMeterMax > 0) {
		stateGame.bonusMeterBaseMax = config.bonusMeterMax;
		stateGame.bonusMeterMax = config.bonusMeterMax;
	}
	if (config.spinMeterStart != null) {
		stateGame.spinMeterValue = Math.min(config.spinMeterStart, stateGame.spinMeterMax);
	}
	if (config.bonusMeterStart != null) {
		stateGame.bonusMeterValue = Math.min(config.bonusMeterStart, stateGame.bonusMeterMax);
	}
	if (config.bonusLevelStart != null) {
		stateGame.bonusMeterLevel = config.bonusLevelStart;
	}
}

/** Client-only defaults before the first book (`setBallPerDrop` syncs meter state to UI tier). */
export function applyClientMeterDefaults(spinMeterMax: number, bonusMeterMax: number) {
	if (stateGame.authoritativeMeterFlow) return;
	stateGame.spinMeterBaseMax = spinMeterMax;
	stateGame.bonusMeterBaseMax = bonusMeterMax;
	meterController.setBallPerDrop(stateGame.ballPerDrop);
}

/** Update spin meter max from a `spinMeter` / `bonusRound` book event (server `max` field). */
export function applyAuthoritativeSpinMeterMax(max: number) {
	if (max <= 0) return;
	// ⚠️ ONLY A DROP-PHASE MAX MAY BE CACHED AGAINST THE TIER. The in-bonus bar is a different meter —
	// the math sizes it from the bonus round's own ball supply, per level, so it has nothing to do with
	// how many SPIN pockets a paid drop of this tier needs. Filing one under the tier poisons
	// `spinMeterMaxForTier`, and `syncSpinMeterAfterBet` re-seeds the HUD from that cache at the end of
	// EVERY round — so a 50-ball player who hit a bonus would come out of it with a 3-notch bar instead
	// of 21, and a buy would file its bar under tier 10 (the reference `ballsPerDrop` a buy book
	// reports). It self-heals on the next `plinkoDrop`, but that is a round too late.
	//
	// This was a latent one-notch wobble while the in-bonus bar was a fixed 3-10; per-level sizing
	// (math `in_bonus_spin_meter_max_at_level`) takes it up to 268 on a deep round, so guard it.
	const inBonus =
		stateGame.bonusRoundActive ||
		stateGame.bonusBallsRemaining > 0 ||
		Boolean(stateGame.pendingBuyBonusMode);
	if (!inBonus) {
		// Remember it for the tier this round is playing, so the per-drop re-seed between rounds
		// (`seedSpinMeterForCurrentTier`) keeps the math's max instead of reverting to the local constant.
		rememberRgsSpinMeterMax(activeMeterTierBalls(), max);
	}
	stateGame.spinMeterBaseMax = max;
	stateGame.spinMeterMax = max;
	stateGame.spinMeterValue = Math.min(stateGame.spinMeterValue, max);
}
