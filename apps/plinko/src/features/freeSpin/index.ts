export { FreeSpinMeterEngine } from './FreeSpinMeterEngine';
export { default as FreeSpinMeter } from './FreeSpinMeter.svelte';
export { default as FreeSpinRoulette } from './FreeSpinRoulette.svelte';
export type { FreeSpinRouletteResult } from './FreeSpinRoulette.svelte';
export { bookHasFreeSpinTrigger, injectFreeSpinTriggerIfMeterFull } from './bookAugmentation';
export {
	ensureFreeSpinWhenSessionMeterFull,
	runFreeSpinTriggerFlow,
	sessionSpinMeterReachedMax,
} from './freeSpinFeature';
export {
	applyRgsBalanceFromResponse,
	bookPayoutMultiplierDecimal,
	bookRoundPayoutIncludesFreeSpin,
	freeSpinMultiplierFromSegment,
	getBookRoundPayoutAmount,
	getFreeSpinBaseRoundWin,
	hasMeaningfulFreeSpinWalletCredit,
	isFreeSpinBonusWheelSegment,
	resolveFreeSpinFeatureCredit,
	resolveFreeSpinPayoutAmount,
	resolveFreeSpinRoundTotalWin,
} from './payout';
export {
	freeSpinSegmentIndexForMultiplier,
	freeSpinSegmentIndexForSegment,
	isFreeSpinBonusSegment,
	onFreeSpinRouletteFinished,
} from './rouletteFlow';
export { fallbackFreeSpinSegmentFromRound } from './wallet';
export type { FreeSpinWalletSettlement } from './wallet';
