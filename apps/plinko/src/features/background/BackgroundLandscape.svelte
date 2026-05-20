<script lang="ts">
	import { innerWidth } from 'svelte/reactivity/window';

	import PlinkoBackgroundApp from './PlinkoBackgroundApp.svelte';

	let hostEl = $state<HTMLDivElement | undefined>(undefined);

	/** Wide viewport only; mobile layout keeps the static CSS background in Game.svelte. */
	const showAnimatedBackground = $derived((innerWidth.current ?? 0) >= 600);
</script>

{#if showAnimatedBackground}
	<div class="background-landscape-root" bind:this={hostEl} aria-hidden="true">
		<PlinkoBackgroundApp resizeTarget={hostEl} />
	</div>
{/if}

<style>
	.background-landscape-root {
		position: fixed;
		inset: 0;
		width: 100%;
		height: 100%;
		z-index: 0;
		pointer-events: none;
		overflow: hidden;
	}
</style>
