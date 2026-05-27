<script lang="ts">

	import { innerHeight, innerWidth } from 'svelte/reactivity/window';



	import { EnablePixiExtension } from 'components-pixi';

	import { App, SpineProvider, SpineTrack } from 'pixi-svelte';

	import BackgroundPixiResize from './BackgroundPixiResize.svelte';



	import { isPortraitGameLayout } from '../lib/format';

	import { staticUrl } from '../lib/staticUrl';



	const BACKGROUND_ANIMATION = 'animation';

	const LANDSCAPE_ASSET_KEY = 'backgroundLandscape';

	const PORTRAIT_ASSET_KEY = 'backgroundPortrait';

	/** Skeleton AABB from exported spine JSON (x/y can be negative). */
	const SPINE_DESIGN_BOUNDS = {
		[LANDSCAPE_ASSET_KEY]: { x: -1887.31, y: -3.17, width: 3731.67, height: 2007.81 },
		[PORTRAIT_ASSET_KEY]: { x: -1194.71, y: -3.78, width: 3045.9, height: 1761 },
	} as const;

	/**
	 * Scale spine to viewport width (`100vw` in px). Height follows aspect ratio;
	 * bottom of skeleton bounds stays on the viewport bottom.
	 */
	const coverSpineLayout = (
		viewportWidth: number,
		viewportHeight: number,
		bounds: (typeof SPINE_DESIGN_BOUNDS)[keyof typeof SPINE_DESIGN_BOUNDS],
	) => {
		const { y: boundsY, width: spineWidth } = bounds;
		const scale = viewportWidth / spineWidth;

		return {
			x: viewportWidth / 2,
			y: viewportHeight - boundsY * scale,
			width: viewportWidth,
		};
	};



	const mobile = $derived.by(() => {

		innerWidth.current;

		innerHeight.current;

		return isPortraitGameLayout();

	});



	const spineKey = $derived(mobile ? PORTRAIT_ASSET_KEY : LANDSCAPE_ASSET_KEY);



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

	const spineLayout = $derived(
		coverSpineLayout(hostWidth, hostHeight, SPINE_DESIGN_BOUNDS[spineKey]),
	);

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

				<SpineProvider key={spineKey} {...spineLayout}>

					<SpineTrack trackIndex={0} animationName={BACKGROUND_ANIMATION} loop />

				</SpineProvider>

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

