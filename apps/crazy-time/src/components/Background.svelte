<script lang="ts">
	/**
	 * The backdrop: the ship's deck at night. It covers the whole viewport rather than the 16:9
	 * frame, so the bands a differently shaped viewport letterboxes still show the scene.
	 *
	 * Landscape is built from three layers: the sea (islands, moon, the other ship) under the deck
	 * (rail, rigging, lanterns, planking), which is transparent above the rail and between its
	 * balusters. The deck covers the viewport and stays put; the sea, drawn the same size, rises and
	 * settles slowly behind it, so the view over the rail swells like a ship under way.
	 * A bank of fog, the deck's size, lies over the deck along the rail and drifts against the sea's
	 * swell — down where the sea goes up — twice to each of the sea's swells.
	 *
	 * Portrait keeps its own tall still: the landscape layers cropped to cover a phone would lose the
	 * deck to the sides and blow the ship up past the frame.
	 *
	 * The art rides in as custom properties so the stylesheet's `url(var(--…))` paints the preload's
	 * resident copy (lib/preloadAssets.ts) — it is in memory before this mounts, so the reveal paints
	 * the scene rather than the flat colour. The bonus rooms bring their own backdrops over this one
	 * (BonusRound.svelte).
	 */
	import { staticCssUrl } from '../lib/staticUrl';

	let { portrait = false }: { portrait?: boolean } = $props();
</script>

{#if portrait}
	<div
		class="background"
		style="--art-backdrop:{staticCssUrl('img/background_base_portrait.webp')}"
	></div>
{:else}
	<div
		class="background"
		style="--art-sea:{staticCssUrl('img/background_layered_components/sea.webp')};--art-deck:{staticCssUrl('img/background_layered_components/deck.webp')};--art-fog:{staticCssUrl('img/background_layered_components/fog.webp')}"
	>
		<div class="sea"></div>
		<div class="deck"></div>
		<div class="fog"></div>
	</div>
{/if}

<style>
	/* z-index 0 keeps the whole block under the stage (1) and the panel (2). Every layer has the
	   deck along its foot, so a viewport shaped unlike the art crops the sides and keeps the
	   horizon and the moon. */
	.background {
		position: absolute;
		inset: 0;
		z-index: 0;
		isolation: isolate;
		overflow: hidden;
		pointer-events: none;
		background: var(--art-backdrop, none) no-repeat center / cover;
		background-color: #0b1420;
	}

	/* All three layers share one box and one sizing, so they line up with each other whatever
	   shape the viewport is. */
	.sea,
	.deck,
	.fog {
		position: absolute;
		inset: 0;
		background: var(--art-deck) no-repeat center / cover;
	}

	.sea {
		background-image: var(--art-sea);
		animation: sea-swell 10s ease-in-out infinite;
		will-change: transform;
	}

	.fog {
		background-image: var(--art-fog);
		animation: fog-drift 5s ease-in-out infinite;
		will-change: transform;
	}

	/* The sea is no bigger than the deck, so it only ever rises from where it rests: dropping
	   would open a strip of bare sky above the rail. Rising opens one at the foot instead, and the
	   deck is solid planking over its bottom fifth (the art's rows 850-1078), far deeper than this
	   2%. Long and eased at both ends, so it reads as a swell rather than a bounce. */
	@keyframes sea-swell {
		0%,
		100% {
			transform: translate3d(0, 0, 0);
		}
		50% {
			transform: translate3d(0, -2%, 0);
		}
	}

	/* Against the sea's swell, at twice its pace (5 s to the sea's 10 s): the fog sinks and lifts once
	   while the sea rises and once more while it settles. The fog art is clear above its row 497 and
	   below its row 972, so moving it 2% opens nothing at either edge. */
	@keyframes fog-drift {
		0%,
		100% {
			transform: translate3d(0, 0, 0);
		}
		50% {
			transform: translate3d(0, 2%, 0);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.sea,
		.fog {
			animation: none;
		}
	}
</style>
