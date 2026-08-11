import { stateSoundDerived } from 'state-shared';

/**
 * One-shot table sound effects.
 *
 * Deliberately plain HTMLAudio rather than the shared `utils-sound` package: that one is built
 * around pixi-svelte's loaded-audio sprite sheets, and this game is DOM-only with a couple of
 * standalone mp3s. Each play uses its own audio node, so overlapping plays (tapping one colour
 * straight after another) sound together instead of restarting the one already playing.
 */
export type SoundName = 'whoosh' | 'pop' | 'click' | 'merge';

const SOURCES: Record<SoundName, string> = {
	// The chip leaving the tray.
	whoosh: '/sound/whoosh.mp3',
	// The chip settling onto the colour.
	pop: '/sound/pop.mp3',
	// A button answering the press — Play and Clear.
	click: '/sound/clickUIButton.mp3',
	// A won chip going into the balance.
	merge: '/sound/chip_merge.mp3',
};

/** Per-sound trim, so the movement swish sits under the landing pop rather than over it. */
const MIX: Record<SoundName, number> = {
	whoosh: 0.5,
	pop: 0.9,
	click: 0.9,
	merge: 0.9,
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

// --- Background music ---------------------------------------------------------------------
// One looping track under the table, on the MUSIC volume rather than the effects one, so a
// player who only wants the chips can turn it off on its own.

const MUSIC_SRC = '/sound/background_music_placeholder.mp3';

/** Held well under the effects — the track plays behind the game, not over it. */
const MUSIC_MIX = 0.05;

let music: HTMLAudioElement | null = null;
/** Calls off a pending "start on the first gesture" wait; null while nothing is waiting. */
let cancelGestureWait: (() => void) | null = null;

const musicVolume = () => Math.min(1, stateSoundDerived.volumeMusic() * MUSIC_MIX);

/** Run `start` on the first interaction with the page, once, and only ever wait for one. */
const onFirstGesture = (start: () => void): void => {
	if (cancelGestureWait || typeof window === 'undefined') return;
	const events = ['pointerdown', 'keydown', 'touchstart'] as const;
	const onGesture = () => {
		cancelGestureWait?.();
		start();
	};
	cancelGestureWait = () => {
		for (const type of events) window.removeEventListener(type, onGesture);
		cancelGestureWait = null;
	};
	for (const type of events) window.addEventListener(type, onGesture, { passive: true });
};

/**
 * Start the table music, looping until `stopMusic`.
 *
 * Autoplay is refused until the player has interacted with the page, so a blocked start is not
 * a failure: the track waits for the first touch of the table and begins there instead. Safe to
 * call again — it reuses the element it already has.
 */
export const startMusic = (): void => {
	if (typeof Audio === 'undefined') return; // SSR
	if (!music) {
		music = new Audio(MUSIC_SRC);
		music.loop = true;
		music.preload = 'auto';
	}
	music.volume = musicVolume();
	// Turned all the way down: nothing to start until the slider comes back up (syncMusicVolume).
	if (music.volume <= 0) return;
	void music.play().catch(() => onFirstGesture(startMusic));
};

/** Follow the music slider: silence pauses the track, and turning it back up resumes it. */
export const syncMusicVolume = (): void => {
	// Read before the guard, so a caller tracking this (Game's effect) still subscribes to the
	// slider on a call that lands before the track exists.
	const volume = musicVolume();
	if (!music) return;
	music.volume = volume;
	if (volume <= 0) music.pause();
	else if (music.paused) startMusic();
};

export const stopMusic = (): void => {
	cancelGestureWait?.();
	music?.pause();
	music = null;
};
