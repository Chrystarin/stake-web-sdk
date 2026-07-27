import { staticAssetPath } from '../staticUrl';
import type { SpineImageOverlayDef, SpineOverlayDef } from './types';

/**
 * Free-game (bonus mode) overlays. Every spine here was exported from the SAME Spine scene as the base
 * `background_{landscape,portrait}` skeletons (identical `../background/Spine/` image root and matching
 * authored world bounds), so each lines up with the base scene when rendered with the base spine's fit
 * transform and the same skeleton scale (0.5). They are painted only while the bonus round is active —
 * see `SpineBackgroundRenderer.setBonusMode`.
 *
 * Layers, from farthest to nearest:
 *  - moon  (image overlay, 50% opacity, behind the scene)   — `getBonusMoonOverlay`
 *  - ship  (spine, INSIDE the base scene just above the sea) — `getBonusShipOverlay`
 *  - splash×2 (spine, inside the base scene, over the ship)  — `getBonusSplashOverlay`
 *  - tornado×2 (spine, above the scene: a big one right, a smaller one left) — `getBonusTornadoOverlay`
 *  - cloud (spine, drifting storm clouds on top)             — `getBonusCloudOverlay`
 *  - rain  (spine, on top — landscape/portrait specific)     — `getBonusRainOverlay`
 *
 * The ship and splashes are anchored into the BASE skeleton's draw order (`baseSlot`) rather than
 * layered under the base spine as a whole: they have to paint over the sea plane while the waterfall,
 * dock, fog and the base scene's own splashes still occlude them — and those are all slots of the one
 * base skeleton, so no amount of stage ordering can put a layer between them.
 */

const CLOUD_BASE = 'spine/FG_CLOUD';
const SPLASH_BASE = 'spine/FG_SPLASH';
const SHIP_BASE = 'spine/ship';
const TORNADO_BASE = 'spine/tornado';
const LANDSCAPE_RAIN_BASE = 'spine/landscape_rain';
const PORTRAIT_RAIN_BASE = 'spine/portrait_rain';
const MOON_IMAGE = 'img/moon.png';

export type Orientation = 'landscape' | 'portrait';

/** Must match the base background skeletons' `skeletonScale` so world coordinates align. */
const OVERLAY_SKELETON_SCALE = 0.5;

/*
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 *  TUNING KNOBS — position & scale of the bonus-mode MOON, SHIP and TORNADO(es).
 *
 *  Landscape (desktop) and portrait (mobile) are configured INDEPENDENTLY in the two blocks below:
 *  changing a value in one block never affects the other orientation.
 *
 *  SHIP & TORNADO (animated spines, placed relative to the moving scene):
 *    • offsetXVw    — horizontal nudge, as a fraction of viewport WIDTH.  + = RIGHT, − = LEFT.
 *    • offsetYScene — vertical nudge in SCENE units (stays locked to the water on any screen shape).
 *                       − = UP, + = DOWN.   (Roughly 1 unit ≈ 1px on a ~1280px-wide desktop.)
 *    • scaleMul     — size multiplier.  1 = original size, 0.8 = 80% (smaller), 1.25 = 125% (bigger).
 *
 *  MOON (a plain image, placed in viewport fractions — independent of the scene):
 *    • xVw / yVh    — CENTRE position, as fractions of viewport width / height (0 = left/top … 1 = right/bottom).
 *    • widthVw      — width as a fraction of viewport width (height follows automatically to keep aspect).
 *    • alpha        — opacity, 0–1  (0.5 = 50%).
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 */

/** Position + size of an animated spine overlay (ship, tornado). See the knob descriptions above. */
type SpinePlacement = { offsetXVw: number; offsetYScene: number; scaleMul: number };
/** Position + size of the moon image overlay. See the knob descriptions above. */
type MoonPlacement = { xVw: number; yVh: number; widthVw: number; alpha: number };

type OrientationTuning = {
	moon: MoonPlacement;
	ship: SpinePlacement;
	/** The big right-hand tornado (shown in both orientations). */
	tornadoRight: SpinePlacement;
	/** The smaller left-hand tornado — LANDSCAPE ONLY (portrait renders just the right one). */
	tornadoLeft?: SpinePlacement;
	/** Water-splash burst at the RIGHT-hand waterfall. */
	splashRight: SpinePlacement;
	/** Water-splash burst at the LEFT-hand waterfall (a mirrored copy of the right one). */
	splashLeft: SpinePlacement;
};

