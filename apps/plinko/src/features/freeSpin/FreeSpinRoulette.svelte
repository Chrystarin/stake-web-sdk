<script lang="ts">
	import { onMount } from 'svelte';

	import { FREE_SPIN_SEGMENTS } from '../../game-logic/constants';
	import { eventEmitter } from '../../game/eventEmitter';
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
			// ⚠️ Portrait `wheel.offsetY` measures from the wheel's PARKING SPOT — the top of its grid
			// row, directly under the title row — NOT from the row's centre like landscape. The row's
			// spare height no longer moves the wheel (`place-self: start` + the height budget below), so
			// this one knob fully decides the title↔wheel relationship, and the SAME value renders the
			// SAME composition on every device and viewport height. +0.5 parks the pointer ~5px under
			// the title art — "almost sticking". Bigger = lower. (Mirrors BonusRoulette.)
			wheel: { scale: 1.35, offsetX: 0, offsetY: 0.5 },
		},
	};

	// ─── Tuning knobs: the per-segment gold highlight ──────────────────────────────────────────────
	// EDIT THESE to move/resize the glowing outline that marks the wedge under the pointer. Every knob
	// is a NO-OP at its default, which leaves the outline exactly where the art measurements put it
	// (edges parallel to the wedge's ropes, arc on the disc rim) — so nudge from here rather than
	// editing ART_WEDGE_GEOMETRY/HIGHLIGHT_PNG below, which are recovered measurements, not opinions.
	// The outline rides INSIDE the rotating disc, so these are expressed in the WEDGE's own frame and
	// apply identically to all 8 slots. There is no landscape/portrait split on purpose: the whole
	// assembly scales as one, so the highlight already follows the `wheel` knobs above.
	//   scale:            radial REACH — how far the outline extends from its apex. 1 = the arc lands on
	//                     the disc rim; >1 pushes it out under the wooden ring (which will eat the outer
	//                     band), <1 pulls it back toward the hub. The wedge's ANGLE is unaffected: only
	//                     the scaleX:scaleY ratio sets that, and this scales both together.
	//   widenDeg:         degrees added to the wedge's HALF-angle, so the outline opens by twice this in
	//                     total (+1 ⇒ 1° more daylight on each side of the wedge; negative tightens).
	//                     0 = matches the ropes exactly. Keep within roughly ±10 — past that the squeeze
	//                     solver hits the ends of its search range and silently stops widening.
	//   offsetRadial:     slide the whole outline along its bisector, as a fraction of the disc RADIUS
	//                     (+ = outward toward the rim, − = inward toward the hub). 0.05 ≈ 5% of the
	//                     hub→rim distance. Unlike `scale`, this carries the arc along with it.
	//   offsetTangential: slide it sideways across its wedge, same units (+ = clockwise).
	//   rotateDeg:        swing it about its apex (+ = clockwise). Use this to re-aim the outline along
	//                     the ropes; `offsetTangential` shifts it bodily instead.
	const FREE_SPIN_HIGHLIGHT_TUNING = {
		scale: 1.01,
		widenDeg: 0,
		offsetRadial: 0,
		offsetTangential: -.0,
		rotateDeg: 0,
	};

	// ─── Tuning knob: the values disc (wheel_values.png) ───────────────────────────────────────────
	// `scale` grows the wedge colours + their baked-in labels about the hub. The values are painted INTO
	// this art, so this is the only way to size them without new art — the wedges grow with them.
	// Safe because the ring hides the overflow: the disc rim normally lands exactly on the ring's opaque
	// inner edge, so scaling up just tucks the disc's outer band further underneath (never a gap — that
	// would need scale < 1). The wedges stay visible from the hub out to the ring either way.
	// Does NOT disturb the other layers: a uniform scale about the hub preserves ANGLES, so the wedge
	// bisectors/half-angles the highlight is built from are untouched, and the highlight's arc still
	// lands on the ring's edge because the ring — not the disc rim — is what bounds the visible wedge.
	// It does scale the seams' chord offsets by the same factor (see the ropes' note below): at 1.15 vs
	// the ropes' 1.13 the two differ by 0.02×offset ≈ 0.5px, i.e. they track each other closely.
	const FREE_SPIN_VALUES_TUNING = {
		scale: 1.12,
	};

	// ─── Tuning knob: the rope dividers (wheel_divider.png) ────────────────────────────────────────
	// `scale` grows the rope layer about the WHEEL CENTRE, so the ropes reach further out (and get
	// proportionally thicker — it is one image, there is no radial-only stretch).
	//   1     = the art's own registration: rope tips land at 802–829 art px from the hub. The tips
	//           differ because the ropes are CHORDS, so a chord's two ends sit at different radii.
	//   1.127 = the shortest rope just reaches the disc rim (904) = the ring's opaque inner edge, so
	//           EVERY rope runs into the wood and the tip ferrules tuck out of sight beneath it.
	// Below ~1.09 the shortest ropes stop short of the ring's shadow (starts at ~837) and you get a
	// band of bare wedge colour at the rim — the gap this knob exists to close.
	// Overshooting is safe: nothing here clips, and the frame (z 3) paints over anything past the rim;
	// the ring's outer edge is ~1069 art px away, so there is plenty of headroom.
	const FREE_SPIN_DIVIDER_TUNING = {
		scale: 1.13,
	};

	// ⚠️ DEBUG ONLY — extra delay (ms) before the wheel starts spinning, so the assembled layout can be
	// inspected first. Must be `0` when shipping. Added on top of the normal pre-spin delay (~0.52s),
	// so e.g. 9480 ≈ the wheel spins 10s after it appears (pairs with DEV_SHOW_FREE_SPIN_ROULETTE_ON_LOAD in Game.svelte).
	const DEBUG_SPIN_DELAY_MS = 0;

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
	//   wheel_segment_highlight.png (597×767) — ONE 45° wedge glow; apex (285.4, 772) at the BOTTOM,
	//     r=777. ⚠️ It is a hollow OUTLINE, not a fill: the interior is alpha 0 and only the gold rim +
	//     soft glow are painted, so it traces the wedge's perimeter. Its edges sit at -21.99°/+22.76°
	//     from its own vertical (i.e. it is very slightly lopsided), and its corners are clipped a px or
	//     two by its own canvas.
	//   wheel_divider.png (1553×1564) — the 8 gold ROPES, on their own layer so the segment highlight can
	//     sit UNDER them (see the layering note on the markup below). Rides inside the rotating disc.
	//     ⚠️ The ropes are NOT radial — they are 4 straight CHORDS laid across the wheel (the art shows
	//     them missing the hub, leaving a small gap), which is the same geometry ART_WEDGE_GEOMETRY below
	//     was recovered from.
	const BASE_PNG = { w: 1911, h: 1925, cx: 955.46, cy: 968.93, outerR: 945.87, opaqueInnerR: 800 };
	/** wheel_divider.png is the rope layer of the SAME artboard as wheel_values.png, exported 1:1 and
	 * trimmed — so it drops onto the disc at native size with a pure offset, no scaling.
	 * Recovered by diffing the previous rope-BAKED wheel_values.png (git) against the current rope-free
	 * one, which isolates the baked rope pixels exactly, then registering this art against them:
	 * eroding both masks identically (so the erosion bias cancels) matched their extents at scale
	 * 1.0033/1.0020/0.9993 across three erosion depths ⇒ 1:1; an offset-only IoU fit then peaked at
	 * (121, 111), agreeing with the independent bbox-midpoint estimate of (120.5, 114). Verified by
	 * overlaying this art on the OLD disc: the gold rope covers the baked cream rope with no ghosting.
	 * ⚠️ Scale here is NOT recoverable by naive IoU/correlation — the ropes are long and thin, so they
	 * overlap themselves under scaling and the score is flat to ±2% (a fit like that lands on ~1.10). */
	const DIVIDER_PNG = { w: 1553, h: 1564, offsetX: 121, offsetY: 111 };
	const HIGHLIGHT_PNG = {
		w: 597,
		h: 767,
		apexX: 285.4,
		apexY: 772,
		r: 777,
		edgeLDeg: -21.99,
		edgeRDeg: 22.76,
	};
	/** Disc radius in wheel_values.png px — the frame of reference for ART_WEDGE_GEOMETRY below. */
	const VALUES_ART_R = 904;

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
	// The apex, as a % of the highlight's own box. Every transform pivots here, so the outline swings
	// and squeezes about its own point rather than sliding.
	const HIGHLIGHT_ORIGIN = {
		x: (HIGHLIGHT_PNG.apexX / HIGHLIGHT_PNG.w) * 100,
		y: (HIGHLIGHT_PNG.apexY / HIGHLIGHT_PNG.h) * 100,
	};
	// The rope layer shares the disc's artboard 1:1, and the disc is inscribed in that square canvas and
	// fills the stack exactly — so disc-art px map to the stack by a plain divide, no scale term.
	const VALUES_ART_D = VALUES_ART_R * 2;
	const DIVIDER_BOX = {
		w: DIVIDER_PNG.w / VALUES_ART_D,
		h: DIVIDER_PNG.h / VALUES_ART_D,
		left: DIVIDER_PNG.offsetX / VALUES_ART_D,
		top: DIVIDER_PNG.offsetY / VALUES_ART_D,
	};
	// The wheel centre (the hub, at 50%/50% of the stack) in the rope layer's OWN box — the art is
	// trimmed, so its box is NOT centred on the hub and a plain `50% 50%` origin would scale the ropes
	// about the wrong point and slide them off their seams.
	const DIVIDER_ORIGIN = {
		x: ((VALUES_ART_R - DIVIDER_PNG.offsetX) / DIVIDER_PNG.w) * 100,
		y: ((VALUES_ART_R - DIVIDER_PNG.offsetY) / DIVIDER_PNG.h) * 100,
	};

	const valuesSrc = staticUrl('img/bonus_roulette_v2/wheel_values.webp');
	const frameSrc = staticUrl('img/bonus_roulette_v2/wheel_base.webp');
	const highlightSrc = staticUrl('img/bonus_roulette_v2/wheel_segment_highlight.webp');
	const dividerSrc = staticUrl('img/bonus_roulette_v2/wheel_divider.webp');

	const SEG_ANGLE = 360 / FREE_SPIN_SEGMENTS.length;
	/** ⚠️ The art and `FREE_SPIN_SEGMENTS` start at DIFFERENT wedges. Both run clockwise in the same
	 * cyclic order, but the art parks BONUS under the pointer at rotation 0 while the constant is
	 * indexed from 2X — a 3-wedge (135°) offset. Landing on `winner*SEG_ANGLE` would therefore pay out
	 * a DIFFERENT value than the one shown under the pointer. */
	const ART_TOP_SEGMENT_INDEX = FREE_SPIN_SEGMENTS.indexOf('BONUS');

	/** Geometry of each wedge's ROPE-FREE INTERIOR, by ART SLOT (0 = the wedge the art parks under the
	 * pointer = BONUS, then clockwise).
	 * ⚠️ The 8 rope dividers are NOT radial. They are 4 straight CHORDS laid across the wheel, each
	 * offset from the hub by 8–23px — so the two ropes bounding a wedge meet at a point that is NOT the
	 * hub (up to 45px away). A wedge outline pivoted about the HUB therefore CROSSES its ropes: snug at
	 * one radius, gaping at another (which is exactly what the user saw at the rim). Pin the outline's
	 * apex to `apexX/apexY` instead and its edges run PARALLEL to the ropes at a constant pixel gap.
	 * Note the bisectors land within ~1.2° of the ideal 45° grid and the half-angles all ≈22.4° — the
	 * big "wedge centre drift" an earlier pass measured was an artefact of reading a chord's angle at
	 * one radius, NOT real.
	 * Recovered by total-least-squares line-fitting each rope's core pixels, offsetting each line inward
	 * by its measured half-width (≈6.3px) + 2px of daylight, and intersecting the pairs.
	 *   apexX/apexY: where a wedge's two rope-inner-edges meet, relative to the hub, in wheel_values.png
	 *                px (VALUES_ART_R). +y is DOWN, matching CSS.
	 *   bisectorDeg: direction of that interior's bisector, clockwise from the pointer.
	 *   halfDeg:     half the angle between the two ropes. */
	const ART_WEDGE_GEOMETRY = [
		{ apexX: 0.7, apexY: -45.4, bisectorDeg: 0.7, halfDeg: 22.44 }, // BONUS
		{ apexX: 16.0, apexY: -38.7, bisectorDeg: 45.44, halfDeg: 22.302 }, // 20X
		{ apexX: 24.1, apexY: -24.0, bisectorDeg: 90.28, halfDeg: 22.533 }, // 15X
		{ apexX: 14.5, apexY: -10.1, bisectorDeg: 135.22, halfDeg: 22.408 }, // 2X
		{ apexX: 0.3, apexY: -0.8, bisectorDeg: 180.31, halfDeg: 22.678 }, // 0.5X
		{ apexX: -16.2, apexY: -4.9, bisectorDeg: 225.99, halfDeg: 23.003 }, // 1X
		{ apexX: -21.2, apexY: -20.7, bisectorDeg: 271.16, halfDeg: 22.169 }, // 5X
		{ apexX: -13.2, apexY: -35.3, bisectorDeg: 315.79, halfDeg: 22.466 }, // 10X
	];

	const DEG = Math.PI / 180;
	/** The art's edge angles after `scaleX(s)` about its apex. scaleX squeezes about the art's VERTICAL,
	 * not its (slightly lopsided) bisector, so the bisector shifts a little too — hence both are returned. */
	function squeezedEdges(s: number) {
		const l = Math.atan(s * Math.tan(HIGHLIGHT_PNG.edgeLDeg * DEG)) / DEG;
		const r = Math.atan(s * Math.tan(HIGHLIGHT_PNG.edgeRDeg * DEG)) / DEG;
		return { halfDeg: (r - l) / 2, bisectorDeg: (r + l) / 2 };
	}
	/** The scaleX that opens the art to `targetHalf`. Monotonic in s, so bisect rather than invert. */
	function squeezeForHalf(targetHalf: number): number {
		let lo = 0.5;
		let hi = 1.6;
		for (let i = 0; i < 60; i++) {
			const mid = (lo + hi) / 2;
			if (squeezedEdges(mid).halfDeg < targetHalf) lo = mid;
			else hi = mid;
		}
		return (lo + hi) / 2;
	}

	/** Per-slot CSS transform inputs, resolved once. The apex offset is converted art px → fraction of
	 * the disc radius → fraction of the stack → % of the outline's own box (so it scales with layout). */
	const HIGHLIGHT_PLACEMENT = ART_WEDGE_GEOMETRY.map((g) => {
		// scaleX/scaleY only set the wedge's ANGLE via their ratio, so scaleY is free to control how far
		// the outline reaches without disturbing the edges: scaling about the apex leaves the edge LINES
		// (apex + direction) fixed, and the directions depend only on sx/sy. `scale` therefore rides on
		// scaleY and is carried into scaleX by the `ratio *` below, leaving the ratio — and so the
		// angle — untouched; `widenDeg` is the only knob that moves the edges.
		const ratio = squeezeForHalf(g.halfDeg + FREE_SPIN_HIGHLIGHT_TUNING.widenDeg);
		const bisRad = g.bisectorDeg * DEG;
		// How far the apex sits OUTWARD along the wedge's bisector. ⚠️ The outline's arc rides on the
		// apex, so left uncompensated this shoves the arc the same distance PAST the rim and the ring
		// eats the whole outer band (measured: only 1px of the ~40px band survived on 10X, 0px on
		// BONUS/20X). Shrink radially by exactly that much to pin the arc back on the rim.
		// Deliberately read from the UNTUNED apex: this compensation belongs to the art, so the offset
		// knobs below stay a pure nudge on top of it rather than re-deriving (and fighting) it.
		const outward = g.apexX * Math.sin(bisRad) - g.apexY * Math.cos(bisRad);
		const scaleY = ((VALUES_ART_R - outward) / VALUES_ART_R) * FREE_SPIN_HIGHLIGHT_TUNING.scale;
		// The offset knobs are in the WEDGE's frame, so rotate them onto the disc's axes before adding.
		// Outward radial unit = (sin θ, −cos θ) with +y DOWN — the same vector `outward` dots against —
		// and tangential is that turned 90° clockwise = (cos θ, sin θ).
		const apexX =
			g.apexX +
			(FREE_SPIN_HIGHLIGHT_TUNING.offsetRadial * Math.sin(bisRad) +
				FREE_SPIN_HIGHLIGHT_TUNING.offsetTangential * Math.cos(bisRad)) *
				VALUES_ART_R;
		const apexY =
			g.apexY +
			(-FREE_SPIN_HIGHLIGHT_TUNING.offsetRadial * Math.cos(bisRad) +
				FREE_SPIN_HIGHLIGHT_TUNING.offsetTangential * Math.sin(bisRad)) *
				VALUES_ART_R;
		return {
			rotateDeg:
				g.bisectorDeg - squeezedEdges(ratio).bisectorDeg + FREE_SPIN_HIGHLIGHT_TUNING.rotateDeg,
			scaleX: ratio * scaleY,
			scaleY,
			txPct: (((apexX / VALUES_ART_R) * 0.5) / HIGHLIGHT_BOX.w) * 100,
			tyPct: (((apexY / VALUES_ART_R) * 0.5) / HIGHLIGHT_BOX.h) * 100,
		};
	});

	/** Which art slot segment `index` occupies (see ART_TOP_SEGMENT_INDEX). */
	function artSlot(index: number): number {
		const n = FREE_SPIN_SEGMENTS.length;
		return (((index - ART_TOP_SEGMENT_INDEX) % n) + n) % n;
	}

	/** Where segment `index` actually sits, in degrees clockwise from the pointer, at rotation 0. Used
	 * for the landing, so the wedge settles centred under the pointer. */
	function segmentAngleFromTop(index: number): number {
		return ART_WEDGE_GEOMETRY[artSlot(index)].bisectorDeg;
	}

	/** Art slot of the wedge under the marker RIGHT NOW, read from the wheel's LIVE (mid-transition)
	 * rotation θ. A wedge at art angle `a` displays at `a + θ`, so the one under the marker (0°) is the
	 * one with `a ≈ -θ`. The ideal 45° grid is accurate enough to pick the slot (the bisectors are all
	 * within ~1.2° of it); the slot's exact geometry then comes from ART_WEDGE_GEOMETRY. */
	function currentTopSlot(): number {
		const el = wheelEl;
		if (!el) return 0;
		const t = getComputedStyle(el).transform;
		if (!t || t === 'none') return 0;
		const m = new DOMMatrixReadOnly(t);
		const theta = (Math.atan2(m.b, m.a) * 180) / Math.PI;
		const n = FREE_SPIN_SEGMENTS.length;
		return ((Math.round(-theta / SEG_ANGLE) % n) + n) % n;
	}

	/** Ratchet "tick" each time a new wedge reaches the pointer — the highlight hand-off already marks
	 * exactly that boundary, so it doubles as the sound cue and the two can never drift apart.
	 * At most one tick per frame: even at peak spin the wheel covers well under a wedge per frame, and
	 * two plays in the same frame would land on top of each other inaudibly anyway. */
	function trackHighlight() {
		const slot = currentTopSlot();
		if (slot !== highlightSlot) {
			const now = performance.now();
			if (now - lastTickAt >= ROULETTE_TICK_MIN_GAP_MS) {
				lastTickAt = now;
				eventEmitter.broadcast({ type: 'soundOnce', name: 'rouletteTick' });
			}
		}
		highlightSlot = slot;
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
	/** How far the frame art reaches BELOW the wheel centre, as a multiple of the wheel diameter — the
	 * lowest painted pixel of the assembly. NOT half the frame box: the ring centre sits below the base
	 * PNG's canvas centre (the pointer is taller than the bottom edge). The portrait height budget in
	 * `updateRouletteLayout()` is measured against this (mirrors BonusRoulette). */
	const FRAME_REACH_BELOW_CENTRE = FRAME_BOX.h * (1 - BASE_PNG.cy / BASE_PNG.h) * wheelGroupScale;

	let overlayVisible = $state(false);
	let wheelVisible = $state(false);
	let wheelSpinClass = $state(false);
	let wheelRotationDeg = $state(0);
	/** Art slot the outline is glued to. It rides INSIDE the rotating disc, so between hand-offs it
	 * follows its wedge for free; the tracker just re-points it at each boundary. Starts on the wedge
	 * the art parks under the pointer (slot 0 = BONUS), matching the wheel's rest pose. */
	let highlightSlot = $state(0);
	let highlightRaf = 0;
	// Throttle the tick SFX only (the glow hand-off below still updates every wedge). Near the start of
	// the spin the wheel crosses a wedge almost every frame, so an un-throttled tick fires ~60×/s and
	// the identical waveforms stack into a clipped, distorted buzz. A min gap keeps a clean ratchet.
	const ROULETTE_TICK_MIN_GAP_MS = 55;
	let lastTickAt = 0;
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
		// Vertical budget, as a multiple of the wheel diameter. Landscape keeps the naive column
		// (label + wheel). Portrait measures what the PINNED composition actually OCCUPIES, top of the
		// label row → bottom of the frame art: label + half the disc + the `wheel.offsetY` knob + the
		// frame's reach below the wheel centre. The wheel is parked at the top of its row
		// (`place-self: start`), so the composition is a pure function of the knobs — and when a short
		// viewport can't hold it, the WHEEL shrinks (this budget) instead of the title and wheel
		// drifting into each other.
		const columnToWheel = portrait
			? LABEL_HEIGHT_TO_WIDTH + 0.5 + WHEEL_OFFSET_Y + FRAME_REACH_BELOW_CENTRE
			: 1 + LABEL_HEIGHT_TO_WIDTH;
		const fromHeight = Math.max(0, rect.height - labelGapPx) / columnToWheel;
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
	const highlightPlacement = $derived(HIGHLIGHT_PLACEMENT[highlightSlot]);

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
			highlightSlot = artSlot(winner);
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
				src={staticUrl('img/free-spin-label.webp')}
				alt="Free spin"
			/>
			<div
				class="free-spin-wheel-stack"
				class:free-spin-wheel-stack--portrait={portrait}
				style:width={stackSizePx}
				style:height={stackSizePx}
			>
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
						<!-- Layer order inside the rotating disc: values → highlight → ropes. The wedge colours
						     are bare here (the ropes are their own layer now), so the glow sits ON the wedge and
						     the ropes draw OVER it — the outline is bounded by the ropes instead of painting on
						     top of them. -->
						<img
							class="free-spin-wheel-values"
							style:--values-scale={FREE_SPIN_VALUES_TUNING.scale}
							src={valuesSrc}
							alt=""
						/>
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
							style:--highlight-angle-deg="{highlightPlacement.rotateDeg}deg"
							style:--highlight-scale-x={highlightPlacement.scaleX}
							style:--highlight-scale-y={highlightPlacement.scaleY}
							style:--highlight-tx="{highlightPlacement.txPct}%"
							style:--highlight-ty="{highlightPlacement.tyPct}%"
							src={highlightSrc}
							alt=""
						/>
						<!-- The ropes. Same artboard as the disc, so this is a plain 1:1 placement — it must NOT
						     be stretched to the stack, or the ropes leave their seams. The tuning scale then
						     grows them about the hub so they run into the ring. -->
						<img
							class="free-spin-divider"
							style:left="{DIVIDER_BOX.left * 100}%"
							style:top="{DIVIDER_BOX.top * 100}%"
							style:width="{DIVIDER_BOX.w * 100}%"
							style:height="{DIVIDER_BOX.h * 100}%"
							style:--divider-origin-x="{DIVIDER_ORIGIN.x}%"
							style:--divider-origin-y="{DIVIDER_ORIGIN.y}%"
							style:--divider-scale={FREE_SPIN_DIVIDER_TUNING.scale}
							src={dividerSrc}
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
	/* Portrait parks the wheel at the TOP of its row, welded to the title row above it, so the
	   title↔wheel relationship is `wheel.offsetY` alone — the row's spare height (which varies with
	   browser chrome and viewport) all falls BELOW the wheel instead of centring it away from the
	   title. The stack must also stay SQUARE: `rouletteSizePx` is already capped against both stage
	   axes in JS, and the default max-width/height clamps do NOT scale the assembly down — every piece
	   inside is `object-fit: fill` on a box measured in % of this one, so a clamped height silently
	   squashes the wheel into an ellipse. The group inside is absolutely positioned; nothing here
	   clips. (Mirrors BonusRoulette.) */
	.free-spin-wheel-stack--portrait {
		max-width: none;
		max-height: none;
		place-self: start center;
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
	/* The coloured disc is inscribed in its square canvas, so it fills the stack exactly — which also
	   means the hub IS this box's centre, so the default 50%/50% origin scales about the hub. */
	.free-spin-wheel-values {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		pointer-events: none;
		transform-origin: 50% 50%;
		transform: scale(var(--values-scale, 1));
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
		/* z-index 1: above the wedge colours, below the ropes (z-index 2). */
		/* Read right-to-left: open to the wedge's angle and pull the arc back to the rim (in the art's own
		   upright frame, about the apex), swing onto the wedge's bisector, then slide the apex off the hub
		   to where the wedge's two ropes actually meet — that last step is what keeps the edges parallel
		   to the ropes. */
		transform: translate(var(--highlight-tx, 0), var(--highlight-ty, 0))
			rotate(var(--highlight-angle-deg, 0deg))
			scale(var(--highlight-scale-x, 1), var(--highlight-scale-y, 1));
	}
	/* Between the highlight (1) and the frame (3): the ropes bound the glow, the ring still covers their
	   ends. `fill` matches the other pieces — the box is already the art's exact aspect ratio.
	   Scaled about the HUB (not the box centre — the art is trimmed) so the ropes reach the ring. */
	.free-spin-divider {
		position: absolute;
		z-index: 2;
		object-fit: fill;
		pointer-events: none;
		transform-origin: var(--divider-origin-x) var(--divider-origin-y);
		transform: scale(var(--divider-scale, 1));
	}
	.free-spin-frame {
		position: absolute;
		z-index: 3;
		object-fit: fill;
		pointer-events: none;
	}
</style>
