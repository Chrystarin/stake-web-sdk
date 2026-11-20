import { stateSoundDerived } from 'state-shared';

import { staticUrl } from '../lib/staticUrl';
import type { RoomSpot } from './constants';
import { stateGame } from './stateGame.svelte';

/**
 * One-shot table sound effects.
 *
 * Deliberately plain HTMLAudio rather than the shared `utils-sound` package: that one is built
 * around pixi-svelte's loaded-audio sprite sheets, and this game is DOM-only with a couple of
 * standalone mp3s. Each effect plays on a small ring of audio nodes, so overlapping plays (tapping
 * one colour straight after another) sound together instead of restarting the one already playing.
 */
// --- Output: Web Audio gain ----------------------------------------------------------------
// Every element — each effect voice and each music track — is routed through a GainNode of its own,
// and its level is set there rather than on `el.volume`. iOS ignores `volume` on a media element
// outright (it is always 1), so with `volume` alone an iPhone heard the music some 26 dB over the
// mix it was given, every effect at full, no fades, and sliders that did nothing short of zero. A
// GainNode is honoured everywhere. The elements still do the fetching, decoding and looping; only
// the level moves.
//
// The context is made on the first touch, not at load: one made before it starts suspended, and
// Chrome logs a warning for it. Elements made before then are routed the moment it exists (nothing
// can sound before that touch anyway). Where there is no Web Audio, or routing an element fails,
// that element simply keeps using `volume`.

type WebkitWindow = Window & { webkitAudioContext?: typeof AudioContext };

let ctx: AudioContext | null = null;
const gains = new WeakMap<HTMLMediaElement, GainNode>();
/** Elements waiting for the context to be made, to be routed then. */
const unrouted = new Set<HTMLMediaElement>();

const routeNow = (el: HTMLMediaElement, context: AudioContext): void => {
	if (gains.has(el)) return;
	try {
		const gain = context.createGain();
		// Whatever level it was given while it waited is carried over to the node.
		gain.gain.value = el.volume;
		context.createMediaElementSource(el).connect(gain).connect(context.destination);
		gains.set(el, gain);
		el.volume = 1;
	} catch {
		/* already routed elsewhere, or no support: it stays on `volume` */
	}
};

/** Put `el` on a gain of its own — now if the context exists, else as soon as it does. */
const route = (el: HTMLMediaElement): void => {
	if (ctx) routeNow(el, ctx);
	else unrouted.add(el);
};

/** Set an element's level, on its gain if it has one. */
const setLevel = (el: HTMLMediaElement, level: number): void => {
	const gain = gains.get(el);
	if (gain) gain.gain.value = level;
	else el.volume = Math.min(1, Math.max(0, level));
};
const levelOf = (el: HTMLMediaElement): number => gains.get(el)?.gain.value ?? el.volume;

/**
 * iOS files Web Audio under the "ambient" session by default, which the ringer switch mutes — so once
 * the elements play through a context, a phone on silent would hear nothing. "playback" is what an
 * `<audio>` element had on its own. Re-asserted on `pageshow`, as the plinko app found it needed.
 */
const preferPlaybackSession = (): void => {
	const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
	if (session && session.type !== 'playback') {
		try {
			session.type = 'playback';
		} catch {
			/* read-only on this build */
		}
	}
};

/**
 * Keep the context running. A suspended or "interrupted" one (a call, Siri, another app taking the
 * session) comes back with `resume()`. A ZOMBIE — "running", but its clock frozen, which iOS leaves
 * behind when the page is hidden while it is sounding — does not: `resume()` on it is a no-op, and
 * only suspending it and resuming restarts it (measured on real devices in the plinko app).
 */
let lastClock = -1;
const heal = (): void => {
	if (!ctx || ctx.state === 'closed') return;
	if (ctx.state !== 'running') {
		void ctx.resume().catch(() => {});
		return;
	}
	const now = ctx.currentTime;
	if (now === lastClock) {
		lastClock = -1;
		const zombie = ctx;
		void zombie
			.suspend()
			.then(() => zombie.resume())
			.catch(() => {});
		return;
	}
	lastClock = now;
};

