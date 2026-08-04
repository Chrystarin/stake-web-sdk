<script lang="ts">
	import { onMount } from 'svelte';
	import { Howl } from 'howler';

	import { getContext } from '../game/context';
	import { stateGame } from '../game/stateGame.svelte';
	import { staticUrl } from '../lib/staticUrl';

	const context = getContext();

	// Looping background tracks. Kept separate from the one-shot sound effects in `sound.ts`
	// so they can be toggled (and their volume tuned) independently of the `Sound` toggle.
	// The normal loop plays continuously and never stops for the bonus; when a bonus round starts
	// (once its congratulations screen has slid away) the bonus loop fades in ON TOP of it, and
	// fades back out when the bonus ends.
	let music = $state<Howl | undefined>(undefined);
	let bonusMusic = $state<Howl | undefined>(undefined);
	// Browsers block audio playback until the user has interacted with the page. `musicEnabled`
	// defaults to true, so the very first play() on load would be blocked and never retried, leaving
	// the game silent until something else re-triggered playback. Gate all playback on this flag and
	// flip it on the first real user gesture (see the listeners in onMount).
	let audioUnlocked = $state(false);

	const NORMAL_VOLUME = 0.35;
	const BONUS_VOLUME = 0.35;
	// The normal loop keeps playing underneath the bonus loop, ducked so the two layer instead of
	// fighting each other. Raise towards NORMAL_VOLUME for a more present base track.
	const NORMAL_VOLUME_DURING_BONUS = 0.18;
	// Long enough to read as a smooth swap, short enough that bonus music is up as balls start.
	const CROSSFADE_MS = 900;

	onMount(() => {
		const normalHowl = new Howl({
			src: [staticUrl('sound/background_music.m4a')],
			loop: true,
			volume: NORMAL_VOLUME,
			// HTML5 streaming is better suited to a long music file than buffering it fully.
			html5: true,
			// ⚠️ Must not preload — see the note on `unlock()` below. Loading an `html5: true` source
			// before Howler's own first-gesture handler has run logs "HTML5 Audio pool exhausted".
			preload: false,
			onloaderror: (_id, err) => {
				console.warn('[plinko] background music failed to load', err);
			},
		});
		trackedVolume.set(normalHowl, NORMAL_VOLUME);
		music = normalHowl;

		const bonusHowl = new Howl({
			// The file carries a `.mpeg` extension but is MPEG layer III (MP3) audio — pin the format
			// so Howler picks the right codec instead of guessing from the unusual extension.
			src: [staticUrl('sound/background_music_bonus_mode.mpeg')],
			format: ['mp3'],
			loop: true,
			volume: BONUS_VOLUME,
			html5: true,
			preload: false,
			onloaderror: (_id, err) => {
				console.warn('[plinko] bonus background music failed to load', err);
			},
		});
		trackedVolume.set(bonusHowl, BONUS_VOLUME);
		bonusMusic = bonusHowl;

		// Unlock playback on the first user gesture. Re-apply the music state SYNCHRONOUSLY inside the
		// handler (not just via the reactive effect) so the first play() happens within the gesture's
		// call stack — some browsers (Safari) reject a play() that's deferred to a later microtask.
		const unlock = () => {
			if (audioUnlocked) return;
			audioUnlocked = true;
			// First load of both tracks. Deferred to here (rather than Howler's default preload) because
			// Howler fills its pool of unlocked `<audio>` nodes — `Howler._html5AudioPool` — from *inside*
			// its own first-gesture handler. An `html5: true` Howl that loads before that finds the pool
			// empty, and `_obtainHtml5Audio()`'s fallback probes a bare `new Audio().play()` which always
			// rejects (that element has no source), logging "HTML5 Audio pool exhausted, returning
			// potentially locked audio object" once per track on every page load. `Howler.html5PoolSize`
			// in sound.ts cannot prevent it: the size is only read when the pool is filled, long after
			// mount. The bytes are already in the HTTP cache from the loader's preload (AUDIO_PATHS in
			// preloadAssets.ts), so waiting for the gesture costs nothing.
			normalHowl.load();
			bonusHowl.load();
			applyMusicState();
		};
		// Howler registers ITS unlock listener on `document`, in the CAPTURE phase, for exactly these
		// four events — from inside the first `new Howl()` above. Matching the target, phase and event
		// list puts us immediately after it: same-target capture listeners fire in registration order,
		// so the pool is guaranteed to be full by the time `load()` runs.
		// ⚠️ Do not "modernise" this to `pointerdown`: that is a different, EARLIER event, so it would
		// fire before Howler's handler and re-open the exact bug this ordering exists to avoid.
		const gestureEvents = ['touchstart', 'touchend', 'click', 'keydown'] as const;
		const opts = { capture: true, passive: true } as const;
		for (const evt of gestureEvents) document.addEventListener(evt, unlock, opts);

		return () => {
			for (const evt of gestureEvents) document.removeEventListener(evt, unlock, opts);
			fadeTimers.forEach((timer) => clearInterval(timer));
			fadeTimers.clear();
			normalHowl.stop();
			normalHowl.unload();
			bonusHowl.stop();
			bonusHowl.unload();
			music = undefined;
			bonusMusic = undefined;
		};
	});

	// Manual per-track volume ramps. Howler's own `.fade()` is unreliable on `html5: true` sources
	// (the tween often fails to move the HTML5 audio element's volume, leaving the track "playing" but
	// silent), so we step `howl.volume()` ourselves — which HTML5 audio honours reliably.
	const fadeTimers = new Map<Howl, ReturnType<typeof setInterval>>();
	const FADE_STEP_MS = 50;

	const clampVol = (v: number) => Math.min(1, Math.max(0, v));

	// ⚠️ `howl.volume()` cannot be read back reliably. While an html5 source is still loading (or while
	// Howler's `_playLock` is up), `volume(v)` pushes onto the Howl's internal `_queue` instead of
	// applying, and the getter keeps returning the PREVIOUS value. Since `preload: false` guarantees the
	// tracks are unloaded on the first ramp, a read-back start value would equal the target, `fadeTo`
	// would early-return without ever creating a ramp, and the queued `volume(0)` would then replay on
	// load — leaving the track playing at volume 0 for the whole session. So mirror every volume we set
	// and ramp from that. (Queued steps replay in order once loaded, so the ramp still lands on target.)
	const trackedVolume = new Map<Howl, number>();

	function setVolume(howl: Howl, v: number) {
		const vol = clampVol(v);
		trackedVolume.set(howl, vol);
		howl.volume(vol);
	}

	/** Ramp a track towards `target`, starting playback first if it needs to be audible. When ramping
	 * down to silence, pause once it reaches 0 so the paused loop stops consuming a stream. */
	function fadeTo(howl: Howl, target: number, ms: number) {
		const existing = fadeTimers.get(howl);
		if (existing) {
			clearInterval(existing);
			fadeTimers.delete(howl);
		}
		// Nothing to do if it's already stopped and we're heading to silence.
		if (target <= 0 && !howl.playing()) return;
		// Backgrounded tabs throttle/freeze `setInterval`, which would strand the volume mid-ramp (silent).
		// The user isn't watching a hidden tab, so skip the animation and set the target outright — this
		// keeps the track correct (never stuck silent) regardless of timer throttling. Set the volume
		// BEFORE play(): Howler re-applies the Howl's stored volume when an html5 source starts, so a
		// volume set after play() gets clobbered.
		if (typeof document !== 'undefined' && document.hidden) {
			setVolume(howl, target);
			if (target > 0) {
				if (!howl.playing()) howl.play();
			} else {
				howl.pause();
			}
			return;
		}
		if (target > 0 && !howl.playing()) {
			setVolume(howl, 0);
			howl.play();
		}
		const start = trackedVolume.get(howl) ?? 0;
		if (start === target) {
			if (target <= 0) howl.pause();
			return;
		}
		const steps = Math.max(1, Math.round(ms / FADE_STEP_MS));
		let i = 0;
		const timer = setInterval(() => {
			i += 1;
			setVolume(howl, start + (target - start) * (i / steps));
			if (i >= steps) {
				clearInterval(timer);
				fadeTimers.delete(howl);
				setVolume(howl, target);
				if (target <= 0) howl.pause();
			}
		}, FADE_STEP_MS);
		fadeTimers.set(howl, timer);
	}

	// Bonus music layers in the moment the congratulations screen's closing-door SFX plays, and fades
	// back out when the bonus round ends. Driven by the door-close cue (below) rather than a state
	// derive so the swap is synced exactly to that slam, not to the screen's later dismissal.
	let bonusMusicOn = $state(false);
	// Mirrors `bonusMusicOn` as `applyMusicState` last saw it, so it can spot the moment a bonus round
	// starts and rewind the bonus track. Deliberately NOT `$state`: it's written from inside the effect.
	let bonusTrackArmed = false;

	// The `doorClose` cue fires for three slides: the bonus wheel's backdrop drop, the entry
	// congratulations screen, and the bonus-END treasure screen. `bonusEntryCongratsActive` is true only
	// while that ENTRY screen is on screen, so gating on it uniquely picks out the "you won the bonus"
	// door-close — exactly when to swap to bonus music.
	// ⚠️ This can gate on NEITHER side of `bonusRoundActive` any more: bonus mode is switched ON one beat
	// AFTER this slam (when the entry screen fully covers the view) and OFF one beat after the END
	// screen's own slam — so that flag now reads `false` on the slide we want and `true` on one we don't.
	context.eventEmitter.subscribeOnMount({
		soundOnce: ({ name }) => {
			if (name === 'doorClose' && stateGame.bonusEntryCongratsActive) bonusMusicOn = true;
		},
	});

	// Bonus over → back to the normal loop. Clearing on `!bonusRoundActive` also covers the case where
	// the bonus ends before any door-close ever set the flag (e.g. a mid-bonus reload/resume).
	$effect(() => {
		if (!stateGame.bonusRoundActive) bonusMusicOn = false;
	});

	/** Bring the two tracks to the volumes the current state calls for: the normal loop always runs
	 * (ducked while a bonus round is up, where the bonus loop plays alongside it), and both go silent
	 * when music is off or audio isn't unlocked yet.
	 * Reading the reactive state here means the `$effect` below re-runs this whenever it changes;
	 * the gesture handler calls it directly to start playback within the user's first interaction. */
	function applyMusicState() {
		const enabled = stateGame.musicEnabled;
		const unlocked = audioUnlocked;
		const bonus = bonusMusicOn;
		const normalHowl = music;
		const bonusHowl = bonusMusic;
		if (!normalHowl || !bonusHowl) return;

		// Every bonus round must open on the first bar of the bonus track. `fadeTo` pauses a track when it
		// ramps to silence, and Howler resumes a paused sound from where it left off — so rewind on the
		// rising edge. `stop()` (not `seek(0)`) is the reliable reset for an `html5` source, and it leaves
		// the track not-playing so `fadeTo` starts it cleanly from zero volume.
		if (bonus !== bonusTrackArmed) {
			bonusTrackArmed = bonus;
			if (bonus) bonusHowl.stop();
		}

		if (!enabled || !unlocked) {
			fadeTo(normalHowl, 0, CROSSFADE_MS);
			fadeTo(bonusHowl, 0, CROSSFADE_MS);
			return;
		}

		// The normal loop never stops — it just ducks under the bonus loop and comes back up after.
		fadeTo(normalHowl, bonus ? NORMAL_VOLUME_DURING_BONUS : NORMAL_VOLUME, CROSSFADE_MS);
		fadeTo(bonusHowl, bonus ? BONUS_VOLUME : 0, CROSSFADE_MS);
	}

	// Re-apply whenever the Music toggle, the bonus phase, the audio-unlock, or the loaded tracks change.
	$effect(() => {
		applyMusicState();
	});
</script>
