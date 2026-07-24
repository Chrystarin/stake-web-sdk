<script lang="ts">
	import { BONUS_LEVEL_LABELS } from '../../game-logic/constants';
	import { staticUrl } from '../../lib/staticUrl';

	type Props = {
		activeLevels?: number;
		pendingLevelHighlight?: number;
		levelLabels?: Array<number | string>;
	};

	const props: Props = $props();

	const displayLevelLabels = $derived(
		(props.levelLabels ?? BONUS_LEVEL_LABELS).slice(0, 9).map((v) => String(v)),
	);

const LEVEL_BAR_URLS = Array.from({ length: 9 }, (_, i) => staticUrl(`img/bonus-bar-level-${i + 1}.png`));
const ACTIVE_LEVEL_BAR_URLS = Array.from(
	{ length: 9 },
	(_, i) => staticUrl(`img/bonus-bar-level-active-${i + 1}.png`),
);
</script>

<div class="bonus-level-track">
	{#each displayLevelLabels as label, idx}
		<div
			class="bonus-level-node"
			class:bonus-level-node--pending={(idx + 1) === (props.pendingLevelHighlight ?? 0) &&
				idx >= (props.activeLevels ?? 0)}
			style:--bonus-level-node-image={`url(${idx < (props.activeLevels ?? 0) ? ACTIVE_LEVEL_BAR_URLS[idx] : LEVEL_BAR_URLS[idx]})`}
			style:background-image={`url(${idx < (props.activeLevels ?? 0) ? ACTIVE_LEVEL_BAR_URLS[idx] : LEVEL_BAR_URLS[idx]})`}
			aria-label="Bonus level {label}"
		></div>
	{/each}
	<img
		class="bonus-level-base-bg"
		src={staticUrl('img/bonus-level-base-background.png')}
		alt=""
		aria-hidden="true"
	/>
	<img class="bonus-level-base" src={staticUrl('img/bonus-level-base.png')} alt="" aria-hidden="true" />
</div>

<style>
	.bonus-level-track {
		position: absolute;
		inset: 0;
		pointer-events: none;
		width: var(--bonus-level-track-width, 100%);
		height: var(--bonus-level-track-height, 100%);
		box-sizing: border-box;
		--bonus-level-bar-scale: calc(var(--bonus-level-track-width, 100%) * 0.00193);

		/* =====================================================================
		   MANUAL TUNING KNOBS — change just these numbers to taste.
		   ===================================================================== */

		/* Size of the number bars → controls the GAP between them.
		     2.5  = bars touch (no gap)
		     2.3  = small, even gap (current)
		     lower = smaller bars / bigger gaps
		   Applies to BOTH desktop and mobile. */
		--bonus-level-node-size-ratio: 2.15;

		/* Brown backdrop (bonus-level-base-background.png) fine-tuning, so you can
		   nudge/resize it to line up exactly with the gold frame:
		     --bonus-level-bg-scale     1   = same box as the frame; >1 bigger, <1 smaller
		     --bonus-level-bg-offset-x  0%  = move right (+) / left (-), as % of track width
		     --bonus-level-bg-offset-y  0%  = move down  (+) / up   (-), as % of track height */
		--bonus-level-bg-scale: 0.97;
		--bonus-level-bg-offset-x: 0%;
		--bonus-level-bg-offset-y: 2.5%;

		/* Gold arch frame (bonus-level-base.png) scale / nudge — same idea as the backdrop:
		     --bonus-level-base-scale     1   = default size; >1 bigger, <1 smaller
		     --bonus-level-base-offset-x  0%  = move right (+) / left (-), as % of track width
		     --bonus-level-base-offset-y  0%  = move down  (+) / up   (-), as % of track height
		   ⚠️ Scaling/moving the frame does NOT move the number tiles (they are positioned to the
		   track box, not to the frame). Large changes will desync the tiles from the arch —
		   re-tune the per-tile positions below to match. */
		--bonus-level-base-scale: 0.98;
		--bonus-level-base-offset-x: 0%;
		--bonus-level-base-offset-y: 0%;
	}
	.bonus-level-base {
		position: absolute;
		inset: 0;
		pointer-events: none;
		width: 100%;
		height: 100%;
		object-fit: contain;
		transform: translate(
				var(--bonus-level-base-offset-x, 0%),
				var(--bonus-level-base-offset-y, 0%)
			)
			scale(var(--bonus-level-base-scale, 1));
		transform-origin: center;
		z-index: 2;
	}
	/* Filled backdrop that sits beneath the gold-arch frame AND the number bars — same box,
	   size and position as .bonus-level-base, just painted behind everything (z-index 0). */
	.bonus-level-base-bg {
		position: absolute;
		inset: 0;
		pointer-events: none;
		width: 100%;
		height: 100%;
		object-fit: contain;
		transform: translate(
				var(--bonus-level-bg-offset-x, 0%),
				var(--bonus-level-bg-offset-y, 0%)
			)
			scale(var(--bonus-level-bg-scale, 1));
		transform-origin: center;
		z-index: 0;
	}
	.bonus-level-node {
		position: absolute;
		width: calc(
			var(--bonus-level-node-width, 70) *
			var(--bonus-level-bar-scale) *
			var(--bonus-level-node-size-ratio, 1)
		);
		height: calc(
			var(--bonus-level-node-height, 62) *
			var(--bonus-level-bar-scale) *
			var(--bonus-level-node-size-ratio, 1)
		);
		/* rotate() spins the tile around its own centre. Set --bonus-level-node-rot
		   per tile below (e.g. 8deg = clockwise, -8deg = counter-clockwise). */
		transform: translate(-50%, -50%) rotate(var(--bonus-level-node-rot, 0deg));
		background-position: center;
		background-repeat: no-repeat;
		background-size: contain;
		z-index: 1;
	}
	.bonus-level-node--pending {
		isolation: isolate;
		filter: drop-shadow(0 0 0.2vw rgba(255, 232, 92, 0.95))
			drop-shadow(0 0 0.48vw rgba(255, 189, 58, 0.8));
	}
	.bonus-level-node--pending::after {
		content: '';
		position: absolute;
		inset: 0;
		background-color: rgba(255, 222, 59, 0.85);
		-webkit-mask-image: var(--bonus-level-node-image);
		-webkit-mask-position: center;
		-webkit-mask-repeat: no-repeat;
		-webkit-mask-size: contain;
		mask-image: var(--bonus-level-node-image);
		mask-position: center;
		mask-repeat: no-repeat;
		mask-size: contain;
		opacity: 0.24;
		animation: bonus-level-node-pending-tint-blink 1.35s cubic-bezier(0.42, 0, 0.58, 1) infinite
			alternate;
	}
	/* =====================================================================
	   PER-TILE POSITION & SHAPE — one block per number tile (1 → 256).
	   Adjust these to move/resize an individual tile:
	     left  = horizontal position, % across the track width (0 = far left, 100 = far right)
	     top   = vertical position, as a FRACTION of track height (0 = top, 1 = bottom)
	     --bonus-level-node-width / -height = that tile's relative box (its native px size;
	        scaled globally by --bonus-level-node-size-ratio above — change these two only to
	        tweak ONE tile's size/aspect relative to the others).
	     --bonus-level-node-rot = rotate that one tile around its centre, e.g. 8deg / -8deg
	        (defaults to 0deg — add this line to any tile block below to angle it).
	   ===================================================================== */
	.bonus-level-node:nth-child(1) {
		left: 11%;
		top: calc(var(--bonus-level-track-height, 100%) * 0.705);
		--bonus-level-node-width: 100;
		--bonus-level-node-height: 61;
	}
	.bonus-level-node:nth-child(2) {
		left: 21%;
		top: calc(var(--bonus-level-track-height, 100%) * 0.541667);
		--bonus-level-node-width: 100;
		--bonus-level-node-height: 72;
	}
	.bonus-level-node:nth-child(3) {
		left: 28.25%;
		top: calc(var(--bonus-level-track-height, 100%) * 0.354167);
		--bonus-level-node-width: 100;
		--bonus-level-node-height: 71;
	}
	.bonus-level-node:nth-child(4) {
		left: 37.5%;
		top: calc(var(--bonus-level-track-height, 100%) * 0.233333);
		--bonus-level-node-width: 100;
		--bonus-level-node-height: 62;
	}
	.bonus-level-node:nth-child(5) {
		left: 49%;
		top: calc(var(--bonus-level-track-height, 100%) * 0.19);
		--bonus-level-node-width: 100;
		--bonus-level-node-height: 50;
	}
	.bonus-level-node:nth-child(6) {
		left: 60.75%;
		top: calc(var(--bonus-level-track-height, 100%) * 0.24);
		--bonus-level-node-width: 100;
		--bonus-level-node-height: 63;
	}
	.bonus-level-node:nth-child(7) {
		left: 70.5%;
		top: calc(var(--bonus-level-track-height, 100%) * 0.37);
		--bonus-level-node-width: 100;
		--bonus-level-node-height: 66;
	}
	.bonus-level-node:nth-child(8) {
		left: 77.35%;
		top: calc(var(--bonus-level-track-height, 100%) * 0.55);
		--bonus-level-node-width: 100;
		--bonus-level-node-height: 68.95;
	}
	.bonus-level-node:nth-child(9) {
		left: 88%;
		top: calc(var(--bonus-level-track-height, 100%) * 0.7);
		--bonus-level-node-width: 100;
		--bonus-level-node-height: 62;
	}
	@keyframes bonus-level-node-pending-tint-blink {
		0% {
			opacity: 0.24;
		}
		100% {
			opacity: 0.78;
		}
	}
</style>
