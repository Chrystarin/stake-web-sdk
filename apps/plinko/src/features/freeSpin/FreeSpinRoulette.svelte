<script lang="ts">
	import { onMount } from 'svelte';

	import { FREE_SPIN_SEGMENTS } from '../../game-logic/constants';
	import { assertAuthoritativeOutcome } from '../../game/plinkoFairnessGuard';
	import { isPortraitGameLayout } from '../../lib/format';
	import { staticUrl } from '../../lib/staticUrl';

	export type FreeSpinRouletteResult = {
		segmentIndex: number;
		segmentLabel: string;
	};

	type Props = {
		targetSegmentIndex?: number;
		/** When true, wheel must land on `targetSegmentIndex` (RGS/math book). */
		serverAuthoritative?: boolean;
		/** Fires the moment the wheel STOPS on its segment (before the exit fade) — used to reveal the
		 * win in the HUD in sync with seeing the multiplier. */
		onLanded?: (result: FreeSpinRouletteResult) => void;
		onFinished?: (result: FreeSpinRouletteResult) => void;
	};

	const props: Props = $props();

	/** Shared wheel diameter from viewport; label/base/marker derive from this. */
	const ROULETTE_SIZE_VW = 0.72;
	const LABEL_HEIGHT_TO_WIDTH = 462 / 1925;
	const BASE_TO_WHEEL = 624 / 1348;
	const MARKER_WIDTH_TO_WHEEL = (151 / 1348) * 0.65;
	const MARKER_HEIGHT_TO_WHEEL = (435 / 1348) * 0.65;

	// ─── Tuning knobs: independently scale & reposition the three roulette pieces ───────────────────
	// EDIT THESE to move/resize the free-spin roulette. Values are split by orientation: `landscape` is
	// used on desktop/wide layouts, `portrait` on mobile/tall layouts (chosen by `portrait` below).
	//   scale:    1 = base size (what the layout computes); >1 = larger, <1 = smaller.
	//   offsetX:  horizontal shift as a fraction of the wheel diameter (positive = right).
	//   offsetY:  vertical shift as a fraction of the wheel diameter (positive = down).
	// The wheel's center base scales/moves with the wheel. The marker stays pinned to the (scaled) wheel
	// rim by default, so its offsets only fine-tune from there.
	// Note: pieces are clipped at the screen edges (the overlay hides overflow), so very large scales
	// will crop — lower the scale or nudge with the offsets.
	const FREE_SPIN_ROULETTE_TUNING = {
		landscape: {
			label: { scale: 2, offsetX: 0, offsetY: -0.05 },
			wheel: { scale: 1.65, offsetX: 0, offsetY: 0.4 },
			marker: { scale: 2.3, offsetX: 0, offsetY: 0.4 },
		},
		portrait: {
			label: { scale: 2, offsetX: 0, offsetY: 0.2 },
			wheel: { scale: 1.35, offsetX: 0, offsetY: 0.2 },
			marker: { scale: 2, offsetX: 0, offsetY: 0.2 },
		},
	};

	// ⚠️ DEBUG ONLY — extra delay (ms) before the wheel starts spinning, so the assembled layout can be
	// inspected first. Set back to `0` before shipping. Added on top of the normal pre-spin delay.
	const DEBUG_SPIN_DELAY_MS = 0;

	const portrait = isPortraitGameLayout();
	// Resolve the orientation-specific tuning knobs (see FREE_SPIN_ROULETTE_TUNING above).
	const tuning = portrait ? FREE_SPIN_ROULETTE_TUNING.portrait : FREE_SPIN_ROULETTE_TUNING.landscape;
	const LABEL_SCALE = tuning.label.scale;
	const LABEL_OFFSET_X = tuning.label.offsetX;
	const LABEL_OFFSET_Y = tuning.label.offsetY;
	const WHEEL_SCALE = tuning.wheel.scale;
	const WHEEL_OFFSET_X = tuning.wheel.offsetX;
	const WHEEL_OFFSET_Y = tuning.wheel.offsetY;
	const MARKER_SCALE = tuning.marker.scale;
	const MARKER_OFFSET_X = tuning.marker.offsetX;
	const MARKER_OFFSET_Y = tuning.marker.offsetY;

	let overlayVisible = $state(false);
	let wheelVisible = $state(false);
	let markerVisible = $state(false);
	let wheelSpinClass = $state(false);
	let wheelRotationDeg = $state(0);
	// Center base counter-rotates with the wheel (opposite direction, whole turns) so it lands back on its
	// original orientation exactly when the wheel stops.
	let baseRotationDeg = $state(0);
	let wheelEl = $state<HTMLImageElement | undefined>(undefined);
	let stageEl = $state<HTMLDivElement | undefined>(undefined);
	let rouletteSizePx = $state(0);
	const timers: ReturnType<typeof setTimeout>[] = [];

	function updateRouletteLayout() {
		const stage = stageEl;
		if (!stage) return;
		const rect = stage.getBoundingClientRect();
		if (rect.width <= 0 || rect.height <= 0) return;
		const labelGapPx = Math.min(Math.max(window.innerWidth * 0.015, 4), 16);
		const vwCap = window.innerWidth * ROULETTE_SIZE_VW;
		const maxWidth = Math.min(vwCap, rect.width);
		const fromHeight = Math.max(0, rect.height - labelGapPx) / (1 + LABEL_HEIGHT_TO_WIDTH);
		rouletteSizePx = Math.max(0, Math.floor(Math.min(maxWidth, fromHeight)));
	}

	onMount(() => {
		requestAnimationFrame(() => (overlayVisible = true));
		timers.push(
			setTimeout(() => {
				wheelVisible = true;
				markerVisible = true;
			}, 120),
		);
		timers.push(setTimeout(() => startSpin(), 520 + DEBUG_SPIN_DELAY_MS));
		return () => timers.forEach(clearTimeout);
	});

	$effect(() => {
		const stage = stageEl;
		if (!stage) return;
		const observer = new ResizeObserver(() => updateRouletteLayout());
		observer.observe(stage);
		const onResize = () => updateRouletteLayout();
		window.addEventListener('resize', onResize);
		updateRouletteLayout();
		return () => {
			observer.disconnect();
			window.removeEventListener('resize', onResize);
		};
	});

	const labelWidthPx = $derived(rouletteSizePx > 0 ? `${rouletteSizePx}px` : undefined);
	const stackSizePx = $derived(rouletteSizePx > 0 ? `${rouletteSizePx}px` : undefined);
	const baseWidthPx = $derived(
		rouletteSizePx > 0 ? `${Math.round(rouletteSizePx * BASE_TO_WHEEL)}px` : undefined,
	);
	const markerWidthPx = $derived(
		rouletteSizePx > 0 ? `${Math.round(rouletteSizePx * MARKER_WIDTH_TO_WHEEL)}px` : undefined,
	);
	const markerHeightPx = $derived(
		rouletteSizePx > 0 ? `${Math.round(rouletteSizePx * MARKER_HEIGHT_TO_WHEEL)}px` : undefined,
	);
	// Marker sits at the wheel rim; tracking WHEEL_SCALE keeps it on the (scaled) rim by default.
	const markerYOffsetPx = $derived(
		rouletteSizePx > 0 ? `-${Math.round(rouletteSizePx * 0.5 * WHEEL_SCALE)}px` : undefined,
	);

	// Tuning offsets, resolved to px from the wheel diameter (positive X → right, positive Y → down).
	const labelOffsetXPx = $derived(`${Math.round(rouletteSizePx * LABEL_OFFSET_X)}px`);
	const labelOffsetYPx = $derived(`${Math.round(rouletteSizePx * LABEL_OFFSET_Y)}px`);
	const wheelOffsetXPx = $derived(`${Math.round(rouletteSizePx * WHEEL_OFFSET_X)}px`);
	const wheelOffsetYPx = $derived(`${Math.round(rouletteSizePx * WHEEL_OFFSET_Y)}px`);
	const markerOffsetXPx = $derived(`${Math.round(rouletteSizePx * MARKER_OFFSET_X)}px`);
	const markerOffsetYPx = $derived(`${Math.round(rouletteSizePx * MARKER_OFFSET_Y)}px`);
	// Multiplier labels are drawn dynamically (the wheel art is label-less) so they ALWAYS match
	// `FREE_SPIN_SEGMENTS` — segment `i` sits at `i*45°` from the top marker, the same angle the
	// spin lands on (`-winner*45`), so the value under the marker is exactly the math result.
	const labelRadiusPx = $derived(
		rouletteSizePx > 0 ? `${Math.round(rouletteSizePx * 0.315)}px` : '0px',
	);
	const labelFontPx = $derived(
		rouletteSizePx > 0 ? `${Math.round(rouletteSizePx * 0.072)}px` : '0px',
	);

	function startSpin() {
		// Provably-fair guard: a live spin must land on the book's `targetSegmentIndex`. Falling back to
		// segment 0 / a client-random segment live would break fairness, so surface it (throws in DEV).
		if (!(props.targetSegmentIndex != null && props.targetSegmentIndex >= 0)) {
			assertAuthoritativeOutcome('FreeSpinRoulette spin without authoritative targetSegmentIndex', {
				targetSegmentIndex: props.targetSegmentIndex,
				serverAuthoritative: props.serverAuthoritative,
			});
		}
		const winner =
			props.targetSegmentIndex != null && props.targetSegmentIndex >= 0
				? props.targetSegmentIndex % FREE_SPIN_SEGMENTS.length
				: props.serverAuthoritative
					? 0
					: Math.floor(Math.random() * FREE_SPIN_SEGMENTS.length);
		const extraRounds = 5 + Math.floor(Math.random() * 3);
		const targetDeg = wheelRotationDeg + extraRounds * 360 - winner * 45;
		// Base counter-rotates: opposite direction, a whole number of turns (so it lands back on its original
		// orientation) at the same speed/duration as the wheel — same `extraRounds` over the same transition.
		const baseTargetDeg = baseRotationDeg - extraRounds * 360;
		let settled = false;
		const settle = () => {
			if (settled) return;
			settled = true;
			afterSpin(winner);
		};
		requestAnimationFrame(() => {
			wheelSpinClass = true;
			wheelRotationDeg = targetDeg;
			baseRotationDeg = baseTargetDeg;
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
		// Reveal the win NOW that the wheel has stopped on its segment (before the exit fade), so the Win
		// field updates in sync with the visible multiplier rather than only on overlay close.
		props.onLanded?.({ segmentIndex: winner, segmentLabel: label });
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
		<div class="free-spin-stage" bind:this={stageEl}>
			<img
				class="free-spin-label"
				style:width={labelWidthPx}
				style:--label-scale={LABEL_SCALE}
				style:--label-offset-x={labelOffsetXPx}
				style:--label-offset-y={labelOffsetYPx}
				src={staticUrl('img/free-spin-label.png')}
				alt="Free spin"
			/>
			<div class="free-spin-wheel-stack" style:width={stackSizePx} style:height={stackSizePx}>
				<img
					class="free-spin-marker"
					class:free-spin-marker--visible={markerVisible}
					style:width={markerWidthPx}
					style:height={markerHeightPx}
					style:--marker-y-offset={markerYOffsetPx}
					style:--marker-scale={MARKER_SCALE}
					style:--marker-offset-x={markerOffsetXPx}
					style:--marker-offset-y={markerOffsetYPx}
					src={staticUrl('img/free-spin-roulette-marker.png')}
					alt=""
				/>
				<img
					bind:this={wheelEl}
					class="free-spin-wheel"
					class:free-spin-wheel--animating={wheelSpinClass}
					class:free-spin-wheel--visible={wheelVisible}
					style:--wheel-rotation-deg="{wheelRotationDeg}deg"
					style:--wheel-scale={WHEEL_SCALE}
					style:--wheel-offset-x={wheelOffsetXPx}
					style:--wheel-offset-y={wheelOffsetYPx}
					src={staticUrl('img/free-spin-roulette-wheel.png')}
					alt=""
				/>
				<img
					class="free-spin-center-base"
					class:free-spin-center-base--animating={wheelSpinClass}
					style:width={baseWidthPx}
					style:--base-rotation-deg="{baseRotationDeg}deg"
					style:--wheel-scale={WHEEL_SCALE}
					style:--wheel-offset-x={wheelOffsetXPx}
					style:--wheel-offset-y={wheelOffsetYPx}
					src={staticUrl('img/free-spin-roulette-base.png')}
					alt=""
				/>
			</div>
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
		justify-content: flex-start;
		height: 100%;
		min-height: 0;
		box-sizing: border-box;
		overflow: hidden;
		padding: clamp(0.5rem, 2vw, 1.5rem) clamp(0.75rem, 4vw, 2rem) clamp(0.5rem, 2vw, 1.5rem);
	}
	.free-spin-stage {
		flex: 1;
		min-height: 0;
		width: 100%;
		display: grid;
		grid-template-rows: auto minmax(0, 1fr);
		justify-items: center;
	}
	.free-spin-label {
		position: relative;
		/* Above the wheel-stack's marker (z 2) and center-base (z 3) so the label always paints over the
		   marker's tail when it pokes up past the rim. */
		z-index: 4;
		width: min(72vw, 100%);
		max-width: 100%;
		height: auto;
		flex-shrink: 0;
		object-fit: contain;
		margin-bottom: clamp(0.25rem, 1.5vw, 1rem);
		filter: drop-shadow(0 0 16px rgba(255, 215, 96, 0.25));
		transform-origin: 50% 0%;
		transform: translate(var(--label-offset-x, 0px), var(--label-offset-y, 0px))
			scale(var(--label-scale, 1));
	}
	.free-spin-wheel-stack {
		position: relative;
		width: min(72vw, 100%);
		height: min(72vw, 100%);
		max-width: 100%;
		max-height: 100%;
		flex-shrink: 0;
		place-self: center;
	}
	.free-spin-marker {
		position: absolute;
		left: 50%;
		top: 50%;
		object-fit: contain;
		transform: translate(-50%, -50%) translateY(-150vh) scale(var(--marker-scale, 1));
		transform-origin: 50% 50%;
		z-index: 2;
		opacity: 0;
		pointer-events: none;
		transition:
			transform 0.68s cubic-bezier(0.22, 1, 0.36, 1),
			opacity 0.34s ease;
	}
	.free-spin-marker--visible {
		transform: translate(-50%, -50%)
			translate(
				var(--marker-offset-x, 0px),
				calc(var(--marker-y-offset, 0px) + var(--marker-offset-y, 0px))
			)
			scale(var(--marker-scale, 1));
		opacity: 1;
	}
	.free-spin-wheel {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: contain;
		transform-origin: 50% 50%;
		--wheel-rotation-deg: 0deg;
		transform: translateY(125vh) rotate(var(--wheel-rotation-deg)) scale(var(--wheel-scale, 1));
		opacity: 0;
	}
	.free-spin-wheel--visible {
		transform: translate(var(--wheel-offset-x, 0px), var(--wheel-offset-y, 0px))
			rotate(var(--wheel-rotation-deg)) scale(var(--wheel-scale, 1));
		opacity: 1;
		transition:
			transform 0.68s cubic-bezier(0.22, 1, 0.36, 1),
			opacity 0.34s ease;
	}
	.free-spin-wheel--animating {
		transition: transform 4.1s cubic-bezier(0.12, 0.72, 0.12, 1);
	}
	/* Multiplier labels overlay — rotates in lock-step with the wheel image (same rotation var +
	   transitions) so each value stays glued to its wedge. Drawn from FREE_SPIN_SEGMENTS, so the
	   value under the marker is always the math-authored segment. */
	.free-spin-wheel-labels {
		position: absolute;
		inset: 0;
		z-index: 2;
		pointer-events: none;
		transform-origin: 50% 50%;
		--wheel-rotation-deg: 0deg;
		transform: translateY(125vh) rotate(var(--wheel-rotation-deg));
		opacity: 0;
	}
	.free-spin-wheel-labels--visible {
		transform: translateY(0) rotate(var(--wheel-rotation-deg));
		opacity: 1;
		transition:
			transform 0.68s cubic-bezier(0.22, 1, 0.36, 1),
			opacity 0.34s ease;
	}
	.free-spin-wheel-labels--animating {
		transition: transform 4.1s cubic-bezier(0.12, 0.72, 0.12, 1);
	}
	.free-spin-wheel-label {
		position: absolute;
		left: 50%;
		top: 50%;
		transform: translate(-50%, -50%) rotate(var(--seg-angle, 0deg))
			translateY(calc(-1 * var(--label-radius, 0px)));
		transform-origin: 50% 50%;
		font-family: 'PotatoSans', sans-serif;
		font-weight: 800;
		font-size: var(--label-font-size, 16px);
		line-height: 1;
		color: #fff;
		white-space: nowrap;
		-webkit-text-stroke: 0.06em #3a1d05;
		paint-order: stroke fill;
		text-shadow: 0 0.04em 0.06em rgba(0, 0, 0, 0.55);
		user-select: none;
	}
	.free-spin-center-base {
		position: absolute;
		left: 50%;
		top: 50%;
		height: auto;
		object-fit: contain;
		transform-origin: 50% 50%;
		--base-rotation-deg: 0deg;
		transform: translate(-50%, -50%)
			translate(var(--wheel-offset-x, 0px), var(--wheel-offset-y, 0px))
			rotate(var(--base-rotation-deg))
			scale(var(--wheel-scale, 1));
		z-index: 3;
		pointer-events: none;
	}
	/* Matches the wheel's spin timing so the counter-rotating base stops at the same moment. */
	.free-spin-center-base--animating {
		transition: transform 4.1s cubic-bezier(0.12, 0.72, 0.12, 1);
	}
</style>
