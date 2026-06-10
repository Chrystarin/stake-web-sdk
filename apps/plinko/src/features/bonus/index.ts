export { BonusMeterEngine } from './BonusMeterEngine';
export { default as BonusMeter } from './BonusMeter.svelte';
export { default as BonusRoulette } from './BonusRoulette.svelte';
export type { BonusRouletteResult } from './BonusRoulette.svelte';
export { default as BonusLevel } from './BonusLevel.svelte';
export { bookHasBonusRoulette, injectBonusRoundIfMeterFull } from './bookAugmentation';
export {
	bookEventsReachBonusMeterMax,
	ensureBonusWhenSessionMeterFull,
	fallbackBonusFreeBallsFromRound,
	runBonusRouletteFlow,
	scheduleBonusRouletteIfMeterFullIdle,
	sessionBonusMeterReachedMax,
	shouldTriggerBonusRouletteForFullMeter,
} from './bonusFeature';