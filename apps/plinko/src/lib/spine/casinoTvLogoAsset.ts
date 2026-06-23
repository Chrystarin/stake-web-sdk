import { staticAssetPath } from '../staticUrl';
import type { SpineAssetDef } from './types';

const SPINE_BASE = 'spine/casino_tv_logo';

/**
 * Intro splash spine: the casino TV logo flicker-on animation. Played once (no loop) over the
 * `casino_tv_logo_backdrop.png` backdrop while the game boots, replacing the old stake-engine
 * loader. Rendered centered + cover-fit via {@link SpineBackgroundRenderer}; the backdrop image
 * is drawn behind it by the loader component (CSS background), so this def carries no `backdrop`.
 */
export const getCasinoTvLogoAsset = (): SpineAssetDef => ({
	id: 'casino_tv_logo',
	format: 'json',
	skeleton: staticAssetPath(`${SPINE_BASE}/skeleton.json`),
	atlas: staticAssetPath(`${SPINE_BASE}/skeleton.atlas`),
	images: {
		'skeleton.png': staticAssetPath(`${SPINE_BASE}/skeleton.png`),
		'skeleton2.png': staticAssetPath(`${SPINE_BASE}/skeleton2.png`),
		'skeleton3.png': staticAssetPath(`${SPINE_BASE}/skeleton3.png`),
		'skeleton4.png': staticAssetPath(`${SPINE_BASE}/skeleton4.png`),
	},
	animation: 'animation',
	loop: false,
	boundsMode: 'authored',
	// This skeleton's artwork sits above the root (y-up); without this it fits off the top edge.
	yUp: true,
});

/** Backdrop image shown behind the intro spine (CSS background, cover). */
export const CASINO_TV_LOGO_BACKDROP = staticAssetPath(`${SPINE_BASE}/casino_tv_logo_backdrop.png`);

/**
 * Authored animation length in ms (last keyframe ≈ 3.333s, see skeleton.json). The loader holds
 * the splash this long — the logo fades out right at the end — then dismisses.
 */
export const CASINO_TV_LOGO_DURATION_MS = 3400;
