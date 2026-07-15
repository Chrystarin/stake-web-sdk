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

	/** Shared wheel diameter from viewport; label/frame/highlight derive from this. */
	const ROULETTE_SIZE_VW = 0.72;
	const LABEL_HEIGHT_TO_WIDTH = 462 / 1925;

	// ─── Tuning knobs: independently scale & reposition the roulette pieces ────────────────────────
	// EDIT THESE to move/resize the free-spin roulette. Values are split by orientation: `landscape` is
	// used on desktop/wide layouts, `portrait` on mobile/tall layouts (chosen by `portrait` below).
	//   scale:    1 = base size (what the layout computes); >1 = larger, <1 = smaller. For `wheel` this
	//             sizes the assembly by its OUTER (wooden ring) diameter = rouletteSizePx × scale.
	//   offsetX:  horizontal shift as a fraction of `rouletteSizePx` (positive = right).
	//   offsetY:  vertical shift as a fraction of `rouletteSizePx` (positive = down).
	// ⚠️ The offsets are fractions of the UNSCALED `rouletteSizePx`, not of the on-screen diameter, so
	// they do not follow `scale` — changing one does not require re-tuning the other.
	// `wheel` moves/scales the whole assembly (disc + highlight + frame) as one — they must stay
	// registered with each other, so there are no separate frame knobs.
	// Note: pieces are clipped at the screen edges (the overlay hides overflow), so very large scales
	// will crop — lower the scale or nudge with the offsets.
	const FREE_SPIN_ROULETTE_TUNING = {
		landscape: {
			label: { scale: 2, offsetX: 0, offsetY: -0.05 },
			wheel: { scale: 1.65, offsetX: 0, offsetY: 0.4 },
		},
		portrait: {
			label: { scale: 2, offsetX: 0, offsetY: 0.2 },
			wheel: { scale: 1.35, offsetX: 0, offsetY: 0.2 },
		},
	};

	// ⚠️ DEBUG ONLY — extra delay (ms) before the wheel starts spinning, so the assembled layout can be
	// inspected first. Must be `0` when shipping. Added on top of the normal pre-spin delay (~0.52s),
	// so e.g. 6480 ≈ the wheel spins 7s after it appears (pairs with DEV_SHOW_FREE_SPIN_ROULETTE_ON_LOAD in Game.svelte).
	const DEBUG_SPIN_DELAY_MS = 4480;

	// ─── Wheel art (img/bonus_roulette_v2) ─────────────────────────────────────────────────────────
	// Three flat pieces, layered disc → highlight → frame. Native measurements below were recovered
	// from the PNGs themselves (opaque-mask radial scans + least-squares circle/edge fits), which is
	// what registers them to each other:
	//   wheel_values.png (1808²) — the ROTATING disc. The coloured disc is inscribed in the square
	//     canvas: centre (904,904), r=904. So it renders at exactly the stack's box.
	//   wheel_base.png (1911×1925) — the STATIC frame: wooden ring + top pointer + centre medallion all
	//     baked into ONE image, so none of them can rotate independently. Ring centre (955.46, 968.93)
	//     — note that is ~0.3% BELOW the canvas centre, hence the asymmetric `top` below — outer
	//     r=945.9. Drawn over the disc: the ring hides the disc's rim, the medallion hides the wedges'
	//     converging apexes, and the pointer overhangs the rim by ~47px of native art.
	//   wheel_segment_highlight.png (597×767) — ONE 45° wedge glow; apex (285.4, 772), r=777, bisector
	//     vertical, apex at the BOTTOM. Its corners are clipped a pixel or two by its own canvas.
	const BASE_PNG = { w: 1911, h: 1925, cx: 955.46, cy: 968.93, outerR: 945.87, opaqueInnerR: 800 };
	const HIGHLIGHT_PNG = { w: 597, h: 767, apexX: 285.4, apexY: 772, r: 777 };

	/** Disc radius, expressed in base-PNG px — i.e. how far the disc reaches under the ring.
	 * ⚠️ NOT the ring's nominal inner radius (~757). The ring's inner edge is a long SOFT alpha ramp:
	 * alpha only climbs from ~0 at r=741 to fully opaque at r≈796 (worst angle 799). Ending the disc at
	 * the first non-zero alpha leaves it under near-transparent pixels, so the dark overlay shows
	 * straight through the ring's shadow as a GAP. Reaching the opaque radius instead makes the seam
	 * flush and lets the ring's shadow fall on the disc as intended. */
	const DISC_R_IN_BASE_PX = BASE_PNG.opaqueInnerR;

	// Frame/highlight boxes as fractions of the disc diameter D — the stack is D×D with the disc filling
	// it, so these drop straight into CSS percentages. Each piece is placed by pinning its own measured
	// registration point (the frame's ring centre, the highlight's apex) to the wheel centre at 50%/50%.
	const baseScale = 0.5 / DISC_R_IN_BASE_PX;
	const FRAME_BOX = {
		w: BASE_PNG.w * baseScale,
		h: BASE_PNG.h * baseScale,
		left: 0.5 - BASE_PNG.cx * baseScale,
		top: 0.5 - BASE_PNG.cy * baseScale,
	};
	// Scaled so the wedge's outer arc lands on the disc rim; the soft glow that bleeds past it is hidden
	// under the frame's ring, and the apex end is hidden under the frame's medallion.
	const highlightScale = 0.5 / HIGHLIGHT_PNG.r;
	const HIGHLIGHT_BOX = {
		w: HIGHLIGHT_PNG.w * highlightScale,
		h: HIGHLIGHT_PNG.h * highlightScale,
		left: 0.5 - HIGHLIGHT_PNG.apexX * highlightScale,
		top: 0.5 - HIGHLIGHT_PNG.apexY * highlightScale,
	};
	// The apex, as a % of the highlight's own box — it sits on the wheel centre, so rotating about it
	// swings the wedge around the hub.
	const HIGHLIGHT_ORIGIN = {
		x: (HIGHLIGHT_PNG.apexX / HIGHLIGHT_PNG.w) * 100,
		y: (HIGHLIGHT_PNG.apexY / HIGHLIGHT_PNG.h) * 100,
	};

	const valuesSrc = staticUrl('img/bonus_roulette_v2/wheel_values.png');
	const frameSrc = staticUrl('img/bonus_roulette_v2/wheel_base.png');
	const highlightSrc = staticUrl('img/bonus_roulette_v2/wheel_segment_highlight.png');

	const SEG_ANGLE = 360 / FREE_SPIN_SEGMENTS.length;
	/** ⚠️ The art and `FREE_SPIN_SEGMENTS` start at DIFFERENT wedges. Both run clockwise in the same
	 * cyclic order, but the art parks BONUS under the pointer at rotation 0 while the constant is
	 * indexed from 2X — a 3-wedge (135°) offset. Landing on `winner*SEG_ANGLE` would therefore pay out
	 * a DIFFERENT value than the one shown under the pointer. */
	const ART_TOP_SEGMENT_INDEX = FREE_SPIN_SEGMENTS.indexOf('BONUS');

	/** Where segment `index` sits, in degrees clockwise from the pointer, at rotation 0. */
	function segmentAngleFromTop(index: number): number {
		const n = FREE_SPIN_SEGMENTS.length;
		return ((((index - ART_TOP_SEGMENT_INDEX) % n) + n) % n) * SEG_ANGLE;
	}

	/** Art angle of the wedge under the marker RIGHT NOW, read from the wheel's LIVE (mid-transition)
	 * rotation θ. A wedge at art angle `a` displays at `a + θ`, so the one under the marker (0°) is the
	 * one with `a ≈ -θ`, snapped to the wedge grid. */
	function currentTopArtAngle(): number {
		const el = wheelEl;
		if (!el) return 0;
		const t = getComputedStyle(el).transform;
		if (!t || t === 'none') return 0;
		const m = new DOMMatrixReadOnly(t);
		const theta = (Math.atan2(m.b, m.a) * 180) / Math.PI;
		const n = FREE_SPIN_SEGMENTS.length;
		return (((Math.round(-theta / SEG_ANGLE) % n) + n) % n) * SEG_ANGLE;
	}

	function trackHighlight() {
		highlightAngleDeg = currentTopArtAngle();
		highlightRaf = requestAnimationFrame(trackHighlight);
	}

	function stopHighlightTracking() {
		if (highlightRaf) cancelAnimationFrame(highlightRaf);
		highlightRaf = 0;
	}

	const portrait = isPortraitGameLayout();
	// Resolve the orientation-specific tuning knobs (see FREE_SPIN_ROULETTE_TUNING above).
	const tuning = portrait
		? FREE_SPIN_ROULETTE_TUNING.portrait
		: FREE_SPIN_ROULETTE_TUNING.landscape;
	const LABEL_SCALE = tuning.label.scale;
	const LABEL_OFFSET_X = tuning.label.offsetX;
	const LABEL_OFFSET_Y = tuning.label.offsetY;
	const WHEEL_SCALE = tuning.wheel.scale;
	const WHEEL_OFFSET_X = tuning.wheel.offsetX;
	const WHEEL_OFFSET_Y = tuning.wheel.offsetY;

	/** `wheel.scale` is expressed as the assembly's OUTER (ring) diameter, but the group it drives scales
	 * the DISC — so divide out the ring:disc ratio. Keeps the knob stable if the disc/ring fit changes. */
	const RING_OUTER_TO_DISC = BASE_PNG.outerR / DISC_R_IN_BASE_PX;
	const wheelGroupScale = WHEEL_SCALE / RING_OUTER_TO_DISC;

	let overlayVisible = $state(false);
	let wheelVisible = $state(false);
	let wheelSpinClass = $state(false);
	let wheelRotationDeg = $state(0);
	/** Art angle of the wedge the highlight is glued to. It rides INSIDE the rotating disc, so between
	 * hand-offs it follows its wedge for free; the tracker just re-points it at each boundary. */
	let highlightAngleDeg = $state(0);
	let highlightRaf = 0;
	// Bound to the rotating disc container; drives the settle transitionend and is read each frame to
	// find the wedge under the marker.
	let wheelEl = $state<HTMLDivElement | undefined>(undefined);
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
		timers.push(setTimeout(() => (wheelVisible = true), 120));
		timers.push(setTimeout(() => startSpin(), 520 + DEBUG_SPIN_DELAY_MS));
		return () => {
			timers.forEach(clearTimeout);
			stopHighlightTracking();
		};
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

	// Tuning offsets, resolved to px from the disc diameter (positive X → right, positive Y → down).
	const labelOffsetXPx = $derived(`${Math.round(rouletteSizePx * LABEL_OFFSET_X)}px`);
	const labelOffsetYPx = $derived(`${Math.round(rouletteSizePx * LABEL_OFFSET_Y)}px`);
	const wheelOffsetXPx = $derived(`${Math.round(rouletteSizePx * WHEEL_OFFSET_X)}px`);
	const wheelOffsetYPx = $derived(`${Math.round(rouletteSizePx * WHEEL_OFFSET_Y)}px`);

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
		const targetDeg = wheelRotationDeg + extraRounds * 360 - segmentAngleFromTop(winner);
		let settled = false;
		const settle = () => {
			if (settled) return;
			settled = true;
			// Stop the per-frame tracking and pin the glow on the landed wedge (it's under the marker now).
			stopHighlightTracking();
			highlightAngleDeg = segmentAngleFromTop(winner);
			afterSpin(winner);
		};
		requestAnimationFrame(() => {
			wheelSpinClass = true;
			wheelRotationDeg = targetDeg;
			// Hand the glow from wedge to wedge as the marker sweeps over them during the spin.
			stopHighlightTracking();
			trackHighlight();
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
				<!-- One transformed group so the disc, highlight and frame keep their measured registration
				     under the tuning scale/offsets and the entry animation. -->
				<div
					class="free-spin-wheel-group"
					class:free-spin-wheel-group--visible={wheelVisible}
					style:--wheel-scale={wheelGroupScale}
					style:--wheel-offset-x={wheelOffsetXPx}
					style:--wheel-offset-y={wheelOffsetYPx}
				>
					<div
						bind:this={wheelEl}
						class="free-spin-wheel"
						class:free-spin-wheel--animating={wheelSpinClass}
						style:--wheel-rotation-deg="{wheelRotationDeg}deg"
						role="img"
						aria-label="Free spin wheel"
					>
						<img class="free-spin-wheel-values" src={valuesSrc} alt="" />
						<!-- Rides INSIDE the rotating disc, so it stays glued to its wedge while the wheel turns;
						     the rAF tracker only re-points it as each new wedge reaches the marker. -->
						<img
							class="free-spin-highlight"
							style:left="{HIGHLIGHT_BOX.left * 100}%"
							style:top="{HIGHLIGHT_BOX.top * 100}%"
							style:width="{HIGHLIGHT_BOX.w * 100}%"
							style:height="{HIGHLIGHT_BOX.h * 100}%"
							style:--highlight-origin-x="{HIGHLIGHT_ORIGIN.x}%"
							style:--highlight-origin-y="{HIGHLIGHT_ORIGIN.y}%"
							style:--highlight-angle-deg="{highlightAngleDeg}deg"
							src={highlightSrc}
							alt=""
						/>
					</div>
					<img
						class="free-spin-frame"
						style:left="{FRAME_BOX.left * 100}%"
						style:top="{FRAME_BOX.top * 100}%"
						style:width="{FRAME_BOX.w * 100}%"
						style:height="{FRAME_BOX.h * 100}%"
						src={frameSrc}
						alt=""
					/>
				</div>
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
		/* Above the wheel assembly so the label always paints over the frame's pointer when it pokes up. */
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
	/* The frame overhangs this box (it is ~1.25× the disc), so nothing here may clip. */
	.free-spin-wheel-group {
		position: absolute;
		inset: 0;
		transform-origin: 50% 50%;
		transform: translateY(125vh) scale(var(--wheel-scale, 1));
		opacity: 0;
	}
	.free-spin-wheel-group--visible {
		transform: translate(var(--wheel-offset-x, 0px), var(--wheel-offset-y, 0px))
			scale(var(--wheel-scale, 1));
		opacity: 1;
		transition:
			transform 0.68s cubic-bezier(0.22, 1, 0.36, 1),
			opacity 0.34s ease;
	}
	/* The only piece that rotates. */
	.free-spin-wheel {
		position: absolute;
		inset: 0;
		transform-origin: 50% 50%;
		--wheel-rotation-deg: 0deg;
		transform: rotate(var(--wheel-rotation-deg));
	}
	.free-spin-wheel--animating {
		transition: transform 4.1s cubic-bezier(0.12, 0.72, 0.12, 1);
	}
	/* The coloured disc is inscribed in its square canvas, so it fills the stack exactly. */
	.free-spin-wheel-values {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		pointer-events: none;
	}
	/* `fill` on both of these: the boxes are already the art's exact aspect ratio, and `contain` would
	   silently letterbox (and so break the registration) on any rounding drift. */
	/* Deliberately NOT transitioned — the glow must SNAP to the next wedge as it reaches the marker,
	   then ride along with it (it is inside the rotating disc). */
	.free-spin-highlight {
		position: absolute;
		z-index: 1;
		object-fit: fill;
		pointer-events: none;
		transform-origin: var(--highlight-origin-x) var(--highlight-origin-y);
		transform: rotate(var(--highlight-angle-deg, 0deg));
	}
	.free-spin-frame {
		position: absolute;
		z-index: 3;
		object-fit: fill;
		pointer-events: none;
	}
</style>
