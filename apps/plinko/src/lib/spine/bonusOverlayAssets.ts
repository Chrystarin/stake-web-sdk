import { staticAssetPath } from '../staticUrl';
import type { SpineOverlayDef } from './types';

/**
 * Free-game (bonus mode) spine overlays. Both were exported from the SAME Spine scene as the base
 * `background_landscape` skeleton (identical `../background/Spine/` image root and matching authored
 * bounds), so they line up with the base scene when rendered with the base spine's fit transform and
 * the same skeleton scale (0.5). They are painted on top of the base background only while the bonus
 * round is active — see `SpineBackgroundRenderer.setBonusMode`.
 *
 * `FG_CLOUD` drifts free-game clouds across the sky (replacing the base ambient clouds, which are
 * hidden during bonus). `FG_SPLASH` is the crashing water-splash burst.
 */

const CLOUD_BASE = 'spine/FG_CLOUD';
const SPLASH_BASE = 'spine/FG_SPLASH';

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
	// Under the base scene, so the waterfall, flags and dock all cover the splash. The distant ship is
	// lifted into the underlay copy (`bonusUnderlaySlots`) so it still passes BEHIND the splash.
	behindBase: true,
});

export const getBonusOverlays = (): SpineOverlayDef[] => [
	getBonusCloudOverlay(),
	getBonusSplashOverlay(false),
	getBonusSplashOverlay(true),
];
