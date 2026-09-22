<script lang="ts">
	/**
	 * The backdrop: the ship's deck at night, a still filling the viewport. It covers the whole
	 * viewport rather than the 16:9 frame, so the bands a differently shaped viewport letterboxes
	 * still show the scene.
	 *
	 * Two cuts of it: the 16:9 landscape still, and a tall one for a portrait viewport (Game.svelte's
	 * `portrait`, height over width), where the landscape art cropped to cover would lose the deck
	 * to the sides and blow the ship up past the frame.
	 *
	 * The art rides in as a custom property so the stylesheet's `url(var(--…))` paints the preload's
	 * resident copy (lib/preloadAssets.ts) — it is in memory before this mounts, so the reveal paints
	 * the scene rather than the flat colour. The bonus rooms bring their own backdrops over this one
	 * (BonusRound.svelte).
	 */
	import { staticCssUrl } from '../lib/staticUrl';

	let { portrait = false }: { portrait?: boolean } = $props();

	const art = $derived(
		portrait ? 'img/background_base_portrait.webp' : 'img/background_base_landscape.webp',
	);
</script>

<div
	class="background"
	style="--art-backdrop:{staticCssUrl(art)}"
></div>

<style>
	/* z-index 0 keeps the whole block under the stage (1) and the panel (2). Both cuts have the
	   deck along their foot, so a viewport shaped unlike its cut crops the sides and keeps the
	   horizon and the moon. */
	.background {
		position: absolute;
		inset: 0;
		z-index: 0;
		isolation: isolate;
		overflow: hidden;
		pointer-events: none;
		background: var(--art-backdrop) no-repeat center / cover;
		background-color: #0b1420;
	}
</style>
