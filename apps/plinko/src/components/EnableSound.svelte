<script lang="ts">
	import { onMount } from 'svelte';

	import { getContext } from '../game/context';
	import { stateGame } from '../game/stateGame.svelte';
	import { staticUrl } from '../lib/staticUrl';
	import {
		installPlinkoAudioResume,
		loadPlinkoSound,
		playPlinkoSound,
		startPlinkoSoundLoop,
		stopPlinkoSoundLoop,
		type LoadSoundOptions,
		type SoundEffectName,
	} from '../game/sound';

	const context = getContext();

	// Every clip is MP3, on purpose. It is the one codec both of Howler's paths play on every iOS,
	// Android and desktop browser: Web Audio `decodeAudioData` for these one-shots and `<audio>`
	// streaming for the music. OGG/Vorbis and Opus never decode on an iPhone/iPad, and a file whose
	// extension does not name its codec (the MP3s that used to ship as `.mpeg`) is served under a
	// `video/*` MIME type that iOS `<audio>` may refuse outright. A clip re-delivered in any other
	// format goes through `scripts/transcode-audio.mjs` first.
	const soundMap: Record<SoundEffectName, string> = {
		bet: staticUrl('sound/bet.mp3'),
		win: staticUrl('sound/win.mp3'),
		pocket: staticUrl('sound/pocket.mp3'),
		peg: staticUrl('sound/peg.mp3'),
		rouletteTick: staticUrl('sound/roulette_tick.mp3'),
		placeChip: staticUrl('sound/placeChip.mp3'),
		clickingFail: staticUrl('sound/clickingFail.mp3'),
		startAutoPlay: staticUrl('sound/startAutoPlay.mp3'),
		openPopup: staticUrl('sound/openPopup.mp3'),
		clickUIButton: staticUrl('sound/clickUIButton.mp3'),
		coinFlip: staticUrl('sound/coin_flip.mp3'),
		coinPeg: staticUrl('sound/coin_peg.mp3'),
		// Both shuffle variants are the SAME file, played as different time windows (see sprite below).
		coinShuffleSingle: staticUrl('sound/coin_shuffle.mp3'),
		coinShuffleMulti: staticUrl('sound/coin_shuffle.mp3'),
		// Bonus congratulations screen slide SFX (see sprite windows below). MP3 rather than the
		// originally delivered OGG: iOS Safari has no Vorbis decoder, so the .ogg versions simply
		// never loaded on any iPhone/iPad and both doors were silent there.
		doorClose: staticUrl('sound/door_close.mp3'),
		doorOpen: staticUrl('sound/door_open.mp3'),
		// Bonus level-up chime (leading silence trimmed via sprite below).
		bonusLevelUp: staticUrl('sound/bonus_level_up.mp3'),
		// Post-bonus treasure screen coin bed — held on loop, see the `loop` option below.
		postBonusCoins: staticUrl('sound/post_bonus_clinking_coins.mp3'),
		// Congratulations-screen fanfare, both screens (leading silence trimmed via sprite below).
		bonusCongratulations: staticUrl('sound/bonus_congratulations.mp3'),
	};

	// Per-sound load options (default: full file at volume 1). The coin-shuffle bed is sliced into two
	// windows of the one sample. The clip has ~0.56s of leading silence before the first shuffle
	// (measured via Web Audio), so the 1-ball window starts AT that onset (540ms) and runs ~1.1s to the
	// end of the first shuffle — no dead air, it plays on the sound immediately. The busier 10/20/50-ball
	// drops use the longer second shuffle at 2–4s (which starts cleanly).
	// The door SFX cut out the early ticking/rattle and start on the loud slam (waveform-measured
	// onsets: door_close ~2.80s, door_open ~3.22s). Windows begin a hair before onset so the attack
	// isn't clipped, and BOTH keep their full trailing wash so it isn't chopped off: door_close decays
	// out to ~5.0s (window 2.79→5.05s), door_open to ~4.06s (window 3.20→4.10s).
	const soundOptions: Partial<Record<SoundEffectName, LoadSoundOptions>> = {
		// Peg hit fires on nearly every bounce; mixed at half volume so a busy board isn't harsh.
		// It is also the most crowded sound on the board — every ball thunks once per row, so a 50-ball
		// drop has many landing inside the 130ms the sample takes to ring out. The widest bank of
		// instances so those overlap cleanly instead of sharing one Howl's state (see `voices`).
		peg: { volume: 0.5, voices: 16 },
		// Several balls can reach the three coin pegs within the same frame, and a coin chime is long
		// enough that the next hits land while it is still ringing. Its own bank of instances so those
		// simultaneous hits never share Howler state and clip each other short. Eight covers the widest
		// drop (50 balls funnelling through three coins) with room to spare.
		coinPeg: { voices: 8 },
		coinShuffleSingle: { sprite: [540, 1100] },
		coinShuffleMulti: { sprite: [2000, 2000] },
		doorClose: { sprite: [2790, 2260] },
		doorOpen: { sprite: [3200, 900] },
		// NO sprite, deliberately: this clip used to open with ~3.17s of silence and was played through
		// a [3150, 3200] window to skip it. The re-delivered file has that silence cut — the chime now
		// starts 71ms in — so the window would have skipped the chime and played its tail instead
		// (measured over the old window: peak 0.06 against 0.90 for the chime itself, i.e. inaudible).
		// It plays whole. Re-measure the onset if it is ever re-delivered again.
		// Held on loop under the post-bonus treasure screen (started by `soundLoopStart`, below). Mixed
		// under the music it plays over: it is a texture behind the message, not a cue.
		postBonusCoins: { loop: true, volume: 0.55 },
		// Fired the instant the message starts popping in, so it has to open ON the sound — the file
		// carries 270ms of silence first (envelope-measured: nothing above 2% of peak until then), which
		// would have landed the fanfare a fifth of a second behind the type. The window opens 20ms early
		// so the attack isn't clipped, and runs to 5.0s to keep the whole tail: the last audible frame is
		// at ~4.87s and the file ends at 5.38s. Re-measure the onset if the clip is ever re-delivered.
		// Mixed down a little — it plays over the music, and on the bonus-end screen over the coin bed
		// too, and at full level it swamped both.
		bonusCongratulations: { sprite: [250, 4750], volume: 0.8 },
	};

	onMount(() => {
		for (const [name, url] of Object.entries(soundMap)) {
			loadPlinkoSound(name as SoundEffectName, url, soundOptions[name as SoundEffectName]);
		}
		// TEMP: on-screen audio state overlay for debugging on devices without DevTools (BrowserStack).
		if (import.meta.env.DEV && new URLSearchParams(location.search).has('audioDebug')) {
			void import('../lib/devAudioDebug').then(({ installAudioDebugOverlay }) =>
				installAudioDebugOverlay(),
			);
		}
		// Keep the Web Audio context running for the whole session — the autoplay policy blocks it on a
		// fresh load, and the browser suspends it again on backgrounding / orientation change, which
		// Howler's own one-shot unlock never recovers from. See installPlinkoAudioResume.
		return installPlinkoAudioResume();
	});

	/** The sound currently being held on loop by a screen, if any. See EmitterEventSoundLoop. */
	let heldLoop = $state<SoundEffectName | undefined>(undefined);

	context.eventEmitter.subscribeOnMount({
		soundOnce: ({ name, rate }) => {
			if (!stateGame.soundEnabled) return;
			playPlinkoSound(name as SoundEffectName, rate ?? 1);
		},
		soundLoopStart: ({ name }) => {
			heldLoop = name as SoundEffectName;
		},
		// Name-checked so a late stop from a screen that has already been replaced cannot cut off the
		// loop the new one just started.
		soundLoopStop: ({ name }) => {
			if (heldLoop === name) heldLoop = undefined;
		},
	});

	// Run the held loop for exactly as long as it is held AND Sound is on. The teardown covers all
	// three ways it ends — the screen releases it, the player turns Sound off mid-screen, or this
	// component is destroyed — so no loop can outlive what it belongs to.
	$effect(() => {
		const name = heldLoop;
		if (!name || !stateGame.soundEnabled) return;
		startPlinkoSoundLoop(name);
		return () => stopPlinkoSoundLoop(name);
	});
</script>
