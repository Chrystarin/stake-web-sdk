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
	// Bonus level-up overlay: a chime played the instant the LEVEL x / +free-balls card pops. The
	// source file has ~3.17s of leading silence, so it's loaded as a sprite window that starts at the
	// onset (see EnableSound) — the sound fires immediately with no dead air.
	| 'bonusLevelUp';

/** A [startMs, durationMs] slice of the source file to play instead of the whole thing. */
export type SoundSprite = [startMs: number, durationMs: number];

export type LoadSoundOptions = { volume?: number; sprite?: SoundSprite };

const howls = new Map<SoundEffectName, Howl>();
// Names whose Howl was built with a sprite window — those must be played by sprite id, not bare.
const SPRITE_ID = 'seg';
const spriteSounds = new Set<SoundEffectName>();

export function loadPlinkoSound(
	name: SoundEffectName,
	url: string,
	options: LoadSoundOptions = {},
): void {
	if (howls.has(name)) return;
	const { volume = 1, sprite } = options;
	try {
		howls.set(
			name,
			new Howl({
				src: [url],
				volume,
				// Play only a slice of the file when a sprite window is given (e.g. seconds 0–1.5 vs 2–4
				// of the same coin-shuffle sample). Howler indexes sprites in milliseconds.
				...(sprite ? { sprite: { [SPRITE_ID]: sprite } } : {}),
				onloaderror: (_id, err) => {
					console.warn(`[plinko] sound "${name}" failed to load (${url})`, err);
				},
			}),
		);
		if (sprite) spriteSounds.add(name);
	} catch (err) {
		console.warn(`[plinko] sound "${name}" could not be created`, err);
	}
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
	const howl = howls.get(name);
	if (!howl) return;
	// A sprite sound must be triggered by its window id so only that slice plays.
	const id = spriteSounds.has(name) ? howl.play(SPRITE_ID) : howl.play();
	// Per-instance rate so overlapping plays (a 50-ball drop) each keep their own pitch. Rate
	// doubles = one octave up; leave the default untouched so a plain play() is unchanged.
	if (id != null && rate !== 1) {
		howl.rate(rate, id);
	}
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
