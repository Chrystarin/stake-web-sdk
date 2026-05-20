<script lang="ts">
	import { browser } from '$app/environment';

	import { BACKGROUND_LANDSCAPE_IMAGE } from '../../game/assets';
	import { isMobile } from '../../lib/format';
	import { staticCssUrl } from '../../lib/staticUrl';
	import AnimatedLandscapeBackground from './AnimatedLandscapeBackground.svelte';

	let hostEl = $state<HTMLDivElement | undefined>(undefined);

	/** Desktop layout only (matches Game.svelte); mobile uses CSS background image. */
	const showAnimatedBackground = $derived(browser && !isMobile());

	const backgroundImage = $derived(
		showAnimatedBackground ? staticCssUrl(BACKGROUND_LANDSCAPE_IMAGE) : undefined,
	);
</script>

<div
	class="background-landscape-root"
	class:background-landscape-root--active={showAnimatedBackground}
	style:background-image={backgroundImage}
	bind:this={hostEl}
	aria-hidden="true"
>
	{#if showAnimatedBackground && hostEl}
		<AnimatedLandscapeBackground host={hostEl} />
	{/if}
</div>

<style>
	.background-landscape-root {
		position: fixed;
		inset: 0;
		width: 100vw;
		height: 100vh;
		height: 100dvh;
		z-index: 0;
		pointer-events: none;
		overflow: hidden;
	}

	.background-landscape-root--active {
		background-color: #5a8f94;
		background-size: cover;
		background-position: center top;
		background-repeat: no-repeat;
	}
</style>
