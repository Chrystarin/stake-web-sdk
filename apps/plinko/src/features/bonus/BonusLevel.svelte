<script lang="ts">
	import { BONUS_LEVEL_LABELS } from '../../game-logic/constants';
	import { staticUrl } from '../../lib/staticUrl';

	const asset = (path: string) => `url(${staticUrl(path)})`;

	type Props = {
		activeLevels?: number;
		pendingLevelHighlight?: number;
		levelLabels?: Array<number | string>;
	};

	const props: Props = $props();

	const displayLevelLabels = $derived(
		(props.levelLabels ?? BONUS_LEVEL_LABELS).slice(0, 9).map((v) => String(v)),
	);
</script>

<div
	class="bonus-level-track"
	style:--bonus-level-base={asset('img/bonus-level-base.png')}
	style:--bl-1={asset('img/bonus-bar-level-1.png')}
	style:--bl-2={asset('img/bonus-bar-level-2.png')}
	style:--bl-3={asset('img/bonus-bar-level-3.png')}
	style:--bl-4={asset('img/bonus-bar-level-4.png')}
	style:--bl-5={asset('img/bonus-bar-level-5.png')}
	style:--bl-6={asset('img/bonus-bar-level-6.png')}
	style:--bl-7={asset('img/bonus-bar-level-7.png')}
	style:--bl-8={asset('img/bonus-bar-level-8.png')}
	style:--bl-9={asset('img/bonus-bar-level-9.png')}
	style:--bla-1={asset('img/bonus-bar-level-active-1.png')}
	style:--bla-2={asset('img/bonus-bar-level-active-2.png')}
	style:--bla-3={asset('img/bonus-bar-level-active-3.png')}
	style:--bla-4={asset('img/bonus-bar-level-active-4.png')}
	style:--bla-5={asset('img/bonus-bar-level-active-5.png')}
	style:--bla-6={asset('img/bonus-bar-level-active-6.png')}
	style:--bla-7={asset('img/bonus-bar-level-active-7.png')}
	style:--bla-8={asset('img/bonus-bar-level-active-8.png')}
	style:--bla-9={asset('img/bonus-bar-level-active-9.png')}
>
	{#each displayLevelLabels as label, idx}
		<div
			class="bonus-level-node"
			class:bonus-level-node--active={idx < (props.activeLevels ?? 0)}
			class:bonus-level-node--pending={(idx + 1) === (props.pendingLevelHighlight ?? 0) &&
				idx >= (props.activeLevels ?? 0)}
			aria-label="Bonus level {label}"
		></div>
	{/each}
</div>

<style>
	.bonus-level-track {
		position: absolute;
		inset: 0;
		pointer-events: none;
		height: 12vw;
		width: 28.5vw;
		box-sizing: border-box;
		--bonus-level-bar-scale: 0.055vw;
	}
	.bonus-level-track::after {
		content: '';
		position: absolute;
		inset: 0;
		pointer-events: none;
		background: var(--bonus-level-base) center / contain no-repeat;
		z-index: 2;
	}
	.bonus-level-node {
		position: absolute;
		width: calc(var(--bonus-level-node-width, 70) * var(--bonus-level-bar-scale));
		height: calc(var(--bonus-level-node-height, 62) * var(--bonus-level-bar-scale));
		transform: translate(-50%, -50%);
		background-position: center;
		background-repeat: no-repeat;
		background-size: contain;
		background-image: var(--bonus-level-node-image);
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
		top: 8.25vw;
		--bonus-level-node-width: 100;
		--bonus-level-node-height: 61;
		--bonus-level-node-image: var(--bl-1);
	}
	.bonus-level-node:nth-child(2) {
		left: 21%;
		top: 6.5vw;
		--bonus-level-node-width: 73;
		--bonus-level-node-height: 72;
		--bonus-level-node-image: var(--bl-2);
	}
	.bonus-level-node:nth-child(3) {
		left: 28.5%;
		top: 4.25vw;
		--bonus-level-node-width: 74;
		--bonus-level-node-height: 71;
		--bonus-level-node-image: var(--bl-3);
	}
	.bonus-level-node:nth-child(4) {
		left: 37.5%;
		top: 2.8vw;
		--bonus-level-node-width: 70;
		--bonus-level-node-height: 62;
		--bonus-level-node-image: var(--bl-4);
	}
	.bonus-level-node:nth-child(5) {
		left: 49%;
		top: 2.5vw;
		--bonus-level-node-width: 68;
		--bonus-level-node-height: 50;
		--bonus-level-node-image: var(--bl-5);
	}
	.bonus-level-node:nth-child(6) {
		left: 61%;
		top: 3vw;
		--bonus-level-node-width: 72;
		--bonus-level-node-height: 63;
		--bonus-level-node-image: var(--bl-6);
	}
	.bonus-level-node:nth-child(7) {
		left: 70.5%;
		top: 4.5vw;
		--bonus-level-node-width: 71;
		--bonus-level-node-height: 66;
		--bonus-level-node-image: var(--bl-7);
	}
	.bonus-level-node:nth-child(8) {
		left: 78%;
		top: 6.5vw;
		--bonus-level-node-width: 75;
		--bonus-level-node-height: 75;
		--bonus-level-node-image: var(--bl-8);
	}
	.bonus-level-node:nth-child(9) {
		left: 89%;
		top: 8.3vw;
		--bonus-level-node-width: 100;
		--bonus-level-node-height: 62;
		--bonus-level-node-image: var(--bl-9);
	}
	.bonus-level-node:nth-child(1).bonus-level-node--active {
		background-image: var(--bla-1);
	}
	.bonus-level-node:nth-child(2).bonus-level-node--active {
		background-image: var(--bla-2);
	}
	.bonus-level-node:nth-child(3).bonus-level-node--active {
		background-image: var(--bla-3);
	}
	.bonus-level-node:nth-child(4).bonus-level-node--active {
		background-image: var(--bla-4);
	}
	.bonus-level-node:nth-child(5).bonus-level-node--active {
		background-image: var(--bla-5);
	}
	.bonus-level-node:nth-child(6).bonus-level-node--active {
		background-image: var(--bla-6);
	}
	.bonus-level-node:nth-child(7).bonus-level-node--active {
		background-image: var(--bla-7);
	}
	.bonus-level-node:nth-child(8).bonus-level-node--active {
		background-image: var(--bla-8);
	}
	.bonus-level-node:nth-child(9).bonus-level-node--active {
		background-image: var(--bla-9);
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
