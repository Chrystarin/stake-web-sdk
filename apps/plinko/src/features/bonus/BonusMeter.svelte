<script lang="ts">
	import { onMount } from 'svelte';

	import { BonusMeterEngine } from './BonusMeterEngine';
	import { staticUrl } from '../../lib/staticUrl';

	/** `visible` — whether the meter is actually on screen. It stays MOUNTED when hidden (churning the
	 *  WebGL canvas flashes white on slower GPUs), so this is what stops the marker-tracking loop below
	 *  running for the whole 1-ball tier. Defaults to true so Storybook use needs no prop. */
	type Props = { progress?: number; visible?: boolean };

	const props: Props = $props();

	let hostEl: HTMLDivElement;
	let engine: BonusMeterEngine | undefined;
	let markerLeft = $state(0);
	let markerTop = $state(0);
	let markerSize = $state(10);
	// The engine only computes a real marker position after its async init (texture load + first
	// resize). Until then markerLeft/Top are 0, which paints the marker at the wrap's top-left
	// corner — visible as a marker that flashes "way off position" then snaps back whenever the
	// meter mounts (e.g. switching back from 1 Ball Per Drop). Keep it hidden until ready.
	let markerReady = $state(false);

	onMount(() => {
		engine = new BonusMeterEngine();
		void engine.init(hostEl).then(() => {
			engine?.setProgress(props.progress ?? 0);
			syncMarker();
			markerReady = true;
		});

		return () => engine?.destroy();
	});

	// The marker is an HTML <img>, so it can't ride the Pixi scene graph — it samples the engine's
	// published tip position every frame instead. Only while the meter is on screen: hidden, this was a
	// permanent rAF loop running for the whole session with nothing to show for it.
	// (The engine's own canvas is separately render-on-demand — see BonusMeterEngine.renderNow.)
	$effect(() => {
		if (!(props.visible ?? true)) return;
		let rafId = requestAnimationFrame(function tick() {
			syncMarker();
			rafId = requestAnimationFrame(tick);
		});
		return () => cancelAnimationFrame(rafId);
	});

	$effect(() => {
		const progress = props.progress ?? 0;
		engine?.setProgress(progress);
		syncMarker();
	});

	function syncMarker() {
		if (!engine) return;
		markerLeft = engine.markerLeftPx;
		markerTop = engine.markerTopPx;
		markerSize = engine.markerSizePx;
	}
</script>

<div class="bonus-meter-root">
	<div class="meter-host" bind:this={hostEl}></div>
	<img
		class="meter-marker"
		src={staticUrl('img/bonus-bar-marker.webp')}
		alt=""
		style:left="{markerLeft}px"
		style:top="{markerTop}px"
		style:width="{markerSize}px"
		style:height="{markerSize}px"
		style:opacity={markerReady ? 1 : 0}
	/>
</div>

<style>
	.bonus-meter-root {
		position: relative;
		width: 100%;
		height: 100%;
	}
	.meter-host {
		width: 100%;
		height: 100%;
	}
	.meter-host :global(canvas) {
		width: 100% !important;
		height: 100% !important;
		display: block;
	}
	.meter-marker {
		position: absolute;
		transform: translate(-50%, -50%);
		pointer-events: none;
		z-index: 2;
	}
</style>
