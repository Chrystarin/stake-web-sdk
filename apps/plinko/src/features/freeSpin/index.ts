export { FreeSpinMeterEngine } from './FreeSpinMeterEngine';
export { default as FreeSpinMeter } from './FreeSpinMeter.svelte';
export { default as FreeSpinRoulette } from './FreeSpinRoulette.svelte';
export type { FreeSpinRouletteResult } from './FreeSpinRoulette.svelte';
export {
	augmentBetBookForSessionMeterFull,
	bookHasFreeSpinTrigger,
	injectFreeSpinTriggerIfMeterFull,
} from './bookAugmentation';
export {
	ensureFreeSpinWhenSessionMeterFull,
	runFreeSpinTriggerFlow,
	sessionSpinMeterReachedMax,
} from './freeSpinFeature';
export {
	applyFreeSpinActionBalance,
	freeSpinMultiplierFromSegment,
	isFreeSpinBonusWheelSegment,
	resolveFreeSpinPayoutAmount,
} from './payout';
export {
	freeSpinSegmentIndexForMultiplier,
	freeSpinSegmentIndexForSegment,
	isFreeSpinBonusSegment,
	onFreeSpinRouletteFinished,
} from './rouletteFlow';
export { fallbackFreeSpinSegmentFromRound, settleFreeSpinWalletCredit } from './wallet';
export type { FreeSpinWalletSettlement } from './wallet';
export {
	flushPendingFreeSpinWalletBeforeEndRound,
	queuePendingFreeSpinWalletCredit,
} from './walletSync';
export type { PendingFreeSpinWalletCredit } from './walletSync';