/* ▼▼▼ DESKTOP / LANDSCAPE — move & resize the moon, ship and tornadoes on desktop here. ▼▼▼ */
const LANDSCAPE_TUNING: OrientationTuning = {
	moon: { xVw: 0.12, yVh: 0.13, widthVw: 0.35, alpha: 0.5 },
	ship: { offsetXVw: -0.2, offsetYScene: 100, scaleMul: 1 },
	tornadoRight: { offsetXVw: 0.23, offsetYScene: -516, scaleMul: 1 },
	tornadoLeft: { offsetXVw: -0.2, offsetYScene: -554, scaleMul: 0.62 },
	splashRight: { offsetXVw: 0, offsetYScene: -55, scaleMul: 1 },
	splashLeft: { offsetXVw: 0.011, offsetYScene: -55, scaleMul: 1 },
};

/* ▼▼▼ MOBILE / PORTRAIT — move & resize the moon, ship and tornado on mobile here. ▼▼▼ */
const PORTRAIT_TUNING: OrientationTuning = {
	moon: { xVw: 0.175, yVh: 0.05, widthVw: 0.5, alpha: 0.5 },
	ship: { offsetXVw: -0.07, offsetYScene: -50, scaleMul: 0.9 },
	tornadoRight: { offsetXVw: 0.3, offsetYScene: -645, scaleMul: 0.7 },
	// (no left tornado on mobile)
	// The FG_SPLASH is authored at the landscape waterfalls; in portrait the board fills the frame, so
	// the two splashes are separated to the lower-left / lower-right sea and scaled down to stay visible.
	splashRight: { offsetXVw: -0.1, offsetYScene: -400, scaleMul: 0.5 },
	splashLeft: { offsetXVw: 0.1, offsetYScene: -400, scaleMul: 0.5 },
};

const TUNING: Record<Orientation, OrientationTuning> = {
	landscape: LANDSCAPE_TUNING,
	portrait: PORTRAIT_TUNING,
};

/**
 * Where the ship and the splashes are drawn inside the base scene: the `moon` slot, moved during bonus
 * to sit directly after the sea plane (see `SpineOverlayDef.baseSlot` / `baseSlotAfter`).
 *
 * The depth wanted is "one step above the sea, below everything else the scene draws" — but no slot at
 * that depth can be anchored to: an anchor lends its bone transform AND its slot alpha to whatever is
 * attached, and every slot between the sea and the waterfall pulses alpha (the clouds swing 0x00↔0xff,
 * the water band 0x51↔0x8b). `moon` can: static `root` bone, no colour timeline, and its art is already
 * hidden for the whole bonus round (`bonusHiddenSlots`), so relocating it is invisible. Neither
 * background animation has a draw-order timeline, so nothing fights the move; the setup order is
 * restored when bonus ends.
 */
const ANCHOR_SLOT: Record<Orientation, string> = {
	landscape: 'moon',
	portrait: 'moon',
};
/** The sea plane the anchor is parked directly above — note the capital O in the portrait scene. */
const SEA_SLOT: Record<Orientation, string> = {
	landscape: 'ocean',
	portrait: 'Ocean',
};

export const getBonusCloudOverlay = (): SpineOverlayDef => ({
	id: 'fg_cloud',
	format: 'json',
	skeleton: staticAssetPath(`${CLOUD_BASE}/skeleton.json`),
	atlas: staticAssetPath(`${CLOUD_BASE}/skeleton.atlas`),
	images: {
		'skeleton.png': staticAssetPath(`${CLOUD_BASE}/skeleton.png`),
	},
	animation: 'animation',
	loop: true,
	skeletonScale: OVERLAY_SKELETON_SCALE,
});

/**
 * Pause between splashes, so each waterfall bursts intermittently rather than looping continuously.
 * Randomized in this range and re-rolled after every play, so the bursts feel irregular rather than
 * metronomic.
 */
const SPLASH_GAP_MIN_SECONDS = 5;
const SPLASH_GAP_MAX_SECONDS = 7;
/**
 * The LEFT splash fires first; the RIGHT one follows 0.5s later. (Left is the mirrored copy, hence
 * the `mirror ? 0 : …`.) The two never burst together: they share one duty cycle (`cycleGroup`), so
 * the offset is a property of the schedule rather than a head start that decays.
 */
