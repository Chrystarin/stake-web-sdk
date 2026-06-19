import { BONUS_LEVEL_LABELS, METER_TIER_CONFIG, bonusMeterTierFor } from './constants';

export type MeterTierState = {
	spinValue: number;
	spinMax: number;
	bonusValue: number;
	bonusMax: number;
};

export type MeterControllerState = {
	ballPerDrop: number;
	spinMeterValue: number;
	spinMeterMax: number;
	spinMeterBaseMax: number;
	bonusMeterValue: number;
	bonusMeterMax: number;
	bonusMeterBaseMax: number;
	bonusMeterOverflowValue: number;
	bonusLevelProgress: number;
	pendingBonusLevelUpCount: number;
	bonusRoundActive: boolean;
	rouletteFlowInProgress: boolean;
	activeRouletteSource: 'spin' | 'bonus' | null;
	pendingRouletteSource: 'spin' | 'bonus' | null;
};

const defaultState = (): MeterControllerState => ({
	ballPerDrop: 10,
	spinMeterValue: 0,
	spinMeterMax: 10,
	spinMeterBaseMax: 10,
	bonusMeterValue: 0,
	bonusMeterMax: 20,
	bonusMeterBaseMax: 20,
	bonusMeterOverflowValue: 0,
	bonusLevelProgress: 0,
	pendingBonusLevelUpCount: 0,
	bonusRoundActive: false,
	rouletteFlowInProgress: false,
	activeRouletteSource: null,
	pendingRouletteSource: null,
});

export const createMeterController = (
	externalState?: MeterControllerState,
) => {
	const state: MeterControllerState = externalState ?? { ...defaultState() };

	const getScaledTierMax = (baseMax: number, ballCount: number): number => {
		const tier = METER_TIER_CONFIG[ballCount];
		if (!tier) return baseMax;
		return Math.round(baseMax * tier.maxRatio);
	};

	const rebuildMeterTierMaxima = () => {
		state.spinMeterMax = getScaledTierMax(state.spinMeterBaseMax, state.ballPerDrop);
		state.bonusMeterMax = getScaledTierMax(state.bonusMeterBaseMax, state.ballPerDrop);
		state.spinMeterValue = Math.min(state.spinMeterValue, state.spinMeterMax);
		state.bonusMeterValue = Math.min(state.bonusMeterValue, state.bonusMeterMax);
	};

	const spinMeterProgress = () => {
		const max = state.spinMeterMax || 1;
		return Math.max(0, Math.min(1, state.spinMeterValue / max));
	};

	const bonusMeterProgress = () => {
		const max = state.bonusMeterMax || 1;
		return Math.max(0, Math.min(1, state.bonusMeterValue / max));
	};

	const setBallPerDrop = (count: number) => {
		state.ballPerDrop = count;
		rebuildMeterTierMaxima();
	};

	type RouletteTrigger = 'spin' | 'bonus' | null;

	/** Increment spin meter for UI only — never opens the free-spin wheel. */
	const bumpSpinMeterVisual = (delta = 1): void => {
		if (delta <= 0) return;
		const safeMax = state.spinMeterMax > 0 ? state.spinMeterMax : 10;
		if (state.spinMeterValue >= safeMax) return;
		state.spinMeterValue = Math.min(safeMax, state.spinMeterValue + delta);
	};

	/** Increment bonus meter for UI only — never opens the bonus wheel. */
	const bumpBonusMeterVisual = (delta = 1): void => {
		if (delta <= 0) return;
		const safeMax = state.bonusMeterMax > 0 ? state.bonusMeterMax : 20;
		if (state.bonusMeterValue >= safeMax) return;
		state.bonusMeterValue = Math.min(safeMax, state.bonusMeterValue + delta);
	};

	const addSpinMeterValue = (
		delta = 1,
		onTrigger: (source: 'spin') => void,
	): void => {
		if (delta <= 0) return;
		const safeMax = state.spinMeterMax > 0 ? state.spinMeterMax : 10;
		if (state.spinMeterValue >= safeMax) return;
		state.spinMeterValue = Math.min(safeMax, state.spinMeterValue + delta);
		if (state.spinMeterValue < safeMax) return;
		if (state.bonusRoundActive || state.rouletteFlowInProgress) {
			state.pendingRouletteSource = 'spin';
			return;
		}
		onTrigger('spin');
	};

	const addBonusMeterValue = (
		delta = 1,
		onTrigger: (source: 'bonus') => void,
		options?: { allowDuringRoulette?: boolean; onBonusRoundFilled?: (overflow: number) => void },
	): void => {
		const allowDuringRoulette = options?.allowDuringRoulette === true;
		if (delta <= 0) return;
		if (state.rouletteFlowInProgress && !allowDuringRoulette) return;
		const safeMax = state.bonusMeterMax > 0 ? state.bonusMeterMax : 20;
		if (state.bonusMeterValue >= safeMax) {
			if (!state.bonusRoundActive) return;
			state.bonusMeterValue = safeMax;
			state.bonusMeterOverflowValue += delta;
			options?.onBonusRoundFilled?.(delta);
			return;
		}
		const next = state.bonusMeterValue + delta;
		state.bonusMeterValue = Math.min(safeMax, next);
		if (state.bonusMeterValue < safeMax) return;
		const overflow = Math.max(0, next - safeMax);
		if (state.bonusRoundActive) {
			state.bonusMeterValue = safeMax;
			options?.onBonusRoundFilled?.(overflow);
			return;
		}
		if (state.rouletteFlowInProgress) {
			state.pendingRouletteSource = 'bonus';
			return;
		}
		onTrigger('bonus');
	};

	const beginRoulette = (source: 'spin' | 'bonus') => {
		state.rouletteFlowInProgress = true;
		state.activeRouletteSource = source;
	};

	const completeRoulette = (): RouletteTrigger => {
		const queued = state.pendingRouletteSource;
		state.rouletteFlowInProgress = false;
		state.activeRouletteSource = null;
		state.pendingRouletteSource = null;
		return queued;
	};

	const resetBonusMeterForRoulette = () => {
		if (state.bonusRoundActive) return;
		// Reset the SESSION bonus meter to the current tier's base start (0 on 1/10-ball, 1/8 on
		// 20-ball, 1/4 on 50-ball), not 0.
		const start = bonusMeterTierFor(state.ballPerDrop).start;
		state.bonusMeterValue = Math.min(start, state.bonusMeterMax);
	};

	const startBonusRound = (freeBalls: number) => {
		state.bonusRoundActive = true;
		state.bonusLevelProgress = 0;
		state.pendingBonusLevelUpCount = 0;
		return freeBalls;
	};

	const bonusPendingLevelHighlight = () =>
		Math.min(BONUS_LEVEL_LABELS.length, state.bonusLevelProgress + state.pendingBonusLevelUpCount + 1);

	return {
		state,
		getScaledTierMax,
		rebuildMeterTierMaxima,
		spinMeterProgress,
		bonusMeterProgress,
		setBallPerDrop,
		bumpSpinMeterVisual,
		bumpBonusMeterVisual,
		addSpinMeterValue,
		addBonusMeterValue,
		beginRoulette,
		completeRoulette,
		resetBonusMeterForRoulette,
		startBonusRound,
		bonusPendingLevelHighlight,
	};
};

export type MeterController = ReturnType<typeof createMeterController>;
