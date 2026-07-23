<script lang="ts">
	import { onMount } from 'svelte';
	import { Howl } from 'howler';

	import { getContext } from '../game/context';
	import { stateGame } from '../game/stateGame.svelte';
	import { staticUrl } from '../lib/staticUrl';

	const context = getContext();

	// Looping background tracks. Kept separate from the one-shot sound effects in `sound.ts`
	// so they can be toggled (and their volume tuned) independently of the `Sound` toggle.
	// Two tracks crossfade: the normal loop plays during regular play; a bonus loop takes over
	// while a bonus round is active (once its congratulations screen has slid away), then the
	// normal loop returns when the bonus ends.
	let music = $state<Howl | undefined>(undefined);
	let bonusMusic = $state<Howl | undefined>(undefined);
	// Browsers block audio playback until the user has interacted with the page. `musicEnabled`
	// defaults to true, so the very first play() on load would be blocked and never retried, leaving
	// the game silent until something else re-triggered playback. Gate all playback on this flag and
	// flip it on the first real user gesture (see the listeners in onMount).
	let audioUnlocked = $state(false);

	const NORMAL_VOLUME = 0.35;
	const BONUS_VOLUME = 0.35;
	// Long enough to read as a smooth swap, short enough that bonus music is up as balls start.
	const CROSSFADE_MS = 900;

	onMount(() => {
		const normalHowl = new Howl({
			src: [staticUrl('sound/background_music.m4a')],
			loop: true,
			volume: NORMAL_VOLUME,
			// HTML5 streaming is better suited to a long music file than buffering it fully.
			html5: true,
			onloaderror: (_id, err) => {
				console.warn('[plinko] background music failed to load', err);
			},
		});
		music = normalHowl;

		const bonusHowl = new Howl({
			// The file carries a `.mpeg` extension but is MPEG layer III (MP3) audio — pin the format
			// so Howler picks the right codec instead of guessing from the unusual extension.
			src: [staticUrl('sound/background_music_bonus_mode.mpeg')],
			format: ['mp3'],
			loop: true,
			volume: BONUS_VOLUME,
			html5: true,
			onloaderror: (_id, err) => {
				console.warn('[plinko] bonus background music failed to load', err);
			},
		});
		bonusMusic = bonusHowl;

		// Unlock playback on the first user gesture. Re-apply the music state SYNCHRONOUSLY inside the
		// handler (not just via the reactive effect) so the first play() happens within the gesture's
		// call stack — some browsers (Safari) reject a play() that's deferred to a later microtask.
		const unlock = () => {
			if (audioUnlocked) return;
			audioUnlocked = true;
			applyMusicState();
		};
		const gestureEvents = ['pointerdown', 'touchend', 'keydown'] as const;
		const opts = { once: true, passive: true } as const;
		for (const evt of gestureEvents) window.addEventListener(evt, unlock, opts);

		return () => {
			for (const evt of gestureEvents) window.removeEventListener(evt, unlock);
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
			howl.volume(clampVol(target));
			if (target > 0) {
				if (!howl.playing()) howl.play();
			} else {
				howl.pause();
			}
			return;
		}
		if (target > 0 && !howl.playing()) {
			howl.volume(0);
			howl.play();
		}
		const start = howl.volume();
		if (start === target) {
			if (target <= 0) howl.pause();
			return;
		}
		const steps = Math.max(1, Math.round(ms / FADE_STEP_MS));
		let i = 0;
		const timer = setInterval(() => {
			i += 1;
			howl.volume(clampVol(start + (target - start) * (i / steps)));
			if (i >= steps) {
				clearInterval(timer);
				fadeTimers.delete(howl);
				howl.volume(clampVol(target));
				if (target <= 0) howl.pause();
			}
		}, FADE_STEP_MS);
		fadeTimers.set(howl, timer);
	}

	// Bonus music takes over the moment the congratulations screen's closing-door SFX plays, and hands
	// back to the normal loop when the bonus round ends. Driven by the door-close cue (below) rather than
	// a state derive so the swap is synced exactly to that slam, not to the screen's later dismissal.
	let bonusMusicOn = $state(false);

	// The `doorClose` cue fires for three slides: the bonus wheel's backdrop drop, the entry
	// congratulations screen, and the bonus-END treasure screen. `bonusRoundActive` is only true for the
	// ENTRY congratulations one (it's set as that screen appears, and cleared before the end screen), so
	// gating on it uniquely picks out the "you won the bonus" door-close — exactly when to swap to bonus
	// music.
	context.eventEmitter.subscribeOnMount({
		soundOnce: ({ name }) => {
			if (name === 'doorClose' && stateGame.bonusRoundActive) bonusMusicOn = true;
		},
	});

	// Bonus over → back to the normal loop. Clearing on `!bonusRoundActive` also covers the case where
	// the bonus ends before any door-close ever set the flag (e.g. a mid-bonus reload/resume).
	$effect(() => {
		if (!stateGame.bonusRoundActive) bonusMusicOn = false;
	});

	/** Bring the two tracks to the volumes the current state calls for: the normal loop during regular
	 * play, the bonus loop during a bonus round, and silence when music is off or audio isn't unlocked
	 * yet. Reading the reactive state here means the `$effect` below re-runs this whenever it changes;
	 * the gesture handler calls it directly to start playback within the user's first interaction. */
	function applyMusicState() {
		const enabled = stateGame.musicEnabled;
		const unlocked = audioUnlocked;
		const bonus = bonusMusicOn;
		const normalHowl = music;
		const bonusHowl = bonusMusic;
		if (!normalHowl || !bonusHowl) return;

		if (!enabled || !unlocked) {
			fadeTo(normalHowl, 0, CROSSFADE_MS);
			fadeTo(bonusHowl, 0, CROSSFADE_MS);
			return;
		}

		if (bonus) {
			fadeTo(normalHowl, 0, CROSSFADE_MS);
			fadeTo(bonusHowl, BONUS_VOLUME, CROSSFADE_MS);
		} else {
			fadeTo(bonusHowl, 0, CROSSFADE_MS);
			fadeTo(normalHowl, NORMAL_VOLUME, CROSSFADE_MS);
		}
	}

	// Re-apply whenever the Music toggle, the bonus phase, the audio-unlock, or the loaded tracks change.
	$effect(() => {
		applyMusicState();
	});
</script>
