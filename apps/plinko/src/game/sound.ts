import { createSound } from 'utils-sound';

export type SoundEffectName =
	| 'bet'
	| 'win'
	| 'pocket'
	| 'placeChip'
	| 'clickingFail'
	| 'startAutoPlay'
	| 'openPopup'
	| 'clickUIButton';

export type SoundName = SoundEffectName;

const sound = createSound<SoundName>();

export { sound };
