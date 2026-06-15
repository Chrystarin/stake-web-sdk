<script lang="ts">
	import { innerHeight, innerWidth } from 'svelte/reactivity/window';

	import { isPortraitGameLayout } from '../lib/format';
	import { getBackgroundLandscapeAsset } from '../lib/spine/backgroundLandscapeAsset';
	import { getBackgroundPortraitAsset } from '../lib/spine/backgroundPortraitAsset';
	import { SpineBackgroundRenderer } from '../lib/spine/SpineBackgroundRenderer';
	import type { SpineAssetDef } from '../lib/spine/types';
	import { staticUrl } from '../lib/staticUrl';

	/** Match Game.svelte layout: mobile UA or tall narrow viewport uses portrait assets. */
	const portrait = $derived.by(() => {
		innerWidth.current;
		innerHeight.current;
		return isPortraitGameLayout();
	});

	const backgroundAsset = $derived(
		portrait ? getBackgroundPortraitAsset() : getBackgroundLandscapeAsset(),
	);
	/** Shown only while the Spine stack (backdrop + animation) is loading or failed. */
	const fallbackImageSrc = $derived(
		staticUrl(portrait ? 'img/BG_portrait.jpg' : 'img/BG_landscape.jpg'),
	);

	let canvasHost = $state<HTMLElement | undefined>();
	let spineReady = $state(false);
	let spineFailed = $state(false);
	let renderer: SpineBackgroundRenderer | undefined;
	let activeSession = 0;

	const mountSpine = async (host: HTMLElement, asset: SpineAssetDef) => {
		const session = ++activeSession;

		renderer?.destroy();
		renderer = undefined;
		spineReady = false;
		spineFailed = false;

		const instance = new SpineBackgroundRenderer(host);
		renderer = instance;

		try {
			await instance.init(asset);
			if (session !== activeSession) return;
			spineReady = true;
		} catch (error) {
			if (session !== activeSession) return;
			console.error('[Background] failed to load spine background', error);
			spineFailed = true;
		}
	};

	$effect(() => {
		const host = canvasHost;
		const asset = backgroundAsset;
		if (!host) return;

		void mountSpine(host, asset);

		return () => {
			activeSession += 1;
			renderer?.destroy();
			renderer = undefined;
			spineReady = false;
			spineFailed = false;
		};
	});
</script>

<div class="background">
	{#if !spineReady || spineFailed}
		<img class="background__image" src={fallbackImageSrc} alt="" />
	{/if}
	<div
		class="background__canvas"
		class:background__canvas--ready={spineReady && !spineFailed}
		bind:this={canvasHost}
	></div>
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

	.background__canvas {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		opacity: 0;
		z-index: 1;
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
