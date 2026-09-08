import { staticPath } from '../staticUrl';
import type { SpineAssetDef } from './types';

/**
 * The animated backdrop, lifted from One Eyed Willy's Plinko: a Spine scene (sea, sky, ship) played
 * over a static webp of the same view. Crazy Time only ever draws the landscape cut — the game frame
 * is a fixed 16:9 box — so there is no portrait variant here, and none of Plinko's free-game overlay
 * layers are declared: every one of those fields is optional and the renderer skips them when absent.
 *
 * The fill and offset numbers are Plinko's, and they are what registers the animated layer against
 * the static one. Change them in pairs or the scene and its backdrop drift apart.
 */
const SPINE_BASE = 'spine/background_landscape';

/** 1 = exactly viewport width; above that the scene zooms in and the sides crop. */
const WIDTH_FILL = 1.215;
const OFFSET_X_VW = -0.002;
const OFFSET_Y_VH = -0.21;

/** The static webp behind the animation, fitted by the same rules. */
const IMAGE_WIDTH_FILL = 1.275;
const IMAGE_OFFSET_X_VW = -0.045;
const IMAGE_OFFSET_Y_VH = 0.22;

/**
 * Which cut of the backdrop art to load. The 2879x1620 original is ~17.8 MB decoded and resident for
 * the session; a phone's backbuffer never exceeds the 1920 px `_phone` cut, so it gains nothing from
 * the larger file and pays for it in the memory that makes iOS reap WebGL contexts. Decided by
 * screen, not viewport: a phone held sideways is still a phone.
 */
export const isPhoneScreen = (): boolean => {
	if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
	const touch =
		navigator.maxTouchPoints > 0 ||
		(typeof window.matchMedia === 'function' && window.matchMedia('(any-pointer: coarse)').matches);
	if (!touch) return false;
	const { width, height } = window.screen;
	return Math.max(width || 0, height || 0) <= 960;
};

/** Static-relative path (`img/…`) of the backdrop cut for this device. */
export const backdropImagePath = (): string =>
	isPhoneScreen() ? 'img/BG_landscape_phone.webp' : 'img/BG_landscape.webp';

export const getBackgroundLandscapeAsset = (): SpineAssetDef => ({
	id: 'background_landscape',
	format: 'json',
	skeleton: staticPath(`${SPINE_BASE}/skeleton.json`),
	atlas: staticPath(`${SPINE_BASE}/skeleton.atlas`),
	images: {
		'skeleton.png': staticPath(`${SPINE_BASE}/skeleton.webp`),
		'skeleton_2.png': staticPath(`${SPINE_BASE}/skeleton_2.webp`),
	},
	animation: 'animation',
	boundsMode: 'authored',
	boundsPadding: 0,
	fitAnchor: 'bottom',
	widthFillScale: WIDTH_FILL,
	offsetXVw: OFFSET_X_VW,
	offsetYVh: OFFSET_Y_VH,
	backdrop: {
		src: staticPath(backdropImagePath()),
		widthFillScale: IMAGE_WIDTH_FILL,
		offsetXVw: IMAGE_OFFSET_X_VW,
		offsetYVh: IMAGE_OFFSET_Y_VH,
		// Cover the height as well: a squarer-than-16:9 window otherwise shows an empty strip above
		// the scene. The Spine layer's scale is tied to this one, so both zoom together.
		coverHeight: true,
	},
	skeletonScale: 0.5,
});
