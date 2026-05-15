<script lang="ts">
	import { onMount } from 'svelte';

	import { sound } from '../game/sound';
	import { getContext } from '../game/context';
	import { stateGame } from '../game/stateGame.svelte';

	const context = getContext();

	const soundMap: Record<string, string> = {
		bet: '/sound/bet.mp3',
		win: '/sound/win.mp3',
		pocket: '/sound/pocket.mp3',
		placeChip: '/sound/placeChip.mp3',
		clickingFail: '/sound/clickingFail.mp3',
		startAutoPlay: '/sound/startAutoPlay.mp3',
		openPopup: '/sound/openPopup.mp3',
		clickUIButton: '/sound/clickUIButton.mp3',
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
