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
	// True while the game is in the background — home button, app switch, another tab. The two music
	// tracks are the game's only `<audio>` elements, and an `<audio>` element that is playing (or is
	// merely still holding a long source) is what makes Android/iOS put the game in the notification
	// shade as a media player, complete with Play/Pause transport controls. The game has no media to
	// transport, so the tracks are torn down entirely for as long as the player is away and rebuilt
	// when they come back — see `releaseTracks` / `rebuildTracks`.
	let pageHidden = $state(false);

	const NORMAL_VOLUME = 0.35;
	const BONUS_VOLUME = 0.35;
	// The normal loop keeps playing underneath the bonus loop, ducked so the two layer instead of
	// fighting each other. Raise towards NORMAL_VOLUME for a more present base track.
	const NORMAL_VOLUME_DURING_BONUS = 0.18;
	// Long enough to read as a smooth swap, short enough that bonus music is up as balls start.
	const CROSSFADE_MS = 900;

	type TrackKind = 'normal' | 'bonus';

	// How far into each track we were when the page was backgrounded. The Howls themselves do not
	// survive a hide, so the position has to be parked here and handed to the rebuilt track.
	const resumeSeek: Record<TrackKind, number> = { normal: 0, bonus: 0 };
	// Position to apply to a freshly built track the moment it next starts playing. Applied straight
	// after `play()` so it also works while the source is still loading: Howler queues both calls and
	// replays them in order once the track is ready.
	const pendingSeek = new Map<Howl, number>();

	function createTrack(kind: TrackKind): Howl {
		const howl =
			kind === 'normal'
				? new Howl({
						src: [staticUrl('sound/background_music.m4a')],
						loop: true,
						volume: NORMAL_VOLUME,
						// HTML5 streaming is better suited to a long music file than buffering it fully.
						// (The two loops are 5 and 11 minutes long — decoding them into Web Audio buffers
						// would cost hundreds of MB of PCM, so `<audio>` is the only workable path here.)
						html5: true,
						// ⚠️ Must not preload — see the note on `unlock()` below. Loading an `html5: true`
						// source before Howler's own first-gesture handler has run logs "HTML5 Audio pool
						// exhausted".
						preload: false,
						onloaderror: (_id, err) => {
							console.warn('[plinko] background music failed to load', err);
							armMusicRecoveryOnGesture();
						},
						onplayerror: () => armMusicRecoveryOnGesture(),
					})
				: new Howl({
						// The file carries a `.mpeg` extension but is MPEG layer III (MP3) audio — pin the
						// format so Howler picks the right codec instead of guessing from the unusual extension.
						src: [staticUrl('sound/background_music_bonus_mode.mpeg')],
						format: ['mp3'],
						loop: true,
						volume: BONUS_VOLUME,
						html5: true,
						preload: false,
						onloaderror: (_id, err) => {
							console.warn('[plinko] bonus background music failed to load', err);
							armMusicRecoveryOnGesture();
						},
						onplayerror: () => armMusicRecoveryOnGesture(),
					});
		silenceHowlerTeardownSrc(howl);
		trackedVolume.set(howl, kind === 'normal' ? NORMAL_VOLUME : BONUS_VOLUME);
		pendingSeek.set(howl, resumeSeek[kind]);
		return howl;
	}

	/**
	 * Stop Howler pointing a torn-down `<audio>` element at a base64 `data:` WAV.
	 *
	 * Howler ends a streaming download by assigning a scrap of silence as a `data:` URI (its
	 * `_clearSound`). The page Stake serves the game from sends `Content-Security-Policy:
	 * default-src 'self'` and never sets `media-src`, so that assignment is refused and the console
	 * takes a "Loading media from 'data:audio/wav;base64,…' violates … default-src 'self'" error for
	 * each track, every time the tracks are released — which is every backgrounding of the page, not
	 * just unmount.
	 *
	 * Dropping the attribute and re-running the resource selection algorithm aborts the same
	 * in-flight download with no URL for the policy to weigh, so the download still stops and the OS
	 * still drops the media session. Overridden per instance rather than on `Howl.prototype` so it
	 * reaches only these two tracks — Howler invokes it as `self._clearSound`, so an own property
	 * shadows the prototype for exactly this Howl.
	 *
	 * Safe because the only caller reached here is `unload()` (via `destroyTrack`), which hands the
	 * element straight back to Howler's pool and rebuilds its `src` from scratch when the pool next
	 * issues it. Howler's other call site clears a node mid-`stop()` when its duration is `Infinity`
	 * — an endless live stream, which neither of these finite files can be.
	 */
	function silenceHowlerTeardownSrc(howl: Howl) {
		(howl as unknown as { _clearSound: (node: HTMLAudioElement) => void })._clearSound = (
			node: HTMLAudioElement,
		) => {
			node.removeAttribute('src');
			// Removing the attribute alone does not abort a load in flight — only setting `src` does
			// that implicitly, so a source-less element has to be re-run by hand.
			node.load();
		};
	}

	/** Current playhead in seconds, or 0 if the track was never loaded (`seek()` returns the Howl). */
	function currentSeek(howl: Howl): number {
		const position = howl.seek();
		return typeof position === 'number' && Number.isFinite(position) ? position : 0;
	}

	function destroyTrack(howl: Howl) {
		const timer = fadeTimers.get(howl);
		if (timer) {
			clearInterval(timer);
			fadeTimers.delete(howl);
		}
		howl.stop();
		// `unload()` hands the underlying `<audio>` node back to Howler's pool with its source replaced
		// by a scrap of silence. That — not `pause()` — is what makes the OS drop the media session: a
		// merely paused element keeps its notification around so the player can resume it from outside
		// the game.
		howl.unload();
		trackedVolume.delete(howl);
		pendingSeek.delete(howl);
	}

	/** Tear both tracks down, remembering where they were. Safe to call when they are already gone. */
	function releaseTracks() {
		const normalHowl = music;
		const bonusHowl = bonusMusic;
		music = undefined;
		bonusMusic = undefined;
		if (normalHowl) {
			resumeSeek.normal = currentSeek(normalHowl);
			destroyTrack(normalHowl);
		}
		if (bonusHowl) {
			resumeSeek.bonus = currentSeek(bonusHowl);
			destroyTrack(bonusHowl);
		}
		clearMediaSession();
	}

	/** Build both tracks fresh. Loads immediately if the player has already unlocked audio — the
	 * gesture that did so was this session, so the html5 pool is long since filled. */
	function rebuildTracks() {
		if (music || bonusMusic) return;
		const normalHowl = createTrack('normal');
		const bonusHowl = createTrack('bonus');
		music = normalHowl;
		bonusMusic = bonusHowl;
		if (audioUnlocked) {
			normalHowl.load();
			bonusHowl.load();
		}
	}

	/**
	 * A track failed to load or start — most commonly on iOS after an app switch, where the rebuilt
	 * track's play() can be rejected (no fresh user activation) or its re-stream aborted. Nothing
	 * reactive re-runs `applyMusicState` after such an async failure, so without this the music
	 * stays silent for the rest of the session (QA: "BGM does not resume until a full refresh").
	 * Arm a one-shot retry on the next gesture: inside a tap the play() is always allowed.
	 */
	let musicRecoveryArmed = false;
	function armMusicRecoveryOnGesture() {
		if (musicRecoveryArmed || typeof document === 'undefined') return;
		musicRecoveryArmed = true;
		const opts = { capture: true, passive: true } as const;
		const retry = () => {
			for (const evt of recoveryEvents) document.removeEventListener(evt, retry, opts);
			musicRecoveryArmed = false;
			// A track whose stream was aborted mid-download sits `unloaded` and play() on it would
			// just queue forever — kick the load first, then re-drive playback to the wanted state.
			for (const howl of [music, bonusMusic]) {
				if (howl && howl.state() === 'unloaded') howl.load();
			}
			applyMusicState();
		};
		const recoveryEvents = ['touchend', 'click', 'keydown'] as const;
		for (const evt of recoveryEvents) document.addEventListener(evt, retry, opts);
	}

	/** Drop any media metadata/transport state the browser may still be holding for this page, so a
	 * stale "now playing" entry can't outlive the tracks we just unloaded. */
	function clearMediaSession() {
		const session = typeof navigator === 'undefined' ? undefined : navigator.mediaSession;
		if (!session) return;
		try {
			session.playbackState = 'none';
			session.metadata = null;
		} catch {
			/* older engines expose a read-only subset — nothing to clean up there anyway */
		}
	}

	onMount(() => {
		rebuildTracks();

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
			// mount.
			//
			// The bytes are usually already cached — but by `preloadPostRevealAssets()`, which starts at
			// reveal, NOT by the blocking splash pass: 12 MB of music on the critical path pushed the
			// splash past its timeout on slow links and got art revealed part-loaded (see AUDIO_PATHS).
			// So on a slow first run this may still be streaming when the gesture lands, which is
			// exactly what `html5: true` is for — it plays as it arrives instead of waiting.
			music?.load();
			bonusMusic?.load();
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

		// Leaving the game must leave nothing playing behind it. Gameplay itself deliberately carries on
		// while hidden (an Autobet run has to keep settling — see PlinkoBoard's hidden driver), but the
		// music does not: it is torn down on the way out and rebuilt on the way back, which is what keeps
		// the game out of the device's media notification / lock-screen controls.
		const setHidden = (hidden: boolean) => {
			if (hidden === pageHidden) return;
			pageHidden = hidden;
			if (hidden) {
				releaseTracks();
			} else {
				rebuildTracks();
				applyMusicState();
			}
		};
		const onVisibilityChange = () => setHidden(document.visibilityState === 'hidden');
		// `pagehide` covers the cases `visibilitychange` misses — notably iOS, where a swipe away or a
		// bfcache navigation can freeze the page without a visibility transition ever being delivered.
		const onPageHide = () => setHidden(true);
		const onPageShow = () => setHidden(document.visibilityState === 'hidden');

		document.addEventListener('visibilitychange', onVisibilityChange);
		window.addEventListener('pagehide', onPageHide);
		window.addEventListener('pageshow', onPageShow);

		return () => {
			for (const evt of gestureEvents) document.removeEventListener(evt, unlock, opts);
			document.removeEventListener('visibilitychange', onVisibilityChange);
			window.removeEventListener('pagehide', onPageHide);
			window.removeEventListener('pageshow', onPageShow);
			fadeTimers.forEach((timer) => clearInterval(timer));
			fadeTimers.clear();
			releaseTracks();
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

	/** Start a track, dropping it back at the position it held before the page was backgrounded. */
	function startPlayback(howl: Howl) {
		howl.play();
		const position = pendingSeek.get(howl);
		pendingSeek.delete(howl);
		// Straight after `play()` on purpose: on a track that is still loading both calls land on
		// Howler's queue and replay in that order, so the seek can never be overtaken by playback start.
		if (position) howl.seek(position);
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
				if (!howl.playing()) startPlayback(howl);
			} else {
				howl.pause();
			}
			return;
		}
		if (target > 0 && !howl.playing()) {
			setVolume(howl, 0);
			startPlayback(howl);
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
		const hidden = pageHidden;
		const normalHowl = music;
		const bonusHowl = bonusMusic;
		// Nothing to drive while the player is away: the tracks have been torn down deliberately, and
		// starting one here would put the game straight back into the device's media controls.
		if (hidden || !normalHowl || !bonusHowl) return;

		// Every bonus round must open on the first bar of the bonus track. `fadeTo` pauses a track when it
		// ramps to silence, and Howler resumes a paused sound from where it left off — so rewind on the
		// rising edge. `stop()` (not `seek(0)`) is the reliable reset for an `html5` source, and it leaves
		// the track not-playing so `fadeTo` starts it cleanly from zero volume.
		if (bonus !== bonusTrackArmed) {
			bonusTrackArmed = bonus;
			if (bonus) {
				bonusHowl.stop();
				// And drop any position parked for it by a background/foreground cycle — a bonus round that
				// ended while the player was away would otherwise hand its playhead to the NEXT one.
				pendingSeek.delete(bonusHowl);
			}
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