/** Once a second while the page is shown: a running context whose clock has not moved is a zombie. */
const WATCHDOG_MS = 1000;

const makeContext = (): void => {
	if (ctx || typeof window === 'undefined') return;
	const Ctor = window.AudioContext ?? (window as WebkitWindow).webkitAudioContext;
	if (!Ctor) return;
	try {
		ctx = new Ctor();
	} catch {
		return;
	}
	for (const el of unrouted) routeNow(el, ctx);
	unrouted.clear();
	setInterval(() => {
		if (document.hidden) lastClock = -1;
		else heal();
	}, WATCHDOG_MS);
};

/** Every touch: make the context if it is not made, and wake it if it is not running. */
const onTouch = (): void => {
	makeContext();
	if (ctx && ctx.state !== 'running' && ctx.state !== 'closed') void ctx.resume().catch(() => {});
};

if (typeof window !== 'undefined') {
	preferPlaybackSession();
	// iOS counts `touchend` and `click` as activation, not `touchstart`; `pointerdown` is everyone
	// else's earliest. Capture, so a handler that stops propagation cannot keep it from us.
	for (const type of ['pointerdown', 'touchend', 'click', 'keydown'] as const) {
		window.addEventListener(type, onTouch, { capture: true, passive: true });
	}
	window.addEventListener('pageshow', () => {
		preferPlaybackSession();
		heal();
	});
	document.addEventListener('visibilitychange', () => {
		if (!document.hidden) heal();
	});
}

