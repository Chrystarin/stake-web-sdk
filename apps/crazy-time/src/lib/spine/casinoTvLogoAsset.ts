import { staticNetworkUrl } from '../staticUrl';
import type { LogoSpineAsset } from './LogoSpineRenderer';

const SPINE_BASE = 'spine/casino_tv_logo';

/**
 * Intro splash spine: the casino TV logo flicker-on animation, lifted as-is from One-Eyed Willy's
 * Plinko (apps/plinko/static/spine/casino_tv_logo — same skeleton, same pages, same timings). Played
 * once (no loop) over the `casino_tv_logo_backdrop.webp` backdrop while the game boots. Rendered
 * centred + cover-fit by {@link LogoSpineRenderer}; the backdrop is a CSS background on the loader.
 *
 * ⚠️ The atlas names its pages `skeleton.png` … `skeleton_4.png`; the files on disk are webp. The
 * `images` map is what tells the spine atlas loader which file each page name really is.
 */
export const getCasinoTvLogoAsset = (): LogoSpineAsset => ({
	id: 'casino_tv_logo',
	skeleton: staticNetworkUrl(`${SPINE_BASE}/skeleton.json`),
	atlas: staticNetworkUrl(`${SPINE_BASE}/skeleton.atlas`),
	images: {
		'skeleton.png': staticNetworkUrl(`${SPINE_BASE}/skeleton.webp`),
		'skeleton_2.png': staticNetworkUrl(`${SPINE_BASE}/skeleton_2.webp`),
		'skeleton_3.png': staticNetworkUrl(`${SPINE_BASE}/skeleton_3.webp`),
		'skeleton_4.png': staticNetworkUrl(`${SPINE_BASE}/skeleton_4.webp`),
	},
	animation: 'animation',
	// This skeleton's artwork sits above the root (y-up); without this it fits off the top edge.
	yUp: true,
	// The logo is authored 16:9 (1920×1085). On a narrow portrait screen the default cover fit scales
	// it to fill the height, blowing the width past the viewport so it is clipped on both sides.
	// Contain it instead so the whole logo stays centred and visible, with a small margin.
	containInPortrait: true,
	portraitContainScale: 0.9,
	// Keep the opening frames from skipping: the logo's first render competes with the atlas GPU
	// upload and the preload starting behind the splash, so a dropped frame would otherwise jump the
	// animation ~100ms (Pixi's default catch-up cap). Clamp catch-up to one 60fps frame (≤16.7ms)
	// so a stall pauses-and-resumes instead of skipping ahead.
	catchUpMinFps: 60,
});

/** Backdrop image shown behind the intro spine (CSS background, cover). A 128-byte flat colour. */
export const CASINO_TV_LOGO_BACKDROP = staticNetworkUrl(`${SPINE_BASE}/casino_tv_logo_backdrop.webp`);

/**
 * Authored animation length in ms (last keyframe ≈ 3.333s, see skeleton.json). The loader dismisses
 * once the spine's own track has run this far — the logo fades out right at the end.
 */
export const CASINO_TV_LOGO_DURATION_MS = 3400;

/**
 * Where the splash HOLDS the animation while the asset preload finishes (seconds into `animation`).
 *
 * Read off the authored timeline in `skeleton.json`:
 *   0 → 0.633s  the `effectsLogo` flicker sequence plays, `logo_adjust` still at alpha 0
 *   0.667s      `logo_adjust` snaps to full alpha (stepped) — the logo is now fully lit
 *   0.667 → 2s  it holds there, unchanged
 *   2 → 3.2s    it fades back to alpha 0
 *   3.333s      the closing bone-scale settles; nothing is on screen
 *
 * So 2s is the LAST frame on which the logo is fully lit. Pausing there shows the player the finished
 * logo for as long as loading takes; anywhere later and they would be watching it dissolve. Resuming
 * plays 2 → 3.333s, so the fade-out still runs in full before the game is revealed.
 */
export const CASINO_TV_LOGO_HOLD_SECONDS = 2;

/**
 * The loading pulse: rather than sitting on one dead frame, the splash ping-pongs the animation across
 * this window for as long as the preload takes, so the logo breathes and the wait reads as "working".
 * The window is the top ~3% of the logo's authored grow-in (see the Plinko's casinoTvLogoAsset.ts for
 * the sampled pose table this was tuned against): below ~0.7s the flicker is still on screen, above
 * 2.0s the alpha starts dropping.
 */
export const CASINO_TV_LOGO_PULSE = {
	fromSeconds: 1.8,
	toSeconds: CASINO_TV_LOGO_HOLD_SECONDS,
	periodSeconds: 1.8,
} as const;
