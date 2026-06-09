<script lang="ts">
	import { innerHeight, innerWidth } from 'svelte/reactivity/window';

	import { EnablePixiExtension } from 'components-pixi';
	import { App, Container, SpineProvider, SpineTrack } from 'pixi-svelte';

	import { isPortraitGameLayout } from '../lib/format';
	import { staticUrl } from '../lib/staticUrl';
	import BackgroundPixiResize from './BackgroundPixiResize.svelte';
	import BackgroundSpineClearSlots from './BackgroundSpineClearSlots.svelte';
	import BackgroundSpineSlotBlend from './BackgroundSpineSlotBlend.svelte';

	const BACKGROUND_ANIMATION = 'animation';

	/** Back → front. Lamps render above waterfalls. */
	const LANDSCAPE_SPINE_LAYERS = [
		{ key: 'backgroundLandscape', zIndex: 0 },
		{ key: 'backgroundWaterfall', zIndex: 1 },
		{ key: 'backgroundLamp', zIndex: 2 },
	] as const;

	const LANDSCAPE_REFERENCE_BOUNDS = { x: -1887.31, y: -3.17, width: 3731.67, height: 2007.81 } as const;
	const PORTRAIT_REFERENCE_BOUNDS = { x: -1194.71, y: -3.78, width: 3045.9, height: 1761 } as const;

	/** Base landscape export still contains lamp/water slots (low-res atlas). */
	const LANDSCAPE_HIDDEN_SLOTS = [
		'lamp2',
		'lamp3',
		'light',
		'light2',
		'water lines/0',
		'water lines/2',
		'water sparkle/0',
		'water sparkle/2',
		'waterDrop1',
		'waterDrop5',
		'waterDrop2',
		'waterDrop6',
		'waterFlow',
		'waterFlow3',
		'splash',
		'splash2',
		'splash3',
		'splash4',
	] as const;

	const LAMP_LIGHT_SLOTS = ['light', 'light2'] as const;

	/** @see @esotericsoftware/spine-pixi-v8 BlendMode.Additive */
	const BLEND_ADDITIVE = 1;

	const mobile = $derived.by(() => {
		innerWidth.current;
		innerHeight.current;
		return isPortraitGameLayout();
	});

	const staticImageUrl = $derived(
		staticUrl(mobile ? 'img/BG_portrait.jpg' : 'img/BG_landscape.jpg'),
	);

	let spineHostEl = $state<HTMLDivElement | null>(null);
	let hostWidth = $state(1);
	let hostHeight = $state(1);

	$effect(() => {
		const el = spineHostEl;
		if (!el) return;

		const syncHostSize = (width: number, height: number) => {
			if (width > 0) hostWidth = width;
			if (height > 0) hostHeight = height;
		};

		syncHostSize(el.clientWidth, el.clientHeight);

		const ro = new ResizeObserver(([entry]) => {
			const { width, height } = entry.contentRect;
			syncHostSize(width, height);
		});

		ro.observe(el);
		return () => ro.disconnect();
	});

	/**
	 * Split landscape layers share one root transform so lamp/waterfall bones
	 * align with the base scenery skeleton coordinates.
	 */
	const landscapeContainerLayout = $derived.by(() => {
		const scale = hostWidth / LANDSCAPE_REFERENCE_BOUNDS.width;

		return {
			x: hostWidth / 2,
			y: hostHeight - LANDSCAPE_REFERENCE_BOUNDS.y * scale,
			scale,
			sortableChildren: true,
		};
	});

	const portraitSpineLayout = $derived.by(() => {
		const scale = hostWidth / PORTRAIT_REFERENCE_BOUNDS.width;

		return {
			x: hostWidth / 2,
			y: hostHeight - PORTRAIT_REFERENCE_BOUNDS.y * scale,
			width: hostWidth,
		};
	});
</script>

<div class="background">
	<img
		class="background__image"
		class:background__image--bottom={!mobile}
		src={staticImageUrl}
		alt=""
		aria-hidden="true"
	/>

	<div class="background__spine" bind:this={spineHostEl}>
		<App>
			<EnablePixiExtension />

			{#if spineHostEl}
				<BackgroundPixiResize host={spineHostEl} />
			{/if}

			{#if mobile}
				<SpineProvider key="backgroundPortrait" {...portraitSpineLayout}>
					<SpineTrack trackIndex={0} animationName={BACKGROUND_ANIMATION} loop />
				</SpineProvider>
			{:else}
				<Container {...landscapeContainerLayout}>
					{#each LANDSCAPE_SPINE_LAYERS as layer (layer.key)}
						<SpineProvider key={layer.key} zIndex={layer.zIndex}>
							<SpineTrack trackIndex={0} animationName={BACKGROUND_ANIMATION} loop />
							{#if layer.key === 'backgroundLandscape'}
								<BackgroundSpineClearSlots slotNames={LANDSCAPE_HIDDEN_SLOTS} />
							{/if}
							{#if layer.key === 'backgroundLamp'}
								<BackgroundSpineSlotBlend slotNames={LAMP_LIGHT_SLOTS} blendMode={BLEND_ADDITIVE} />
							{/if}
						</SpineProvider>
					{/each}
				</Container>
			{/if}
		</App>
	</div>
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
		object-position: center;
		z-index: 0;
	}

	.background__image--bottom {
		object-position: center bottom;
	}

	.background__spine {
		position: absolute;
		inset: 0;
		width: 100vw;
		height: 100vh;
		height: 100dvh;
		z-index: 1;
		overflow: hidden;
	}

	.background__spine :global(> div) {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
	}

	.background__spine :global(canvas) {
		display: block;
		width: 100% !important;
		height: 100% !important;
	}
</style>
