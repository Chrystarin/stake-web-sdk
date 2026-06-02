import { stateGame } from './stateGame.svelte';

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

/** Client-only defaults before the first book (flat max from config, no tier scaling). */
export function applyClientMeterDefaults(spinMeterMax: number, bonusMeterMax: number) {
	if (stateGame.authoritativeMeterFlow) return;
	stateGame.serverMeterLimitsActive = true;
	stateGame.spinMeterBaseMax = spinMeterMax;
	stateGame.bonusMeterBaseMax = bonusMeterMax;
	stateGame.spinMeterMax = spinMeterMax;
	stateGame.bonusMeterMax = bonusMeterMax;
	stateGame.spinMeterValue = Math.min(stateGame.spinMeterValue, spinMeterMax);
	stateGame.bonusMeterValue = Math.min(stateGame.bonusMeterValue, bonusMeterMax);
}

/** Update spin meter max from a `spinMeter` book event (server `max` field). */
export function applyAuthoritativeSpinMeterMax(max: number) {
	if (max <= 0) return;
	stateGame.spinMeterBaseMax = max;
	stateGame.spinMeterMax = max;
	stateGame.spinMeterValue = Math.min(stateGame.spinMeterValue, max);
}
