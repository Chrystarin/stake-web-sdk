<script lang="ts">
	import { onMount } from 'svelte';
	import { innerHeight, innerWidth } from 'svelte/reactivity/window';

	import { getBackgroundLandscapeAsset } from '../lib/spine/backgroundLandscapeAsset';
	import { SpineBackgroundRenderer } from '../lib/spine/SpineBackgroundRenderer';
	import { staticUrl } from '../lib/staticUrl';

	/** Spine landscape asset when the viewport is wider than tall. */
	const portrait = $derived.by(() => {
		innerWidth.current;
		innerHeight.current;
		if (typeof window === 'undefined') return false;
		return window.innerHeight > window.innerWidth;
	});

	const portraitImageSrc = $derived(staticUrl('img/BG_portrait.jpg'));
	const landscapeFallbackSrc = $derived(staticUrl('img/BG_landscape.jpg'));

	let canvasHost = $state<HTMLElement | undefined>();
	let spineReady = $state(false);
	let spineFailed = $state(false);
	let renderer: SpineBackgroundRenderer | undefined;
	let loadGeneration = 0;

	const destroyRenderer = () => {
		renderer?.destroy();
		renderer = undefined;
	};

	const startSpineBackground = (host: HTMLElement) => {
		destroyRenderer();

		const generation = ++loadGeneration;
		spineReady = false;
		spineFailed = false;

		const instance = new SpineBackgroundRenderer(host);
		renderer = instance;

		void instance
			.init(getBackgroundLandscapeAsset())
			.then(() => {
				if (generation !== loadGeneration) return;
				spineReady = true;
			})
			.catch((error) => {
				if (generation !== loadGeneration) return;
				console.error('[Background] failed to load spine background', error);
				spineFailed = true;
			});
	};

	$effect(() => {
		if (portrait || !canvasHost) {
			loadGeneration += 1;
			destroyRenderer();
			spineReady = false;
			spineFailed = false;
			return;
		}

		startSpineBackground(canvasHost);

		return () => {
			loadGeneration += 1;
			destroyRenderer();
			spineReady = false;
			spineFailed = false;
		};
	});

	onMount(() => destroyRenderer);
</script>

<div class="background">
	{#if portrait}
		<img class="background__image" src={portraitImageSrc} alt="" />
	{:else}
		{#if !spineReady || spineFailed}
			<img
				class="background__image background__image--landscape"
				src={landscapeFallbackSrc}
				alt=""
			/>
		{/if}
		<div
			class="background__canvas"
			class:background__canvas--ready={spineReady && !spineFailed}
			bind:this={canvasHost}
		></div>
	{/if}
</div>

<style>
	.background {
		position: absolute;
		inset: 0;
		overflow: hidden;
		pointer-events: none;
	}

	.background__image {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: cover;
		object-position: center bottom;
	}

	.background__image--landscape {
		transform: scale(1.12);
		transform-origin: center bottom;
	}

	.background__canvas {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		opacity: 0;
	}

	.background__canvas--ready {
		opacity: 1;
	}

	.background__canvas :global(canvas) {
		display: block;
		width: 100%;
		height: 100%;
	}
</style>
