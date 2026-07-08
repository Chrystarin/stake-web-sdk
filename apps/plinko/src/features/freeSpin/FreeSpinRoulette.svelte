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
	// Centre gem medallion size as a fraction of the wheel. Enlarged from the art's native 624/1348≈0.463
	// to 0.53 so it covers the segments' slightly-ragged INNER edges (their outer edges are clipped to a
	// circle; the inner edges are left irregular and hidden under this medallion). Stays clear of the values.
	const BASE_TO_WHEEL = 0.53;
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
	// inspected first. Must be `0` when shipping. Added on top of the normal pre-spin delay (~0.52s),
	// so e.g. 6480 ≈ the wheel spins 7s after it appears (pairs with DEV_SHOW_FREE_SPIN_ROULETTE_ON_LOAD in Game.svelte).
	const DEBUG_SPIN_DELAY_MS = 0;

	// ─── Reassembled free-spin wheel ────────────────────────────────────────────────────────────────
	// Composited at runtime from the blank copper disc `free_spin_roulette_empty.png` plus one value-wedge
	// PNG per segment. {w,h} = displayed size, {l,t} = top-left, all as fractions of the wheel. The wedges
	// are near-congruent at their native scale but their outer arcs are slightly irregular/tilted (esp. the
	// wide BONUS wedge). Rather than chase a per-wedge concentric fit, the wedges are sized to OVERSHOOT +
	// OVERLAP and the whole segment layer is CLIPPED to a circle (`.free-spin-segs`, r=46.2% of the wheel):
	// the clip gives an exact circular outer edge, the overlap means no gaps, and the copper base ring
	// shows outside the clip. Placement, per wedge: scale about its own CENTROID by 1.15 (widen → overlap,
	// close gaps), tangential-shift + scale so its (flattened) outer arc ≈ the clip radius, then a final
	// uniform 1.025× about the wheel centre so full coverage reaches the clip radius (verified 100% coverage
	// at the clip). Index-aligned with `FREE_SPIN_SEGMENTS` (clockwise from top: 2X,0.5X,1X,5X,10X,BONUS,20X,15X).
	const FREE_SPIN_SEGMENT_PLACEMENTS: { w: number; h: number; l: number; t: number }[] = [
		{ w: 0.45774, h: 0.38408, l: 0.23386, t: -0.02415 }, // 2X
		{ w: 0.50912, h: 0.53814, l: 0.45121, t: -0.02902 }, // 0.5X
		{ w: 0.37542, h: 0.39209, l: 0.63816, t: 0.27983 }, // 1X
		{ w: 0.48259, h: 0.4791, l: 0.54207, t: 0.44014 }, // 5X
		{ w: 0.39373, h: 0.31918, l: 0.38252, t: 0.66594 }, // 10X
		{ w: 0.57262, h: 0.60336, l: 0.02783, t: 0.46824 }, // BONUS
		{ w: 0.3715, h: 0.39161, l: -0.01183, t: 0.33557 }, // 20X
		{ w: 0.51686, h: 0.50639, l: -0.01694, t: 0.05158 }, // 15X
	];
	// FREE_SPIN_SEGMENTS label → SVG filename stem in free_spin_roulette_segments/.
	const FREE_SPIN_SEGMENT_FILE: Record<string, string> = {
		'2X': 'segment_x2',
		'0.5X': 'segment_x0.5',
		'1X': 'segment_x1',
		'5X': 'segment_x5',
		'10X': 'segment_x10',
		BONUS: 'segment_bonus',
		'20X': 'segment_x20',
		'15X': 'segment_x15',
	};
	const SEG_ANGLE = 360 / FREE_SPIN_SEGMENTS.length;
	const emptyWheelSrc = staticUrl('img/free_spin_roulette_segments/free_spin_roulette_empty.png');
	const segments = FREE_SPIN_SEGMENTS.map((label, i) => ({
		label,
		index: i,
		placement: FREE_SPIN_SEGMENT_PLACEMENTS[i] as
			| { w: number; h: number; l: number; t: number }
			| undefined,
		src: staticUrl(`img/free_spin_roulette_segments/${FREE_SPIN_SEGMENT_FILE[label] ?? ''}.png`),
	}));

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
	// Bound to the rotating wheel container (was the single wheel <img>); drives settle transitionend and
	// is read each frame to find the wedge under the top marker.
	let wheelEl = $state<HTMLDivElement | undefined>(undefined);
	let stageEl = $state<HTMLDivElement | undefined>(undefined);
	let rouletteSizePx = $state(0);
	// Index of the segment currently under the top marker (glows gold); null = no highlight.
	let highlightedIndex = $state<number | null>(null);
	let highlightRaf = 0;
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

	/** Which wedge is under the top marker right now, read from the wheel's LIVE (mid-transition) rotation.
	 * Segment `i` sits `i*SEG_ANGLE` clockwise from the top at rest, so the top wedge is
	 * `round(-angle/SEG_ANGLE)` mod segment count. */
	function currentTopIndex(): number | null {
		const el = wheelEl;
		if (!el) return null;
		const t = getComputedStyle(el).transform;
		if (!t || t === 'none') return 0;
		const m = new DOMMatrixReadOnly(t);
		const angle = (Math.atan2(m.b, m.a) * 180) / Math.PI;
		const n = FREE_SPIN_SEGMENTS.length;
		return ((Math.round(-angle / SEG_ANGLE) % n) + n) % n;
	}

	function trackHighlight() {
		highlightedIndex = currentTopIndex();
		highlightRaf = requestAnimationFrame(trackHighlight);
	}

	function stopHighlightTracking() {
		if (highlightRaf) cancelAnimationFrame(highlightRaf);
		highlightRaf = 0;
	}

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
			// Stop the per-frame tracking and pin the glow on the landed wedge (it's under the marker now).
			stopHighlightTracking();
			highlightedIndex = winner;
			afterSpin(winner);
		};
		requestAnimationFrame(() => {
			wheelSpinClass = true;
			wheelRotationDeg = targetDeg;
			baseRotationDeg = baseTargetDeg;
			// Light up each wedge as the marker sweeps over it during the spin.
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
				highlightedIndex = null;
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
	<!-- Inner-glow filter for the lit wedge. A CSS box-shadow can't follow an <img>'s alpha (it uses the
	     rectangular box), so this recreates the design's gold inset glow + inner vignette along the actual
	     wedge outline: flood a colour OUTSIDE the shape, blur it inward, then clip back INTO the shape. -->
	<svg class="free-spin-filter-defs" width="0" height="0" aria-hidden="true" focusable="false">
		<filter
			id="free-spin-seg-lit-glow"
			x="-25%"
			y="-25%"
			width="150%"
			height="150%"
			color-interpolation-filters="sRGB"
		>
			<!-- inner black vignette (broad) — the `inset 0 0 50px #000` layer -->
			<feFlood flood-color="rgb(0,0,0)" flood-opacity="0.5" result="dark" />
			<feComposite in="dark" in2="SourceAlpha" operator="out" result="darkRing" />
			<feGaussianBlur in="darkRing" stdDeviation="22" result="darkBlur" />
			<feComposite in="darkBlur" in2="SourceAlpha" operator="in" result="darkGlow" />
			<!-- broad gold inset glow — the `inset ±30px rgba(255,184,x,0.8)` layers -->
			<feFlood flood-color="rgb(255,184,1)" flood-opacity="0.95" result="gold" />
			<feComposite in="gold" in2="SourceAlpha" operator="out" result="goldRing" />
			<feGaussianBlur in="goldRing" stdDeviation="15" result="goldBlur" />
			<feComposite in="goldBlur" in2="SourceAlpha" operator="in" result="goldGlow" />
			<!-- crisp bright rim right at the outline -->
			<feFlood flood-color="rgb(255,201,46)" flood-opacity="1" result="rim" />
			<feComposite in="rim" in2="SourceAlpha" operator="out" result="rimRing" />
			<feGaussianBlur in="rimRing" stdDeviation="4" result="rimBlur" />
			<feComposite in="rimBlur" in2="SourceAlpha" operator="in" result="rimGlow" />
			<feMerge>
				<feMergeNode in="SourceGraphic" />
				<feMergeNode in="darkGlow" />
				<feMergeNode in="goldGlow" />
				<feMergeNode in="rimGlow" />
			</feMerge>
		</filter>
	</svg>
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
				<div
					bind:this={wheelEl}
					class="free-spin-wheel"
					class:free-spin-wheel--animating={wheelSpinClass}
					class:free-spin-wheel--visible={wheelVisible}
					style:--wheel-rotation-deg="{wheelRotationDeg}deg"
					style:--wheel-scale={WHEEL_SCALE}
					style:--wheel-offset-x={wheelOffsetXPx}
					style:--wheel-offset-y={wheelOffsetYPx}
					role="img"
					aria-label="Free spin wheel"
				>
					<img class="free-spin-wheel-base" src={emptyWheelSrc} alt="" />
					<!-- Segments are clipped to a circle so their outer edges form an EXACT circle (the wedge
					     arcs are slightly irregular/tilted; the wedges are sized to overshoot + overlap, so the
					     clip is fully filled with no gaps). The copper base ring shows outside the clip. -->
					<div class="free-spin-segs">
						{#each segments as seg (seg.index)}
							{#if seg.placement}
								<img
									class="free-spin-seg"
									class:free-spin-seg--lit={highlightedIndex === seg.index}
									style:left="{seg.placement.l * 100}%"
									style:top="{seg.placement.t * 100}%"
									style:width="{seg.placement.w * 100}%"
									style:height="{seg.placement.h * 100}%"
									src={seg.src}
									alt=""
								/>
							{/if}
						{/each}
					</div>
				</div>
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
		position: relative;
		display: block;
		width: 100%;
		height: 100%;
		transform-origin: 50% 50%;
		--wheel-rotation-deg: 0deg;
		transform: translateY(125vh) rotate(var(--wheel-rotation-deg)) scale(var(--wheel-scale, 1));
		opacity: 0;
	}
	/* Base ring + gem + coloured wedges (no values); the value wedges layer on top. */
	.free-spin-wheel-base {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: contain;
		pointer-events: none;
	}
	/* Clips the value wedges to a circle so their combined outer edge is an exact circle (r = 46.2% of the
	   wheel). The wedges overshoot + overlap this radius, so the clip is fully filled with no gaps; the
	   copper base ring shows outside it. */
	.free-spin-segs {
		position: absolute;
		inset: 0;
		clip-path: circle(46.2% at 50% 50%);
	}
	/* One value wedge per segment, positioned/sized as fractions of the wheel (see FREE_SPIN_SEGMENT_PLACEMENTS). */
	.free-spin-seg {
		position: absolute;
		object-fit: contain;
		pointer-events: none;
	}
	.free-spin-filter-defs {
		position: absolute;
		width: 0;
		height: 0;
		pointer-events: none;
	}
	/* Highlight on the wedge under the marker: gold inset glow + inner vignette along the wedge outline
	   (SVG inner-glow filter, see #free-spin-seg-lit-glow) plus the design's soft outer shadow. */
	.free-spin-seg--lit {
		z-index: 1;
		filter: url(#free-spin-seg-lit-glow) drop-shadow(0 0 10px rgba(0, 0, 0, 0.25));
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
			rotate(var(--base-rotation-deg)) scale(var(--wheel-scale, 1));
		z-index: 3;
		pointer-events: none;
	}
	/* Matches the wheel's spin timing so the counter-rotating base stops at the same moment. */
	.free-spin-center-base--animating {
		transition: transform 4.1s cubic-bezier(0.12, 0.72, 0.12, 1);
	}
</style>
