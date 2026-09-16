<script lang="ts">
	/**
	 * The backdrop: a looping video filling the viewport. It covers the whole viewport rather than
	 * the 16:9 frame, so the bands a differently shaped viewport letterboxes still show the scene.
	 *
	 * The `<video>` is not written here — it is ADOPTED from the intro preload (lib/preloadAssets.ts),
	 * which built it behind the splash and has a decoded first frame in it by the time this mounts, so
	 * the reveal paints the scene rather than black. `appendChild` moves the element with its buffer
	 * intact; on teardown it goes back to the preload's parking stage, paused, for the next mount.
	 *
	 * The element is muted and inline, which is what lets it start on its own: every browser blocks
	 * autoplay of a video that could make noise, and iOS Safari otherwise takes it fullscreen. Nothing
	 * here depends on playback actually starting — if a browser refuses, the first frame stays up over
	 * the flat colour and the game is unaffected.
	 */
	import { onMount } from 'svelte';

	import { adoptVideo, releaseVideo } from '../lib/preloadAssets';

	let host = $state<HTMLDivElement>();

	onMount(() => {
		if (!host) return;
		const video = adoptVideo('table', host);
		if (video) video.className = 'background__video';
		return () => releaseVideo('table');
	});
</script>

<div class="background" bind:this={host}></div>

<style>
	/* z-index 0 keeps the whole block under the stage (1) and the panel (2). */
	.background {
		position: absolute;
		inset: 0;
		z-index: 0;
		isolation: isolate;
		overflow: hidden;
		pointer-events: none;
		background-color: #0b1420;
	}

	/* :global — the element is appended by script, so it never receives this component's scope. */
	.background :global(.background__video) {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: cover;
		object-position: center;
	}
</style>
