import { staticAssetPath } from '../staticUrl';
import type { SpineAssetDef } from './types';

const SPINE_BASE = 'spine/background_landscape';

/**
 * Width fill multiplier for the landscape Spine background.
 * 1 = exactly viewport width; raise to zoom in (e.g. 1.12 = 12% wider, sides cropped).
 */
export const LANDSCAPE_BACKGROUND_WIDTH_FILL = 1.275;

/**
 * Position nudge after fit (viewport-relative, like CSS vw/vh).
 * 0.05 = 5% of viewport width/height; negative moves left/up.
 */
export const LANDSCAPE_BACKGROUND_OFFSET_X_VW = -0.045;
export const LANDSCAPE_BACKGROUND_OFFSET_Y_VH = 0;

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
	boundsMode: 'content',
	boundsPadding: 0,
	fitAnchor: 'bottom',
	widthFillScale: LANDSCAPE_BACKGROUND_WIDTH_FILL,
	offsetXVw: LANDSCAPE_BACKGROUND_OFFSET_X_VW,
	offsetYVh: LANDSCAPE_BACKGROUND_OFFSET_Y_VH,
	skeletonScale: 0.5,
});