export type SoundName =
	| 'whoosh'
	| 'pop'
	| 'click'
	| 'merge'
	| 'peg'
	| 'boom'
	| 'cannon'
	| 'dragon'
	| 'treasure'
	| 'notify'
	| 'win'
	| 'doorClose'
	| 'doorOpen'
	| 'kraken'
	| 'shipWheel'
	| 'coinFlip'
	| 'coinShuffle'
	| 'openPopup'
	| 'wheelTick'
	| 'wheelLand'
	| 'chipLand'
	| 'refused'
	| 'spinStart'
	| 'topSlotHit'
	| 'bigWin'
	| 'chestPick'
	| 'chipReturn'
	| 'slamHome'
	| 'reelStop';

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
	// The cannon over the plinko board firing the ball. A SPRITE window, for its silent head alone;
	// past that the shot decays to nothing by itself around 1.9s, well under the peg ticking that
	// starts a few frames after it.
	cannon: staticUrl('sound/cannon_sfx.mp3'),
	// The chest room's dragon breathing over the last chest, and the chest itself giving up its
	// prize. The roar is a SPRITE window — the recording carries a wind-up and a tail either side
	// of the breath (see `SPRITES`). The chest's cue plays WHOLE, and the room is cut to it rather
	// than the other way round: it starts with the fire, the chest shudders through its build, and
	// the lid comes off on the hit 4s in (rooms/RoomChest.svelte, `LID_AT_CUE_MS`).
	dragon: staticUrl('sound/dragon_sfx.mp3'),
	treasure: staticUrl('sound/treasure_sfx.mp3'),
	// A bomb going off on the plinko board. Synthesised rather than sampled — a burst of low-passed
	// noise over a pitched-down thump, a second long — since nothing in the shared sound sets is an
	// explosion. Replace with a recorded one if the pirate set ever gets one.
	boom: staticUrl('sound/boom.mp3'),
	// A reel coming to rest in the Top Slot.
	notify: staticUrl('sound/notify.mp3'),
	win: staticUrl('sound/win.mp3'),
	// The jackpot screen arriving and leaving — a door thudding shut and creaking back open, from
	// the same game's bonus screen. Both are SPRITE windows; see `SPRITES`. MP3, not the Vorbis .ogg
	// they were delivered as: no iPhone or iPad decodes Vorbis in an <audio>, so both doors were
	// silent there. These are the plinko app's transcodes, which keep the same sprite windows.
	doorClose: staticUrl('sound/door_close.mp3'),
	doorOpen: staticUrl('sound/door_open.mp3'),
	// The kraken rising over the rail in Ocean Voyage v2 (rooms/RoomOceanVoyageV2.svelte). A SPRITE
	// window: the recording runs nearly 13s, and the room is gone long before that.
	kraken: staticUrl('sound/kraken_sfx.mp3'),
	// The ship's wheel creaking round under the player's hands in Ocean Voyage v2. A SPRITE window.
	shipWheel: staticUrl('sound/ship_wheel_sfx.mp3'),
	// A coin of Ocean Voyage's fountain landing in the barrel of gold — One-Eyed Willy's plinko's own
	// coin, as its win coins land in the balance (apps/plinko/static/sound/coin_flip.mp3).
	coinFlip: staticUrl('sound/coin_flip.mp3'),
	// The coins of that fountain being thrown: the same game's win coin shower's bed, as its win coins
	// start spawning (apps/plinko/static/sound/coin_shuffle.mp3). A SPRITE window.
	coinShuffle: staticUrl('sound/coin_shuffle.mp3'),
	// The win popup arriving: Willy's own (apps/plinko/static/sound/openPopup.mp3).
	openPopup: staticUrl('sound/openPopup.mp3'),
	// Chosen from the audition (2026-11-20). The plinko ones are that game's files as they ship there;
	// the two dice ones are from the @3d-dice/dice-box-threejs package (MIT), renamed for what they do.
	// The main wheel's flapper ticking past each pin. The bonus wheel and the Top Slot keep the peg.
	wheelTick: staticUrl('sound/roulette_tick.mp3'),
	// The main wheel coming to rest on its segment; also the plinko room's ball dropping into its slot.
	wheelLand: staticUrl('sound/pocket.mp3'),
	// A chip set down on a bet tile (a chip going home to the tray keeps the pop).
	chipLand: staticUrl('sound/chip_felt.mp3'),
	// A tap the table cannot take: a tile the balance does not cover, a chip worth more than it.
	refused: staticUrl('sound/clickingFail.mp3'),
	// SPIN pressed.
	spinStart: staticUrl('sound/startAutoPlay.mp3'),
	// The Top Slot's two reels landing on a pair that carries a multiplier to the board.
	topSlotHit: staticUrl('sound/bonus_level_up.mp3'),
	// A win of BIG_WIN_SOUND_MULT times the stake or more, in place of `win`. A SPRITE window.
	bigWin: staticUrl('sound/bonus_congratulations.mp3'),
	// A chest opened in the chest room.
	chestPick: staticUrl('sound/chest_wood.mp3'),
	// Kenney, CC0 (see static/sound/LICENSES.md), transcoded from the packs' OGG to MP3 for iOS.
	// A chip going home to the tray — handed back, cleared, or sent home in mid-flight.
	chipReturn: staticUrl('sound/chip_return.mp3'),
	// The Top Slot cabinet and then the wheel slammed home onto their perches.
	slamHome: staticUrl('sound/slam_plate.mp3'),
	// Each Top Slot reel coming to rest.
	reelStop: staticUrl('sound/reel_bell.mp3'),
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
		/**
		 * The roar, against the dragon's `Fire` animation (rooms/ChestDragon.svelte): the breath
		 * itself, from 1.5s to 5.0s of the recording, with the last of it riding down rather than
		 * stopping dead. It starts on the ignition and is finished half a second before the lid
		 * comes off.
		 */
		dragon: [1500, 3500, 400],
		/**
		 * The shot, off its silent head. The recording opens with ~0.09s of digital silence before
		 * the blast, which put the bang a frame and a half behind the ball leaving the barrel; the
		 * window starts a hair inside that so the attack is not clipped. It runs to the end of the
		 * recording, which is already silent by 1.9s, so there is nothing to fade.
		 */
		cannon: [80, 2040],
		/**
		 * The kraken's first swell: a rumble under its peek over the rail, the loudest of it from 1.7s
		 * to 2.3s, which is where it rears up (the room's surge lands at ~1.8s), then riding down as
		 * the room moves on. The recording swells again from 4.9s and runs to 11s; none of that is
		 * wanted.
		 */
		kraken: [0, 4200, 800],
		/**
		 * One turn's creak: off the recording's 0.2s of silence, through the steady creaking, and down
		 * before the last knock at 1.9s and the decay after it. The room plays it again as each one
		 * ends while the wheel is still being turned, so it is the length of a stretch of turning.
		 */
		shipWheel: [180, 1700, 300],
		/**
		 * The recording's second shuffle, 2s to 4s — plinko's `coinShuffleMulti`, the window its win
		 * celebration plays under a shower of coins (the first, from 0.54s, is its one-ball trickle).
		 * Two seconds is about a fountain's flight, throw to the last coin in.
		 */
		coinShuffle: [2000, 2000],
		/**
		 * The chime and the first of its ring: loud at the hit, -30 dB by 3.2s, and the file runs on to
		 * 6.2s. By then the multiplier has flown to the board and the wheel is turning, so it is let go
		 * over the last second.
		 */
		topSlotHit: [0, 3000, 1000],
		/**
		 * The fanfare off its 0.27s of silent head (plinko's own window starts at 250ms), and only as
		 * long as the win popup is up (WIN_POPUP_TOTAL_MS, 3.2s): it rides down with the popup's fade
		 * rather than ringing on into the next round.
		 */
		bigWin: [250, 3300, 900],
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
	// Recorded hot — it peaks where the bomb does. Held just under it, because the bomb is the
	// one thing on that board allowed to be the loudest, and the shot fires once a round.
	cannon: 0.7,
	// Both recorded as hot as the cannon. The roar is the loud moment of that room, so it keeps
	// most of its level; the chest is under it, because the win line is read over the top.
	dragon: 0.7,
	treasure: 0.6,
	// Two of these land per spin, a couple of seconds apart, over the peg ticking.
	notify: 0.7,
	win: 1,
	// Well under the plinko game's own level: there they are the bonus screen's headline moment,
	// here they are the way into one, and loud they walk over the announcement the screen lands on.
	// The thud is quieter again than the creak — it arrives on top of the word.
	doorClose: 0.25,
	doorOpen: 0.5,
	// Recorded quiet, so the file itself carries +6dB (it still peaks near -18dBFS), and it is the
	// moment the voyage is lost on, so it plays at full level besides.
	kraken: 1,
	// Well under everything else: it plays for as long as the wheel is being turned.
	shipWheel: 0.3,
	// Both at plinko's own level (its win shower plays them at full volume).
	coinFlip: 1,
	coinShuffle: 1,
	openPopup: 1,
	// The new set, levelled from measured peaks and loudness against what each replaces — not yet by
	// ear. The old pop peaked at -22 dBFS, so its replacements, which peak near -3, are held well
	// down; they still come out louder than the pop did, which was hard to hear.
	// The tick peaks within 2 dB of the peg it replaces; the callers' build-up gains stay as they were.
	wheelTick: 0.5,
	// The one hit at the end of a five-second spin.
	wheelLand: 0.6,
	// Up to a dozen of these go down in a bundle tap, 60ms apart.
	chipLand: 0.35,
	// Recorded quiet (-29 LUFS): near full so it is heard at all.
	refused: 0.8,
	// Recorded hot (-18 LUFS, peaking at -0.4): a press, not an event.
	spinStart: 0.5,
	topSlotHit: 0.8,
	// Plinko's own level for it: over the music and the popup's coin bed.
	bigWin: 0.8,
	// Eleven in a row, climbing in pitch.
	chestPick: 0.35,
	// The same chip family as `chipLand`, at its level.
	chipReturn: 0.35,
	// The boom's level, with the callers' gains kept: the plate peaks and sits within 2 dB of it.
	slamHome: 0.85,
	// Two a spin, over the peg ticking. The notify it replaces was 20 dB under everything; this
	// peaks near full scale, so it is held down to sit with the tick rather than over it.
	reelStop: 0.4,
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
		route(voice);
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
		// A sprite plays on the warmed element itself, so that is what goes on a gain. Only the
		// sprites': the other warmed elements are never played, only cloned.
		route(warmed);
		node = warmed;
	} else {
		node = takeVoice(name);
	}
	// Capped at 1 so the mix is what it was before the gains; a gain could take a quiet file past it.
	setLevel(node, Math.min(1, volume));
	// Set on every play, not only a pitched one: the voice is reused, and would otherwise carry the
	// last caller's rate into a play that asked for none.
	const pitched = node as HTMLAudioElement & {
		preservesPitch?: boolean;
		webkitPreservesPitch?: boolean;
	};
	pitched.preservesPitch = false;
	// Safari before 17 only knows the prefixed name, and would otherwise pitch-correct every
	// rate-shifted tick back to the same note.
	pitched.webkitPreservesPitch = false;
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
	const full = levelOf(node);

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
					setLevel(node, Math.max(0, full * (1 - step / steps)));
					if (step < steps) return;
					clearInterval(ramp);
					node.pause();
					// Handed back at its proper level, or the next play starts silent.
					setLevel(node, full);
				}, fade / steps);
			},
			Math.max(0, windowMs - fade),
		);

		spriteRuns.set(name, () => {
			clearTimeout(stop);
			if (ramp) clearInterval(ramp);
			setLevel(node, full);
		});
	};
	// `readyState >= HAVE_METADATA` is the point at which a seek will take.
	if (node.readyState >= 1) start();
	else node.addEventListener('loadedmetadata', start, { once: true });
};