const SPLASH_RIGHT_DELAY_SECONDS = 0.5;
/** Shared duty-cycle schedule for the mirrored splash pair — see `SpineOverlayDef.cycleGroup`. */
const SPLASH_CYCLE_GROUP = 'fg_splash_pair';

/**
 * The FG_SPLASH asset authors a single splash at the RIGHT-hand waterfall. `mirror` produces a second
 * instance flipped across the scene centre so the LEFT waterfall gets a matching splash. Position/scale
 * come from the tuning block above (`splashRight` / `splashLeft`, per orientation).
 */
export const getBonusSplashOverlay = (
	orientation: Orientation,
	mirror = false,
): SpineOverlayDef => ({
	id: mirror ? 'fg_splash_left' : 'fg_splash',
	format: 'json',
	skeleton: staticAssetPath(`${SPLASH_BASE}/skeleton.json`),
	atlas: staticAssetPath(`${SPLASH_BASE}/skeleton.atlas`),
	images: {
		'skeleton.png': staticAssetPath(`${SPLASH_BASE}/skeleton.png`),
		'skeleton_2.png': staticAssetPath(`${SPLASH_BASE}/skeleton_2.png`),
		'skeleton_3.png': staticAssetPath(`${SPLASH_BASE}/skeleton_3.png`),
	},
	animation: 'animation',
	loop: true,
	skeletonScale: OVERLAY_SKELETON_SCALE,
	mirror,
	...(mirror ? TUNING[orientation].splashLeft : TUNING[orientation].splashRight),
	cycleGapMinSeconds: SPLASH_GAP_MIN_SECONDS,
	cycleGapMaxSeconds: SPLASH_GAP_MAX_SECONDS,
	cycleStartDelaySeconds: mirror ? 0 : SPLASH_RIGHT_DELAY_SECONDS,
	// Both copies run off ONE schedule, so the half-second stagger holds for every burst instead of
	// drifting apart (and occasionally colliding) as each side re-rolls its own random gap.
	cycleGroup: SPLASH_CYCLE_GROUP,
	// Same anchor as the ship, and later in `getBonusOverlays`, so the splash paints OVER the ship while
	// everything the base scene draws above the sea — the waterfalls, its own splashes, the flags, the
	// dock, the lamps and the fog — still covers it.
	baseSlot: ANCHOR_SLOT[orientation],
	baseSlotAfter: SEA_SLOT[orientation],
	behindBase: true,
});

/**
 * The distant sailing ship, authored in the portrait scene's coordinate frame. It is drawn inside the
 * base scene just above the sea plane, so the water no longer washes over the hull, while the dock,
 * waterfall, fog and the splashes above it still occlude it. Per-orientation nudges align it with the
 * reference.
 */
export const getBonusShipOverlay = (orientation: Orientation): SpineOverlayDef => ({
	id: 'bonus_ship',
	format: 'json',
	skeleton: staticAssetPath(`${SHIP_BASE}/portrait.json`),
	atlas: staticAssetPath(`${SHIP_BASE}/portrait.atlas`),
	images: {
		'portrait.png': staticAssetPath(`${SHIP_BASE}/portrait.png`),
	},
	animation: 'animation',
	loop: true,
	skeletonScale: OVERLAY_SKELETON_SCALE,
	// Above the sea, under everything else the base scene draws (`behindBase` is only the fallback if
	// the anchor slot is ever renamed out of the skeleton).
	baseSlot: ANCHOR_SLOT[orientation],
	baseSlotAfter: SEA_SLOT[orientation],
	behindBase: true,
	// Position/scale from the tuning block above. `offsetYScene` (not offsetYVh) keeps the ship's hull
	// on the water horizon across viewport aspect ratios.
	...TUNING[orientation].ship,
});

/**
 * A swirling waterspout/tornado on the horizon. The asset is authored near the scene centre, so it's
 * pushed to either side by `offsetXVw`; the reference shows a large one to the right and a smaller,
 * fainter one to the left, so the left copy is scaled down. Drawn on top of the base scene and the
 * drifting clouds (so the funnel reads against the cloudy sky), but under the rain. `left` picks the
 * smaller left-hand copy.
 */
