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
 *  - ship  (spine, behind the scene so the dock/waterfall occlude it) — `getBonusShipOverlay`
 *  - splash×2 (spine, behind the scene at the two waterfalls) — `getBonusSplashOverlay`
 *  - tornado×2 (spine, behind the scene: a big one right, a smaller one left) — `getBonusTornadoOverlay`
 *  - cloud (spine, drifting storm clouds on top)             — `getBonusCloudOverlay`
 *  - rain  (spine, on top — landscape/portrait specific)     — `getBonusRainOverlay`
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

/** Raise both splashes so more of them peeks out above the waterfall lip (negative = up). */
const SPLASH_OFFSET_Y_VH = -0.06;
/**
 * Residual nudge for the mirrored (left) splash. The mirror reflects about the skeleton root (world
 * x=0), but the scene is symmetric about ~world +8 — the midpoint of the two waterfall bones (−1169 /
 * +1201). `2 × 8 × scale / viewportWidth ≈ 0.011vw` puts the left splash exactly opposite the right one.
 */
const SPLASH_LEFT_OFFSET_X_VW = 0.011;

/**
 * Pause between splashes, so each waterfall bursts intermittently rather than looping continuously.
 * Randomized in this range and re-rolled after every play, so the bursts feel irregular rather than
 * metronomic.
 */
const SPLASH_GAP_MIN_SECONDS = 5;
const SPLASH_GAP_MAX_SECONDS = 7;
/**
 * The LEFT splash fires first; the RIGHT one follows 0.5s later. (Left is the mirrored copy, hence
 * the `mirror ? 0 : …`.)
 */
const SPLASH_RIGHT_DELAY_SECONDS = 0.5;

/**
 * The FG_SPLASH asset authors a single splash at the RIGHT-hand waterfall. `mirror` produces a second
 * instance flipped across the scene centre so the LEFT waterfall gets a matching splash.
 */
export const getBonusSplashOverlay = (mirror = false): SpineOverlayDef => ({
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
	offsetYVh: SPLASH_OFFSET_Y_VH,
	offsetXVw: mirror ? SPLASH_LEFT_OFFSET_X_VW : 0,
	cycleGapMinSeconds: SPLASH_GAP_MIN_SECONDS,
	cycleGapMaxSeconds: SPLASH_GAP_MAX_SECONDS,
	cycleStartDelaySeconds: mirror ? 0 : SPLASH_RIGHT_DELAY_SECONDS,
	// Under the base scene, so the waterfall, flags and dock all cover the splash.
	behindBase: true,
});

/**
 * The distant sailing ship, authored in the portrait scene's coordinate frame. It sits behind the base
 * scene so the dock and waterfall occlude it. Per-orientation nudges align it with the reference.
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
	behindBase: true,
	...(orientation === 'landscape'
		? { offsetXVw: -0.24, offsetYVh: -0.12, scaleMul: 0.8 }
		: { offsetXVw: -0.07, offsetYVh: -0.08, scaleMul: 1 }),
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
	const place =
		orientation === 'landscape'
			? left
				? { offsetXVw: -0.2, offsetYVh: -0.63, scaleMul: 0.62 }
				: { offsetXVw: 0.19, offsetYVh: -0.61, scaleMul: 1 }
			: // Portrait shows a single, smaller waterspout in the upper-right sky (no left copy).
				{ offsetXVw: 0.28, offsetYVh: -0.82, scaleMul: 0.55 };
	return {
		id: left ? 'bonus_tornado_left' : 'bonus_tornado',
		format: 'json',
		skeleton: staticAssetPath(`${TORNADO_BASE}/skeleton.json`),
		atlas: staticAssetPath(`${TORNADO_BASE}/skeleton.atlas`),
		images: {
			'skeleton.png': staticAssetPath(`${TORNADO_BASE}/skeleton.png`),
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
	alpha: 0.5,
	behindBase: true,
	...(orientation === 'landscape'
		? { xVw: 0.12, yVh: 0.13, widthVw: 0.2 }
		: { xVw: 0.16, yVh: 0.13, widthVw: 0.3 }),
});

/**
 * Spine overlays in z-order (earlier = further back). `behindBase` layers (ship, splashes) go under the
 * base scene; the rest paint on top of it — clouds first, then the tornadoes (so the funnels read
 * against the cloudy sky), then rain in front of everything.
 */
export const getBonusOverlays = (orientation: Orientation): SpineOverlayDef[] => [
	getBonusShipOverlay(orientation),
	getBonusSplashOverlay(false),
	getBonusSplashOverlay(true),
	getBonusCloudOverlay(),
	getBonusTornadoOverlay(orientation, false),
	// Landscape shows a second, smaller tornado on the left; portrait has only the right-hand one.
	...(orientation === 'landscape' ? [getBonusTornadoOverlay(orientation, true)] : []),
	getBonusRainOverlay(orientation),
];

export const getBonusImageOverlays = (orientation: Orientation): SpineImageOverlayDef[] => [
	getBonusMoonOverlay(orientation),
];
