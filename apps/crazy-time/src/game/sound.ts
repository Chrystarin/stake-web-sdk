import { stateSoundDerived } from 'state-shared';

import { staticUrl } from '../lib/staticUrl';
import { stateGame } from './stateGame.svelte';

/**
 * One-shot table sound effects.
 *
 * Deliberately plain HTMLAudio rather than the shared `utils-sound` package: that one is built
 * around pixi-svelte's loaded-audio sprite sheets, and this game is DOM-only with a couple of
 * standalone mp3s. Each effect plays on a small ring of audio nodes, so overlapping plays (tapping
 * one colour straight after another) sound together instead of restarting the one already playing.
 */
export type SoundName =
	| 'whoosh'
	| 'pop'
	| 'click'
	| 'merge'
	| 'peg'
	| 'boom'
	| 'notify'
	| 'win'
	| 'doorClose'
	| 'doorOpen';

const SOURCES: Record<SoundName, string> = {
	// The chip leaving the tray.
	whoosh: staticUrl('sound/whoosh.mp3'),
	// The chip settling onto the colour.
	pop: staticUrl('sound/pop.mp3'),
	// A button answering the press — Play and Clear.
	click: staticUrl('sound/clickUIButton.mp3'),
	// A won chip going into the balance.
	merge: staticUrl('sound/chip_merge.mp3'),
	// The jackpot ball striking a peg, and the win marquee going up. Both lifted from One-Eyed
	// Willy's plinko (apps/plinko/static/sound) so the bonus round sounds like the game it came
	// from — same samples, and the trims below are that game's too.
	peg: staticUrl('sound/peg.wav'),
	// A bomb going off on the plinko board. Synthesised rather than sampled — a burst of low-passed
	// noise over a pitched-down thump, a second long — since nothing in the shared sound sets is an
	// explosion. Replace with a recorded one if the pirate set ever gets one.
	boom: staticUrl('sound/boom.mp3'),
	// A reel coming to rest in the Top Slot.
	notify: staticUrl('sound/notify.mp3'),
	win: staticUrl('sound/win.mp3'),
	// The jackpot screen arriving and leaving — a door thudding shut and creaking back open, from
	// the same game's bonus screen. Both are SPRITE windows; see `SPRITES`.
	doorClose: staticUrl('sound/door_close.ogg'),
	doorOpen: staticUrl('sound/door_open.ogg'),
};

/**
 * A `[startMs, durationMs, fadeMs?]` slice to play instead of the whole file.
 *
 * The door clips open with a stretch of latch ticking and rattle before the slam, so playing them
 * whole would put the noise where the sound should be. The windows start a hair before the
 * measured onset — `door_close` at ~2.80s, `door_open` at ~3.22s — so the attack is not clipped,
 * and both run to the end of their decay so the tail is not chopped. Lifted from the plinko app's
 * own sprite table.
 *
 * `fadeMs` rides the last of the window down to silence instead of stopping dead on it. Ending a
 * decaying tail with a `pause()` is a step to zero however quiet it has got, and a step is a click
 * — which is the "cut" you hear rather than the window being mistimed.
 */
const SPRITES: Partial<Record<SoundName, [startMs: number, durationMs: number, fadeMs?: number]>> =
	{
		doorClose: [2790, 2260, 400],
		// A shorter window gets a shorter tail — the same quarter of it, so the creak lands the way the
		// thud does rather than fading for half its length.
		doorOpen: [3200, 900, 220],
	};

/** Per-sound trim, so the movement swish sits under the landing pop rather than over it. */
const MIX: Record<SoundName, number> = {
	whoosh: 0.5,
	pop: 0.9,
	click: 0.9,
	merge: 0.9,
	// A drop strikes twenty-one of these in under two seconds, so it sits well back.
	peg: 0.5,
	// The one loud thing on the board, and it has to read over the peg ticking under it.
	boom: 0.85,
	// Two of these land per spin, a couple of seconds apart, over the peg ticking.
	notify: 0.7,
	win: 1,
	// Well under the plinko game's own level: there they are the bonus screen's headline moment,
	// here they are the way into one, and loud they walk over the announcement the screen lands on.
	// The thud is quieter again than the creak — it arrives on top of the word.
	doorClose: 0.25,
	doorOpen: 0.5,
};

const preloaded = new Map<SoundName, HTMLAudioElement>();
/**
 * Everything a playing sprite has outstanding — its end-of-window stop and its fade ticker — so a
 * re-trigger can call the last one off rather than being cut short by it.
 */
