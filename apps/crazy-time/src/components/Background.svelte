<script lang="ts">
	/**
	 * The backdrop: the ship's deck at night, looking out over the rail at the island, the moon and the
	 * other ship. It covers the whole viewport rather than the 16:9 frame, so the bands a differently
	 * shaped viewport letterboxes still show the scene.
	 *
	 * It is the artist's Spine scene (lib/spine/backdropScenes.ts, `mainLandscape` / `mainPortrait`):
	 * clouds drifting over the sky, the sea's frame sequence, the far ship riding the swell with its
	 * flag going, banks of fog crossing the water and the rail, the lanterns swinging. Portrait has its
	 * own cut, built for the tall frame. On the reduced budget, before the canvas is up, and if the GPU
	 * takes it away, the scene's still shows instead (SpineBackdrop.svelte).
	 *
	 * Held still while a bonus room covers the table (`paused`), so the two scenes never both draw.
	 * When a bonus room's icon slams back into the wheel, the sea lurches behind the rail (`lurch`).
	 */
	import SpineBackdrop from './SpineBackdrop.svelte';

	let { portrait = false, paused = false }: { portrait?: boolean; paused?: boolean } = $props();

	let backdrop = $state<SpineBackdrop>();

	/** The sea's knock from a bonus room's icon slamming back into the wheel (Game.svelte). */
	export const lurch = () => backdrop?.lurch();
</script>

<!-- z-index 0 keeps the whole block under the stage (1) and the panel (2). -->
<div class="background">
	<SpineBackdrop bind:this={backdrop} scene={portrait ? 'mainPortrait' : 'mainLandscape'} {paused} />
</div>

<style>
	.background {
		position: absolute;
		inset: 0;
		z-index: 0;
		isolation: isolate;
		overflow: hidden;
		pointer-events: none;
		background-color: #0b1420;
	}
</style>
