<script lang="ts">
	import { onMount } from 'svelte';

	import { bonusRouletteSegmentsForTier } from '../../game-logic/constants';
	import { eventEmitter } from '../../game/eventEmitter';
	import { assertAuthoritativeOutcome } from '../../game/plinkoFairnessGuard';
	import { stateGame } from '../../game/stateGame.svelte';
	import { isPortraitGameLayout } from '../../lib/format';
	import { staticUrl } from '../../lib/staticUrl';

	export type BonusRouletteResult = {
		segmentIndex: number;
		segmentLabel: string;
		freeBallCount: number;
	};

	type Props = {
		mode?: 'roulette' | 'message';
		messageTitle?: string;
		messageValue?: string;
		messageHint?: string;
		/** Bonus-end win screen: render the "CONGRATULATIONS! / YOU HAVE WON / $value" treasure layout
		 * (rising treasure table + twinkling sparkles) instead of the falling-coin free-balls congrats. */
		treasureWin?: boolean;
		/** The pre-formatted win amount shown big in the AustereBlackCapsSSK value font (e.g. "$1,733"). */
		winValue?: string;
		targetFreeBalls?: number;
		/** When true, wheel outcome must come from `targetFreeBalls` (RGS/math book). */
		serverAuthoritative?: boolean;
		/** Buy bonus: skip the wheel spin entirely and announce "you won `targetFreeBalls` drops" directly
		 * (the entry count is fixed by the purchase, so there's nothing to spin for). */
		skipSpin?: boolean;
		/** Replay mode: auto-press the "press anywhere" announcement (no player to click). */
		autoDismiss?: boolean;
		onFinished?: (result: BonusRouletteResult) => void;
		onResultReady?: (result: BonusRouletteResult) => void;
		onClosed?: () => void;
	};

	const props: Props = $props();

	/** Shared wheel diameter from viewport; label/wheel derive from this. */
	const LABEL_HEIGHT_TO_WIDTH = 594 / 1280;
	/** Per the bonus art, the "FREE BALLS" banner is wider than the wheel — it's the widest element and
	 * therefore drives the horizontal budget (the wheel = label / LABEL_TO_WHEEL). */
	const LABEL_TO_WHEEL = 1.1;
	/** Label width as a fraction of the viewport. Mobile fills the screen to match the reference art;
	 * desktop keeps the prior, smaller footprint (≈0.8/1.1 ≈ 0.72vw wheel as before). */
	const MOBILE_LABEL_VW = 0.96;
	const DESKTOP_LABEL_VW = 0.8;
	/** Vertical gap between the banner and the wheel, as a fraction of the wheel diameter. Sized so the
	 * frame's crown pointer (which pokes ~0.10·wheel above the ring) clears the banner. */
	const LABEL_GAP_TO_WHEEL = 0.1;

	// ─── Tuning knobs: independently scale & reposition the roulette pieces ─────────────────────────
	// EDIT THESE to move/resize the bonus roulette. Values are split by orientation: `landscape` is used
	// on desktop/wide layouts, `portrait` on mobile/tall layouts (chosen by `portrait` below).
	//   scale:    1 = base size (what the layout computes); >1 = larger, <1 = smaller. For `wheel` this
	//             sizes the assembly by its OUTER (wooden ring) diameter = rouletteSizePx × scale.
	//   offsetX:  horizontal shift as a fraction of `rouletteSizePx` (positive = right).
	//   offsetY:  vertical shift as a fraction of `rouletteSizePx` (positive = down).
	// ⚠️ The offsets are fractions of the UNSCALED `rouletteSizePx`, not of the on-screen diameter, so
	// they do not follow `scale` — changing one does not require re-tuning the other.
	// `wheel` moves/scales the whole assembly (disc + highlight + frame) as one — they must stay
	// registered with each other, so there are no separate frame/marker knobs (the pointer is baked into
	// the frame art).
	// Note: pieces are clipped at the screen edges (the overlay hides overflow), so very large scales
	// will crop — lower the scale or nudge with the offsets.
	const BONUS_ROULETTE_TUNING = {
		landscape: {
			label: { scale: 1.8, offsetX: 0, offsetY: -0.05 },
			wheel: { scale: 1.8, offsetX: 0, offsetY: 0.3 },
		},
		portrait: {
			label: { scale: 1.2, offsetX: 0, offsetY: 0 },
			wheel: { scale: 1.2, offsetX: 0, offsetY: -0.2 },
		},
	};

	// ⚠️ DEBUG ONLY — set back to `false` before shipping. When true, the roulette assembles and then
	// stays on screen (no auto-spin, no auto-advance to the announcement) so the layout can be inspected.
	// The bonus round will NOT resolve while this is on.
	const DEBUG_KEEP_OPEN = false;

	// ⚠️ DEBUG ONLY — extra delay (ms) before the wheel starts spinning, so the assembled layout can be
	// inspected first. Set back to `0` before shipping. Added on top of the normal pre-spin delay.
	const DEBUG_SPIN_DELAY_MS = 0;

	// ─── Wheel art (img/free_bonus_roulette_v2) ────────────────────────────────────────────────────
	// Three flat pieces, layered disc → highlight → frame (mirrors FreeSpinRoulette). This replaced the
	// old runtime reassembly (label-less ring PNG + one value-wedge SVG per segment). Native measurements
	// below were recovered from the PNGs themselves (opaque-mask radial scans + least-squares circle/edge
	// fits), which is what registers them to each other:
	//   wheel_values.png (1806²) — the ROTATING disc, with the free-ball values BAKED IN. The coloured
	//     disc is inscribed in the square canvas: centre (903,903), r=903, so it renders at exactly the
	//     stack's box.
	//   wheel_base.png (1971×2109) — the STATIC frame: wooden ring + top crown pointer + bottom ornament
	//     + centre skull medallion all baked into ONE image, so none of them can rotate independently
	//     (the old separate marker <img> and counter-rotating centre base are gone). Ring centre
	//     (986.2, 1117.5) — note that is ~3% BELOW the canvas centre because the crown is taller than the
	//     bottom ornament, hence the asymmetric `top` below — outer r=932.3.
	//   wheel_segment_highlight.png (510×633) — ONE 40° wedge glow. ⚠️ It is a hollow OUTLINE, not a
	//     fill: the interior is alpha 0 and only the gold rim + soft green glow are painted, so it traces
	//     the wedge's perimeter. Its apex (261.16, 770.55) is 137px BELOW its own canvas — the art is a
	//     TRUNCATED wedge whose point is cut off where the medallion covers it. Its edges sit at
	//     -19.95°/+19.16° from its own vertical (i.e. it is very slightly lopsided).
	const BASE_PNG = { w: 1971, h: 2109, cx: 986.2, cy: 1117.5, outerR: 932.3, opaqueInnerR: 779 };
	const HIGHLIGHT_PNG = {
		w: 510,
		h: 633,
		apexX: 261.16,
		apexY: 770.55,
		r: 769.5,
		edgeLDeg: -19.954,
		edgeRDeg: 19.157,
	};
	/** Disc radius in wheel_values.png px — the frame of reference for ART_WEDGE_GEOMETRY below. */
	const VALUES_ART_R = 903;

	/** Disc radius, expressed in base-PNG px — i.e. how far the disc reaches under the ring.
	 * ⚠️ This is the disc's OWN radius (1:1), NOT the ring's inner radius — the opposite of what the
	 * free-spin wheel does, because this art is built differently. The three PNGs here are layers of ONE
	 * artwork exported at the SAME scale, proven three ways: the ropes stop at r≈775 and the ring's
	 * opaque inner edge is 779; the highlight's arc is 770 from its apex and slot 0's apex sits 7.2px off
	 * the hub (7.2+770 = 777). So the ring is MEANT to cover everything past r≈779 — and it must, because
	 * past its rope the art leaves a DARK GREY divider stub running all the way out to the rim (the wedge
	 * COLOURS do reach the rim, so nothing shows through). Scaling the disc so its rim met the ring's
	 * inner edge instead put those stubs on screen as black spokes at every boundary. */
	const DISC_R_IN_BASE_PX = VALUES_ART_R;
	/** Hub-radius (in values-art px) every wedge's highlight arc is pinned to = the ring's opaque inner
	 * edge, so the outline reaches the ring and the soft glow that bleeds past it is hidden underneath. */
	const HIGHLIGHT_ARC_R = BASE_PNG.opaqueInnerR;

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
	// Sized so the art's own arc radius maps to HIGHLIGHT_ARC_R; the per-slot scaleY below then pins the
	// arc there for every wedge. The apex end is hidden under the frame's medallion.
	const highlightScale = ((HIGHLIGHT_ARC_R / VALUES_ART_R) * 0.5) / HIGHLIGHT_PNG.r;
	const HIGHLIGHT_BOX = {
		w: HIGHLIGHT_PNG.w * highlightScale,
		h: HIGHLIGHT_PNG.h * highlightScale,
		left: 0.5 - HIGHLIGHT_PNG.apexX * highlightScale,
		top: 0.5 - HIGHLIGHT_PNG.apexY * highlightScale,
	};
	// The apex, as a % of the highlight's own box. Every transform pivots here, so the outline swings and
	// squeezes about its own point rather than sliding. y > 100% — the apex is below the box.
	const HIGHLIGHT_ORIGIN = {
		x: (HIGHLIGHT_PNG.apexX / HIGHLIGHT_PNG.w) * 100,
		y: (HIGHLIGHT_PNG.apexY / HIGHLIGHT_PNG.h) * 100,
	};

	const valuesSrc = staticUrl('img/free_bonus_roulette_v2/wheel_values.png');
	const frameSrc = staticUrl('img/free_bonus_roulette_v2/wheel_base.png');
	const highlightSrc = staticUrl('img/free_bonus_roulette_v2/wheel_segment_highlight.png');

	/** Free-ball values BAKED into wheel_values.png, clockwise from the wedge parked under the pointer at
	 * rotation 0. Recovered by hue-sampling the art at each wedge's bisector (100 red, 90 orange, 80 blue,
	 * 70 amber, 60 teal, 50 green, 40 purple, 30 magenta, 20 dark green).
	 * ⚠️ This is what makes the wheel land on the value it PAYS: `artSlot()` maps a segment onto its wedge
	 * BY VALUE, so the wheel stays honest even if `BONUS_WHEEL_FREE_BALLS` is ever reordered. (The
	 * free-spin wheel's art is offset from its constant by 3 wedges; this one happens to line up, but do
	 * not rely on index === slot.) If the art is re-exported with the values in a different order, fix
	 * this array — it is the single source of truth for art order.
	 * ⚠️ 50 and 20 are both green and differ only in brightness — a hue-only check would merge them. */
	const ART_SLOT_FREE_BALLS = [100, 90, 80, 70, 60, 50, 40, 30, 20];

	/** Geometry of each wedge's ROPE-FREE INTERIOR, by ART SLOT (0 = the wedge the art parks under the
	 * pointer = 100, then clockwise).
	 * ⚠️ The 9 rope dividers are NOT radial — each is offset from the hub by up to 16px, so the two ropes
	 * bounding a wedge meet at a point that is NOT the hub (up to 46px away). An outline pivoted about the
	 * HUB therefore CROSSES its ropes: snug at one radius, gaping at another. Pin the outline's apex to
	 * `apexX/apexY` instead and its edges run PARALLEL to the ropes at a constant pixel gap.
	 * Note the rope DIRECTIONS land within 0.55° of the ideal 40° grid — an angular histogram of the rope
	 * pixels reads them as ±1.9° off, but that is an artefact of the hub offset, NOT real.
	 * Recovered by total-least-squares line-fitting each rope's core pixels, offsetting each line inward
	 * by its measured half-width (≈5.5px) + 2px of daylight, and intersecting the pairs.
	 *   apexX/apexY: where a wedge's two rope-inner-edges meet, relative to the hub, in wheel_values.png
	 *                px (VALUES_ART_R). +y is DOWN, matching CSS.
	 *   bisectorDeg: direction of that interior's bisector, clockwise from the pointer.
	 *   halfDeg:     half the angle between the two ropes. */
	const ART_WEDGE_GEOMETRY = [
		{ apexX: 2.9, apexY: -7.2, bisectorDeg: 0.168, halfDeg: 19.965 }, // 100
		{ apexX: 17.0, apexY: -2.2, bisectorDeg: 40.203, halfDeg: 20.07 }, // 90
		{ apexX: 21.9, apexY: 12.3, bisectorDeg: 80.162, halfDeg: 19.889 }, // 80
		{ apexX: 34.4, apexY: 29.9, bisectorDeg: 120.129, halfDeg: 20.079 }, // 70
		{ apexX: 12.3, apexY: 27.0, bisectorDeg: 160.379, halfDeg: 20.171 }, // 60
		{ apexX: -2.8, apexY: 37.5, bisectorDeg: 200.532, halfDeg: 19.982 }, // 50
		{ apexX: -11.2, apexY: 24.2, bisectorDeg: 240.226, halfDeg: 19.712 }, // 40
		{ apexX: -19.5, apexY: 10.5, bisectorDeg: 280.098, halfDeg: 20.16 }, // 30
		{ apexX: -11.1, apexY: -2.1, bisectorDeg: 320.23, halfDeg: 19.972 }, // 20
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
		// (apex + direction) fixed, and the directions depend only on sx/sy.
		const ratio = squeezeForHalf(g.halfDeg);
		const bisRad = g.bisectorDeg * DEG;
		// How far the apex sits OUTWARD along the wedge's bisector. ⚠️ The outline's arc rides on the
		// apex, so left uncompensated this shoves the arc the same distance past the ring's inner edge and
		// the ring eats the outer band (worst here: slot 3's apex is 45px out).
		const outward = g.apexX * Math.sin(bisRad) - g.apexY * Math.cos(bisRad);
		const scaleY = (HIGHLIGHT_ARC_R - outward) / HIGHLIGHT_ARC_R;
		return {
			rotateDeg: g.bisectorDeg - squeezedEdges(ratio).bisectorDeg,
			scaleX: ratio * scaleY,
			scaleY,
			txPct: (((g.apexX / VALUES_ART_R) * 0.5) / HIGHLIGHT_BOX.w) * 100,
			tyPct: (((g.apexY / VALUES_ART_R) * 0.5) / HIGHLIGHT_BOX.h) * 100,
		};
	});

	// ─── Congratulations-screen coin shower ────────────────────────────────────────────────────────
	// Two coin art variants fall behind the headline while the "PRESS ANYWHERE" screen is up. Generated
	// once per mount (not reactive) so the shower doesn't reshuffle on every render.
	const ANNOUNCEMENT_COIN_IMAGES = [
		staticUrl('img/congratulations_screen/coin_1.png'),
		staticUrl('img/congratulations_screen/coin_2.png'),
	];
	type AnnouncementCoin = {
		id: number;
		img: string;
		leftPct: number;
		sizeVw: number;
		durationS: number;
		delayS: number;
		rotateDeg: number;
		driftPx: number;
	};
	const ANNOUNCEMENT_COIN_COUNT = 24;
	const announcementCoins: AnnouncementCoin[] = Array.from(
		{ length: ANNOUNCEMENT_COIN_COUNT },
		(_, i) => {
			// Slow fall so the rotation reads as a gentle tumble rather than a spin.
			const durationS = 5.5 + Math.random() * 3;
			return {
				id: i,
				img: ANNOUNCEMENT_COIN_IMAGES[i % ANNOUNCEMENT_COIN_IMAGES.length],
				leftPct: Math.random() * 100,
				sizeVw: 3.2 + Math.random() * 3.6,
				durationS,
				// Spread across the FULL fall cycle (not just a beat) so the shower never reads as one
				// synchronized curtain — at any moment some coins are just starting, some mid-fall, some
				// about to loop. Every coin's first frame is still its 0% keyframe (off-screen above the
				// view, opacity 0), so each one genuinely starts its fall from the top, just at its own
				// staggered moment.
				delayS: Math.random() * durationS,
				rotateDeg: (Math.random() < 0.5 ? -1 : 1) * (180 + Math.random() * 280),
				driftPx: (Math.random() - 0.5) * 160,
			};
		},
	);

	// ─── Treasure-win congratulations screen (treasureWin) ───────────────────────────────────────────
	// The bonus-end "CONGRATULATIONS! / YOU HAVE WON / $X" screen swaps the falling-coin shower for a
	// treasure table that rises from the bottom, with white star sparkles twinkling over the hoard and the
	// win value (matches the reference art + guide video). Positions are hand-placed over the art.
	const TREASURE_ART = staticUrl('img/congratulations_screen/treasure_table.png');
	const SPARKLE_ART = staticUrl('img/congratulations_screen/sparkle.png');
	type Sparkle = {
		id: number;
		xPct: number;
		yPct: number;
		size: number;
		durationS: number;
		delayS: number;
	};
	// ⚙️ SPARKLE POSITIONS — edit these to move/resize each sparkle. One entry per sparkle; positions are
	// over the treasure art (chest+coins left, loose coins centre, sack+barrel right), and the sparkles
	// live INSIDE the treasure wrap so they track it as it rises and across screen sizes.
	//   x    — horizontal position: 0 = left edge of the treasure, 50 = centre, 100 = right edge
	//   y    — vertical position:   0 = top of the treasure, 100 = bottom (the floor)
	//   size — sparkle width as a % of the treasure's width (bigger number = bigger star)
	// Add or delete a line to add or remove a sparkle. The trailing comment just notes what each sits on.
	const TREASURE_SPARKLE_POSITIONS: Array<{ x: number; y: number; size: number }> = [
		{ x: 13.4, y: 38.4, size: 6.4 }, // chest — front-left coins
		{ x: 23.3, y: 29.4, size: 6.6 }, // chest — upper coins
		{ x: 37.5, y: 55.9, size: 4.2 }, // floor coin right of the chest
		{ x: 24.1, y: 76.8, size: 5.5 }, // floor coins below the chest
		{ x: 60.7, y: 53.1, size: 4.4 }, // centre floor coins (left)
		{ x: 67.6, y: 50.4, size: 4.2 }, // centre floor coins (right)
		{ x: 87.0, y: 17.9, size: 4.9 }, // barrel top rim
		{ x: 77.0, y: 67.9, size: 5.2 }, // coins left of the sack
		{ x: 89.35, y: 65.7, size: 4.9 }, // bottom-right coins
	];
	const treasureSparkles: Sparkle[] = TREASURE_SPARKLE_POSITIONS.map((p, i) => ({
		id: i,
		xPct: p.x,
		yPct: p.y,
		size: p.size,
		durationS: 1.1 + Math.random() * 0.9,
		delayS: -Math.random() * 2,
	}));

	let slidePhase = $state<'enter' | 'idle' | 'exit'>('enter');
	let bgJoined = $state(false);
	let labelVisible = $state(false);
	let wheelVisible = $state(false);
	let wheelSpinClass = $state(false);
	let wheelRotationDeg = $state(0);
	let announcementVisible = $state(false);
	let announcementBgVisible = $state(false);
	let announcementTextVisible = $state(false);
	let announcementCoinsVisible = $state(false);
	let wonFreeBalls = $state(0);
	// Bound to the rotating wheel container (was the single wheel <img>). Drives the settle transitionend
	// and is read each frame to know which wedge is under the top marker.
	let wheelEl = $state<HTMLDivElement | undefined>(undefined);
	let stageEl = $state<HTMLDivElement | undefined>(undefined);
	/** Art slot the outline is glued to. It rides INSIDE the rotating disc, so between hand-offs it
	 * follows its wedge for free; the tracker just re-points it at each boundary. Starts on the wedge the
	 * art parks under the pointer (slot 0 = 100), matching the wheel's rest pose. */
	let highlightSlot = $state(0);
	let highlightRaf = 0;
	// Throttle the tick SFX only (the glow hand-off below still updates every wedge). Near the start of
	// the spin the wheel crosses a wedge almost every frame, so an un-throttled tick fires ~60×/s and
	// the identical waveforms stack into a clipped, distorted buzz. A min gap keeps a clean ratchet.
	const ROULETTE_TICK_MIN_GAP_MS = 55;
	let lastTickAt = 0;
	let rouletteSizePx = $state(0);
	let pendingResult: BonusRouletteResult | null = null;
	let resultReadyEmitted = false;
	const timers: ReturnType<typeof setTimeout>[] = [];
	// Mobile UA *or* tall-narrow portrait layout — matches how the rest of the game (Background, Result,
	// Game, BonusLevelUpOverlay) picks its mobile/portrait assets, so the mobile art shows in both.
	const portrait = isPortraitGameLayout();

	// Resolve the orientation-specific tuning knobs (see BONUS_ROULETTE_TUNING above).
	const tuning = portrait ? BONUS_ROULETTE_TUNING.portrait : BONUS_ROULETTE_TUNING.landscape;
	const LABEL_SCALE = tuning.label.scale;
	const LABEL_OFFSET_X = tuning.label.offsetX;
	const LABEL_OFFSET_Y = tuning.label.offsetY;
	const WHEEL_SCALE = tuning.wheel.scale;
	const WHEEL_OFFSET_X = tuning.wheel.offsetX;
	const WHEEL_OFFSET_Y = tuning.wheel.offsetY;

	/** `wheel.scale` is expressed as the assembly's OUTER (ring) diameter, but the group it drives scales
	 * the DISC — so divide out the ring:disc ratio. Keeps the knob stable if the disc/ring fit changes,
	 * and preserves the knob's original values from the old (ring-sized) wheel image. */
	const RING_OUTER_TO_DISC = BASE_PNG.outerR / DISC_R_IN_BASE_PX;
	const wheelGroupScale = WHEEL_SCALE / RING_OUTER_TO_DISC;

	function updateRouletteLayout() {
		const stage = stageEl;
		if (!stage) return;
		const rect = stage.getBoundingClientRect();
		if (rect.width <= 0 || rect.height <= 0) return;
		// The banner is the widest element, so the horizontal budget caps the label width; the wheel is
		// derived from it (wheel = label / LABEL_TO_WHEEL), matching the reference proportions.
		const labelVwCap = window.innerWidth * (portrait ? MOBILE_LABEL_VW : DESKTOP_LABEL_VW);
		const maxLabelWidth = Math.min(labelVwCap, rect.width);
		const wheelFromWidth = maxLabelWidth / LABEL_TO_WHEEL;
		// Column height = label height + gap + wheel, all expressed as multiples of the wheel diameter.
		const columnToWheel = LABEL_TO_WHEEL * LABEL_HEIGHT_TO_WIDTH + LABEL_GAP_TO_WHEEL + 1;
		const wheelFromHeight = Math.max(0, rect.height) / columnToWheel;
		rouletteSizePx = Math.max(0, Math.floor(Math.min(wheelFromWidth, wheelFromHeight)));
	}

	const labelWidthPx = $derived(
		rouletteSizePx > 0 ? `${Math.round(rouletteSizePx * LABEL_TO_WHEEL)}px` : undefined,
	);
	const labelGapPx = $derived(
		rouletteSizePx > 0 ? `${Math.round(rouletteSizePx * LABEL_GAP_TO_WHEEL)}px` : undefined,
	);
	const stackSizePx = $derived(rouletteSizePx > 0 ? `${rouletteSizePx}px` : undefined);
	const highlightPlacement = $derived(HIGHLIGHT_PLACEMENT[highlightSlot]);

	// Tuning offsets, resolved to px from the wheel diameter (positive X → right, positive Y → down).
	const labelOffsetXPx = $derived(`${Math.round(rouletteSizePx * LABEL_OFFSET_X)}px`);
	const labelOffsetYPx = $derived(`${Math.round(rouletteSizePx * LABEL_OFFSET_Y)}px`);
	const wheelOffsetXPx = $derived(`${Math.round(rouletteSizePx * WHEEL_OFFSET_X)}px`);
	const wheelOffsetYPx = $derived(`${Math.round(rouletteSizePx * WHEEL_OFFSET_Y)}px`);

	const headlineText = $derived(
		props.mode === 'message' ? (props.messageTitle ?? 'CONGRATULATIONS!') : 'CONGRATULATIONS!',
	);
	const rewardText = $derived(
		props.mode === 'message' ? (props.messageValue ?? '') : `YOU WON ${wonFreeBalls} DROPS`,
	);

	// Wheel values. `stateGame.ballPerDrop` is the real selected tier (the HUD shows 1 during the bonus,
	// but the tier is unchanged); the values are tier-INDEPENDENT and are baked into the art.
	const segments = $derived(
		bonusRouletteSegmentsForTier(stateGame.ballPerDrop).map((freeBalls, i) => ({
			label: String(freeBalls),
			freeBalls,
			index: i,
		})),
	);
	// The art is 9 equal 40° slices; the per-segment angle derives from the art so they cannot drift.
	const segAngle = 360 / ART_SLOT_FREE_BALLS.length;

	/** Which art slot segment `index` occupies — matched BY VALUE, so the wedge that stops under the
	 * pointer is always the one the book pays. Returns -1 if the value isn't on the wheel. */
	function artSlot(index: number): number {
		const seg = segments[index];
		return seg ? ART_SLOT_FREE_BALLS.indexOf(seg.freeBalls) : -1;
	}

	/** Where segment `index` actually sits, in degrees clockwise from the pointer, at rotation 0. Used
	 * for the landing, so the wedge settles centred under the pointer. */
	function segmentAngleFromTop(index: number): number {
		const slot = artSlot(index);
		return slot >= 0 ? ART_WEDGE_GEOMETRY[slot].bisectorDeg : 0;
	}

	/** How long the roulette screen's backdrop takes to slide down and cover the view — matches the
	 * `.bonus-spin-bg-drop` transform transition (0.62s). Used to land the closing-door slam on it. */
	const BONUS_BG_SLIDE_MS = 620;

	/** Fire the same closing-door slam that the congratulations screen uses, timed to land as a screen
	 * finishes sliding down. `slideMs` is that screen's slide duration; the slam sits at the sprite's
	 * start, so schedule it ahead of the settle (sprite lead-in + audio latency + a 0.2s advance). */
	function scheduleDoorCloseForSlide(slideMs: number) {
		timers.push(
			setTimeout(
				() => eventEmitter.broadcast({ type: 'soundOnce', name: 'doorClose' }),
				Math.max(0, slideMs - 240),
			),
		);
	}

	onMount(() => {
		if (props.mode === 'message') {
			requestAnimationFrame(() => (slidePhase = 'idle'));
			startAnnouncementSequence();
			return cleanup;
		}
		// Buy bonus: the entry count is fixed by the purchase — skip the wheel and announce it directly,
		// still emitting onResultReady/onFinished so the bonus-round award flow is unchanged.
		if (props.skipSpin) {
			requestAnimationFrame(() => (slidePhase = 'idle'));
			const freeBallCount = Math.max(0, Math.floor(props.targetFreeBalls ?? 0));
			pendingResult = { segmentIndex: 0, segmentLabel: String(freeBallCount), freeBallCount };
			wonFreeBalls = freeBallCount;
			startAnnouncementSequence();
			return cleanup;
		}
		requestAnimationFrame(() => {
			slidePhase = 'idle';
			bgJoined = true;
			// The bonus roulette screen slides down now (bg-drop) — play the same closing-door slam as the
			// congratulations screen, landing as the backdrop finishes covering the view.
			scheduleDoorCloseForSlide(BONUS_BG_SLIDE_MS);
		});
		const assembleTimer = setTimeout(() => {
			labelVisible = true;
			wheelVisible = true;
			// DEBUG_KEEP_OPEN: hold the assembled roulette on screen — skip the spin (and the announcement
			// it leads into) so the layout stays visible for inspection.
			if (DEBUG_KEEP_OPEN) return;
			const spinTimer = setTimeout(() => startSpin(), 360 + DEBUG_SPIN_DELAY_MS);
			timers.push(spinTimer);
		}, 620);
		timers.push(assembleTimer);
		return cleanup;
	});

	function cleanup() {
		timers.forEach(clearTimeout);
		stopHighlightTracking();
	}

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

	function resolveWinnerIndex(): number {
		if (props.targetFreeBalls != null) {
			const match = segments.findIndex((s) => s.freeBalls === props.targetFreeBalls);
			if (match >= 0) return match;
		}
		// Provably-fair guard: a live spin must resolve to the book's `targetFreeBalls` segment. Falling
		// back to segment 0 / a client-random segment live would break fairness, so surface it (throws in DEV).
		assertAuthoritativeOutcome('BonusRoulette spin without a matching authoritative segment', {
			targetFreeBalls: props.targetFreeBalls,
			serverAuthoritative: props.serverAuthoritative,
		});
		if (props.serverAuthoritative) return 0;
		return Math.floor(Math.random() * segments.length);
	}

	/** Art slot of the wedge under the marker RIGHT NOW, read from the wheel's LIVE (mid-transition)
	 * rotation θ. A wedge at art angle `a` displays at `a + θ`, so the one under the marker (0°) is the
	 * one with `a ≈ -θ`. The ideal 40° grid is accurate enough to pick the slot (the bisectors are all
	 * within ~0.6° of it); the slot's exact geometry then comes from ART_WEDGE_GEOMETRY. */
	function currentTopSlot(): number {
		const el = wheelEl;
		if (!el) return 0;
		const t = getComputedStyle(el).transform;
		if (!t || t === 'none') return 0;
		const m = new DOMMatrixReadOnly(t);
		const theta = (Math.atan2(m.b, m.a) * 180) / Math.PI;
		const n = ART_SLOT_FREE_BALLS.length;
		return ((Math.round(-theta / segAngle) % n) + n) % n;
	}

	/** Ratchet "tick" each time a new wedge reaches the marker — the highlight hand-off already marks
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

	function startSpin() {
		const winner = resolveWinnerIndex();
		const extraRounds = 5 + Math.floor(Math.random() * 3);
		const targetDeg = wheelRotationDeg + extraRounds * 360 - segmentAngleFromTop(winner);
		let settled = false;
		const settle = () => {
			if (settled) return;
			settled = true;
			// Stop the per-frame tracking and pin the glow on the landed wedge (it's under the marker now).
			stopHighlightTracking();
			highlightSlot = Math.max(0, artSlot(winner));
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
		const landed = segments[winner];
		const freeBallCount =
			props.serverAuthoritative && props.targetFreeBalls != null
				? props.targetFreeBalls
				: landed.freeBalls;
		timers.push(
			setTimeout(() => {
				labelVisible = false;
				wheelVisible = false;
				pendingResult = {
					segmentIndex: winner,
					segmentLabel: String(freeBallCount),
					freeBallCount,
				};
				wonFreeBalls = freeBallCount;
				startAnnouncementSequence();
			}, 850),
		);
	}

	/** Replay has no player to dismiss the "press anywhere" screen — show it briefly, then advance.
	 * Measured from the start of the slide-down, so it must clear the 1s slide plus a beat of readable
	 * hold before auto-advancing. */
	const AUTO_DISMISS_DELAY_MS = 2000;

	/** How long the congratulations screen takes to slide down and fully cover the view — matches the
	 * `.bonus-announcement` transform transition (1s). The text also fades in at this mark. */
	const ANNOUNCEMENT_SLIDE_MS = 1000;

	/** How long the overlay takes to slide back up and off screen on dismiss — matches the
	 * `.bonus-spin-overlay` exit transform transition (1s). */
	const ANNOUNCEMENT_SLIDE_UP_MS = 1000;

	/** How long the headline/reward "pop" reveal takes to fully finish — the reward's
	 * `animation-delay` (0.12s) plus its `bonus-announcement-pop` duration (0.6s). Coins are held off
	 * until this elapses so the message finishes animating before the shower starts. ⚠️ Keep in sync
	 * with the CSS below. */
	const ANNOUNCEMENT_TEXT_POP_MS = 720;

	function startAnnouncementSequence() {
		announcementVisible = true;
		if (pendingResult && !resultReadyEmitted) {
			resultReadyEmitted = true;
			props.onResultReady?.(pendingResult);
		}
		// Kick the slide-down. The announcement mounts at translateY(-100%) and animates to 0 when the
		// `--bg-visible` class lands. The browser only runs the CSS transform transition if it has
		// PAINTED the off-screen start state first — a single rAF can toggle the class before that first
		// paint, so the screen SNAPS into place with no visible slide. A double rAF guarantees one paint
		// at translateY(-100%) before we flip to translateY(0), so the slide actually plays.
		requestAnimationFrame(() =>
			requestAnimationFrame(() => {
				announcementBgVisible = true;
				// The slide-down starts on THIS frame, so measure the sound + text off it. Land the
				// closing-door slam as the screen finishes covering the view.
				scheduleDoorCloseForSlide(ANNOUNCEMENT_SLIDE_MS);
				timers.push(setTimeout(() => (announcementTextVisible = true), ANNOUNCEMENT_SLIDE_MS));
				timers.push(
					setTimeout(
						() => (announcementCoinsVisible = true),
						ANNOUNCEMENT_SLIDE_MS + ANNOUNCEMENT_TEXT_POP_MS,
					),
				);
			}),
		);
		if (props.autoDismiss) {
			timers.push(setTimeout(() => onAnnouncementClick(), AUTO_DISMISS_DELAY_MS));
		}
	}

	function onAnnouncementClick() {
		if (!announcementVisible) return;
		announcementTextVisible = false;
		announcementCoinsVisible = false;
		// The screen slides back up to reveal the game — play the opening-door creak to match.
		eventEmitter.broadcast({ type: 'soundOnce', name: 'doorOpen' });
		slidePhase = 'exit';
		timers.push(
			setTimeout(() => {
				props.onClosed?.();
				if (props.mode === 'message') return;
				const result = pendingResult;
				pendingResult = null;
				if (result) props.onFinished?.(result);
			}, ANNOUNCEMENT_SLIDE_UP_MS + 320),
		);
	}
