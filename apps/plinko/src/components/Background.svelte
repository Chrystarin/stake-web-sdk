<script lang="ts">
	import { innerHeight, innerWidth } from 'svelte/reactivity/window';

	import { isPortraitGameLayout } from '../lib/format';
	import { stateGame, stateGameDerived } from '../game/stateGame.svelte';
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

	/** Free game: swap the backdrop to the FREEGAME art, hide the base clouds, show the FG overlays.
	 * Same signal that drives the bonus frame overlay (`container--bonus`) in Game.svelte. */
	const bonus = $derived(stateGameDerived.isBonusBackgroundActive);

	const backgroundAsset = $derived(
		portrait ? getBackgroundPortraitAsset() : getBackgroundLandscapeAsset(),
	);
	/** Shown only while the Spine stack (backdrop + animation) is loading or failed. */
	const fallbackImageSrc = $derived.by(() => {
		const base = portrait ? 'img/BG_portrait.webp' : 'img/BG_landscape.webp';
		const free = portrait ? 'img/BG_portrait_FREEGAME.webp' : 'img/BG_landscape_FREEGAME.webp';
		return staticUrl(bonus ? free : base);
	});

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

	// Drive bonus-mode layers once the spine is live. Re-runs on `bonus` toggle and whenever a re-mount
	// (orientation change) flips `spineReady` back to true, so the current mode is always re-applied.
	$effect(() => {
		const active = bonus;
		if (!spineReady) return;
		void renderer?.setBonusMode(active);
	});

	// Drop to a trickle frame rate whenever a full-screen congratulations screen hides this canvas, so the
	// GPU budget goes to that screen's own animations instead of a free-game scene nobody can see. Re-runs
	// on re-mount (orientation change) for the same reason as the bonus effect above.
	$effect(() => {
		const hidden = stateGame.overlayCoversGame;
		if (!spineReady) return;
		renderer?.setHiddenByOverlay(hidden);
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
