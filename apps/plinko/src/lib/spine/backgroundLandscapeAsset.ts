import { staticAssetPath } from '../staticUrl';
import type { SpineAssetDef } from './types';

const SPINE_BASE = 'spine/background_landscape';

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
	skeletonScale: 0.5,
});
