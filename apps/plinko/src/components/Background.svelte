<script lang="ts">
	import { Rectangle, SpineProvider, SpineTrack } from 'pixi-svelte';

	import { getContext } from '../game/context';

	const context = getContext();

	const spineData = $derived(
		context.stateApp.loadedAssets.backgroundLandscape,
	);

	const canvasSizes = $derived(() => {
		const renderer = context.stateApp.pixiApplication?.renderer;
		if (renderer) {
			return { width: renderer.width, height: renderer.height };
		}
		return context.stateLayoutDerived.canvasSizes();
	});

	const backgroundProps = $derived(() => {
		const sizes = canvasSizes();
		const layout = context.stateLayoutDerived.normalBackgroundLayout({ scale: 1.05 });
		return {
			...layout,
			x: sizes.width / 2,
			y: sizes.height / 2,
			anchor: 0.5 as const,
		};
	});
</script>

{#if spineData}
	<Rectangle {...canvasSizes()} backgroundColor={0x0a0f14} backgroundAlpha={1} zIndex={0} />

	<SpineProvider key="backgroundLandscape" {...backgroundProps} zIndex={1}>
		<SpineTrack trackIndex={0} animationName="animation" loop timeScale={1} />
	</SpineProvider>
{/if}
