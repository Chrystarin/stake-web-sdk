<script lang="ts">
	import { onMount } from 'svelte';

	import { FreeSpinMeterEngine } from './FreeSpinMeterEngine';

	/** `visible` — whether the meter is actually on screen. It is kept MOUNTED when hidden (churning the
	 *  WebGL canvas flashes white on slower GPUs), so this is what stops it drawing; see
	 *  `FreeSpinMeterEngine.setVisible`. Defaults to true so standalone/Storybook use needs no prop. */
	type Props = { progress?: number; visible?: boolean };

	const props: Props = $props();

	let hostEl: HTMLDivElement;
	let engine: FreeSpinMeterEngine | undefined;
	/** Flipped once the async init has an Application to talk to, so the visibility effect below
	 *  re-runs and applies a `visible={false}` that arrived while the engine was still loading. */
	let engineReady = $state(false);

	onMount(() => {
		engine = new FreeSpinMeterEngine();
		void engine.init(hostEl).then(() => {
			engine?.setProgress(props.progress ?? 0);
			engineReady = true;
		});
		return () => engine?.destroy();
	});

	$effect(() => {
		engine?.setProgress(props.progress ?? 0);
	});

	$effect(() => {
		const visible = props.visible ?? true;
		if (!engineReady) return;
		engine?.setVisible(visible);
	});
</script>

<div class="free-spin-meter-root" bind:this={hostEl}></div>

<style>
	.free-spin-meter-root {
		width: 100%;
		height: 100%;
	}
	.free-spin-meter-root :global(canvas) {
		width: 100% !important;
		height: 100% !important;
		display: block;
	}
</style>
