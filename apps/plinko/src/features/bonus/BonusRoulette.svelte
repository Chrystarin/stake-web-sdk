<script lang="ts">
	import { onMount, untrack } from 'svelte';

	import { OnHotkey } from 'components-shared';

	import { bonusRouletteSegmentsForTier } from '../../game-logic/constants';
	import { eventEmitter } from '../../game/eventEmitter';
	import { assertAuthoritativeOutcome } from '../../game/plinkoFairnessGuard';
	import { stateGame } from '../../game/stateGame.svelte';
	import { isPortraitGameLayout } from '../../lib/format';
	import { staticUrl } from '../../lib/staticUrl';
	import { WIN_RAYS_ART } from '../../lib/winCelebration';

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
		/** Fired the moment this screen has finished sliding down and hides the whole game. Anything that
		 * re-dresses the game for (or out of) bonus mode belongs here, so the player never sees it happen. */
		onCovered?: () => void;
		onClosed?: () => void;
	};

	const props: Props = $props();

	/** Shared wheel diameter from viewport; label/wheel derive from this. The two banner exports are
	 * NOT the same shape, so the ratio is picked per orientation alongside the art (see `labelSrc`). */
	const PORTRAIT_LABEL_HEIGHT_TO_WIDTH = 594 / 1280;
	const LANDSCAPE_LABEL_HEIGHT_TO_WIDTH = 618 / 1400;
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
			label: { scale: 2.05, offsetX: 0, offsetY: -0.125 },
			wheel: { scale: 2.05, offsetX: 0, offsetY: 0.57 },
		},
		portrait: {
			label: { scale: 1.2, offsetX: 0, offsetY: 0 },
			wheel: { scale: 1.1, offsetX: 0, offsetY: -0.3 },
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

	const valuesSrc = staticUrl('img/free_bonus_roulette_v2/wheel_values.webp');
	const frameSrc = staticUrl('img/free_bonus_roulette_v2/wheel_base.webp');
	const highlightSrc = staticUrl('img/free_bonus_roulette_v2/wheel_segment_highlight.webp');

	/** Free-ball values BAKED into wheel_values.png, clockwise from the wedge parked under the pointer at
	 * rotation 0. Recovered by hue-sampling the art at each wedge's bisector (100 red, 90 orange, 80 blue,
	 * 70 amber, 60 teal, 50 green, 40 purple, 30 magenta, 20 dark green).
	 * ⚠️ This is what makes the wheel land on the value it PAYS: `artSlot()` maps a segment onto its wedge
	 * BY VALUE, so the wheel stays honest even if `BONUS_WHEEL_FREE_BALLS` is ever reordered. (The
	 * free-spin wheel's art is offset from its constant by 3 wedges; this one happens to line up, but do
	 * not rely on index === slot.) If the art is re-exported with the values in a different order, fix
	 * this array — it is the single source of truth for art order.
	 * ⚠️ 50 and 20 are both green and differ only in brightness — a hue-only check would merge them.
	 * ⚠️ This list must equal `BONUS_WHEEL_FREE_BALLS` (same values, same wedge order) — the art is the
	 * source of truth for BOTH. When they diverged (values lowered to 10..90 on 2026-07-24, art left at
	 * 20..100), `artSlot()` still mapped award → wedge by VALUE, so the payout stayed correct but the
	 * wheel stopped on a wedge painted 10 higher than it paid (QA 2026-07-27: "landed on 80, won 70").
	 * With the two lists equal, index === slot and every wedge pays exactly what it shows. */
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
	// Two coin art variants fall behind the headline while the "PRESS ANYWHERE" screen is up — on BOTH
	// the pre-bonus (wheel result) and post-bonus (treasure) screens. Generated once per mount (not
	// reactive) so the shower doesn't reshuffle on every render.
	const ANNOUNCEMENT_COIN_IMAGES = [
		staticUrl('img/congratulations_screen/coin_1.webp'),
		staticUrl('img/congratulations_screen/coin_2.webp'),
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
	// Mobile only: fall 50% slower (doubled duration = half the speed). Desktop is unchanged.
	const ANNOUNCEMENT_COIN_SLOWDOWN = isPortraitGameLayout() ? 2 : 1;
	const announcementCoins: AnnouncementCoin[] = Array.from(
		{ length: ANNOUNCEMENT_COIN_COUNT },
		(_, i) => {
			// Slow fall so the rotation reads as a gentle tumble rather than a spin.
			// 20% faster, then another 20% faster on top: divided by 1.2 twice (1.44 total).
			const durationS = ((5.5 + Math.random() * 3) / 1.44) * ANNOUNCEMENT_COIN_SLOWDOWN;
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

	// ─── Congratulations-screen dressing (title art / frame overlay / shine burst) ─────────────────
	// Shared by BOTH congratulations screens. The headline is BAKED ART, not live text: the reference
	// face is hand-drawn (per-glyph bevels, an inner gradient that follows each letter's shape) and the
	// old two-span stroke/fill sandwich could only ever approximate it. The "YOU WON …" row underneath
	// is still live text — it has to interpolate a count.
	const CONGRATS_TITLE_ART = staticUrl(
		'img/congratulations_screen/congratulations_title_text.webp',
	);

	// Rope-and-lantern border that dresses the screen's edges. LANDSCAPE has one export per screen (the
	// pre-bonus one carries more props — ship's wheel, anchor, coin sacks); PORTRAIT has a single export
	// that both screens share, composed for a tall frame rather than a stretched wide one. The screen
	// picks itself off `treasureWin` (the flag that says "bonus END"), not off `mode`.
	// Orientation is read the same way `TREASURE_ART` below reads it: once, at mount. These screens are
	// modal and short-lived, so a device rotated mid-announcement keeps the art it opened with.
	const CONGRATS_OVERLAY_ART = $derived(
		staticUrl(
			isPortraitGameLayout()
				? 'img/congratulations_screen/portrait_congratulations_screen_overlay.webp'
				: props.treasureWin
					? 'img/congratulations_screen/post_congratulations_screen_overlay.webp'
					: 'img/congratulations_screen/pre_congratulations_screen_overlay.webp',
		),
	);

	// The shine burst behind the pre-bonus headline. This is the win popup's ray art, reused verbatim,
	// and it is deliberately NOT a second copy under this folder: a `shine_rays.png` was delivered
	// alongside the overlays above, but it was the SAME image (identical alpha, identical colour) at a
	// LOWER resolution than the export already in the bundle, so it was dropped. Pointing at the
	// existing one costs nothing — it is loaded, decoded and retained on the blocking preload path
	// (`preloadWinPopupAssets`), which makes this screen's burst a straight cache hit instead of a
	// second 2 MB decode.
	const CONGRATS_SHINE_ART = staticUrl(WIN_RAYS_ART);

	// ─── Treasure-win congratulations screen (treasureWin) ───────────────────────────────────────────
	// The bonus-end "CONGRATULATIONS! / YOU HAVE WON / $X" screen adds a treasure table that rises from
	// the bottom UNDER the shared coin shower, with white star sparkles twinkling over the hoard and the
	// win value (matches the reference art + guide video). Positions are hand-placed over the art.
	// Mobile/portrait gets its own taller treasure art (the desktop one is very wide + short); desktop keeps
	// the wide version. Picked here rather than in the template so it's decided once at mount.
	const TREASURE_ART = staticUrl(
		isPortraitGameLayout()
			? 'img/congratulations_screen/treasure_table_mobile.webp'
			: 'img/congratulations_screen/treasure_table.webp',
	);
	const SPARKLE_ART = staticUrl('img/congratulations_screen/sparkle.webp');
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
	// ⚠️ TWO independent sets: desktop and mobile use DIFFERENT treasure art (treasure_table.png is wide +
	// short; treasure_table_mobile.png is taller), so the coins sit in different spots and each set is tuned
	// to its own art. Editing one NEVER affects the other — the matching set is picked by orientation below.
	const TREASURE_SPARKLE_POSITIONS_DESKTOP: Array<{ x: number; y: number; size: number }> = [
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
	// 📱 MOBILE (treasure_table_mobile.png) — EDIT THESE for the mobile screen only. Tuned to the taller art.
	const TREASURE_SPARKLE_POSITIONS_MOBILE: Array<{ x: number; y: number; size: number }> = [
		{ x: 27.0, y: 40.0, size: 6.0 }, // chest — upper coins
		{ x: 31.5, y: 47.5, size: 6.4 }, // chest — main gold pile
		{ x: 22.5, y: 53.5, size: 5.4 }, // chest — front-left coins
		{ x: 39.0, y: 51.0, size: 4.6 }, // chest — right-edge coins
		{ x: 57.0, y: 60.0, size: 5.2 }, // centre coin stacks
		{ x: 49.0, y: 76.0, size: 4.6 }, // floor coins right of the chest
		{ x: 82.0, y: 24.0, size: 4.8 }, // barrel-top coin
		{ x: 64.0, y: 76.0, size: 5.6 }, // bottom-centre coin cluster
		{ x: 85.0, y: 79.0, size: 4.8 }, // coins at the base right of the sack
	];
	const TREASURE_SPARKLE_POSITIONS = isPortraitGameLayout()
		? TREASURE_SPARKLE_POSITIONS_MOBILE
		: TREASURE_SPARKLE_POSITIONS_DESKTOP;
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
	/** True once the congratulations screen has finished sliding down and hides the whole game. */
	let announcementCoversScreen = false;
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

	// Two different "FREE BALLS" banner exports: portrait keeps the original art, landscape uses the
	// v2 one. They differ in aspect, so the height ratio must travel with the source.
	const labelSrc = portrait
		? staticUrl('img/bonus-roulette-label.webp')
		: staticUrl('img/free_bonus_roulette_v2/free_balls_title.webp');
	const labelHeightToWidth = portrait
		? PORTRAIT_LABEL_HEIGHT_TO_WIDTH
		: LANDSCAPE_LABEL_HEIGHT_TO_WIDTH;
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
		const columnToWheel = LABEL_TO_WHEEL * labelHeightToWidth + LABEL_GAP_TO_WHEEL + 1;
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
		//
		// This screen is mounted on the Activate CLICK, before `/wallet/play` has returned, so the door
		// starts closing immediately instead of the player staring at the board for the round trip. The
		// count is usually confirmed long before the 1s slide finishes; if it isn't, `adoptBuyBonusResult`
		// reveals as soon as the book lands (nothing is claimed on screen until then).
		if (props.skipSpin) {
			requestAnimationFrame(() => (slidePhase = 'idle'));
			adoptBuyBonusResult(props.targetFreeBalls);
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

	/**
	 * Post-bonus treasure screen: a coin-clink bed held on loop underneath it.
	 *
	 * Tied to `announcementCoinsVisible`, which is exactly the beat the falling-coin shower starts on —
	 * one `ANNOUNCEMENT_TEXT_POP_MS` after the message pops in, i.e. the moment the text has finished
	 * animating. The teardown releases it on all three exits: the dismiss that clears the flag and slides
	 * the screen away, a Sound toggle handled downstream in EnableSound, and an unmount that never went
	 * through the dismiss path at all.
	 */
	$effect(() => {
		if (!props.treasureWin || !announcementCoinsVisible) return;
		eventEmitter.broadcast({ type: 'soundLoopStart', name: 'postBonusCoins' });
		return () => eventEmitter.broadcast({ type: 'soundLoopStop', name: 'postBonusCoins' });
	});

	function cleanup() {
		timers.forEach(clearTimeout);
		stopHighlightTracking();
		// The screen is gone; from here `bonusRoundActive` carries the bonus state on its own.
		stateGame.bonusEntryCongratsActive = false;
		// Safety net for a teardown that skips the dismiss path (a force-unlock mid-slide): the throttle
		// must never outlive the screen that hid the game, or the background stays stuck at 6fps.
		stateGame.overlayCoversGame = false;
		// Safety net: the award is normally handed over at full cover (`emitResultReady`), and again by
		// `onFinished` on dismiss. If this overlay is torn down between the two (a force-unlock mid-slide),
		// hand it over here so a landed wheel can never lose its free balls — the cosmetic cost of the
		// switch showing is irrelevant once the screen has been ripped away anyway.
		emitResultReady();
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

	/** Wedge whose value is closest to `freeBalls` — display-only fallback, see `resolveWinnerIndex`. */
	function nearestSegmentIndex(freeBalls: number): number {
		let best = 0;
		for (let i = 1; i < segments.length; i++) {
			const closer =
				Math.abs(segments[i].freeBalls - freeBalls) < Math.abs(segments[best].freeBalls - freeBalls);
			if (closer) best = i;
		}
		return best;
	}

	function resolveWinnerIndex(): number {
		const target = props.targetFreeBalls;
		if (target != null) {
			const match = segments.findIndex((s) => s.freeBalls === target);
			if (match >= 0) return match;
			// The book authored a count this wheel has no wedge for — e.g. a BUY-BONUS entry count (72 /
			// 95 / 145 / 239) reaching a base-mode round, where `skipSpin` is false so the wheel actually
			// spins. That is NOT a fairness violation and must not be treated as one: nothing here is
			// client-random, and the award is the book's number either way (`afterSpin` takes
			// `targetFreeBalls` whenever `serverAuthoritative`, never the landed wedge's own value). So
			// land on the nearest wedge for the visual and carry on.
			//
			// Tripping the guard here THREW in DEV, from inside a `setTimeout` — so the spin never settled,
			// `onFinished` never fired, `waitForRouletteClose()` never resolved, and `playBet` hung with it.
			// That is the "Autobet stopped on the free balls roulette" hang. Warn loudly instead: the
			// underlying math/RGS mismatch still needs fixing, it just must not strand the round.
			console.warn(
				'[plinko] bonus wheel has no wedge for the book free-ball count — landing on the nearest wedge',
				{
					targetFreeBalls: target,
					wheelSegments: segments.map((s) => s.freeBalls),
					awarded: target,
				},
			);
			return nearestSegmentIndex(target);
		}
		// No authoritative count at all — this really would be a client-random outcome.
		assertAuthoritativeOutcome('BonusRoulette spin without a matching authoritative segment', {
			targetFreeBalls: target,
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

	/** Replay and Autobet have no player to dismiss the "press anywhere" screen — show it briefly, then
	 * advance. Measured from the start of the slide-down, so it must clear the 1s slide plus a beat of
	 * readable hold before auto-advancing. */
	const AUTO_DISMISS_DELAY_MS = 2000;

	/** How often the auto-dismiss re-checks after arriving too early — see `scheduleAutoDismiss`. */
	const AUTO_DISMISS_RETRY_MS = 250;

	/** How long the congratulations screen takes to slide down and fully cover the view — matches the
	 * `.bonus-announcement` transform transition (1s). The text also fades in at this mark. */
	const ANNOUNCEMENT_SLIDE_MS = 1000;

	/** How long the overlay takes to slide back up and off screen on dismiss — matches the
	 * `.bonus-spin-overlay` exit transform transition (1s). */
	const ANNOUNCEMENT_SLIDE_UP_MS = 1000;

	/** How long the headline/reward "pop" reveal takes to fully finish — the reward's
	 * `animation-delay` (0.12s) plus its `bonus-announcement-pop` duration (`--congrats-pop-duration`,
	 * 0.63s). Coins are held off until this elapses so the message finishes animating before the shower
	 * starts; it also clears the shine burst's own entrance (0.4s delay + 0.28s grow = 0.68s). ⚠️ Keep in
	 * sync with the CSS below. */
	const ANNOUNCEMENT_TEXT_POP_MS = 750;

	/**
	 * Hand the result to the game — this is what starts BONUS MODE (`awardBonusBalls` → `bonusRoundActive`,
	 * which swaps the background art, the game-area frame, the level arch and the whole bottom HUD).
	 *
	 * Called ONLY once the congratulations screen has finished sliding down and fully covers the view, so
	 * the player never watches the game re-dress itself: they see the wheel land, the screen close over
	 * everything, and the bonus game already in place when it lifts. (Fired at most once; the wheel's
	 * `onFinished` still awards the balls as a fallback if this component is torn down early.)
	 */
	function emitResultReady() {
		if (!pendingResult || resultReadyEmitted) return;
		resultReadyEmitted = true;
		props.onResultReady?.(pendingResult);
	}

	/** True when the screen finished covering the view before the purchased entry count was confirmed. */
	let awaitingResultAtCover = false;

	/**
	 * Reveal the headline/reward and hand the result to the game. Normally runs the instant the screen
	 * finishes covering the view; for a buy whose book is still in flight it runs later, when the count
	 * arrives (the cover is already down by then, so the player sees no difference).
	 */
	function revealAnnouncementContent() {
		awaitingResultAtCover = false;
		announcementTextVisible = true;
		// Fanfare, on BOTH screens, fired on the SAME beat the message starts popping in — no delay. This
		// line sits against `announcementTextVisible = true` on purpose: the cue IS the type starting to
		// animate, so nothing should be able to drift the two apart. The clip is sprited to open on its
		// first transient (see EnableSound), so it sounds on that frame rather than 270ms of silence
		// later.
		// ⚠️ It overlaps the closing-door slam, and that is the trade being taken, not an oversight. The
		// slam fires 240ms before this point and its sprite runs 2.26s, so the fanfare lands over the
		// loud part of it (~77% of the slam's peak, envelope-measured). Queueing behind the slam instead
		// is what leaves the type animating in silence — this was tried at the slam's end (1.3s of dead
		// air after the message settled) and at 1s short of it (0.3s), before landing here.
		eventEmitter.broadcast({ type: 'soundOnce', name: 'bonusCongratulations' });
		emitResultReady();
		props.onCovered?.();
		// Held off so the message finishes animating before the shower starts — same offset from the
		// reveal as the old `SLIDE + POP` timer, which fired this long after full cover.
		timers.push(setTimeout(() => (announcementCoinsVisible = true), ANNOUNCEMENT_TEXT_POP_MS));
	}

	/**
	 * BUY BONUS: adopt the purchased entry count once the book confirms it. No-op until then (and after
	 * the first adoption), so nothing is announced before `/wallet/play` has authorised the purchase.
	 */
	function adoptBuyBonusResult(targetFreeBalls: number | undefined): void {
		if (!props.skipSpin || pendingResult) return;
		const freeBallCount = Math.floor(targetFreeBalls ?? 0);
		if (freeBallCount <= 0) return;
		pendingResult = { segmentIndex: 0, segmentLabel: String(freeBallCount), freeBallCount };
		wonFreeBalls = freeBallCount;
		if (awaitingResultAtCover) revealAnnouncementContent();
	}

	// Watch for the confirmed count landing while the door is already down. `untrack` keeps the reveal's
	// own state writes (and the `onResultReady` award flow it fires) out of this effect's dependencies.
	$effect(() => {
		const targetFreeBalls = props.targetFreeBalls;
		untrack(() => adoptBuyBonusResult(targetFreeBalls));
	});

	function startAnnouncementSequence() {
		announcementVisible = true;
		// Entry congratulations screen (not the bonus-END message): flag it so the closing-door slam it
		// schedules below is recognised as the bonus-entry one by the music swap, which can no longer read
		// `bonusRoundActive` (that only flips 240ms later, at full cover).
		if (props.mode !== 'message') stateGame.bonusEntryCongratsActive = true;
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
				timers.push(
					setTimeout(() => {
						// The screen now covers the whole view: reveal the message AND flip the game into bonus
						// mode on the same frame, hidden behind it.
						//
						// ⚠️ The reveal is held for EXACTLY ONE case: a buy started on the Activate click whose
						// book hasn't landed yet (`skipSpin` with no confirmed count) — the cover is already down,
						// so that wait is unseen, and `adoptBuyBonusResult` runs the reveal when the count arrives.
						// Every other caller must reveal HERE. Gating on `pendingResult` alone broke the bonus-END
						// treasure screen (`mode: 'message'` never sets one): it rendered as a bare background with
						// every text layer stuck at `opacity: 0`, and it swallowed `onCovered` — which is what runs
						// the bonus-end settlement.
						const awaitingBuyBonusCount = !!props.skipSpin && !pendingResult;
						announcementCoversScreen = true;
						// Nothing behind this screen is visible any more — let the animated Spine background
						// idle so the coin shower / treasure sparkles get the whole GPU budget.
						stateGame.overlayCoversGame = true;
						if (awaitingBuyBonusCount) awaitingResultAtCover = true;
						else revealAnnouncementContent();
					}, ANNOUNCEMENT_SLIDE_MS),
				);
			}),
		);
		if (props.autoDismiss) scheduleAutoDismiss(AUTO_DISMISS_DELAY_MS);
		// SPACE ALREADY DOWN as this screen opens — the player is pressing "anywhere", they just started
		// before there was anything to press. `OnHotkey` cannot see it (it only reports presses it watched
		// begin, and it mounts with this screen), so without this they sit on a held key that does nothing.
		// Dismissed on exactly the cadence an Autobet run uses, so a held Space and an auto-driven run
		// read identically on screen.
		else if (stateGame.spaceHotkeyDown) scheduleAutoDismiss(AUTO_DISMISS_DELAY_MS, 'heldSpace');
	}

	let autoDismissDone = false;

	/**
	 * Auto-dismiss for the callers with no player to press "anywhere" (replay, and an Autobet run
	 * driving its own bonus round) — and, as `'heldSpace'`, for a player already holding Space when the
	 * screen opened. Both land on the same delay, which is the point: the screen behaves the same way
	 * whether the run is driving it or the player is leaning on the key.
	 *
	 * RETRIES rather than firing once. `onAnnouncementClick` is a deliberate no-op until the screen has
	 * finished sliding down (`announcementCoversScreen`), and that cover is driven by a double-rAF plus a
	 * CSS transition — neither of which is counted in `AUTO_DISMISS_DELAY_MS`. Whenever rAF is throttled
	 * the cover lands after the shot and a single `setTimeout` is simply lost, leaving the overlay up with
	 * nothing left to close it. Autobet is exactly where that bites: it is designed to keep running in a
	 * BACKGROUNDED tab (see Game.svelte's `visibilitychange` note), which is precisely when rAF parks.
	 */
	function scheduleAutoDismiss(delayMs: number, source: 'auto' | 'heldSpace' = 'auto') {
		timers.push(
			setTimeout(() => {
				if (autoDismissDone || slidePhase === 'exit') return;
				// They let go before the screen was ready to take the press — hand it back to them, exactly
				// as releasing a mouse button short of a click would. A fresh press still dismisses at once.
				if (source === 'heldSpace' && !stateGame.spaceHotkeyDown) return;
				if (!announcementCoversScreen) {
					scheduleAutoDismiss(AUTO_DISMISS_RETRY_MS, source);
					return;
				}
				autoDismissDone = true;
				// Still down, and the play hotkey re-enables the moment this screen clears — spend the press
				// here so it cannot also drive Play. See `spaceHotkeyConsumedUntilRelease`.
				if (source === 'heldSpace') stateGame.spaceHotkeyConsumedUntilRelease = true;
				onAnnouncementClick();
			}, delayMs),
		);
	}

	/**
	 * One dismissal per screen. The button stays mounted through the slide-up, and Space auto-repeats
	 * while held, so without this a second press part-way out would creak the door again and queue a
	 * duplicate `onClosed` / `onFinished` behind the first.
	 */
	let announcementDismissed = false;

	/**
	 * Space is the keyboard "press anywhere" — a press and a long press both do exactly what a click
	 * does, no more. Guarded by `onAnnouncementClick` itself, so a hold's repeat presses are no-ops.
	 *
	 * The key can still be down when the game comes back, and the play hotkey re-enables the moment this
	 * screen clears — so the press is marked spent until the player physically lets go. See
	 * `spaceHotkeyConsumedUntilRelease`: without it the same press that dismissed the pre-bonus screen
	 * drops a free ball, and the one that dismissed the post-bonus screen places a real wager.
	 */
	function onAnnouncementHotkey() {
		if (announcementDismissed || !announcementVisible || !announcementCoversScreen) return;
		stateGame.spaceHotkeyConsumedUntilRelease = true;
		onAnnouncementClick();
	}

	function onAnnouncementClick() {
		if (announcementDismissed) return;
		if (!announcementVisible) return;
		// Ignore presses while the screen is still sliding down — its "press anywhere" hint isn't even up
		// yet, and dismissing here would slide the view back open on a game that hasn't switched to bonus
		// mode (that switch happens at full cover, below), putting the change back in front of the player.
		if (!announcementCoversScreen) return;
		announcementDismissed = true;
		announcementTextVisible = false;
		announcementCoinsVisible = false;
		// The game is about to be revealed by the slide-up — put the background back to full rate NOW, so
		// it is already running normally on the first frame the player can see it.
		stateGame.overlayCoversGame = false;
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
				? staticUrl('img/bonus-roulette-background-mobile.webp')
				: staticUrl('img/bonus-roulette-background.webp')})"
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
					src={labelSrc}
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
		<!-- Scoped to the announcement: mounted with it, gone with it. No `disabled` prop — the handler
		     owns every precondition (and `announcementCoversScreen` is not reactive state). -->
		<OnHotkey hotkey="Space" onpress={onAnnouncementHotkey} onhold={onAnnouncementHotkey} />
		<button
			type="button"
			class="bonus-announcement"
			class:bonus-announcement--win={props.mode === 'message'}
			class:bonus-announcement--roulette={props.mode !== 'message'}
			class:bonus-announcement--treasure={props.treasureWin}
			class:bonus-announcement--mobile={portrait}
			class:bonus-announcement--bg-visible={announcementBgVisible}
			class:bonus-announcement--text-visible={announcementTextVisible}
			class:bonus-announcement--coins-visible={announcementCoinsVisible}
			style:background-image="url({portrait
				? staticUrl('img/announcement-message-background-mobile.webp')
				: staticUrl('img/announcement-message-background.webp')})"
			onclick={onAnnouncementClick}
		>
			{#if !props.treasureWin}
				<!-- Pre-bonus only: a shine burst blooms out from behind the headline as it lands. Two
				     elements on purpose — the wrap owns the one-shot grow-in, the inner img owns the
				     endless spin, so the two never fight over `transform` (same split as WinCelebration's
				     `.wc-rays-*`). -->
				<div
					class="congrats-shine"
					class:congrats-shine--in={announcementTextVisible}
					aria-hidden="true"
				>
					<img class="congrats-shine-img" src={CONGRATS_SHINE_ART} alt="" />
				</div>
			{/if}
			<!-- Rope-and-lantern border. DOM order IS the z-order here — all three of these layers sit at
			     z 0 — and it is deliberately between the two: OVER the pre-bonus shine burst, so the
			     border frames the burst instead of being washed out by it, but UNDER the bonus-end
			     treasure table, so the hoard rises in FRONT of the rope and the border's own wheel/sacks/
			     anchor tuck in behind it rather than piling up on top. Under the coin shower (z 1) and
			     every text layer (z 2) either way. -->
			<img class="congrats-frame" src={CONGRATS_OVERLAY_ART} alt="" aria-hidden="true" />
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
			{/if}
			<!-- The coin shower runs on BOTH congratulations screens, identically. On the treasure screen
			     it is sandwiched by z-index: over the risen table and its sparkles (z 0), under every
			     text layer (z 2). -->
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
			<div class="bonus-announcement-main">
				<div class="bonus-announcement-headline">
					<img
						class="bonus-announcement-headline-art"
						src={CONGRATS_TITLE_ART}
						alt={headlineText}
					/>
				</div>
				<!-- Rim UNDER, fill OVER. The rim is an OUTSIDE stroke (measured off the Figma render — see
				     the CSS), and the only way to get one out of a `-webkit-text-stroke`, which is always
				     centred, is to hide its inner half under an unstroked copy of the same text. -->
				<div class="bonus-announcement-reward">
					<span class="bonus-announcement-text-rim" aria-hidden="true">{rewardText}</span>
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
		/* Below the wheel assembly so the frame's crown marker paints OVER the label where it pokes up
		   into the banner (see `.bonus-spin-wheel-stack`). */
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
		/* Above `.bonus-spin-title` (z-index 4) so the frame's baked-in crown marker sits on top of the
		   label instead of being covered by it when the wheel is scaled/offset up into the banner. */
		z-index: 5;
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
		/* Headline / reward pop length — see `bonus-announcement-pop` below, and keep it in sync with
		   ANNOUNCEMENT_TEXT_POP_MS in the script. The win value (`congrats-value-pop`) is intentionally NOT
		   on this var — it keeps its own fixed, non-bouncy duration. */
		--congrats-pop-duration: 0.63s;
	}
	.bonus-announcement-coins {
		position: absolute;
		inset: 0;
		/* One layer above the screen's own background art (painted by `.bonus-announcement` itself) and one
		   BELOW every text layer on the screen — the headline/reward block and the "press anywhere" hint
		   both sit at 2. The shower falls between the two, never across a glyph. */
		z-index: 1;
		overflow: hidden;
		pointer-events: none;
		/* Own compositing layer + paint containment. Without these the clip is a PAINT-time clip applied by
		   the ancestor that also carries the full-screen announcement background, so every coin that moved
		   dirtied a rect of that ~3MP (7MP on mobile) backdrop and forced a main-thread repaint. With paint
		   containment the clip is compositor-side and a falling coin can never invalidate anything outside
		   this box. */
		transform: translateZ(0);
		contain: layout paint;
	}
	.bonus-announcement-coin {
		position: absolute;
		top: -12%;
		height: auto;
		object-fit: contain;
		pointer-events: none;
		will-change: transform, opacity;
		/* ⚠️ NO `filter` here. This used to carry `drop-shadow(0 4px 6px rgba(0,0,0,0.4))`, which is what
		   made the shower stutter on macOS: a BLURRED filter takes an element off the compositor's
		   transform-only fast path — the layer needs its own offscreen render surface and a two-pass
		   Gaussian every time it rasterises, times 24 coins, every frame. Windows at 1× / 60Hz absorbed
		   that; a Retina Mac pays 4× the fill rate (DPR 2) with half the frame budget on a 120Hz ProMotion
		   panel, so it dropped frames. Keeping this animation to `transform` + `opacity` ONLY hands it to
		   the compositor thread, where it runs at display rate no matter what the main thread is doing.
		   The shadow itself was invisible anyway — a 40%-black blur behind a flat gold disc on a backdrop
		   whose mean luma is 54/255. If the depth is ever wanted back, bake it into the coin art. */
		animation-name: bonus-announcement-coin-fall;
		animation-timing-function: linear;
		animation-iteration-count: infinite;
		/* Held paused until the message text has finished its pop-in, so the coin shower starts after it. */
		animation-play-state: paused;
	}
	.bonus-announcement--coins-visible .bonus-announcement-coin {
		animation-play-state: running;
	}
	/* `translate3d` (not `translateY`/`translateX`): WebKit only guarantees the accelerated path for 3D
	   transforms, and translations commute, so `translate3d(drift, fall, 0)` is pixel-identical to the
	   `translateY(fall) translateX(drift)` pair it replaces. */
	@keyframes bonus-announcement-coin-fall {
		0% {
			transform: translate3d(0, 0, 0) rotate(0deg);
			opacity: 0;
		}
		6% {
			opacity: 1;
		}
		100% {
			transform: translate3d(var(--coin-drift, 0px), 128vh, 0) rotate(var(--coin-rotate, 360deg));
			opacity: 1;
		}
	}
	/* ─── Screen dressing: rope frame + shine burst ────────────────────────────────────────────── */
	/* Rope-and-lantern border. z 0 puts it over the screen's own background art (painted by
	   `.bonus-announcement` itself) and under the coin shower (1) and every text layer (2). Where it
	   lands WITHIN z 0 is set by DOM order, not here — see the template: over the shine burst, under the
	   treasure table. */
	.congrats-frame {
		position: absolute;
		inset: 0;
		/* ⚠️ ORIENTATION-SPECIFIC ART, not one export stretched two ways — see CONGRATS_OVERLAY_ART. The
		   landscape exports are 16:9 and the portrait one is 1:2, so each only ever stretches a few
		   percent to reach the viewport. Feeding a 16:9 border to a 9:19.5 phone shears it ~3×: the
		   lanterns draw as slivers, the ship's wheel as an ellipse, and the corner props swell far enough
		   inward to sit under the type. */
		z-index: 0;
		width: 100%;
		height: 100%;
		/* The background art behind it is `background-size: 100% 100%` — STRETCHED to the box, never
		   cropped — so the frame has to distort the same way or the two stop agreeing about where the
		   edges of the scene are. `fill` is that same stretch for a replaced element. */
		object-fit: fill;
		/* Overscan. The rope runs right along the art's own edges, so at 1:1 it reads as a border pinned to
		   the viewport rather than one the screen sits inside; this pushes it ~1.1% past each edge so the
		   outer curve crops off. Arrived at by ratio from the 1.06 it started at (×0.9, ×1.05, ×1.02).
		   ⚠️ The knob is two-sided, and the BONUS-END screen is what binds — its title sits highest, and
		   the border's top props march INWARD as this comes down. Measuring the border's ink against the
		   title's letters there: 0% at 1.06, 0.12% here, 0.40% at 1.002, 1.54% at 0.954 (lantern squarely
		   on the C). Below ~1.0 it also stops bleeding and starts sitting inside the edge, which reads as
		   a rope lying on the screen. The pre-bonus screen is clear at any of these — its title is lower. */
		transform: scale(1.022);
		pointer-events: none;
		user-select: none;
	}
	/* Shine burst behind the pre-bonus headline (`--roulette` only; the bonus-END screen has the
	   treasure table doing this job). Measured off the reference clip: it is 123% of the viewport width
	   square, centred, blooming out from ~45% as the headline tops out its overshoot, then turning
	   forever at 5.8°/s while its opacity breathes on a 2.5s cycle. */
	.congrats-shine {
		position: absolute;
		left: 50%;
		top: 50%;
		z-index: 0;
		width: var(--congrats-shine-size);
		height: var(--congrats-shine-size);
		transform: translate(-50%, -50%) scale(0.45);
		opacity: 0;
		pointer-events: none;
		/* SCREEN, not plain alpha. The burst is a pale-yellow glow over a mid-brown parchment: composited
		   normally at the opacity the reference runs it, it flattens the map texture into a milky wash;
		   screened, it lightens what is already there and the compass rose and coastlines stay readable
		   straight through the rays. (This is also what the reference does — inverting the screen blend
		   over the untouched background recovers the ray art's own colour to within a couple of counts.) */
		mix-blend-mode: screen;
		/* Same reasoning as `.wc-rays-wrap`: this is a very large layer, and letting it demote when the
		   entrance transition ends means a full re-raster at burst size — one missed raster is one
		   flashed frame. */
		will-change: opacity, transform;
		/* The 0.4s delay is not a beat for its own sake: it is exactly where the headline tops out its
		   overshoot (63% of --congrats-pop-duration), so the burst reads as the impact of the title
		   landing rather than as a second, separate entrance. */
		transition:
			opacity 0.28s linear 0.4s,
			transform 0.28s linear 0.4s;
	}
	.congrats-shine--in {
		opacity: 1;
		transform: translate(-50%, -50%) scale(1);
	}
	.congrats-shine-img {
		width: 100%;
		height: 100%;
		transform-origin: center;
		backface-visibility: hidden;
		will-change: transform, opacity;
		/* Two animations, two properties — they never contend. The spin has to live on the inner img
		   because the wrap's `transform` is already spoken for by the entrance. */
		animation:
			congrats-shine-spin 62s linear infinite,
			congrats-shine-pulse 1.25s ease-in-out infinite alternate;
	}
	@keyframes congrats-shine-spin {
		to {
			transform: rotate(360deg);
		}
	}
	/* `alternate` over HALF the 2.5s cycle, starting at the bright end — which lands the first peak just
	   as the burst finishes growing in, the way the reference does. 0.6/0.42 is the screen-blend opacity
	   recovered from the clip, not a guess. */
	@keyframes congrats-shine-pulse {
		from {
			opacity: 0.6;
		}
		to {
			opacity: 0.42;
		}
	}

	/* Text layers. The z-index alone already orders these above `.bonus-announcement-coins`, but the coin
	   box is a PROMOTED compositor layer (`translateZ(0)` + `contain: paint`, and every coin carries
	   `will-change: transform`) while these were plain main-thread paint. Ordering between a promoted
	   layer and later non-promoted content relies on the engine's overlap testing, and WebKit (iOS/macOS
	   Safari) does not reliably promote the overlapped content — that's how a coin ends up drawn ACROSS
	   the headline mid-fall. Promoting the text too makes the order explicit to the compositor, so the
	   shower stays behind the type on every engine. Cheap here: both boxes are static once popped in, and
	   this screen's type is gradient-filled (`background-clip: text`), which already forgoes subpixel AA. */
	.bonus-announcement-main {
		position: relative;
		z-index: 2;
		transform: translateZ(0);
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: clamp(calc(10 * var(--ui-px)), 2vh, calc(18 * var(--ui-px)));
	}
	.bonus-announcement-hint {
		position: absolute;
		z-index: 2;
		transform: translateZ(0);
		left: 0;
		right: 0;
		bottom: clamp(calc(16 * var(--ui-px)), 5vh, calc(56 * var(--ui-px)));
		margin-top: 0;
		padding: 0 clamp(calc(16 * var(--ui-px)), 4vw, calc(32 * var(--ui-px)));
		box-sizing: border-box;
		font-family: 'Perpetua', serif;
		font-size: clamp(calc(16 * var(--ui-px)), 2.6vw, calc(26 * var(--ui-px)));
		line-height: 1.1;
		letter-spacing: 0.03em;
		color: #f0ddaa;
		text-shadow: 0 calc(2 * var(--ui-px)) calc(7 * var(--ui-px)) rgba(0, 0, 0, 0.7);
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
	/* Headline/reward "pop" in from nothing, overshoot, settle. */
	.bonus-announcement-headline,
	.bonus-announcement-reward {
		transform: scale(0);
		transition:
			opacity 0.28s ease,
			transform 0.28s ease;
	}
	.bonus-announcement--text-visible .bonus-announcement-headline {
		animation: bonus-announcement-pop var(--congrats-pop-duration) linear forwards;
	}
	.bonus-announcement--text-visible .bonus-announcement-reward {
		animation: bonus-announcement-pop var(--congrats-pop-duration) linear 0.12s forwards;
	}
	/* ⚠️ Shape and timing function are BOTH load-bearing, and they came off the reference clip (frame-
	   stepped at its native 30fps, headline width measured in px) rather than off a feel-good easing
	   curve. It is THREE distinct linear ramps, not one smooth curve — a real spring overshoots past its
	   target, recoils PAST it the other way, then springs back, and each leg times out at a constant
	   px/frame rate: growing at ~292px/frame up to a 110% overshoot at 400ms (63%), recoiling at
	   ~167px/frame down to an 83% UNDERSHOOT at 567ms (90% — smaller than its 100% resting size, not just
	   short of it), then snapping back at ~262px/frame to settle at 1 by 630ms. That constant-rate-per-leg
	   shape is why the animation runs `linear` with the whole curve living in the keyframes rather than in
	   a single eased transition (no cubic-bezier reproduces two overshoots past opposite sides of the
	   target). Keep `--congrats-pop-duration` in sync with ANNOUNCEMENT_TEXT_POP_MS above. */
	@keyframes bonus-announcement-pop {
		0% {
			transform: scale(0);
			opacity: 0;
		}
		/* Up to full opacity within the first few frames — the reference's headline is already solid at
		   its smallest, so this is a scale-up, not a fade-up. */
		8% {
			opacity: 1;
		}
		63% {
			transform: scale(1.1);
		}
		90% {
			transform: scale(0.83);
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
	.bonus-announcement-text-fill {
		background-clip: text;
		-webkit-background-clip: text;
		-webkit-text-fill-color: transparent;
		color: transparent;
		pointer-events: none;
		user-select: none;
		text-shadow: var(--announcement-glow-shadow), var(--announcement-highlight-shadow);
	}
	/* The rim, on its own layer stacked UNDER the fill (see the template — DOM order is the stacking
	   order inside the row's `inline-grid`, both children sit in cell 1/1). Painted SOLID, glyph and
	   stroke in the same colour, so it is just an oversized silhouette; the fill span on top then covers
	   everything but the overhang, which is what leaves an OUTSIDE stroke.
	   Two things fall out of this arrangement for free. The gradient on the fill span carries no stroke
	   of its own, so its `background-clip: text` mask is the bare glyph and it can never reach past the
	   rim — which is what stops the bright gold hairline that tracing the stroke on the fill span
	   produces (`-webkit-text-stroke` widens the clip mask, so gradient and stroke antialias against
	   each other on the same pixel and the gradient wins a quarter of it). And the effects below hang
	   off THIS span because its ink is the widest: shadows follow the stroked silhouette, as they do in
	   the source. */
	.bonus-announcement-text-rim {
		pointer-events: none;
		user-select: none;
	}
	/* ⚠️ The headline holds NO type any more — it holds `congratulations_title_text.png`. The font-size
	   below survives as this row's sizing UNIT: the art's width is an `em` multiple of it and so is the
	   drop shadow, so every responsive rule that used to size the lettering still sizes the art, with no
	   second ramp to keep in step. The face, the tracking and the whole stroke/fill/glow sandwich that
	   used to live here are baked into the export instead. */
	.bonus-announcement-headline {
		/* px bounds in --ui-px throughout this screen: the vw term is what sizes the type at the
		   1024×576 reference, but every floor below binds on a 400×225 popout and would leave the
		   headline/reward/value 2–3× oversized against the congratulations plate. */
		font-size: clamp(calc(48 * var(--ui-px)), 8.2vw, calc(116 * var(--ui-px)));
		line-height: 0.95;
	}
	/* The CONGRATULATIONS headline is baked art on both screens. Sized in `em` rather than `vw` so it
	   stays welded to the row's own font-size — which is what every responsive rule on this screen
	   already drives (the shared 7.2vw ramp, the --ui-px floors that keep a 400×225 popout sane) and,
	   crucially, what the row's `em`-based drop shadow is measured in: size the art independently and
	   the two drift apart at the clamp ends. Against that 7.2vw ramp, 11.8em resolves to ~85vw at EVERY
	   viewport and orientation — which is where the reference clip puts it. */
	.bonus-announcement-headline-art {
		display: block;
		width: 11.8em;
		/* Never wider than the row's own cap, whatever the font-size resolves to. */
		max-width: 100%;
		height: auto;
		user-select: none;
	}
	.bonus-announcement-reward {
		--announcement-stroke-width: 0.05em;
		--announcement-glow-shadow:
			0 0 0.4em rgba(255, 228, 120, 0.48), 0 0.04em 0.08em rgba(0, 0, 0, 0.25);
		--announcement-highlight-shadow: 0 -0.02em 0.03em rgba(245, 200, 95, 0.32);
		/* Prompt SemiBold — the weight the Figma source specifies, and the only cut installed (see
		   +layout.svelte). `font-weight` is explicit rather than inherited so a missing face can never be
		   faux-bolded into something heavier. It was Black here for a while, which read far too dense
		   against the source: at 102px SemiBold draws a 16px stem where Black draws 25px. */
		font-family: 'Prompt', sans-serif;
		font-weight: 600;
		font-size: clamp(calc(30 * var(--ui-px)), 5.2vw, calc(76 * var(--ui-px)));
		line-height: 1;
		letter-spacing: 0.01em;
	}
	.bonus-announcement-text-fill--reward {
		background-image: linear-gradient(180deg, #f9e4bc 0%, #e0c48a 56.7%, #d49420 100%);
	}
	.bonus-announcement--win .bonus-announcement-headline {
		font-size: clamp(calc(44 * var(--ui-px)), 7.2vw, calc(100 * var(--ui-px)));
	}
	.bonus-announcement--win .bonus-announcement-reward {
		font-size: clamp(calc(42 * var(--ui-px)), 7vw, calc(96 * var(--ui-px)));
	}
	/* MOBILE FULL-BLEED FIX — both congratulations screens (pre-bonus wheel result + post-bonus treasure
	   total) paint `announcement-message-background-mobile.png`, and that export ships with a fully
	   TRANSPARENT border baked in: 8 of its 1868 columns down each side (0.43%) plus ~4 rows along the
	   bottom. The desktop PNG has none. Stretched edge-to-edge by `background-size: 100% 100%`, those
	   transparent margins land exactly on the screen edges, so the game showed through as a thin gap left
	   and right of a screen that is supposed to cover everything behind it.

	   The element itself is already full-width (measured 0 → viewport at 390px), so this is purely the
	   artwork: overscan it just past the box so its SOLID area reaches both edges, anchored to the top so
	   the vertical crop comes off the bottom — where the image is already transparent. 102%/101% leaves
	   ~0.5% of slack each side over the measured margins; the crop taken off the real art is well under a
	   percent of a full-bleed scene, i.e. invisible. Re-exporting the PNG without its transparent border
	   would make this unnecessary, but keeping it here means a future export can't reintroduce the gap. */
	.bonus-announcement--mobile {
		background-size: 102% 101%;
		background-position: center top;
	}
	.bonus-announcement--mobile .bonus-announcement-headline,
	.bonus-announcement--mobile .bonus-announcement-reward,
	.bonus-announcement--mobile .bonus-announcement-hint {
		/* A LITTLE more budget than before (was 100vw - 10vw) — the treasure variant's wider letter-spacing
		   (below) needs the extra room so long strings like "YOU HAVE WON" don't overflow this box and get
		   clipped by the fullscreen overlay's `overflow: hidden` (content here is left-aligned within the
		   box, so any overflow bleeds off the right edge — that's what was cutting off the "!"/"Y"). */
		max-width: calc(100vw - 6vw);
		margin-left: auto;
		margin-right: auto;
		box-sizing: border-box;
	}
	.bonus-announcement--mobile .bonus-announcement-hint {
		white-space: nowrap;
	}
	.bonus-announcement--mobile .bonus-announcement-reward {
		font-size: 7vw;
		line-height: 1.05;
	}
	.bonus-announcement--mobile .bonus-announcement-hint {
		/* Raised well off the bottom edge (was `clamp(12px, 3.5vh, 32px)`) to clear the portrait border's
		   bottom cluster. Unlike the landscape borders — which leave a clear gap between the coin sacks,
		   which is exactly where this row sits — the portrait one runs props across the full width down
		   there: ship's wheel left, sacks centre, anchor right.
		   24vh is measured, not guessed. Compositing the export at viewport scale and sampling the band
		   this row's text actually occupies (~14–86% of the width), the art is only completely clear
		   above 78% of the viewport height; between 78% and 88% the wheel's rim and the anchor's shank
		   still cross it, which is what put "PRESS" on the wheel and "GAME" on the anchor. 78% plus this
		   row's own ~2vh is 24.
		   Aspect-independent despite being a bare `vh`: the border is `object-fit: fill` on `inset: 0`, so
		   an art fraction maps to the same viewport fraction at 9:16 and 9:19.5 alike.
		   Pre-bonus ONLY in practice — the treasure screen puts it back (below), because its table covers
		   the props this is dodging. */
		bottom: 24vh;
		font-size: 3.5vw;
		line-height: 1.2;
	}

	/* ─── Treasure-win congratulations screen ─────────────────────────────────────────────────────── */
	/* Content sits in the upper half so the treasure table can rise into the lower half beneath it. */
	.bonus-announcement--treasure {
		justify-content: flex-start;
		/* Hard black drop shadow sitting BENEATH the congratulations text (the reference look). From the
		   Figma spec's `drop-shadow(5.09502px 10.19px 0 #000)`, converted to em (÷150, the design's
		   CONGRATULATIONS face) so the offset scales with every row's own font-size and stays responsive.
		   The spec's warm-gold glow + soft black layers are intentionally dropped — only this beneath-text
		   shadow is wanted. Layered ON TOP of the existing per-row text-shadows; colours/fills untouched. */
		--congrats-text-shadow: drop-shadow(0.034em 0.068em 0 #000000);
	}
	/* Pre-bonus (roulette) congrats screen: give its "CONGRATULATIONS!" headline and "YOU WON N DROPS"
	   reward row the SAME text treatment as the post-bonus treasure screen (gradient outline, warm-gold
	   glow, hard black drop shadow). Only the text is matched — the roulette screen's layout stays its own. */
	.bonus-announcement--roulette {
		--congrats-text-shadow: drop-shadow(0.034em 0.068em 0 #000000);
		/* 123vw at the 1024×576 reference, with the same --ui-px floor/ceiling breakpoints WinCelebration
		   bounds its own burst at — below ~709px wide the vw term would shrink the burst faster than the
		   type it sits behind, and a 400×225 popout would end up with a burst smaller than the headline. */
		--congrats-shine-size: clamp(calc(872 * var(--ui-px)), 123vw, calc(1948 * var(--ui-px)));
	}
	.bonus-announcement--roulette.bonus-announcement--mobile {
		/* Portrait: vw is the SHORT side now, so carrying 123vw over would shrink the burst to a third of
		   the screen. 255vw keeps its bright core the same fraction of the viewport DIAGONAL as landscape,
		   which is what actually preserves the look across aspect ratios. */
		--congrats-shine-size: 255vw;
	}
	/* The reward row is deliberately NOT in this list: it carries the source's own three effects as a
	   `text-shadow` on its rim span, and the hard drop below would be a fourth, doubled up on the first
	   of them. Everything else on the screen still shares this one. */
	.bonus-announcement--treasure .bonus-announcement-headline,
	.bonus-announcement--treasure .congrats-value,
	.bonus-announcement--treasure .bonus-announcement-hint,
	.bonus-announcement--roulette .bonus-announcement-headline {
		filter: var(--congrats-text-shadow);
	}
	.bonus-announcement--treasure .bonus-announcement-main {
		position: relative;
		z-index: 2;
		/* Both numbers are set by one constraint: the win value has to land ABOVE the hoard, not in it.
		   The treasure art is 1919×633 drawn full-width from 41% of the screen down, and across the
		   middle 40% — the only part the value can collide with — its first opaque row is 49.3% into the
		   art, i.e. ~70% of the way down the screen. Everything above has to fit in what is left.
		   Was 22vh / 2vh, which put the value's baseline ~46px INTO the coins at the 1024×576 reference.
		   At 16vh / 1vh the rows close up and the block lifts, leaving the value clear of the hoard. */
		margin-top: clamp(calc(30 * var(--ui-px)), 16vh, calc(112 * var(--ui-px)));
		gap: clamp(calc(4 * var(--ui-px)), 1vh, calc(12 * var(--ui-px)));
	}
	/* "YOU HAVE WON" subheading: bright Figma cream→gold fill + a warm dark-gold OUTLINE (the reference
	   look), smaller than the CONGRATULATIONS headline (overrides --win). */
	.bonus-announcement--treasure .bonus-announcement-reward,
	.bonus-announcement--roulette .bonus-announcement-reward {
		/* Low min so the text keeps shrinking with the viewport instead of pinning at a min size and
		   overflowing on narrow/high-DPI screens — the 4.7vw scaling keeps it on one line at any width. */
		font-size: clamp(calc(16 * var(--ui-px)), 4.7vw, calc(68 * var(--ui-px)));
		/* Wider than the Figma spec's 0.06em — bumped further for more visible breathing room between
		   characters. Line-height ~0.945 (121/128) still matches the spec. */
		/* The Figma spec value. (A previous pass ran this at 0.12em for "more visible breathing room";
		   the reference tracks noticeably tighter than that, and at 0.12em the row also outgrew the
		   headline art above it.) */
		letter-spacing: 0.06em;
		line-height: 0.945;
		/* HALF of this shows: the stroke is centred on the glyph outline and the fill span covers the
		   inner half, so the visible overhang is 0.049em — which is what the source measures. ⚠️ Figma
		   strokes text in absolute px, so the two source nodes are not proportional to each other: the
		   same ~5px band is 0.049em on the 102px "YOU HAVE WON" and 0.095em on the 63px "YOU WON 60
		   DROPS". No single em reproduces both. Taken from the 102px node — it is the one this request
		   named, and at 4.7vw this row sits nearer its 5.3vw than the other's 3.3vw. */
		--announcement-stroke-width: 0.098em;
	}
	/* Fill: the Figma spec for this row, colours and stop positions verbatim —
	     linear-gradient(177.39deg, #FBECCD 14.23%, #F4D77A 49.67%, #E8BE37 72.44%)
	   — with ONE deliberate change: the angle is normalised to a true 180deg.
	   Figma authors a gradient in the layer's own normalised space and only converts it to degrees on
	   export, so the same handle reads as a different slope on a box of a different aspect ratio. 177.39deg
	   is a 2.6° tilt, which is nothing on the near-square text layer it was drawn against and a lot on this
	   row: at "YOU WON 60 DROPS" the box is ~600×61, so the gradient LINE (|w·sinθ| + |h·cosθ| = 88px) runs
	   mostly horizontally, and the stops sweep ±0.16 of their range across the width — "YOU" comes out pale
	   cream and "DROPS" deep gold, a diagonal wash the reference does not have. It also gets worse the
	   longer the string, and this row's string is variable ("YOU WON 5 DROPS" … "YOU WON 60 DROPS").
	   180deg keeps every glyph on the same top→bottom ramp, which is what the reference shows.
	   Within this row's padding box (line-height .945em + .16em padding = 1.265em tall) the glyph cap runs
	   21%→76%, so the stops land as cream over the top third, #F4D77A through the middle and #E8BE37 held
	   flat across the bottom — the reference's read exactly.
	   text-shadow = the SAME warm-yellow glow as the CONGRATULATIONS headline + win value (so all three rows
	   share one halo), then a subtle dark drop for the raised depth. The dark OUTLINE above keeps the glow
	   from muddying the fill. */
	.bonus-announcement--treasure .bonus-announcement-text-fill--reward,
	.bonus-announcement--roulette .bonus-announcement-text-fill--reward {
		background-image: linear-gradient(180deg, #fbeccd 14.23%, #f4d77a 49.67%, #e8be37 72.44%);
		/* No stroke and no shadow on THIS span. Both live on `.bonus-announcement-text-rim` underneath,
		   whose ink is the stroked silhouette — which is the shape the source casts its effects from.
		   Repeating the glow here would just double it, at a slightly smaller shape. */
		text-shadow: none;
	}
	/* THE FIX for the cut-off "!" and "Y": `background-clip: text` only paints the gradient within the
	   span's own box, but the `-webkit-text-stroke` ink of the FIRST and LAST glyphs extends BEYOND that
	   box — so their outer outline had no gradient behind it and vanished. Padding widens the background
	   box past the glyphs so the gradient reaches the stroke overflow.
	   ⚠️ Load-bearing for the gradient's SHAPE as well, not just its coverage: the stops below are
	   positioned against this padded box (1.265em tall = .945em line-height + .16em top and bottom), and
	   that is the geometry the glyph-relative read of them was worked out on. Change the padding and the
	   fill re-ramps.
	   Reward row only: the headline is baked art now, and padding an <img> would just inset it. */
	/* Rim colour and effects, both read off the Figma source (nodes 467:22621 / 469:22651). The stroke is
	   the one thing Figma's codegen does not export for text, so it was measured off the rendered node
	   instead: scanning a stem, the band is a FLAT #916917 at every height — no gradient, no fade — and
	   the gold core measures 15.5px against the 16px the bare SemiBold glyph draws at that size, which is
	   what pins the alignment to OUTSIDE rather than centre. */
	.bonus-announcement--treasure .bonus-announcement-text-rim,
	.bonus-announcement--roulette .bonus-announcement-text-rim {
		color: #916917;
		-webkit-text-fill-color: #916917;
		-webkit-text-stroke: var(--announcement-stroke-width) #916917;
		/* The source's three effects, in its own order. `text-shadow` rather than chained
		   `filter: drop-shadow()` on purpose: filters compose, so the second would cast a shadow of the
		   first, while Figma draws all three off the same silhouette — which is exactly what a
		   comma-separated `text-shadow` does.
		   Converted against the 102px "YOU HAVE WON" node: (5.095, 10.19)px → 0.05/0.1em,
		   (0, 20.38)px blur 20.38 → 0/0.2em blur 0.2em, blur 145.21 → 1.424em. #EDB02AA3 is alpha 0.64. */
		text-shadow:
			0.05em 0.1em 0 #000000,
			0 0.2em 0.2em #000000,
			0 0 1.424em rgba(237, 176, 42, 0.64);
	}
	.bonus-announcement--treasure .bonus-announcement-reward > *,
	.bonus-announcement--roulette .bonus-announcement-reward > * {
		/* Vertical padding too (not just inline): the line-height is < 1em, so tall glyphs like "!" poke
		   ABOVE the line box and the gradient didn't reach their tops either — this widens the background
		   box on all sides. */
		padding: 0.16em 0.18em;
	}

	/* Both congratulations screens run the headline art at the same size — this is the ramp the `em`
	   width above resolves against. */
	.bonus-announcement--treasure .bonus-announcement-headline,
	.bonus-announcement--roulette .bonus-announcement-headline {
		/* Low min (overrides --win's 44px) so the headline keeps shrinking with the viewport and never
		   overflows/clips on narrow or high-DPI screens. Unchanged on normal/wide screens where 7.2vw is
		   already above the min. */
		font-size: clamp(calc(22 * var(--ui-px)), 7.2vw, calc(100 * var(--ui-px)));
	}

	/* The win value in the AustereBlackCapsSSK face: white glyphs with a golden-brown outline, a black
	   drop shadow and a warm yellow glow (per the reference). Two overlaid spans — a stroke layer that
	   carries the outline + glow + shadow, and a white fill on top. Pops in just after the headline/reward.
	   ⚠️ Deliberately does NOT share `bonus-announcement-pop` — that keyframe set carries the
	   headline/reward's overshoot-undershoot-settle bounce, and the win value is meant to stay a plain
	   grow-to-size with no bounce at all (see `congrats-value-pop` below), so it gets its own keyframes and
	   its own fixed duration instead of `--congrats-pop-duration`. */
	.congrats-value {
		position: relative;
		z-index: 2;
		display: inline-grid;
		justify-items: center;
		/* On top of the flex gap above, so it is the third gap in the stack and the one that pushed the
		   value furthest into the hoard. Pulled right back for the same reason. */
		margin-top: clamp(calc(2 * var(--ui-px)), 0.6vh, calc(8 * var(--ui-px)));
		font-family: 'AustereBlackCapsSSK', 'Arial Black', sans-serif;
		/* The worst offender on this screen: 7.6vw only wins above ~740px wide, so on a 400×225 popout
		   the 56px floor pinned the win value at 14% of the frame width instead of 7.6%. */
		font-size: clamp(calc(56 * var(--ui-px)), 7.6vw, calc(144 * var(--ui-px)));
		line-height: 1.1;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		opacity: 0;
		transform: scale(0);
	}
	.congrats-value--in {
		animation: congrats-value-pop 0.58s ease-out 0.24s forwards;
	}
	/* The win value's own pop — a plain grow-to-size, no overshoot/undershoot. `ease-out` decelerates into
	   the final scale instead of arriving at a constant rate, which is what reads as a "grow" rather than a
	   mechanical linear scale-up. Kept as its own keyframes (rather than re-pointing at the shared
	   `bonus-announcement-pop`, which carries the headline/reward's bounce) so the win value's animation
	   never drifts if that one is retuned again. */
	@keyframes congrats-value-pop {
		0% {
			transform: scale(0);
			opacity: 0;
		}
		10% {
			opacity: 1;
		}
		100% {
			transform: scale(1);
			opacity: 1;
		}
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
		/* Above the screen's own background art, below the coin shower at 1 (which must fall IN FRONT of
		   the table) and the text at 2. The sparkles ride inside this box, so they sit under the shower
		   too — they twinkle on the hoard, and coins pass over both. */
		z-index: 0;
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
		transform: translate3d(-50%, -50%, 0) scale(0.2);
		opacity: 0;
		will-change: transform, opacity;
		/* ⚠️ NO `filter` here — same reason as `.bonus-announcement-coin` above, and worse: these keyframes
		   animate `scale()`, so a blurred filter had to be re-rasterised at a new scale on every frame
		   rather than cached once. sparkle.png already ships its own soft rays + white core, so the extra
		   `drop-shadow(0 0 0.25em rgba(255,255,255,0.55))` halo was near-invisible on top of the baked-in
		   glow — it cost 9 permanent offscreen render surfaces for nothing. */
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
			transform: translate3d(-50%, -50%, 0) scale(0.2) rotate(0deg);
		}
		50% {
			opacity: 1;
			transform: translate3d(-50%, -50%, 0) scale(1) rotate(30deg);
		}
		100% {
			opacity: 0;
			transform: translate3d(-50%, -50%, 0) scale(0.2) rotate(60deg);
		}
	}

	/* Mobile / portrait treasure-win sizing. */
	/* Mobile: centre the CONGRATULATIONS / YOU HAVE WON / $value block in the middle of the screen —
	   overrides the treasure variant's `flex-start` + downward `margin-top` push (desktop keeps those). */
	.bonus-announcement--treasure.bonus-announcement--mobile {
		justify-content: center;
	}
	.bonus-announcement--treasure.bonus-announcement--mobile .bonus-announcement-main {
		margin-top: 0;
	}
	.bonus-announcement--treasure.bonus-announcement--mobile .bonus-announcement-reward,
	.bonus-announcement--roulette.bonus-announcement--mobile .bonus-announcement-reward {
		font-size: 6vw;
		/* No tracking override any more: it existed only to dial the old desktop 0.12em back so the row
		   couldn't overflow its box and get clipped by the fullscreen overlay's `overflow: hidden`, and
		   0.06em is already inside that. Portrait now runs the same spec value as landscape. */
	}
	.bonus-announcement--mobile .congrats-value {
		font-size: 13vw;
	}
	.bonus-announcement--treasure.bonus-announcement--mobile .bonus-announcement-hint {
		/* Back down to the bottom edge, undoing the lift the pre-bonus screen needs above. The reason for
		   that lift is the border's bottom props, and on THIS screen the treasure table is full-width,
		   fills the bottom quarter, and — since the border paints behind it — covers the wheel, sacks and
		   anchor outright. That leaves this row where it has always sat: on the table's own dark wood
		   base, with nothing else under it. */
		bottom: clamp(12px, 3.5vh, 32px);
	}
</style>
