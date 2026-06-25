<script lang="ts">
	import { onMount } from 'svelte';
	import { Howl } from 'howler';

	import { stateGame } from '../game/stateGame.svelte';
	import { staticUrl } from '../lib/staticUrl';

	// Looping background track. Kept separate from the one-shot sound effects in `sound.ts`
	// so it can be toggled (and its volume tuned) independently of the `Sound` toggle.
	let music = $state<Howl | undefined>(undefined);

	onMount(() => {
		const howl = new Howl({
			src: [staticUrl('sound/background_music.m4a')],
			loop: true,
			volume: 0.35,
			// HTML5 streaming is better suited to a long music file than buffering it fully.
			html5: true,
			onloaderror: (_id, err) => {
				console.warn('[plinko] background music failed to load', err);
			},
		});
		music = howl;
		return () => {
			howl.stop();
			howl.unload();
			music = undefined;
		};
	});

	// Start/stop the loop in lockstep with the Music toggle. Toggling it on happens from a
	// user click, which satisfies the browser autoplay gesture requirement.
	$effect(() => {
		const enabled = stateGame.musicEnabled;
		const howl = music;
		if (!howl) return;
		if (enabled) {
			if (!howl.playing()) howl.play();
		} else {
			howl.pause();
		}
	});
</script>
