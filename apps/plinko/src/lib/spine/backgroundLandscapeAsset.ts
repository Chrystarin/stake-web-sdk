import { getBonusOverlays } from './bonusOverlayAssets';
import { staticAssetPath } from '../staticUrl';
import type { SpineAssetDef } from './types';

const SPINE_BASE = 'spine/background_landscape';
const LANDSCAPE_IMAGE = 'img/BG_landscape.jpg';
const LANDSCAPE_BONUS_IMAGE = 'img/BG_landscape_FREEGAME.jpg';

/** Ambient cloud slots in the base scene, hidden during bonus (replaced by the FG_CLOUD overlay). */
const LANDSCAPE_CLOUD_SLOTS = ['cloud1', 'cloud2', 'cloud3', 'cloud5', 'cloud6', 'cloud7'];

/**
 * Width fill multiplier for the landscape Spine background.
 * 1 = exactly viewport width; raise to zoom in (e.g. 1.12 = 12% wider, sides cropped).
 */
export const LANDSCAPE_BACKGROUND_WIDTH_FILL = 1.215;

/**
 * Position nudge for the Spine layer (viewport-relative, like CSS vw/vh).
 * 0.05 = 5% of viewport width/height; negative moves left/up.
 */
export const LANDSCAPE_BACKGROUND_OFFSET_X_VW = -0.002;
export const LANDSCAPE_BACKGROUND_OFFSET_Y_VH = -0.21;

/**
 * Width fill multiplier for the static JPG behind the Spine animation.
 * Uses the same bounds and fit rules as the Spine layer.
 */
export const LANDSCAPE_BACKGROUND_IMAGE_WIDTH_FILL = 1.275;

/**
 * Position nudge for the static JPG backdrop (viewport-relative, like CSS vw/vh).
 */
export const LANDSCAPE_BACKGROUND_IMAGE_OFFSET_X_VW = -0.045;
export const LANDSCAPE_BACKGROUND_IMAGE_OFFSET_Y_VH = 0.22;

export const getBackgroundLandscapeAsset = (): SpineAssetDef => ({
	id: 'background_landscape',
	format: 'json',
	skeleton: staticAssetPath(`${SPINE_BASE}/skeleton.json`),
	atlas: staticAssetPath(`${SPINE_BASE}/skeleton.atlas`),
	images: {
		'skeleton.png': staticAssetPath(`${SPINE_BASE}/skeleton.png`),
		'skeleton_2.png': staticAssetPath(`${SPINE_BASE}/skeleton_2.png`),
	},
	animation: 'animation',
	boundsMode: 'authored',
	boundsPadding: 0,
	fitAnchor: 'bottom',
	widthFillScale: LANDSCAPE_BACKGROUND_WIDTH_FILL,
	offsetXVw: LANDSCAPE_BACKGROUND_OFFSET_X_VW,
	offsetYVh: LANDSCAPE_BACKGROUND_OFFSET_Y_VH,
	backdrop: {
		src: staticAssetPath(LANDSCAPE_IMAGE),
		widthFillScale: LANDSCAPE_BACKGROUND_IMAGE_WIDTH_FILL,
		offsetXVw: LANDSCAPE_BACKGROUND_IMAGE_OFFSET_X_VW,
		offsetYVh: LANDSCAPE_BACKGROUND_IMAGE_OFFSET_Y_VH,
	},
	bonusBackdropSrc: staticAssetPath(LANDSCAPE_BONUS_IMAGE),
	bonusHiddenSlots: LANDSCAPE_CLOUD_SLOTS,
	// The distant ship is authored as the LAST (topmost) slot, above the waterfall. Lift it beneath the
	// bonus overlays so the splash reads in front of it while the waterfall still covers the splash.
	// The moon comes along because lifting the ship alone would drop it below the moon (slot 2) — the
	// underlay preserves the skeleton's own draw order, so listing both keeps the ship over the moon.
	bonusUnderlaySlots: ['moon', 'ship'],
	bonusOverlays: getBonusOverlays(),
	skeletonScale: 0.5,
});
