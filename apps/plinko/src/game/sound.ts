import { Howl } from 'howler';

export type SoundEffectName =
	| 'bet'
	| 'win'
	| 'pocket'
	| 'placeChip'
	| 'clickingFail'
	| 'startAutoPlay'
	| 'openPopup'
	| 'clickUIButton';

const howls = new Map<SoundEffectName, Howl>();

export function loadPlinkoSound(name: SoundEffectName, url: string): void {
	if (howls.has(name)) return;
	try {
		howls.set(
			name,
			new Howl({
				src: [url],
				volume: 1,
				onloaderror: (_id, err) => {
					console.warn(`[plinko] sound "${name}" failed to load (${url})`, err);
				},
			}),
		);
	} catch (err) {
		console.warn(`[plinko] sound "${name}" could not be created`, err);
	}
}

export function playPlinkoSound(name: SoundEffectName): void {
	howls.get(name)?.play();
}
