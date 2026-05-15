<script lang="ts">
	import { onMount } from 'svelte';

	import { FreeSpinMeterEngine } from './FreeSpinMeterEngine';

	type Props = { progress?: number };

	const props: Props = $props();

	let hostEl: HTMLDivElement;
	let engine: FreeSpinMeterEngine | undefined;

	onMount(() => {
		engine = new FreeSpinMeterEngine();
		void engine.init(hostEl).then(() => engine?.setProgress(props.progress ?? 0));
		return () => engine?.destroy();
	});

	$effect(() => {
		engine?.setProgress(props.progress ?? 0);
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
