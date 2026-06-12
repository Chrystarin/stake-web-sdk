<script lang="ts">
	import { onMount } from 'svelte';

	import { BonusMeterEngine } from './BonusMeterEngine';
	import { staticUrl } from '../../lib/staticUrl';

	type Props = { progress?: number };

	const props: Props = $props();

	let hostEl: HTMLDivElement;
	let engine: BonusMeterEngine | undefined;
	let markerLeft = $state(0);
	let markerTop = $state(0);
	let markerSize = $state(10);

	onMount(() => {
		engine = new BonusMeterEngine();
		void engine.init(hostEl).then(() => {
			engine?.setProgress(props.progress ?? 0);
			syncMarker();
		});

		let rafId = 0;
		const tick = () => {
			syncMarker();
			rafId = requestAnimationFrame(tick);
		};
		rafId = requestAnimationFrame(tick);
		return () => {
			cancelAnimationFrame(rafId);
			engine?.destroy();
		};
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
		src={staticUrl('img/bonus-bar-marker.png')}
		alt=""
		style:left="{markerLeft}px"
		style:top="{markerTop}px"
		style:width="{markerSize}px"
		style:height="{markerSize}px"
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