/**
 * Ride a playing SPRITE effect down to silence over `fadeMs` and stop it there, ahead of the end of
 * its window — for a sound that lasts only as long as something is happening (the ship's wheel
 * creaking while it is turned). Does nothing to an effect that is not playing. A play of the same
 * effect during the fade calls the fade off and starts clean, at its proper level.
 */
export const fadeOutSound = (name: SoundName, fadeMs = 250): void => {
	const node = preloaded.get(name);
	if (!node || !SPRITES[name] || node.paused) return;
	cancelSprite(name);
	const full = levelOf(node);
	const steps = Math.max(1, Math.round(fadeMs / 30));
	let step = 0;
	const ramp = setInterval(() => {
		step += 1;
		setLevel(node, Math.max(0, full * (1 - step / steps)));
		if (step < steps) return;
		clearInterval(ramp);
		node.pause();
		setLevel(node, full);
		spriteRuns.delete(name);
	}, fadeMs / steps);
	spriteRuns.set(name, () => {
		clearInterval(ramp);
		setLevel(node, full);
	});
};

/**
 * Stop every effect that is sounding: the voices, and any sprite with its window still open. For the
 * menu's Sound switch going off (a kraken or a dragon would otherwise roar on for seconds after it)
 * and the page being hidden.
 */
