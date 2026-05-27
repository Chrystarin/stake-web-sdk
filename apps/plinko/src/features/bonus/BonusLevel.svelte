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
	}
	.bonus-level-base {
		position: absolute;
		inset: 0;
		pointer-events: none;
		width: 100%;
		height: 100%;
		object-fit: contain;
		z-index: 2;
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
		transform: translate(-50%, -50%);
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
	.bonus-level-node:nth-child(1) {
		left: 11%;
		top: calc(var(--bonus-level-track-height, 100%) * 0.6875);
		--bonus-level-node-width: 100;
		--bonus-level-node-height: 61;
	}
	.bonus-level-node:nth-child(2) {
		left: 21%;
		top: calc(var(--bonus-level-track-height, 100%) * 0.541667);
		--bonus-level-node-width: 73;
		--bonus-level-node-height: 72;
	}
	.bonus-level-node:nth-child(3) {
		left: 28.5%;
		top: calc(var(--bonus-level-track-height, 100%) * 0.354167);
		--bonus-level-node-width: 74;
		--bonus-level-node-height: 71;
	}
	.bonus-level-node:nth-child(4) {
		left: 37.5%;
		top: calc(var(--bonus-level-track-height, 100%) * 0.233333);
		--bonus-level-node-width: 70;
		--bonus-level-node-height: 62;
	}
	.bonus-level-node:nth-child(5) {
		left: 49%;
		top: calc(var(--bonus-level-track-height, 100%) * 0.208333);
		--bonus-level-node-width: 68;
		--bonus-level-node-height: 50;
	}
	.bonus-level-node:nth-child(6) {
		left: 61%;
		top: calc(var(--bonus-level-track-height, 100%) * 0.25);
		--bonus-level-node-width: 72;
		--bonus-level-node-height: 63;
	}
	.bonus-level-node:nth-child(7) {
		left: 70.5%;
		top: calc(var(--bonus-level-track-height, 100%) * 0.375);
		--bonus-level-node-width: 71;
		--bonus-level-node-height: 66;
	}
	.bonus-level-node:nth-child(8) {
		left: 78%;
		top: calc(var(--bonus-level-track-height, 100%) * 0.541667);
		--bonus-level-node-width: 75;
		--bonus-level-node-height: 75;
	}
	.bonus-level-node:nth-child(9) {
		left: 89%;
		top: calc(var(--bonus-level-track-height, 100%) * 0.691667);
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
