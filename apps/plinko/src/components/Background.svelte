<script lang="ts">
	import { innerHeight, innerWidth } from 'svelte/reactivity/window';

	import { isPortraitGameLayout } from '../lib/format';
	import { getBackgroundLandscapeAsset } from '../lib/spine/backgroundLandscapeAsset';
	import { SpineBackgroundRenderer } from '../lib/spine/SpineBackgroundRenderer';
	import { staticUrl } from '../lib/staticUrl';

	/** Match Game.svelte layout: mobile UA or tall narrow viewport uses portrait JPG. */
	const portrait = $derived.by(() => {
		innerWidth.current;
		innerHeight.current;
		return isPortraitGameLayout();
	});

	const portraitImageSrc = $derived(staticUrl('img/BG_portrait.jpg'));
	/** Shown only while the landscape Spine stack (backdrop + animation) is loading or failed. */
	const landscapeFallbackSrc = $derived(staticUrl('img/BG_landscape.jpg'));

	let canvasHost = $state<HTMLElement | undefined>();
	let spineReady = $state(false);
	let spineFailed = $state(false);
	let renderer: SpineBackgroundRenderer | undefined;
	let activeSession = 0;

	const teardownSpine = () => {
		activeSession += 1;
		renderer?.destroy();
		renderer = undefined;
		spineReady = false;
		spineFailed = false;
	};

	const mountSpine = async (host: HTMLElement) => {
		const session = ++activeSession;

		renderer?.destroy();
		renderer = undefined;
		spineReady = false;
		spineFailed = false;

		const instance = new SpineBackgroundRenderer(host);
		renderer = instance;

		try {
			await instance.init(getBackgroundLandscapeAsset());
			if (session !== activeSession) return;
			spineReady = true;
		} catch (error) {
			if (session !== activeSession) return;
			console.error('[Background] failed to load spine background', error);
			spineFailed = true;
		}
	};

	$effect(() => {
		if (portrait) {
			teardownSpine();
			return;
		}

		const host = canvasHost;
		if (!host) return;

		void mountSpine(host);

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