export const silenceSounds = (): void => {
	for (const name of [...spriteRuns.keys()]) cancelSprite(name);
	for (const ring of voices.values()) for (const voice of ring) voice.pause();
	for (const [name, node] of preloaded) if (SPRITES[name]) node.pause();
};

// --- Background music ---------------------------------------------------------------------
// One looping track per scene — the table, and each bonus room its own — on the MUSIC volume
// rather than the effects one, so a player who only wants the chips can turn it off on its own.
// Moving between scenes crossfades: the outgoing track rides down and pauses, the incoming one
// rides up from silence. The table track resumes where it left off; a room's starts from the top.

/** A scene with its own track: the table, or the room on screen (the room keys are its Spots). */
export type MusicScene = 'base' | RoomSpot;

const MUSIC_SOURCES: Record<MusicScene, string> = {
	base: staticUrl('sound/bgm_base.mp3'),
	bonusWheel: staticUrl('sound/bgm_bonus_wheel.mp3'),
	piratePlinko: staticUrl('sound/bgm_pirate_plinko.mp3'),
	chest: staticUrl('sound/bgm_treasure_chest.mp3'),
	oceanVoyage: staticUrl('sound/bgm_ocean_voyage.mp3'),
};

/** The music files — streamed on first use by the scene that plays them, never preloaded. */
export const musicUrls = (): string[] => Object.values(MUSIC_SOURCES);

