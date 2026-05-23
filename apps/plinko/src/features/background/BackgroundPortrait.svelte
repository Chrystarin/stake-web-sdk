<script lang="ts">
	import { browser } from '$app/environment';

	import { BACKGROUND_PORTRAIT_IMAGE } from '../../game/assets';
	import { isPortraitGameLayout } from '../../lib/format';
	import { staticCssUrl } from '../../lib/staticUrl';
	import AnimatedPortraitBackground from './AnimatedPortraitBackground.svelte';

	let hostEl = $state<HTMLDivElement | undefined>(undefined);

	/** Mobile layout only (matches Game.svelte). */
	const showAnimatedBackground = $derived(browser && isPortraitGameLayout());

	const backgroundImage = $derived(
		showAnimatedBackground ? staticCssUrl(BACKGROUND_PORTRAIT_IMAGE) : undefined,
	);
</script>

<div
	class="background-portrait-root"
	class:background-portrait-root--active={showAnimatedBackground}
	style:background-image={backgroundImage}
	bind:this={hostEl}
	aria-hidden="true"
>
	{#if showAnimatedBackground && hostEl}
		<AnimatedPortraitBackground host={hostEl} />
	{/if}
</div>

<style>
	.background-portrait-root {
		position: fixed;
		inset: 0;
		width: 100vw;
		height: 100vh;
		height: 100dvh;
		z-index: 0;
		pointer-events: none;
		overflow: hidden;
	}

	.background-portrait-root--active {
		background-color: #5a8f94;
		background-size: cover;
		background-position: center top;
		background-repeat: no-repeat;
	}
</style>
