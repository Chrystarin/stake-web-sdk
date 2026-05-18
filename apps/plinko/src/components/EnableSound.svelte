<script lang="ts">
	import { onMount } from 'svelte';

	import { sound } from '../game/sound';
	import { getContext } from '../game/context';
	import { stateGame } from '../game/stateGame.svelte';
	import { staticUrl } from '../lib/staticUrl';

	const context = getContext();

	const soundMap: Record<string, string> = {
		bet: staticUrl('sound/bet.mp3'),
		win: staticUrl('sound/win.mp3'),
		pocket: staticUrl('sound/pocket.mp3'),
		placeChip: staticUrl('sound/placeChip.mp3'),
		clickingFail: staticUrl('sound/clickingFail.mp3'),
		startAutoPlay: staticUrl('sound/startAutoPlay.mp3'),
		openPopup: staticUrl('sound/openPopup.mp3'),
		clickUIButton: staticUrl('sound/clickUIButton.mp3'),
	};

	onMount(() => {
		Object.entries(soundMap).forEach(([name, url]) => {
			sound.load({ name: name as keyof typeof soundMap, url });
		});
	});

	context.eventEmitter.subscribeOnMount({
		soundOnce: ({ name }) => {
			if (!stateGame.soundEnabled) return;
			sound.play({ name: name as keyof typeof soundMap });
		},
	});
</script>
