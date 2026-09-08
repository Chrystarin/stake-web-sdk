<script lang="ts">
	/**
	 * The animated backdrop, ported from One Eyed Willy's Plinko: a Spine scene over a static webp of
	 * the same view, filling the game frame behind everything else.
	 *
	 * Plinko's version also swaps art for free games, switches to a portrait cut, and throttles itself
	 * under full-screen overlays. None of that applies here — the frame is a fixed 16:9 box and there
	 * is no second backdrop — so this is the landscape scene and nothing else. What it does keep is
	 * the WebGL context-loss recovery, because the cause has nothing to do with the game: iOS Safari
	 * reaps contexts under memory pressure and a full-viewport renderer is its first pick.
	 */
	import { onDestroy } from 'svelte';

	import { backdropImagePath, getBackgroundLandscapeAsset } from '../lib/spine/backgroundLandscapeAsset';
	import { SpineBackgroundRenderer } from '../lib/spine/SpineBackgroundRenderer';
	import { staticUrl } from '../lib/staticUrl';

	/** Shown while the Spine stack is loading, and left up for good if it fails. */
	const fallbackImageSrc = staticUrl(backdropImagePath());

	let canvasHost = $state<HTMLElement | undefined>();
	let spineReady = $state(false);
	let spineFailed = $state(false);
	let renderer: SpineBackgroundRenderer | undefined;
	let activeSession = 0;

	/**
	 * On a context loss the canvas is dead (Pixi only restores contexts it chose to lose), so the
	 * static backdrop takes over immediately and the renderer is rebuilt after a pause long enough
	 * for the pressure that killed it to ease. Rebuilds are capped: if fresh contexts keep dying, the
	 * device hasn't the memory for the scene, and looping destroy/create feeds the very pressure that
	 * kills them. The static image is the floor.
	 */
	let contextLosses = 0;
	const MAX_CONTEXT_LOSS_REBUILDS = 2;
	const CONTEXT_LOSS_REBUILD_DELAY_MS = 4000;

	const mountSpine = async (host: HTMLElement) => {
		const session = ++activeSession;

		renderer?.destroy();
		renderer = undefined;
		spineReady = false;
		spineFailed = false;

		const instance = new SpineBackgroundRenderer(host);
		renderer = instance;
		instance.onContextLost = () => {
			if (session !== activeSession) return;
			spineReady = false;
			contextLosses += 1;
			if (contextLosses > MAX_CONTEXT_LOSS_REBUILDS) {
				console.error('[Background] WebGL context lost again; staying on the static backdrop');
				spineFailed = true;
				return;
			}
			console.error(
				`[Background] WebGL context lost; rebuilding the spine background (attempt ${contextLosses}/${MAX_CONTEXT_LOSS_REBUILDS})`,
			);
			window.setTimeout(() => {
				if (session !== activeSession) return;
				void mountSpine(host);
			}, CONTEXT_LOSS_REBUILD_DELAY_MS);
		};

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
		const host = canvasHost;
		if (!host) return;
		void mountSpine(host);
	});

	onDestroy(() => {
		activeSession += 1;
		renderer?.destroy();
		renderer = undefined;
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
	<div class="background__scrim"></div>
</div>

<style>
	/* Its own stacking context, so the scrim's z-index stays inside this block: the layers here order
	   among themselves, and the whole thing sits under the stage and the panel. Without it the scrim
	   competes with them in the game's context and dims the wheel. */
	.background {
		position: absolute;
		inset: 0;
		z-index: 0;
		isolation: isolate;
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

	/* Knocks the scene back so the wheel and the panel sit clearly in front of it. Over the canvas,
	   so it darkens the animation and the static fallback alike. */
	.background__scrim {
		position: absolute;
		inset: 0;
		z-index: 2;
		background: rgba(8, 4, 16, 0.45);
	}

	.background__canvas :global(canvas) {
		display: block;
		width: 100%;
		height: 100%;
	}
</style>
