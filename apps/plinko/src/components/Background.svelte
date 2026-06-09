<script lang="ts">
	import { innerHeight, innerWidth } from 'svelte/reactivity/window';

	import { EnablePixiExtension } from 'components-pixi';
	import { App, Container, SpineProvider, SpineTrack } from 'pixi-svelte';

	import { isPortraitGameLayout } from '../lib/format';
	import BackgroundImageSprite from './BackgroundImageSprite.svelte';
	import BackgroundPixiResize from './BackgroundPixiResize.svelte';
	import BackgroundSpineClearSlots from './BackgroundSpineClearSlots.svelte';
	import BackgroundSpineSlotBlend from './BackgroundSpineSlotBlend.svelte';

	const BACKGROUND_ANIMATION = 'animation';

	/** Back → front. Lamps render above waterfalls. */
	const LANDSCAPE_SPINE_LAYERS = [
		{ key: 'backgroundLandscape', zIndex: 1 },
		{ key: 'backgroundWaterfall', zIndex: 2 },
		{ key: 'backgroundLamp', zIndex: 3 },
	] as const;

	const LANDSCAPE_REFERENCE_BOUNDS = { x: -1887.31, y: -3.17, width: 3731.67, height: 2007.81 } as const;
	const PORTRAIT_REFERENCE_BOUNDS = { x: -1194.71, y: -3.78, width: 3045.9, height: 1761 } as const;

	/** Landscape-only zoom; Y is recomputed so the bottom anchor stays on the viewport bottom. */
	const LANDSCAPE_SCALE_BOOST = 1.12;

	type ReferenceBounds = {
		x: number;
		y: number;
		width: number;
		height: number;
	};

	/**
	 * Shared transform for the JPG and all Spine layers.
	 * Cover scale with the spine bottom anchor (reference-bounds top → viewport bottom).
	 */
	const computeBackgroundTransform = (
		width: number,
		height: number,
		bounds: ReferenceBounds,
		scaleMultiplier = 1,
	) => {
		const scale = Math.max(width / bounds.width, height / bounds.height) * scaleMultiplier;

		return {
			x: width / 2,
			y: height - bounds.y * scale,
			scale,
			sortableChildren: true,
		};
	};

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

	const referenceBounds = $derived(
		mobile ? PORTRAIT_REFERENCE_BOUNDS : LANDSCAPE_REFERENCE_BOUNDS,
	);

	const backgroundImagePath = $derived(
		mobile ? 'img/BG_portrait.jpg' : 'img/BG_landscape.jpg',
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

	const landscapeScaleBoost = $derived(mobile ? 1 : LANDSCAPE_SCALE_BOOST);

	const backgroundContainerLayout = $derived.by(() =>
		computeBackgroundTransform(
			hostWidth,
			hostHeight,
			referenceBounds,
			landscapeScaleBoost,
		),
	);

	/**
	 * JPG sits in the same container as Spine. With the original spine anchor the
	 * viewport maps to this local Y band; placing the image here keeps it visible
	 * while sharing scale/translate with the animation layers.
	 */
	const backgroundImageLayout = $derived.by(() => {
		const scale =
			Math.max(hostWidth / referenceBounds.width, hostHeight / referenceBounds.height) *
			landscapeScaleBoost;
		const visibleHeight = hostHeight / scale;

		return {
			path: backgroundImagePath,
			x: referenceBounds.x,
			y: -visibleHeight,
			width: referenceBounds.width,
			height: visibleHeight + referenceBounds.y,
			zIndex: 0,
		};
	});
</script>

<div class="background">
	<div class="background__spine" bind:this={spineHostEl}>
		<App>
			<EnablePixiExtension />

			{#if spineHostEl}
				<BackgroundPixiResize host={spineHostEl} />
			{/if}

			<Container {...backgroundContainerLayout}>
				{#key backgroundImagePath}
					<BackgroundImageSprite {...backgroundImageLayout} />
				{/key}

				{#if mobile}
					<SpineProvider key="backgroundPortrait">
						<SpineTrack trackIndex={0} animationName={BACKGROUND_ANIMATION} loop />
					</SpineProvider>
				{:else}
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
				{/if}
			</Container>
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

	.background__spine {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
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