const spriteRuns = new Map<SoundName, () => void>();

/**
 * How many plays of ONE effect can sound together. The busiest caller is the wheel's peg tick — a
 * 0.13 s sample, pitched up, fired some thirty times a second at full speed — which overlaps three
 * or four deep; eight leaves room for the Top Slot ticking over it.
 */
const VOICES_PER_SOUND = 8;

/**
 * The elements each effect plays on, reused from one play to the next.
 *
 * Every play used to get an element of its own (`cloneNode` on the warmed one). A single spin ticks
 * the peg ~190 times, so that was ~190 media elements — each with its own fetch of the file and its
 * own decoder — built and thrown away per round, and left for the garbage collector to find. A
 * media element is not reclaimed while it is playing and is slow to be reclaimed after; mobile
 * Chrome refuses new players outright past a few dozen live ones, and iOS holds an audio session
 * slot for each. A small ring of voices sounds the same — overlapping plays still layer — and
 * allocates nothing after the first few ticks.
 */
const voices = new Map<SoundName, HTMLAudioElement[]>();
const voiceCursor = new Map<SoundName, number>();

/** An element to play `name` on: an idle voice, a new one while the ring has room, else the oldest. */
const takeVoice = (name: SoundName): HTMLAudioElement => {
	let ring = voices.get(name);
	if (!ring) {
		ring = [];
		voices.set(name, ring);
	}
	const idle = ring.find((voice) => voice.paused || voice.ended);
	if (idle) return idle;
	if (ring.length < VOICES_PER_SOUND) {
		// Cloning the warmed element starts the new voice from the same source, so it is served from
		// what the warm-up already fetched; a fresh Audio covers a play that beats the preload.
		const warmed = preloaded.get(name);
		const voice = warmed ? (warmed.cloneNode() as HTMLAudioElement) : new Audio(SOURCES[name]);
		voice.preload = 'auto';
		ring.push(voice);
		return voice;
	}
	// Every voice is sounding: the oldest gives way, which is the one nearest its end anyway.
	const cursor = voiceCursor.get(name) ?? 0;
	voiceCursor.set(name, (cursor + 1) % ring.length);
	const stolen = ring[cursor];
	stolen.pause();
	return stolen;
};

const cancelSprite = (name: SoundName) => {
	spriteRuns.get(name)?.();
	spriteRuns.delete(name);
};

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

/**
 * How long the intro preload waits on one effect before carrying on without it. `preload` is a hint
 * — iOS ignores it outright on cellular — so an element that never buffers must not hold the splash;
 * the effect just streams on its first play, which is what every effect did before the preload.
 */
const SOUND_WARM_TIMEOUT_MS = 15_000;

/**
 * The same warm-up as {@link preloadSounds}, but as one promise per effect for the intro preload to
 * count towards its progress: each resolves once its element can play through (or has failed, or has
 * taken too long). The ELEMENTS are what is warmed, not the HTTP cache — `playSound` clones these very
 * elements, so what they have buffered is what the first play uses. Always resolves.
 */
export const warmSounds = (): Promise<void>[] => {
	preloadSounds();
	return [...preloaded.values()].map((audio) => {
		if (audio.readyState >= HTMLMediaElement.HAVE_ENOUGH_DATA || audio.error) {
			return Promise.resolve();
		}
		return new Promise<void>((resolve) => {
			const settle = () => {
				clearTimeout(giveUp);
				audio.removeEventListener('canplaythrough', settle);
				audio.removeEventListener('error', settle);
				resolve();
			};
			const giveUp = setTimeout(settle, SOUND_WARM_TIMEOUT_MS);
			audio.addEventListener('canplaythrough', settle);
			audio.addEventListener('error', settle);
			// A second `load()` on an element that is already fetching would restart it; only nudge
			// one the browser has not started on.
			if (audio.networkState === HTMLMediaElement.NETWORK_EMPTY) audio.load();
		});
	});
};

/** The effect files, for the preload's manifest audit (lib/preloadAssets.ts). */
export const soundEffectUrls = (): string[] => Object.values(SOURCES);

/** The music file — streamed by `startMusic` from the game's first frame, never preloaded. */
export const musicUrl = (): string => MUSIC_SRC;

/**
 * `rate` shifts playback speed AND pitch — for a sound fired many times in a row, a touch of
 * random pitch is what stops the repeats sounding machine-gun identical. Browsers default to
 * correcting pitch when the rate changes, which is exactly backwards here, so that is turned off.
 */
