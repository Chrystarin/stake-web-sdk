<script lang="ts">
	/**
	 * The backdrop: the ship's deck at night, a still filling the viewport. It covers the whole
	 * viewport rather than the 16:9 frame, so the bands a differently shaped viewport letterboxes
	 * still show the scene.
	 *
	 * The art rides in as a custom property so the stylesheet's `url(var(--…))` paints the preload's
	 * resident copy (lib/preloadAssets.ts) — it is in memory before this mounts, so the reveal paints
	 * the scene rather than the flat colour. The bonus rooms bring their own backdrops over this one
	 * (BonusRound.svelte).
	 */
	import { staticCssUrl } from '../lib/staticUrl';
</script>

<div
	class="background"
	style="--art-backdrop:{staticCssUrl('img/background_base_landscape.webp')}"
></div>

<style>
	/* z-index 0 keeps the whole block under the stage (1) and the panel (2). The art is 16:9 with the
	   deck along its foot, so a narrower viewport crops the rigging off the sides and keeps the
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
