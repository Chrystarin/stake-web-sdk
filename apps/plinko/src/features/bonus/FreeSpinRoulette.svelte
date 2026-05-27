<script lang="ts">
	import { onMount } from 'svelte';

	import { FREE_SPIN_SEGMENTS } from '../../game-logic/constants';
	import { staticUrl } from '../../lib/staticUrl';

	export type FreeSpinRouletteResult = {
		segmentIndex: number;
		segmentLabel: string;
	};

	type Props = {
		targetSegmentIndex?: number;
		/** When true, wheel must land on `targetSegmentIndex` (RGS/math book). */
		serverAuthoritative?: boolean;
		onFinished?: (result: FreeSpinRouletteResult) => void;
	};

	const props: Props = $props();

	let overlayVisible = $state(false);
	let wheelVisible = $state(false);
	let markerVisible = $state(false);
	let wheelSpinClass = $state(false);
	let wheelRotationDeg = $state(0);
	let wheelEl = $state<HTMLImageElement | undefined>(undefined);
	const timers: ReturnType<typeof setTimeout>[] = [];

	onMount(() => {
		requestAnimationFrame(() => (overlayVisible = true));
		timers.push(
			setTimeout(() => {
				wheelVisible = true;
				markerVisible = true;
			}, 120),
		);
		timers.push(setTimeout(() => startSpin(), 520));
		return () => timers.forEach(clearTimeout);
	});

	function startSpin() {
		const winner =
			props.targetSegmentIndex != null && props.targetSegmentIndex >= 0
				? props.targetSegmentIndex % FREE_SPIN_SEGMENTS.length
				: props.serverAuthoritative
					? 0
					: Math.floor(Math.random() * FREE_SPIN_SEGMENTS.length);
		const extraRounds = 5 + Math.floor(Math.random() * 3);
		const targetDeg = wheelRotationDeg + extraRounds * 360 - winner * 45;
		let settled = false;
		const settle = () => {
			if (settled) return;
			settled = true;
			afterSpin(winner);
		};
		requestAnimationFrame(() => {
			wheelSpinClass = true;
			wheelRotationDeg = targetDeg;
		});
		const el = wheelEl;
		if (el) {
			const onEnd = (e: TransitionEvent) => {
				if (e.propertyName !== 'transform') return;
				el.removeEventListener('transitionend', onEnd);
				settle();
			};
			el.addEventListener('transitionend', onEnd);
			timers.push(setTimeout(settle, 5200));
		} else {
			timers.push(setTimeout(settle, 4200));
		}
	}

	function afterSpin(winner: number) {
		wheelSpinClass = false;
		const label = FREE_SPIN_SEGMENTS[winner];
		timers.push(
			setTimeout(() => {
				overlayVisible = false;
				timers.push(
					setTimeout(() => {
						props.onFinished?.({ segmentIndex: winner, segmentLabel: label });
					}, 280),
				);
			}, 800),
		);
	}
</script>

<div
	class="free-spin-overlay"
	class:free-spin-overlay--visible={overlayVisible}
	class:free-spin-overlay--exit={!overlayVisible}
	role="dialog"
	aria-modal="true"
	aria-label="Free spin wheel"
>
	<div class="free-spin-content">
		<img class="free-spin-label" src={staticUrl('img/free-spin-label.png')} alt="Free spin" />
		<div class="free-spin-wheel-block">
			<img
				class="free-spin-marker"
				class:free-spin-marker--visible={markerVisible}
				src={staticUrl('img/free-spin-roulette-marker.png')}
				alt=""
			/>
			<img
				bind:this={wheelEl}
				class="free-spin-wheel"
				class:free-spin-wheel--animating={wheelSpinClass}
				class:free-spin-wheel--visible={wheelVisible}
				style:--wheel-rotation-deg="{wheelRotationDeg}deg"
				src={staticUrl('img/free-spin-roulette-wheel.png')}
				alt=""
			/>
			<img class="free-spin-center-base" src={staticUrl('img/free-spin-roulette-base.png')} alt="" />
		</div>
	</div>
</div>

<style>
	.free-spin-overlay {
		position: absolute;
		inset: 0;
		z-index: 12000;
		display: flex;
		overflow: hidden;
		background: rgba(3, 8, 18, 0.72);
		opacity: 0;
		transition: opacity 0.28s ease;
		pointer-events: auto;
	}
	.free-spin-overlay--visible {
		opacity: 1;
	}
	.free-spin-overlay--exit {
		opacity: 0;
	}
	.free-spin-content {
		position: relative;
		z-index: 1;
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		min-height: 100%;
		padding: clamp(0.5rem, 3vh, 2rem) clamp(0.75rem, 4vw, 2rem);
	}
	.free-spin-label {
		width: min(82vw, 760px);
		margin-bottom: clamp(0.3rem, 2vh, 1.2rem);
		filter: drop-shadow(0 0 16px rgba(255, 215, 96, 0.25));
	}
	.free-spin-wheel-block {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 100%;
	}
	.free-spin-marker {
		--marker-y-offset: calc(-1 * min(40vw, min(34vh, 310px)));
		position: absolute;
		left: 50%;
		top: 50%;
		transform: translate(-50%, -50%) translateY(-150vh);
		width: min(4vw, 48px);
		z-index: 2;
		opacity: 0;
		transition:
			transform 0.68s cubic-bezier(0.22, 1, 0.36, 1),
			opacity 0.34s ease;
	}
	.free-spin-marker--visible {
		transform: translate(-50%, -50%) translateY(var(--marker-y-offset));
		opacity: 1;
	}
	.free-spin-wheel {
		width: min(80vw, min(68vh, 620px));
		height: min(80vw, min(68vh, 620px));
		transform-origin: 50% 50%;
		--wheel-rotation-deg: 0deg;
		transform: translateY(125vh) rotate(var(--wheel-rotation-deg));
		opacity: 0;
	}
	.free-spin-wheel--visible {
		transform: translateY(0) rotate(var(--wheel-rotation-deg));
		opacity: 1;
		transition:
			transform 0.68s cubic-bezier(0.22, 1, 0.36, 1),
			opacity 0.34s ease;
	}
	.free-spin-wheel--animating {
		transition: transform 4.1s cubic-bezier(0.12, 0.72, 0.12, 1);
	}
	.free-spin-center-base {
		position: absolute;
		left: 50%;
		top: 50%;
		width: min(36vw, min(30vh, 300px));
		transform: translate(-50%, -50%);
		z-index: 3;
		pointer-events: none;
	}
</style>