export const playSound = (name: SoundName, rate?: number, gain = 1): void => {
	if (typeof Audio === 'undefined') return;
	// The menu's Sound switch.
	if (!stateGame.soundEnabled) return;
	// `gain` trims one call rather than the sound: the peg tick is shared by the wheel, the Top Slot
	// and both bonus rooms, and they do not all want it at the same level.
	const volume = stateSoundDerived.volumeSoundEffect() * MIX[name] * gain;
	if (volume <= 0) return;
	const sprite = SPRITES[name];
	// A sprite has to seek before it sounds, and a fresh clone has no metadata to seek against —
	// so these play on the warmed element itself, restarting rather than layering. They are screen
	// transitions: there is only ever one, and a second one wants to cut the first off anyway.
	// Everything else plays on one of its effect's voices (see `takeVoice`).
	let node: HTMLAudioElement;
	if (sprite) {
		let warmed = preloaded.get(name);
		if (!warmed) {
			// A play that beat the preload. Kept, so the next one reuses it rather than building another.
			warmed = new Audio(SOURCES[name]);
			preloaded.set(name, warmed);
		}
		node = warmed;
	} else {
		node = takeVoice(name);
	}
	node.volume = Math.min(1, volume);
	// Set on every play, not only a pitched one: the voice is reused, and would otherwise carry the
	// last caller's rate into a play that asked for none.
	const pitched = node as HTMLAudioElement & { preservesPitch?: boolean };
	pitched.preservesPitch = false;
	node.playbackRate = rate && rate > 0 ? rate : 1;

	// Rejects while the autoplay policy is unsatisfied. Every play here follows a tap on the
	// board, so there is nothing to recover from and nothing worth logging.
	if (!sprite) {
		try {
			// A voice that has played before is sitting at its end (or, stolen, part-way through).
			if (node.currentTime > 0) node.currentTime = 0;
		} catch {
			/* not seekable yet — `play()` on an ended element rewinds by itself */
		}
		void node.play().catch(() => {});
		return;
	}

	const [startMs, durationMs, fadeMs = 0] = sprite;
	cancelSprite(name);
	const speed = rate && rate > 0 ? rate : 1;
	const windowMs = durationMs / speed;
	// A fade longer than the window would start before the sound did.
	const fade = Math.min(fadeMs / speed, windowMs);
	const full = node.volume;

	const start = () => {
		try {
			node.currentTime = startMs / 1000;
		} catch {
			/* not seekable yet — it will play from the top rather than not at all */
		}
		void node.play().catch(() => {});

		let ramp: ReturnType<typeof setInterval> | undefined;
		// Ride the last of the window down rather than stopping on it. Stepping the element's own
		// volume is coarse next to a Web Audio ramp, but at ~30ms a step it is well under what reads
		// as a step, and it keeps this module the plain-HTMLAudio thing it is meant to be.
		const stop = setTimeout(
			() => {
				if (fade <= 0) {
					node.pause();
					return;
				}
				const steps = Math.max(1, Math.round(fade / 30));
				let step = 0;
				ramp = setInterval(() => {
					step += 1;
					node.volume = Math.max(0, full * (1 - step / steps));
					if (step < steps) return;
					clearInterval(ramp);
					node.pause();
					// Handed back at its proper level, or the next play starts silent.
					node.volume = full;
				}, fade / steps);
			},
			Math.max(0, windowMs - fade),
		);

		spriteRuns.set(name, () => {
			clearTimeout(stop);
			if (ramp) clearInterval(ramp);
			node.volume = full;
		});
	};
	// `readyState >= HAVE_METADATA` is the point at which a seek will take.
	if (node.readyState >= 1) start();
	else node.addEventListener('loadedmetadata', start, { once: true });
};

// --- Background music ---------------------------------------------------------------------
// One looping track under the table, on the MUSIC volume rather than the effects one, so a
// player who only wants the chips can turn it off on its own.

const MUSIC_SRC = staticUrl('sound/background_music_placeholder.mp3');

/** Held well under the effects — the track plays behind the game, not over it. */
const MUSIC_MIX = 0.05;

let music: HTMLAudioElement | null = null;
/** Calls off a pending "start on the first gesture" wait; null while nothing is waiting. */
let cancelGestureWait: (() => void) | null = null;

/** Zero while the menu's Music switch is off, which pauses the track the way a silent slider does. */
const musicVolume = () =>
	stateGame.musicEnabled ? Math.min(1, stateSoundDerived.volumeMusic() * MUSIC_MIX) : 0;

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
