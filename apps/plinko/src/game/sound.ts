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
	| 'peg'
	| 'rouletteTick'
	| 'placeChip'
	| 'clickingFail'
	| 'startAutoPlay'
	| 'openPopup'
	| 'clickUIButton'
	// Fired once per coin as it merges into the balance coin. See CoinFountain.
	| 'coinFlip'
	// Coin (featured) peg hit. See PlinkoBoard.
	| 'coinPeg'
	// A coin-shuffle bed played once when a win's coins start spawning. Two windows of the SAME file:
	// a short 0–1.5s slice for 1-ball rapid wins, a longer 2–4s slice for 10/20/50-ball drops.
	| 'coinShuffleSingle'
	| 'coinShuffleMulti'
	// Bonus congratulations screen: a closing-door thud as the screen slides down and an
	// opening-door creak as it slides back up. Both are sprite windows of their source clip
	// (see EnableSound). See BonusRoulette.
	| 'doorClose'
	| 'doorOpen'
	// Bonus level-up overlay: a chime played the instant the LEVEL x / +free-balls card pops. Played
	// whole — the clip opens on the chime (71ms in). It used to carry ~3.17s of leading silence and a
	// sprite window to skip it; the re-delivered file does not, and the window went with it.
	| 'bonusLevelUp'
	// Post-bonus (treasure) congratulations screen: a coin-clink bed held on LOOP from the moment the
	// message finishes popping in until the screen slides away. Started/stopped by
	// `startPlinkoSoundLoop` / `stopPlinkoSoundLoop`, never by `playPlinkoSound`. See BonusRoulette.
	| 'postBonusCoins';

/** A [startMs, durationMs] slice of the source file to play instead of the whole thing. */
export type SoundSprite = [startMs: number, durationMs: number];

export type LoadSoundOptions = {
	volume?: number;
	sprite?: SoundSprite;
	/**
	 * Hold this sound on repeat once started. Loops are driven by `startPlinkoSoundLoop` /
	 * `stopPlinkoSoundLoop` rather than `playPlinkoSound`, so the caller owns exactly how long they run.
	 */
	loop?: boolean;
	/**
	 * Codec hint for a file whose extension does not name its format — `post_bonus_clinking_coins.mpeg`
	 * is MP3 data. Without it Howler guesses from the extension and can decide it cannot play the file.
	 */
	format?: string[];
	/**
	 * Number of INDEPENDENT Howl instances to build for this sound (default 1).
	 *
	 * One Howl can hold several playing voices, but they share per-Howl state — most importantly
	 * `_playLock`, which Howler raises while any one voice is starting. Every deferrable call made
	 * during that window (`rate`, `stop`, …) is pushed onto a single per-Howl queue and applied
	 * later, out of order, against whichever voice is playing then: overlapping hits end up
	 * retuning and ending each other, which is heard as a sound being clipped off part-way.
	 *
	 * Giving a sound several Howls hands each simultaneous hit its own instance with its own lock
	 * and queue, so concurrent plays cannot interfere. Cheap: Howler caches the decoded buffer per
	 * URL, so extra instances of one file share the single decode.
	 */
	voices?: number;
};

// One entry per sound, holding that sound's voices (a single Howl unless `voices` asked for more).
const howls = new Map<SoundEffectName, Howl[]>();
// Round-robin cursor per sound, so repeat hits spread across the voices instead of stacking on one.
const voiceCursors = new Map<SoundEffectName, number>();
// Names whose Howl was built with a sprite window — those must be played by sprite id, not bare.
const SPRITE_ID = 'seg';
const spriteSounds = new Set<SoundEffectName>();

export function loadPlinkoSound(
	name: SoundEffectName,
	url: string,
	options: LoadSoundOptions = {},
): void {
	if (howls.has(name)) return;
	const { volume = 1, sprite, voices = 1, loop = false, format } = options;
	try {
		const instances = Array.from(
			{ length: Math.max(1, voices) },
			() =>
				new Howl({
					src: [url],
					volume,
					loop,
					...(format ? { format } : {}),
					// Play only a slice of the file when a sprite window is given (e.g. seconds 0–1.5 vs 2–4
					// of the same coin-shuffle sample). Howler indexes sprites in milliseconds.
					...(sprite ? { sprite: { [SPRITE_ID]: sprite } } : {}),
					onloaderror: (_id, err) => {
						console.warn(`[plinko] sound "${name}" failed to load (${url})`, err);
					},
				}),
		);
		howls.set(name, instances);
		if (sprite) spriteSounds.add(name);
	} catch (err) {
		console.warn(`[plinko] sound "${name}" could not be created`, err);
	}
}