</script>

<div
	class="bonus-spin-overlay"
	class:bonus-spin-overlay--idle={slidePhase === 'idle'}
	class:bonus-spin-overlay--exit={slidePhase === 'exit'}
	role="dialog"
	aria-modal="true"
	aria-label="Bonus roulette wheel"
>
	{#if props.mode !== 'message'}
		<div
			class="bonus-spin-bg-drop"
			class:bonus-spin-bg-drop--visible={bgJoined}
			style:background-image="url({portrait
				? staticUrl('img/bonus-roulette-background-mobile.png')
				: staticUrl('img/bonus-roulette-background.png')})"
		></div>
		<div class="bonus-spin-content">
			<div class="bonus-spin-stage" bind:this={stageEl}>
				<img
					class="bonus-spin-title"
					class:bonus-spin-title--visible={labelVisible}
					style:width={labelWidthPx}
					style:margin-bottom={labelGapPx}
					style:--label-scale={LABEL_SCALE}
					style:--label-offset-x={labelOffsetXPx}
					style:--label-offset-y={labelOffsetYPx}
					src={staticUrl('img/bonus-roulette-label.png')}
					alt="Free balls"
				/>
				<div class="bonus-spin-wheel-stack" style:width={stackSizePx} style:height={stackSizePx}>
					<!-- One transformed group so the disc, highlight and frame keep their measured registration
					     under the tuning scale/offsets and the entry animation. -->
					<div
						class="bonus-spin-wheel-group"
						class:bonus-spin-wheel-group--visible={wheelVisible}
						style:--wheel-scale={wheelGroupScale}
						style:--wheel-offset-x={wheelOffsetXPx}
						style:--wheel-offset-y={wheelOffsetYPx}
					>
						<div
							bind:this={wheelEl}
							class="bonus-spin-wheel"
							class:bonus-spin-wheel--animating={wheelSpinClass}
							style:--wheel-rotation-deg="{wheelRotationDeg}deg"
							role="img"
							aria-label="Bonus roulette wheel"
						>
							<img class="bonus-spin-wheel-values" src={valuesSrc} alt="" />
							<!-- Rides INSIDE the rotating disc, so it stays glued to its wedge while the wheel turns;
							     the rAF tracker only re-points it as each new wedge reaches the marker. -->
							<img
								class="bonus-spin-highlight"
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
						</div>
						<img
							class="bonus-spin-frame"
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
	{/if}

	{#if announcementVisible}
		<button
			type="button"
			class="bonus-announcement"
			class:bonus-announcement--win={props.mode === 'message'}
			class:bonus-announcement--treasure={props.treasureWin}
			class:bonus-announcement--mobile={portrait}
			class:bonus-announcement--bg-visible={announcementBgVisible}
			class:bonus-announcement--text-visible={announcementTextVisible}
			class:bonus-announcement--coins-visible={announcementCoinsVisible}
			style:background-image="url({portrait
				? staticUrl('img/announcement-message-background-mobile.png')
				: staticUrl('img/announcement-message-background.png')})"
			onclick={onAnnouncementClick}
		>
			{#if props.treasureWin}
				<!-- Treasure table rises up from the bottom, then its sparkles twinkle over the hoard. -->
				<div
					class="congrats-treasure"
					class:congrats-treasure--in={announcementTextVisible}
					aria-hidden="true"
				>
					<img class="congrats-treasure-img" src={TREASURE_ART} alt="" />
					<div class="congrats-sparkles" class:congrats-sparkles--on={announcementCoinsVisible}>
						{#each treasureSparkles as sp (sp.id)}
							<img
								class="congrats-sparkle"
								src={SPARKLE_ART}
								alt=""
								style:left="{sp.xPct}%"
								style:top="{sp.yPct}%"
								style:width="{sp.size}%"
								style:animation-duration="{sp.durationS}s"
								style:animation-delay="{sp.delayS}s"
							/>
						{/each}
					</div>
				</div>
			{:else}
				<div class="bonus-announcement-coins" aria-hidden="true">
					{#each announcementCoins as coin (coin.id)}
						<img
							class="bonus-announcement-coin"
							src={coin.img}
							alt=""
							style:left="{coin.leftPct}%"
							style:width="{coin.sizeVw}vw"
							style:animation-duration="{coin.durationS}s"
							style:animation-delay="{coin.delayS}s"
							style:--coin-rotate="{coin.rotateDeg}deg"
							style:--coin-drift="{coin.driftPx}px"
						/>
					{/each}
				</div>
			{/if}
			<div class="bonus-announcement-main">
				<div class="bonus-announcement-headline">
					<span class="bonus-announcement-text-stroke" aria-hidden="true">{headlineText}</span>
					<span class="bonus-announcement-text-fill bonus-announcement-text-fill--headline"
						>{headlineText}</span
					>
				</div>
				<div class="bonus-announcement-reward">
					<span class="bonus-announcement-text-stroke" aria-hidden="true">{rewardText}</span>
					<span class="bonus-announcement-text-fill bonus-announcement-text-fill--reward"
						>{rewardText}</span
					>
				</div>
				{#if props.treasureWin}
					<div class="congrats-value" class:congrats-value--in={announcementTextVisible}>
						<span class="congrats-value-stroke" aria-hidden="true">{props.winValue ?? ''}</span>
						<span class="congrats-value-fill">{props.winValue ?? ''}</span>
					</div>
				{/if}
			</div>
			<div class="bonus-announcement-hint">
				{props.messageHint ?? 'PRESS ANYWHERE TO GO BACK TO THE GAME'}
			</div>
		</button>
	{/if}
</div>

<style>
	.bonus-spin-overlay {
		position: absolute;
		inset: 0;
		z-index: 12000;
		display: flex;
		overflow: hidden;
		transform: translateX(0);
		transition:
			transform 1s cubic-bezier(0.33, 1, 0.68, 1),
			opacity 0.8s ease;
		pointer-events: auto;
	}
	.bonus-spin-overlay--exit {
		transform: translateY(-100%);
		opacity: 0;
	}
	.bonus-spin-bg-drop {
		position: absolute;
		inset: 0;
		background-size: 100% 100%;
		transform: translateY(-100%);
		transition: transform 0.62s cubic-bezier(0.22, 1, 0.36, 1);
	}
	.bonus-spin-bg-drop--visible {
		transform: translateY(0);
	}
	.bonus-spin-content {
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
		padding: clamp(0.5rem, 3vh, 2rem) clamp(0.75rem, 4vw, 2rem) clamp(1rem, 5vh, 3rem);
	}
	.bonus-spin-stage {
		flex: 1;
		min-height: 0;
		width: 100%;
		display: grid;
		grid-template-rows: auto minmax(0, 1fr);
		justify-items: center;
	}
	.bonus-spin-title {
		position: relative;
		/* Above the wheel assembly so the label always paints over the frame's crown pointer when it pokes up. */
		z-index: 4;
		width: min(72vw, 100%);
		max-width: 100%;
		height: auto;
		flex-shrink: 0;
		object-fit: contain;
		margin-bottom: clamp(0.25rem, 1.5vw, 1rem);
		opacity: 0;
		transform-origin: 50% 0%;
		transform: translateY(-140%) scale(var(--label-scale, 1));
		transition:
			transform 0.5s cubic-bezier(0.22, 1, 0.36, 1),
			opacity 0.32s ease;
	}
	.bonus-spin-title--visible {
		opacity: 1;
		transform: translate(var(--label-offset-x, 0px), var(--label-offset-y, 0px))
			scale(var(--label-scale, 1));
	}
	.bonus-spin-wheel-stack {
		position: relative;
		width: min(72vw, 100%);
		height: min(72vw, 100%);
		max-width: 100%;
		max-height: 100%;
		flex-shrink: 0;
		place-self: center;
	}
	/* The frame overhangs this box (it is ~1.09× the disc), so nothing here may clip. */
	.bonus-spin-wheel-group {
		position: absolute;
		inset: 0;
		transform-origin: 50% 50%;
		transform: translateY(125vh) scale(var(--wheel-scale, 1));
		opacity: 0;
	}
	.bonus-spin-wheel-group--visible {
		transform: translate(var(--wheel-offset-x, 0px), var(--wheel-offset-y, 0px))
			scale(var(--wheel-scale, 1));
		opacity: 1;
		transition:
			transform 0.68s cubic-bezier(0.22, 1, 0.36, 1),
			opacity 0.34s ease;
	}
	/* The only piece that rotates. */
	.bonus-spin-wheel {
		position: absolute;
		inset: 0;
		transform-origin: 50% 50%;
		--wheel-rotation-deg: 0deg;
		transform: rotate(var(--wheel-rotation-deg));
	}
	.bonus-spin-wheel--animating {
		transition: transform 4.1s cubic-bezier(0.12, 0.72, 0.12, 1);
	}
	/* The coloured disc is inscribed in its square canvas, so it fills the stack exactly. */
	.bonus-spin-wheel-values {
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
	.bonus-spin-highlight {
		position: absolute;
		z-index: 1;
		object-fit: fill;
		pointer-events: none;
		transform-origin: var(--highlight-origin-x) var(--highlight-origin-y);
		/* Read right-to-left: open to the wedge's angle and pull the arc back to the ring's inner edge (in
		   the art's own upright frame, about the apex), swing onto the wedge's bisector, then slide the apex
		   off the hub to where the wedge's two ropes actually meet — that last step is what keeps the edges
		   parallel to the ropes. */
		transform: translate(var(--highlight-tx, 0), var(--highlight-ty, 0))
			rotate(var(--highlight-angle-deg, 0deg))
			scale(var(--highlight-scale-x, 1), var(--highlight-scale-y, 1));
	}
	.bonus-spin-frame {
		position: absolute;
		z-index: 3;
		object-fit: fill;
		pointer-events: none;
	}
	.bonus-announcement {
		position: absolute;
		inset: 0;
		z-index: 20;
		border: 0;
		width: 100%;
		height: 100%;
		background-color: transparent;
		background-size: 100% 100%;
		transform: translateY(-100%);
		transition: transform 1s cubic-bezier(0.22, 1, 0.36, 1);
		cursor: pointer;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		color: #f4d36d;
	}
	.bonus-announcement-coins {
		position: absolute;
		inset: 0;
		z-index: 1;
		overflow: hidden;
		pointer-events: none;
	}
	.bonus-announcement-coin {
		position: absolute;
		top: -12%;
		height: auto;
		object-fit: contain;
		pointer-events: none;
		will-change: transform, opacity;
		filter: drop-shadow(0 4px 6px rgba(0, 0, 0, 0.4));
		animation-name: bonus-announcement-coin-fall;
		animation-timing-function: linear;
		animation-iteration-count: infinite;
		/* Held paused until the message text has finished its pop-in, so the coin shower starts after it. */
		animation-play-state: paused;
	}
	.bonus-announcement--coins-visible .bonus-announcement-coin {
		animation-play-state: running;
	}
	@keyframes bonus-announcement-coin-fall {
		0% {
			transform: translateY(0) translateX(0) rotate(0deg);
			opacity: 0;
		}
		6% {
			opacity: 1;
		}
		100% {
			transform: translateY(128vh) translateX(var(--coin-drift, 0px))
				rotate(var(--coin-rotate, 360deg));
			opacity: 1;
		}
	}
	.bonus-announcement-main {
		position: relative;
		z-index: 2;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: clamp(10px, 2vh, 18px);
	}
	.bonus-announcement-hint {
		position: absolute;
		z-index: 2;
		left: 0;
		right: 0;
		bottom: clamp(16px, 5vh, 56px);
		margin-top: 0;
		padding: 0 clamp(1rem, 4vw, 2rem);
		box-sizing: border-box;
		font-family: 'Perpetua', serif;
		font-size: clamp(16px, 2.6vw, 26px);
		line-height: 1.1;
		letter-spacing: 0.03em;
		color: #f0ddaa;
		text-shadow: 0 2px 7px rgba(0, 0, 0, 0.7);
	}
	.bonus-announcement--bg-visible {
		transform: translateY(0);
	}
	.bonus-announcement-headline,
	.bonus-announcement-reward,
	.bonus-announcement-hint {
		opacity: 0;
		text-align: center;
	}
	.bonus-announcement-hint {
		transition: opacity 0.32s ease;
	}
	.bonus-announcement--text-visible .bonus-announcement-hint {
		opacity: 1;
	}
	/* Headline/reward "pop" in with a bouncy overshoot instead of a plain fade. */
	.bonus-announcement-headline,
	.bonus-announcement-reward {
		transform: scale(0.4);
		transition:
			opacity 0.28s ease,
			transform 0.28s ease;
	}
	.bonus-announcement--text-visible .bonus-announcement-headline {
		animation: bonus-announcement-pop 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
	}
	.bonus-announcement--text-visible .bonus-announcement-reward {
		animation: bonus-announcement-pop 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) 0.12s forwards;
	}
	@keyframes bonus-announcement-pop {
		0% {
			transform: scale(0.4);
			opacity: 0;
		}
		55% {
			transform: scale(1.12);
			opacity: 1;
		}
		75% {
			transform: scale(0.94);
		}
		100% {
			transform: scale(1);
			opacity: 1;
		}
	}
	.bonus-announcement-headline,
	.bonus-announcement-reward {
		display: inline-grid;
		width: max-content;
		/* NOT `100%` — this row's parent (`.bonus-announcement-main`, a `align-items: center` flex child)
		   shrink-wraps to ITS content, so a percentage here has no fixed value to resolve against and
		   ends up constraining nothing. Anchor to the viewport directly so there's always a real cap. */
		max-width: 94vw;
		/* Safety net: if the text is ever wider than that (a narrow embed, a font-metric difference from
		   what was measured, a longer localisation) it WRAPS to a second line instead of silently bleeding
		   past the edge and getting clipped by the fullscreen overlay's `overflow: hidden`. Only engages
		   when content doesn't fit — normal single-line rendering is unaffected. */
		overflow-wrap: break-word;
		word-break: break-word;
	}
	.bonus-announcement-headline > *,
	.bonus-announcement-reward > * {
		grid-area: 1 / 1;
		font-family: inherit;
		font-size: inherit;
		font-weight: inherit;
		line-height: inherit;
		letter-spacing: inherit;
		white-space: inherit;
	}
	.bonus-announcement-text-stroke {
		color: transparent;
		-webkit-text-stroke: var(--announcement-stroke-width) var(--announcement-stroke-color);
		paint-order: stroke fill;
		pointer-events: none;
		user-select: none;
	}
	.bonus-announcement-text-fill {
		background-clip: text;
		-webkit-background-clip: text;
		-webkit-text-fill-color: transparent;
		color: transparent;
		text-shadow: var(--announcement-glow-shadow), var(--announcement-highlight-shadow);
	}
	.bonus-announcement-headline {
		--announcement-stroke-width: 0.04em;
		--announcement-stroke-color: #4a2f0a;
		--announcement-glow-shadow:
			0 0 0.48em rgba(255, 200, 70, 0.52), 0 0.05em 0.08em rgba(0, 0, 0, 0.28);
		--announcement-highlight-shadow: 0 -0.02em 0.03em rgba(255, 208, 75, 0.36);
		font-family: 'PiecesOfEight', serif;
		font-size: clamp(48px, 8.2vw, 116px);
		line-height: 0.95;
		letter-spacing: 0.02em;
	}
	.bonus-announcement-text-fill--headline {
		background-image: linear-gradient(180deg, #fad04a 0%, #f0b82e 56.7%, #de951a 100%);
	}
	.bonus-announcement-reward {
		--announcement-stroke-width: 0.05em;
		--announcement-stroke-color: #5c4010;
		--announcement-glow-shadow:
			0 0 0.4em rgba(255, 228, 120, 0.48), 0 0.04em 0.08em rgba(0, 0, 0, 0.25);
		--announcement-highlight-shadow: 0 -0.02em 0.03em rgba(245, 200, 95, 0.32);
		font-family: 'PotatoSans', sans-serif;
		font-size: clamp(30px, 5.2vw, 76px);
		line-height: 1;
		letter-spacing: 0.01em;
	}
	.bonus-announcement-text-fill--reward {
		background-image: linear-gradient(180deg, #f9e4bc 0%, #e0c48a 56.7%, #d49420 100%);
	}
	.bonus-announcement--win .bonus-announcement-headline {
		font-size: clamp(44px, 7.2vw, 100px);
	}
	.bonus-announcement--win .bonus-announcement-reward {
		font-size: clamp(42px, 7vw, 96px);
	}
	.bonus-announcement--mobile .bonus-announcement-headline,
	.bonus-announcement--mobile .bonus-announcement-reward,
	.bonus-announcement--mobile .bonus-announcement-hint {
		/* A LITTLE more budget than before (was 100vw - 10vw) — the treasure variant's wider letter-spacing
		   (below) needs the extra room so long strings like "CONGRATULATIONS!" don't overflow this box and
		   get clipped by the fullscreen overlay's `overflow: hidden` (content here is left-aligned within
		   the box, so any overflow bleeds off the right edge — that's what was cutting off the "!"/"Y"). */
		max-width: calc(100vw - 6vw);
		margin-left: auto;
		margin-right: auto;
		box-sizing: border-box;
	}
	.bonus-announcement--mobile .bonus-announcement-hint {
		white-space: nowrap;
	}
	.bonus-announcement--mobile .bonus-announcement-headline {
		font-size: 10vw;
		line-height: 0.95;
	}
	.bonus-announcement--mobile .bonus-announcement-reward {
		font-size: 7vw;
		line-height: 1.05;
	}
	.bonus-announcement--mobile .bonus-announcement-hint {
		bottom: clamp(12px, 3.5vh, 32px);
		font-size: 3.5vw;
		line-height: 1.2;
	}

	/* ─── Treasure-win congratulations screen ─────────────────────────────────────────────────────── */
	/* Content sits in the upper half so the treasure table can rise into the lower half beneath it. */
	.bonus-announcement--treasure {
		justify-content: flex-start;
	}
	.bonus-announcement--treasure .bonus-announcement-main {
		position: relative;
		z-index: 2;
		/* Sit lower on the screen so the value drops into the treasure zone (matches the reference). */
		margin-top: clamp(44px, 22vh, 150px);
		gap: clamp(8px, 2vh, 22px);
	}
	/* "YOU HAVE WON" subheading: bright Figma cream→gold fill + a warm dark-gold OUTLINE (the reference
	   look), smaller than the CONGRATULATIONS headline (overrides --win). */
	.bonus-announcement--treasure .bonus-announcement-reward {
		/* Low min so the text keeps shrinking with the viewport instead of pinning at a min size and
		   overflowing on narrow/high-DPI screens — the 4.7vw scaling keeps it on one line at any width. */
		font-size: clamp(16px, 4.7vw, 68px);
		/* Wider than the Figma spec's 0.06em — bumped further for more visible breathing room between
		   characters. Line-height ~0.945 (121/128) still matches the spec. */
		letter-spacing: 0.12em;
		line-height: 0.945;
		/* Thinner than the old 0.13em so the outline reads as a rim, not a colour wash. */
		--announcement-stroke-width: 0.1em;
	}
	/* Gradient OUTLINE (transparent-stroke + background-clip trick, same as the headline). The colour is a
	   warm DARK gold (#c8912a→#6e440c) — deliberately darker than the cream fill so the fill reads bright on
	   top. The old build used a BRIGHT saturated gold here (#f0b743→#d08a1b) at 0.13em, which sat too close
	   to the fill in lightness and washed the whole word muddy/orange — that (plus a heavy warm glow), not
	   the text-shadow, was what made it look dark. */
	.bonus-announcement--treasure .bonus-announcement-reward .bonus-announcement-text-stroke {
		-webkit-text-stroke-color: transparent;
		background-image: linear-gradient(180deg, #c8912a 4%, #a06818 50%, #6e440c 100%);
		background-clip: text;
		-webkit-background-clip: text;
		-webkit-text-fill-color: transparent;
	}
	/* Fill: bright warm cream → gold, matched to the reference art. The literal Figma stops
	   (#fbeccd / #d4b777 56.7% / #d18a16 81.67%) rendered too dull — the #d4b777 midtone reads as a grey
	   khaki. Brightened + warmed the midtone and kept the cream holding down ~60% of the glyph so it reads
	   bright-golden like the reference, not tan. text-shadow = the SAME warm-yellow glow as the CONGRATULATIONS
	   headline + win value (so all three rows share one halo), then a subtle dark drop for the raised depth.
	   The dark OUTLINE (above) keeps the glow from muddying the bright fill the way the old bright-gold rim did. */
	.bonus-announcement--treasure .bonus-announcement-text-fill--reward {
		background-image: linear-gradient(180deg, #fdf2d8 0%, #f2d492 62%, #e2aa2c 90%);
		text-shadow:
			0 0 0.42em rgba(255, 196, 62, 0.75),
			0 0 0.95em rgba(255, 178, 44, 0.45),
			0 0.05em 0.055em rgba(0, 0, 0, 0.2);
	}
	/* THE FIX for the cut-off "!" and "Y": `background-clip: text` only paints the gradient within each
	   span's own box, but the `-webkit-text-stroke` ink of the FIRST and LAST glyphs extends BEYOND that
	   box — so their outer outline had no gradient behind it and vanished. Horizontal padding widens each
	   span's background box past the glyphs so the gradient reaches the stroke overflow. Applied to BOTH
	   spans (stroke + fill) equally so they stay registered on top of each other. */
	.bonus-announcement--treasure .bonus-announcement-headline > *,
	.bonus-announcement--treasure .bonus-announcement-reward > * {
		/* Vertical padding too (not just inline): the line-height is < 1em, so tall glyphs like "!" poke
		   ABOVE the line box and the gradient didn't reach their tops either — this widens the background
		   box on all sides. */
		padding: 0.16em 0.18em;
	}

	/* Each title row (CONGRATULATIONS + YOU HAVE WON) carries the SAME warm-yellow glow as the win value
	   (a soft halo hugging the glyphs), one per row — via the fill span's --announcement-glow-shadow. */
	.bonus-announcement--treasure .bonus-announcement-headline {
		/* Low min (overrides --win's 44px) so "CONGRATULATIONS!" keeps shrinking with the viewport and
		   never overflows/clips on narrow or high-DPI screens — 7.2vw keeps it on one line at any width.
		   Unchanged on normal/wide screens where 7.2vw is already above the min. */
		font-size: clamp(22px, 7.2vw, 100px);
		/* Wider gap between characters (overrides the base 0.02em). */
		letter-spacing: 0.08em;
		/* Kept modest so the fill gradient (the letter body) dominates and the outline is just a rim. */
		--announcement-stroke-width: 0.08em;
		--announcement-glow-shadow:
			0 0 0.42em rgba(255, 196, 62, 0.75), 0 0 0.95em rgba(255, 178, 44, 0.45);
		--announcement-highlight-shadow: 0 0.05em 0.08em rgba(0, 0, 0, 0.3);
	}
	/* CONGRATULATIONS outline: a gradient instead of a flat colour. `-webkit-text-stroke-color` can't take
	   a gradient directly, so the stroke span's glyph+stroke geometry is widened with a TRANSPARENT stroke
	   (which still counts for `background-clip: text`'s mask) and painted via the gradient background —
	   only the rim beyond the fill span's edge is visible, reading as a gradient outline. The outline is
	   a DARKER golden-brown than the fill so the fill reads distinctly on top (they'd blend otherwise). */
	.bonus-announcement--treasure .bonus-announcement-headline .bonus-announcement-text-stroke {
		-webkit-text-stroke-color: transparent;
		background-image: linear-gradient(180deg, #bd8018 6%, #9a6011 48%, #6e430b 100%);
		background-clip: text;
		-webkit-background-clip: text;
		-webkit-text-fill-color: transparent;
	}
	.bonus-announcement--treasure .bonus-announcement-text-fill--headline {
		//background-image: linear-gradient(180deg, #f5b936 0%, #ebad26 57%, #d18a16 82%);
	}

	/* The win value in the AustereBlackCapsSSK face: white glyphs with a golden-brown outline, a black
	   drop shadow and a warm yellow glow (per the reference). Two overlaid spans — a stroke layer that
	   carries the outline + glow + shadow, and a white fill on top. Pops in just after the headline/reward. */
	.congrats-value {
		position: relative;
		z-index: 2;
		display: inline-grid;
		justify-items: center;
		margin-top: clamp(6px, 2.2vh, 26px);
		font-family: 'AustereBlackCapsSSK', 'Arial Black', sans-serif;
		font-size: clamp(56px, 7.6vw, 144px);
		line-height: 1.1;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		opacity: 0;
		transform: scale(0.4);
	}
	.congrats-value--in {
		animation: bonus-announcement-pop 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) 0.24s forwards;
	}
	.congrats-value-stroke,
	.congrats-value-fill {
		grid-area: 1 / 1;
		/* trailing letter-spacing pushes the glyphs left of centre — pad the start to re-centre. */
		padding-left: 0.06em;
	}
	.congrats-value-stroke {
		color: transparent;
		-webkit-text-stroke: 0.09em #6d460f;
		paint-order: stroke fill;
		text-shadow:
			0 0.05em 0 #6d460f,
			0.015em 0.09em 0.04em rgba(0, 0, 0, 0.6),
			0 0 0.42em rgba(255, 196, 62, 0.75),
			0 0 0.95em rgba(255, 178, 44, 0.45);
	}
	.congrats-value-fill {
		color: #e9e4e4;
	}
	/* Treasure table: rises up from the bottom as the message pops in, then holds. It hangs BELOW the
	   announcement's bottom edge (translateY 103%), so while the whole screen is still sliding down that
	   overhang would sweep across the view — keep it opacity:0 until the slide finishes (`--in` fires at
	   ANNOUNCEMENT_SLIDE_MS), at which point it's off the bottom edge and rises cleanly into place. */
	.congrats-treasure {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 0;
		width: 100%;
		z-index: 1;
		pointer-events: none;
		opacity: 0;
		transform: translateY(103%);
		transition: transform 0.72s cubic-bezier(0.22, 1, 0.36, 1);
	}
	.congrats-treasure--in {
		opacity: 1;
		transform: translateY(0);
	}
	.congrats-treasure-img {
		display: block;
		width: 100%;
		height: auto;
	}
	.congrats-sparkles {
		position: absolute;
		inset: 0;
		pointer-events: none;
	}
	/* Star sparkles twinkle in place over the hoard / the value (positions + size set inline). */
	.congrats-sparkle {
		position: absolute;
		height: auto;
		transform: translate(-50%, -50%) scale(0.2);
		opacity: 0;
		will-change: transform, opacity;
		filter: drop-shadow(0 0 0.25em rgba(255, 255, 255, 0.55));
		animation-name: congrats-sparkle-twinkle;
		animation-timing-function: ease-in-out;
		animation-iteration-count: infinite;
		animation-play-state: paused;
	}
	.congrats-sparkles--on .congrats-sparkle {
		animation-play-state: running;
	}
	@keyframes congrats-sparkle-twinkle {
		0% {
			opacity: 0;
			transform: translate(-50%, -50%) scale(0.2) rotate(0deg);
		}
		50% {
			opacity: 1;
			transform: translate(-50%, -50%) scale(1) rotate(30deg);
		}
		100% {
			opacity: 0;
			transform: translate(-50%, -50%) scale(0.2) rotate(60deg);
		}
	}

	/* Mobile / portrait treasure-win sizing. */
	.bonus-announcement--treasure.bonus-announcement--mobile .bonus-announcement-main {
		margin-top: clamp(30px, 12vh, 120px);
	}
	.bonus-announcement--treasure.bonus-announcement--mobile .bonus-announcement-headline {
		/* Dialed back from the desktop 0.08em — at mobile's 10vw font-size + `white-space: nowrap`,
		   the full tracking pushed "CONGRATULATIONS!" past its box and got clipped (the "!" vanished off
		   the right edge). Still wider than the pre-treasure 0.02em default. */
		letter-spacing: 0.03em;
	}
	.bonus-announcement--treasure.bonus-announcement--mobile .bonus-announcement-reward {
		font-size: 6vw;
		/* Same reasoning as the headline above — dialed back from the desktop 0.12em so it can't overflow. */
		letter-spacing: 0.05em;
	}
	.bonus-announcement--mobile .congrats-value {
		font-size: 13vw;
	}
</style>
