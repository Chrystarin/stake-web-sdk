import { getBonusImageOverlays, getBonusOverlays } from './bonusOverlayAssets';
import { staticAssetPath } from '../staticUrl';
import type { SpineAssetDef } from './types';

const SPINE_BASE = 'spine/background_landscape';
const LANDSCAPE_IMAGE = 'img/BG_landscape.webp';
const LANDSCAPE_BONUS_IMAGE = 'img/BG_landscape_FREEGAME.webp';

/** Ambient cloud slots in the base scene, hidden during bonus (replaced by the FG_CLOUD overlay). */
const LANDSCAPE_CLOUD_SLOTS = ['cloud1', 'cloud2', 'cloud3', 'cloud5', 'cloud6', 'cloud7'];

/**
 * The base scene's moon and distant ship are hidden during bonus — the free game draws its own dimmed
 * moon (`bonusImageOverlays`) and a dedicated ship spine (`bonusOverlays`) in their place.
 */
const LANDSCAPE_BONUS_HIDDEN_SLOTS = [...LANDSCAPE_CLOUD_SLOTS, 'moon', 'ship'];

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
		'skeleton.png': staticAssetPath(`${SPINE_BASE}/skeleton.webp`),
		'skeleton_2.png': staticAssetPath(`${SPINE_BASE}/skeleton_2.webp`),
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
		// Cover the height too: squarer-than-16:9 windows otherwise show an empty strip above the
		// scene (the width fill only reaches the top down to ~1.7:1). The scene zooms in about its
		// bottom-centre anchor, cropping the sides; the Spine layer's scale is tied to this one
		// (computeSpineOverlayTransform), so the animated scene zooms with it and stays registered.
		coverHeight: true,
	},
	bonusBackdropSrc: staticAssetPath(LANDSCAPE_BONUS_IMAGE),
	bonusHiddenSlots: LANDSCAPE_BONUS_HIDDEN_SLOTS,
	bonusOverlays: getBonusOverlays('landscape'),
	bonusImageOverlays: getBonusImageOverlays('landscape'),
	skeletonScale: 0.5,
});