/**
 * The instance the next play of this sound should use: the first idle voice from the round-robin
 * cursor onwards, so a hit that lands while earlier ones are still ringing gets a fresh instance
 * rather than piling onto a busy one. Falls back to the cursor's voice when every one is busy —
 * that is still a separate Howler voice, just sharing an instance with a sound already playing.
 */
function takeVoice(name: SoundEffectName, instances: Howl[]): Howl {
	const start = voiceCursors.get(name) ?? 0;
	let picked = start;
	for (let i = 0; i < instances.length; i++) {
		const index = (start + i) % instances.length;
		if (!instances[index].playing()) {
			picked = index;
			break;
		}
	}
	voiceCursors.set(name, (picked + 1) % instances.length);
	return instances[picked];
}

/**
 * Pitch this instance BEFORE it is played, by setting the group rate every voice Howler allocates
 * copies as it starts. Howler's public `rate(rate, id)` can only run after `play()` has handed back
 * an id, and by then it may be blocked by the `_playLock` of a sibling hit that is still starting —
 * in which case it is queued and lands on the wrong sound later, resetting that sound's end timer
 * and cutting it off. Setting the rate up front is applied by both the Web Audio and HTML5 paths as
 * the voice starts, and never touches a voice already playing (each keeps its own copy).
 */
function setVoiceRate(howl: Howl, rate: number): void {
	// `_rate` is a Howler internal — real and stable, simply absent from @types.
	(howl as unknown as { _rate: number })._rate = rate;
}

/**
 * Bring Howler's Web Audio context back to `running` if anything has suspended it.
 *
 * Howler only ever resumes the context from inside `play()`, and only when IT was the one that
 * suspended it (its 30s idle auto-suspend) or when iOS reports the context as `interrupted`. A
 * context the BROWSER suspended leaves `Howler.state` reading `running`, so nothing in the library
 * touches it: every later `play()` is swallowed into a stalled graph and the game runs silent with no
 * error. That is the state the page lands in after the autoplay policy blocks the freshly created
 * context (a reload), after the tab is backgrounded, and after an orientation change on iOS.
 *
 * Nothing here can start audio without a user gesture — that is the browser's rule — but it does mean
 * the FIRST interaction of any kind brings the sound back, instead of the game staying mute for the
 * rest of the session.
 */
export function resumePlinkoAudio(): void {
	// `state` and `_autoResume` are Howler internals — real, stable, and simply absent from @types.
	const howler = Howler as unknown as {
		ctx?: AudioContext;
		state?: string;
		_autoResume?: () => void;
	};
	const ctx = howler.ctx;
	if (!ctx || typeof ctx.resume !== 'function') return;
	// Already live — do nothing at all. This is the common case (these listeners fire on every tap and
	// every resize frame of a rotation), so it has to stay free.
	if (ctx.state === 'running') return;
	// Let Howler resume it first where it can: that path also clears its own suspend bookkeeping and
	// emits `resume` to every Howl, which a bare `ctx.resume()` would leave inconsistent.
	try {
		howler._autoResume?.();
	} catch {
		// Never let audio housekeeping break a UI event handler.
	}
	void ctx
		.resume()
		.then(() => {
			howler.state = 'running';
		})
		.catch(() => {
			// Still gesture-locked — the next interaction will try again.
		});
}

/**
 * Keep the audio context alive for the life of the page: resume it on any user interaction, and
 * whenever the page comes back into view or is re-laid-out (an orientation change fires both
 * `orientationchange` and a `resize`, and on iOS it can leave the context interrupted).
 *
 * Deliberately NOT a one-shot. Howler removes its own unlock listeners the moment audio first
 * unlocks, so a context suspended LATER — rotate the device, switch apps, come back — was never
 * recovered by anything. These listeners stay for the whole session so every later interruption is
 * picked up by the next tap.
 *
 * Returns a teardown for the caller's `onMount`.
 */
export function installPlinkoAudioResume(): () => void {
	if (typeof document === 'undefined' || typeof window === 'undefined') return () => {};
	const onVisible = () => {
		if (!document.hidden) resumePlinkoAudio();
	};
	// `pointerdown` deliberately included alongside Howler's own four: a touch that is consumed by a
	// canvas/preventDefault handler may never become a `click` or `touchend`.
	const gestureEvents = ['pointerdown', 'touchstart', 'touchend', 'click', 'keydown'] as const;
	const gestureOpts = { capture: true, passive: true } as const;
	for (const evt of gestureEvents) document.addEventListener(evt, resumePlinkoAudio, gestureOpts);
	document.addEventListener('visibilitychange', onVisible);
	window.addEventListener('pageshow', resumePlinkoAudio);
	window.addEventListener('orientationchange', resumePlinkoAudio);
	window.addEventListener('resize', resumePlinkoAudio, { passive: true });
	return () => {
		for (const evt of gestureEvents) {
			document.removeEventListener(evt, resumePlinkoAudio, gestureOpts);
		}
		document.removeEventListener('visibilitychange', onVisible);
		window.removeEventListener('pageshow', resumePlinkoAudio);
		window.removeEventListener('orientationchange', resumePlinkoAudio);
		window.removeEventListener('resize', resumePlinkoAudio);
	};
}