export const getBonusTornadoOverlay = (
	orientation: Orientation,
	left = false,
): SpineOverlayDef => {
	// Position/scale from the tuning block above. `offsetYScene` keeps the tornado's touchdown on the
	// water horizon across viewport aspect ratios. `tornadoLeft` is landscape-only; fall back to the
	// right-hand tuning if it's somehow missing.
	const place = left
		? (TUNING[orientation].tornadoLeft ?? TUNING[orientation].tornadoRight)
		: TUNING[orientation].tornadoRight;
	return {
		id: left ? 'bonus_tornado_left' : 'bonus_tornado',
		format: 'json',
		skeleton: staticAssetPath(`${TORNADO_BASE}/skeleton.json`),
		atlas: staticAssetPath(`${TORNADO_BASE}/skeleton.atlas`),
		images: {
			// The tornado atlas is TWO pages — frames 7–9 live on `skeleton_2.png`. Both must be mapped
			// or those frames of the 58-frame sequence render blank.
			'skeleton.png': staticAssetPath(`${TORNADO_BASE}/skeleton.png`),
			'skeleton_2.png': staticAssetPath(`${TORNADO_BASE}/skeleton_2.png`),
		},
		animation: 'animation',
		loop: true,
		skeletonScale: OVERLAY_SKELETON_SCALE,
		...place,
	};
};

/**
 * Diagonal free-game rain, drawn on top of the scene (still inside the background canvas, so always
 * behind the plinko board). Landscape and portrait ship their own rain skeletons, each authored in the
 * matching base scene's coordinate frame.
 */
export const getBonusRainOverlay = (orientation: Orientation): SpineOverlayDef =>
	orientation === 'landscape'
		? {
				id: 'bonus_rain',
				format: 'json',
				skeleton: staticAssetPath(`${LANDSCAPE_RAIN_BASE}/skeleton.json`),
				atlas: staticAssetPath(`${LANDSCAPE_RAIN_BASE}/skeleton.atlas`),
				images: {
					'skeleton.png': staticAssetPath(`${LANDSCAPE_RAIN_BASE}/skeleton.png`),
				},
				animation: 'animation',
				loop: true,
				skeletonScale: OVERLAY_SKELETON_SCALE,
			}
		: {
				id: 'bonus_rain',
				format: 'json',
				skeleton: staticAssetPath(`${PORTRAIT_RAIN_BASE}/portrait.json`),
				atlas: staticAssetPath(`${PORTRAIT_RAIN_BASE}/portrait.atlas`),
				images: {
					'portrait.png': staticAssetPath(`${PORTRAIT_RAIN_BASE}/portrait.png`),
				},
				animation: 'animation',
				loop: true,
				skeletonScale: OVERLAY_SKELETON_SCALE,
			};

/**
 * The free-game moon — a soft, dimmed moon in the upper-left sky, replacing the base scene's moon (which
 * is hidden during bonus). Positioned in plain viewport fractions and rendered behind the scene so the
 * clouds drift in front of it.
 */
export const getBonusMoonOverlay = (orientation: Orientation): SpineImageOverlayDef => ({
	id: 'bonus_moon',
	src: staticAssetPath(MOON_IMAGE),
	behindBase: true,
	// Position/size/opacity from the tuning block above.
	...TUNING[orientation].moon,
});

/**
 * Spine overlays in z-order (earlier = further back). The ship and splashes are drawn inside the base
 * scene at `ANCHOR_SLOT` — sharing one anchor, so this array's order is what keeps the ship under
 * the splashes. The rest paint on top of the whole base scene — clouds first, then the tornadoes (so
 * the funnels read against the cloudy sky), then rain in front of everything.
 */
export const getBonusOverlays = (orientation: Orientation): SpineOverlayDef[] => [
	getBonusShipOverlay(orientation),
	getBonusSplashOverlay(orientation, false),
	getBonusSplashOverlay(orientation, true),
	getBonusCloudOverlay(),
	getBonusTornadoOverlay(orientation, false),
	// Landscape shows a second, smaller tornado on the left; portrait has only the right-hand one.
	...(orientation === 'landscape' ? [getBonusTornadoOverlay(orientation, true)] : []),
	getBonusRainOverlay(orientation),
];

export const getBonusImageOverlays = (orientation: Orientation): SpineImageOverlayDef[] => [
	getBonusMoonOverlay(orientation),
];