/** Held well under the effects — the track plays behind the game, not over it. */
const MUSIC_MIX = 0.05;

/** The table track coming up when the game first stands. */
const FADE_START_MS = 1200;
/** The outgoing track, and the incoming one. The in is the longer so the two overlap softly. */
const FADE_OUT_MS = 1000;
const FADE_IN_MS = 1400;

type Track = {
	el: HTMLAudioElement;
	/** 0..1 — where this track's fade stands, multiplied onto the music volume. */
	gain: number;
	ramp?: ReturnType<typeof setInterval>;
};

const tracks = new Map<MusicScene, Track>();
let scene: MusicScene = 'base';
/** Between `startMusic` and `stopMusic`: a scene change outside it only remembers the scene. */
let running = false;
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

const trackFor = (name: MusicScene): Track => {
	let track = tracks.get(name);
	if (!track) {
		const el = new Audio(MUSIC_SOURCES[name]);
		el.loop = true;
		el.preload = 'auto';
		route(el);
		track = { el, gain: 0 };
		tracks.set(name, track);
	}
	return track;
};

// On the track's gain (see `route`), so the fades and the mix are heard on iOS too.
const applyVolume = (track: Track) => {
	setLevel(track.el, Math.min(1, Math.max(0, musicVolume() * track.gain)));
};

/**
 * Play the current scene's track if it should be sounding. Autoplay is refused until the player
 * has interacted with the page, so a blocked start is not a failure: the track waits for the first
 * touch of the table and begins there instead.
 */
const resumeScene = (): void => {
	if (!running || musicVolume() <= 0) return;
	// Nothing plays into a hidden page; `onVisibility` brings the scene back when it is shown.
	if (typeof document !== 'undefined' && document.hidden) return;
	const track = tracks.get(scene);
	if (!track || !track.el.paused) return;
	// A track whose stream failed (a dropped connection mid-download) stays failed: every `play()`
	// on it rejects. Start the fetch over, so the retry on the next touch has something to play.
	if (track.el.error) track.el.load();
	applyVolume(track);
	void track.el.play().catch(() => onFirstGesture(resumeScene));
};

/**
 * Hidden: the music and any effect still sounding stop, rather than playing on in a background tab
 * (or on a phone's lock screen). Shown again: the scene's track picks up where it was. iOS pauses
 * media by itself when the browser goes to the background, and nothing else would ever call
 * `play()` again — the table would come back silent until the Music switch was toggled.
 */
const onVisibility = (): void => {
	if (document.hidden) {
		for (const track of tracks.values()) {
			if (track.ramp) clearInterval(track.ramp);
			track.ramp = undefined;
			track.el.pause();
			// An outgoing track caught mid-fade is finished with: it stays down.
			if (tracks.get(scene) !== track) track.gain = 0;
		}
		// The scene's own track was cut off mid-fade with its ramp: it comes back at full.
		const current = tracks.get(scene);
		if (current) current.gain = 1;
		silenceSounds();
		return;
	}
	resumeScene();
};