export function playPlinkoSound(name: SoundEffectName, rate = 1): void {
	// Nothing may be heard while the player is away from the game. Gameplay deliberately keeps running
	// when the page is hidden so an Autobet run settles (see PlinkoBoard's hidden driver), and without
	// this gate the pegs and pockets of those rounds fire at a player who is on their home screen.
	// A gate here rather than `Howler.mute()`: Howler pools its `<audio>` nodes and never resets a
	// node's `muted` flag when it hands one out again, so a global mute can outlive the mute itself.
	if (typeof document !== 'undefined' && document.hidden) return;
	const instances = howls.get(name);
	if (!instances?.length) return;
	const howl = takeVoice(name, instances);
	// Per-instance rate so overlapping plays (a 50-ball drop) each keep their own pitch. Rate
	// doubles = one octave up. Set before play — see setVoiceRate for why it cannot follow it.
	setVoiceRate(howl, rate);
	// A sprite sound must be triggered by its window id so only that slice plays.
	if (spriteSounds.has(name)) howl.play(SPRITE_ID);
	else howl.play();
}

// ─── Held loops ────────────────────────────────────────────────────────────────────────────────
// A loop is a sound that runs for as long as something is on screen rather than for the length of its
// clip (currently just the post-bonus treasure screen's coin bed). It always uses the sound's FIRST
// voice, so start/stop is unambiguous — there is no round-robin cursor to lose track of.

/** Sounds a caller is currently holding on loop. Kept so the page-hidden gate below can find them. */
const heldLoops = new Set<SoundEffectName>();

function playLoopVoice(name: SoundEffectName): void {
	const howl = howls.get(name)?.[0];
	// Re-entrant by design: `playing()` keeps a resume (or a repeat `start` call) from stacking a second
	// voice on top of the one already running, which would double the level and phase against itself.
	if (!howl || howl.playing()) return;
	setVoiceRate(howl, 1);
	if (spriteSounds.has(name)) howl.play(SPRITE_ID);
	else howl.play();
}

/**
 * Silence held loops while the player is away and bring them back when they return — the same rule
 * `playPlinkoSound` applies to one-shots, which a loop would otherwise sail straight past (it is
 * started once and then runs on its own for as long as its screen is up). Installed on the first loop
 * ever started and left in place: the handler costs nothing while nothing is held.
 */
let loopVisibilityGateInstalled = false;
function installLoopVisibilityGate(): void {
	if (loopVisibilityGateInstalled || typeof document === 'undefined') return;
	loopVisibilityGateInstalled = true;
	document.addEventListener('visibilitychange', () => {
		for (const name of heldLoops) {
			if (document.hidden) howls.get(name)?.[0]?.stop();
			else playLoopVoice(name);
		}
	});
}

/**
 * Start holding `name` on loop. Idempotent — calling it again while the loop is already up is a no-op,
 * so it is safe to drive from an effect. The sound must have been loaded with `loop: true`.
 */
export function startPlinkoSoundLoop(name: SoundEffectName): void {
	if (!howls.get(name)?.length) return;
	installLoopVisibilityGate();
	heldLoops.add(name);
	// Nothing may be heard while the player is away — the gate above starts it when they come back.
	if (typeof document !== 'undefined' && document.hidden) return;
	playLoopVoice(name);
}

/** Release a loop held by `startPlinkoSoundLoop`. Safe to call when nothing is playing. */
export function stopPlinkoSoundLoop(name: SoundEffectName): void {
	heldLoops.delete(name);
	howls.get(name)?.[0]?.stop();
}

/**
 * Map a landed pocket multiplier to a playback rate so the 'pocket' sound is higher-pitched on
 * bigger payouts. Logarithmic because board multipliers span a huge, low-clustered range
 * (0×–100×, up to ~600× in buy modes) — a linear map would leave every low pocket sounding
 * identical. Clamped to Howler's safe rate window. mult 0 → ~0.85 (low), 5 → ~1.26,
 * 100 → ~1.9, and it keeps climbing gently past the top board value.
 */
export function pocketPitchForMultiplier(multiplier: number): number {
	const rate = 0.85 + 0.2275 * Math.log(1 + Math.max(0, multiplier));
	return Math.min(2.4, Math.max(0.5, rate));
}
