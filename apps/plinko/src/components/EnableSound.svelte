<script lang="ts">
	import { onMount } from 'svelte';

	import { getContext } from '../game/context';
	import { stateGame } from '../game/stateGame.svelte';
	import { staticUrl } from '../lib/staticUrl';
	import {
		loadPlinkoSound,
		playPlinkoSound,
		type LoadSoundOptions,
		type SoundEffectName,
	} from '../game/sound';

	const context = getContext();

	const soundMap: Record<SoundEffectName, string> = {
		bet: staticUrl('sound/bet.mp3'),
		win: staticUrl('sound/win.mp3'),
		pocket: staticUrl('sound/pocket.mp3'),
		peg: staticUrl('sound/peg.wav'),
		rouletteTick: staticUrl('sound/roulette_tick.wav'),
		placeChip: staticUrl('sound/placeChip.mp3'),
		clickingFail: staticUrl('sound/clickingFail.mp3'),
		startAutoPlay: staticUrl('sound/startAutoPlay.mp3'),
		openPopup: staticUrl('sound/openPopup.mp3'),
		clickUIButton: staticUrl('sound/clickUIButton.mp3'),
		coinFlip: staticUrl('sound/coin_flip.wav'),
		coinPeg: staticUrl('sound/coin_peg.wav'),
		// Both shuffle variants are the SAME file, played as different time windows (see sprite below).
		coinShuffleSingle: staticUrl('sound/coin_shuffle.mp3'),
		coinShuffleMulti: staticUrl('sound/coin_shuffle.mp3'),
		// Bonus congratulations screen slide SFX (see sprite windows below).
		doorClose: staticUrl('sound/door_close.ogg'),
		doorOpen: staticUrl('sound/door_open.ogg'),
		// Bonus level-up chime (leading silence trimmed via sprite below).
		bonusLevelUp: staticUrl('sound/bonus_level_up.mp3'),
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
		peg: { volume: 0.5 },
		coinShuffleSingle: { sprite: [540, 1100] },
		coinShuffleMulti: { sprite: [2000, 2000] },
		doorClose: { sprite: [2790, 2260] },
		doorOpen: { sprite: [3200, 900] },
		// The clip has ~3.17s of leading silence before the chime (onset measured via Web Audio at
		// 3.170s). The window starts a hair before onset (3150ms) so the attack isn't clipped and runs
		// to the end of the file (~6.34s) — so it plays on the sound immediately, no dead air.
		bonusLevelUp: { sprite: [3150, 3200] },
	};

	onMount(() => {
		for (const [name, url] of Object.entries(soundMap)) {
			loadPlinkoSound(name as SoundEffectName, url, soundOptions[name as SoundEffectName]);
		}
	});

	context.eventEmitter.subscribeOnMount({
		soundOnce: ({ name, rate }) => {
			if (!stateGame.soundEnabled) return;
			playPlinkoSound(name as SoundEffectName, rate ?? 1);
		},
	});
</script>