/** Back from the back/forward cache: `visibilitychange` may not fire, so treat it as being shown. */
const onPageShow = (event: PageTransitionEvent): void => {
	if (event.persisted) resumeScene();
};

let visibilityWired = false;
const wireVisibility = (on: boolean): void => {
	if (typeof document === 'undefined' || on === visibilityWired) return;
	visibilityWired = on;
	if (on) {
		document.addEventListener('visibilitychange', onVisibility);
		window.addEventListener('pageshow', onPageShow);
	} else {
		document.removeEventListener('visibilitychange', onVisibility);
		window.removeEventListener('pageshow', onPageShow);
	}
};

/** Ride a track's gain to `target` over `ms`, pausing it once it reaches silence. */
const rampTo = (track: Track, target: number, ms: number): void => {
	if (track.ramp) clearInterval(track.ramp);
	const from = track.gain;
	// Stepping the element's own volume is coarse next to a Web Audio ramp, but at ~30ms a step it
	// is well under what reads as a step — the same trade the sprite fades above make.
	const steps = Math.max(1, Math.round(ms / 30));
	let step = 0;
	const ramp = setInterval(() => {
		step += 1;
		track.gain = from + (target - from) * (step / steps);
		applyVolume(track);
		if (step < steps) return;
		clearInterval(ramp);
		track.ramp = undefined;
		if (track.gain <= 0) track.el.pause();
	}, ms / steps);
	track.ramp = ramp;
};

/** Start the music, looping until `stopMusic`. Safe to call again — it reuses what it has. */
export const startMusic = (): void => {
	if (typeof Audio === 'undefined') return; // SSR
	running = true;
	wireVisibility(true);
	const track = trackFor(scene);
	if (track.gain < 1) rampTo(track, 1, FADE_START_MS);
	resumeScene();
};

/**
 * Crossfade to a scene's track: the one playing rides down and pauses, the new one rides up. A
 * room's track starts from the top on each visit; one re-entered while still fading out from the
 * last visit picks up where it is rather than jumping.
 */
export const setMusicScene = (next: MusicScene): void => {
	if (next === scene) return;
	const previous = tracks.get(scene);
	scene = next;
	if (!running || typeof Audio === 'undefined') return;
	if (previous) rampTo(previous, 0, FADE_OUT_MS);
	const track = trackFor(next);
	if (next !== 'base' && track.el.paused) {
		try {
			track.el.currentTime = 0;
		} catch {
			/* not seekable yet — it has not played, so it is at the top anyway */
		}
	}
	rampTo(track, 1, FADE_IN_MS);
	resumeScene();
};

/**
 * Start fetching a scene's track ahead of `setMusicScene` — called as the wheel starts for a room,
 * so the room's 4 MB track has the spin and the reveal to arrive in. The tracks are streamed, never
 * part of the intro preload; without this the first visit to a room opened on a few seconds of
 * silence while its track downloaded.
 */
export const prepareMusicScene = (next: MusicScene): void => {
	if (!running || typeof Audio === 'undefined' || musicVolume() <= 0) return;
	const { el } = trackFor(next);
	if (el.networkState === HTMLMediaElement.NETWORK_EMPTY) el.load();
};

/** Follow the music slider: silence pauses the music, and turning it back up resumes the scene's track. */
export const syncMusicVolume = (): void => {
	// Read before the guard, so a caller tracking this (Game's effect) still subscribes to the
	// slider on a call that lands before any track exists.
	const volume = musicVolume();
	if (!running) return;
	for (const track of tracks.values()) {
		applyVolume(track);
		if (volume <= 0) track.el.pause();
	}
	resumeScene();
};

export const stopMusic = (): void => {
	cancelGestureWait?.();
	wireVisibility(false);
	running = false;
	for (const track of tracks.values()) {
		if (track.ramp) clearInterval(track.ramp);
		track.el.pause();
	}
	tracks.clear();
	scene = 'base';
};
