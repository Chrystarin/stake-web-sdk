import { stateSoundDerived } from 'state-shared';

/**
 * One-shot table sound effects.
 *
 * Deliberately plain HTMLAudio rather than the shared `utils-sound` package: that one is built
 * around pixi-svelte's loaded-audio sprite sheets, and this game is DOM-only with a couple of
 * standalone mp3s. Each play uses its own audio node, so overlapping plays (tapping one colour
 * straight after another) sound together instead of restarting the one already playing.
 */
export type SoundName = 'whoosh' | 'pop';

const SOURCES: Record<SoundName, string> = {
	// The chip leaving the tray.
	whoosh: '/sound/whoosh.mp3',
	// The chip settling onto the colour.
	pop: '/sound/pop.mp3',
};

/** Per-sound trim, so the movement swish sits under the landing pop rather than over it. */
const MIX: Record<SoundName, number> = {
	whoosh: 0.5,
	pop: 0.9,
};

const preloaded = new Map<SoundName, HTMLAudioElement>();

/** Warm the files, so the first placement is not silent while the mp3 is still downloading. */
export const preloadSounds = (): void => {
	if (typeof Audio === 'undefined') return; // SSR
	for (const name of Object.keys(SOURCES) as SoundName[]) {
		if (preloaded.has(name)) continue;
		const audio = new Audio(SOURCES[name]);
		audio.preload = 'auto';
		preloaded.set(name, audio);
	}
};

export const playSound = (name: SoundName): void => {
	if (typeof Audio === 'undefined') return;
	const volume = stateSoundDerived.volumeSoundEffect() * MIX[name];
	if (volume <= 0) return;
	// Cloning the warmed element reuses whatever it has already buffered; falling back to a
	// fresh Audio covers a play that beats the preload.
	const warmed = preloaded.get(name);
	const node = warmed ? (warmed.cloneNode() as HTMLAudioElement) : new Audio(SOURCES[name]);
	node.volume = Math.min(1, volume);
	// Rejects while the autoplay policy is unsatisfied. Every play here follows a tap on the
	// board, so there is nothing to recover from and nothing worth logging.
	void node.play().catch(() => {});
};
