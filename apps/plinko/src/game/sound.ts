import { Howl, Howler } from 'howler';

// A 50-ball drop fires the 'pocket' sound ~50 times in quick succession. When Howler falls back to
// HTML5 audio (e.g. Web Audio locked inside the Stake iframe), those rapid plays exhaust the default
// 10-node HTML5 pool → "HTML5 Audio pool exhausted, returning potentially locked audio object". Raise
// the pool so concurrent plays each get their own node.
Howler.html5PoolSize = 60;

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
