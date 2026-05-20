<script lang="ts">
	import { App } from 'pixi-svelte';
	import { EnablePixiExtension } from 'components-pixi';

	import { getContext } from '../../game/context';
	import Background from '../../components/Background.svelte';

	const context = getContext();
	let hostEl = $state<HTMLDivElement | undefined>(undefined);

	/** Resize Pixi to this layer so layout matches the visible game viewport. */
	$effect(() => {
		const app = context.stateApp.pixiApplication;
		const el = hostEl;
		if (!app?.renderer || !el) return;

		const resize = () => {
			const { width, height } = el.getBoundingClientRect();
			if (width < 1 || height < 1) return;
			app.renderer.resize(width, height);
		};

		resize();
		const ro = new ResizeObserver(resize);
		ro.observe(el);

		return () => ro.disconnect();
	});
</script>

<div class="background-landscape-root" bind:this={hostEl} aria-hidden="true">
	<App>
		<EnablePixiExtension />
		<Background />
	</App>
</div>

<style>
	.background-landscape-root {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		z-index: 0;
		pointer-events: none;
		overflow: hidden;
	}

	.background-landscape-root :global(> div) {
		position: absolute !important;
		inset: 0 !important;
		width: 100% !important;
		height: 100% !important;
		margin: 0 !important;
	}

	.background-landscape-root :global(canvas) {
		display: block;
		position: absolute;
		inset: 0;
		width: 100% !important;
		height: 100% !important;
		object-fit: cover;
		pointer-events: none;
	}
</style>
