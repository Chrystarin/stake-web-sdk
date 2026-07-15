<script lang="ts">
	import { onMount } from 'svelte';

	import { getContext } from '../game/context';
	import { stateGame } from '../game/stateGame.svelte';
	import { staticUrl } from '../lib/staticUrl';
	import {
		loadPlinkoSound,
		playPlinkoSound,
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
	};

	onMount(() => {
		for (const [name, url] of Object.entries(soundMap)) {
			loadPlinkoSound(name as SoundEffectName, url);
		}
	});

	context.eventEmitter.subscribeOnMount({
		soundOnce: ({ name, rate }) => {
			if (!stateGame.soundEnabled) return;
			playPlinkoSound(name as SoundEffectName, rate ?? 1);
		},
	});
</script>
