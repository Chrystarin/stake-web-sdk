import { getBonusImageOverlays, getBonusOverlays } from './bonusOverlayAssets';
import { staticAssetPath } from '../staticUrl';
import type { SpineAssetDef } from './types';

const SPINE_BASE = 'spine/background_portrait';
const PORTRAIT_IMAGE = 'img/BG_portrait.jpg';
const PORTRAIT_BONUS_IMAGE = 'img/BG_portrait_FREEGAME.jpg';

/** Ambient cloud slots in the base portrait scene, hidden during bonus (replaced by FG_CLOUD). */
const PORTRAIT_CLOUD_SLOTS = ['cloud1', 'cloud2', 'cloud3', 'cloud5', 'cloud6', 'cloud7'];

/**
 * Hidden during bonus: the base ambient clouds plus the distant ship (replaced by the dedicated ship
 * spine overlay). The portrait scene has no rendered moon of its own, so the free-game moon image is
 * simply added on top. `moon` is listed harmlessly for parity with landscape.
 */
const PORTRAIT_BONUS_HIDDEN_SLOTS = [...PORTRAIT_CLOUD_SLOTS, 'moon', 'ship'];

/**
 * Width fill multiplier for the portrait Spine background.
 * 1 = exactly viewport width; raise to zoom in (e.g. 1.12 = 12% wider, sides cropped).
 */
export const PORTRAIT_BACKGROUND_WIDTH_FILL = 3.25;

/**
 * Position nudge for the Spine layer (viewport-relative, like CSS vw/vh).
 * 0.05 = 5% of viewport width/height; negative moves left/up.
 */
export const PORTRAIT_BACKGROUND_OFFSET_X_VW = 0;
export const PORTRAIT_BACKGROUND_OFFSET_Y_VH = -0.02;

/**
 * Width fill multiplier for the static JPG behind the Spine animation.
 * Uses the same bounds and fit rules as the Spine layer.
 */
export const PORTRAIT_BACKGROUND_IMAGE_WIDTH_FILL = 1;

/**
 * Position nudge for the static JPG backdrop (viewport-relative, like CSS vw/vh).
 */
export const PORTRAIT_BACKGROUND_IMAGE_OFFSET_X_VW = 0;
export const PORTRAIT_BACKGROUND_IMAGE_OFFSET_Y_VH = 0;

export const getBackgroundPortraitAsset = (): SpineAssetDef => ({
	id: 'background_portrait',
	format: 'json',
	skeleton: staticAssetPath(`${SPINE_BASE}/portrait.json`),
	atlas: staticAssetPath(`${SPINE_BASE}/portrait.atlas`),
	images: {
		'portrait.png': staticAssetPath(`${SPINE_BASE}/portrait.png`),
		'portrait_2.png': staticAssetPath(`${SPINE_BASE}/portrait_2.png`),
	},
	animation: 'animation',
	boundsMode: 'authored',
	boundsPadding: 0,
	fitAnchor: 'bottom',
	widthFillScale: PORTRAIT_BACKGROUND_WIDTH_FILL,
	offsetXVw: PORTRAIT_BACKGROUND_OFFSET_X_VW,
	offsetYVh: PORTRAIT_BACKGROUND_OFFSET_Y_VH,
	backdrop: {
		src: staticAssetPath(PORTRAIT_IMAGE),
		widthFillScale: PORTRAIT_BACKGROUND_IMAGE_WIDTH_FILL,
		offsetXVw: PORTRAIT_BACKGROUND_IMAGE_OFFSET_X_VW,
		offsetYVh: PORTRAIT_BACKGROUND_IMAGE_OFFSET_Y_VH,
		// Cover the height too, so tall phones don't show an empty strip above the scene.
		coverHeight: true,
	},
	bonusBackdropSrc: staticAssetPath(PORTRAIT_BONUS_IMAGE),
	bonusHiddenSlots: PORTRAIT_BONUS_HIDDEN_SLOTS,
	bonusOverlays: getBonusOverlays('portrait'),
	bonusImageOverlays: getBonusImageOverlays('portrait'),
	skeletonScale: 0.5,
});
