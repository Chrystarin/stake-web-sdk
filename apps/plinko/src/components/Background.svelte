<script lang="ts">

	import { innerHeight, innerWidth } from 'svelte/reactivity/window';



	import { EnablePixiExtension } from 'components-pixi';

	import { App, SpineProvider, SpineTrack } from 'pixi-svelte';

	import BackgroundPixiResize from './BackgroundPixiResize.svelte';
	import BackgroundSpineClearSlots from './BackgroundSpineClearSlots.svelte';



	import { isPortraitGameLayout } from '../lib/format';

	import { staticUrl } from '../lib/staticUrl';



	const BACKGROUND_ANIMATION = 'animation';

	/** Back → front. Lamps must render above waterfalls. */
	const LANDSCAPE_SPINE_LAYERS = [
		{ key: 'backgroundLandscape', zIndex: 0 },
		{ key: 'backgroundWaterfall', zIndex: 1 },
		{ key: 'backgroundLamp', zIndex: 2 },
	] as const;

	const PORTRAIT_ASSET_KEY = 'backgroundPortrait';

	const LANDSCAPE_REFERENCE_BOUNDS = { x: -1887.31, y: -3.17, width: 3731.67, height: 2007.81 } as const;

	const SPINE_DESIGN_BOUNDS = {
		[PORTRAIT_ASSET_KEY]: { x: -1194.71, y: -3.78, width: 3045.9, height: 1761 },
	} as const;

	/**
	 * Landscape split layers share one root position + scale so lamp/waterfall
	 * align with the base scenery skeleton coordinates.
	 */
	const coverLandscapeLayerLayout = (viewportWidth: number, viewportHeight: number) => {
		const scale = viewportWidth / LANDSCAPE_REFERENCE_BOUNDS.width;

		return {
			x: viewportWidth / 2,
			y: viewportHeight - LANDSCAPE_REFERENCE_BOUNDS.y * scale,
			scale,
		};
	};

	const coverPortraitSpineLayout = (
		viewportWidth: number,
		viewportHeight: number,
		bounds: (typeof SPINE_DESIGN_BOUNDS)[typeof PORTRAIT_ASSET_KEY],
	) => {
		const scale = viewportWidth / bounds.width;

		return {
			x: viewportWidth / 2,
			y: viewportHeight - bounds.y * scale,
			width: viewportWidth,
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



	const mobile = $derived.by(() => {

		innerWidth.current;

		innerHeight.current;

		return isPortraitGameLayout();

	});



	const spineKey = $derived(mobile ? PORTRAIT_ASSET_KEY : 'landscape');



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

	const portraitSpineLayout = $derived(
		coverPortraitSpineLayout(hostWidth, hostHeight, SPINE_DESIGN_BOUNDS[PORTRAIT_ASSET_KEY]),
	);

	const landscapeSpineLayout = $derived(coverLandscapeLayerLayout(hostWidth, hostHeight));

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

			{#key spineKey}
				{#if mobile}
					<SpineProvider key={PORTRAIT_ASSET_KEY} {...portraitSpineLayout}>
						<SpineTrack trackIndex={0} animationName={BACKGROUND_ANIMATION} loop />
					</SpineProvider>
				{:else}
					{#each LANDSCAPE_SPINE_LAYERS as layer (layer.key)}
						<SpineProvider key={layer.key} zIndex={layer.zIndex} {...landscapeSpineLayout}>
							<SpineTrack trackIndex={0} animationName={BACKGROUND_ANIMATION} loop />
							{#if layer.key === 'backgroundLandscape'}
								<BackgroundSpineClearSlots slotNames={LANDSCAPE_HIDDEN_SLOTS} />
							{/if}
						</SpineProvider>
					{/each}
				{/if}
			{/key}

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
