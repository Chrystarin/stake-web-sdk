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
		'skeleton.png': staticAssetPath(`${SPINE_BASE}/skeleton.webp`),
		'skeleton_2.png': staticAssetPath(`${SPINE_BASE}/skeleton_2.webp`),
		'skeleton_3.png': staticAssetPath(`${SPINE_BASE}/skeleton_3.webp`),
		'skeleton_4.png': staticAssetPath(`${SPINE_BASE}/skeleton_4.webp`),
	},
	animation: 'animation',
	loop: false,
	boundsMode: 'authored',
	// This skeleton's artwork sits above the root (y-up); without this it fits off the top edge.
	yUp: true,
	// The logo is authored 16:9 (1920×1085). On a narrow portrait/mobile screen the default cover
	// fit scales it to fill the height, blowing the width past the viewport so it's clipped on both
	// sides. Contain it instead so the whole logo stays centered and visible, with a small margin.
	containInPortrait: true,
	portraitContainScale: 0.9,
	// Keep the opening frames from skipping: the logo's first render competes with the atlas GPU
	// upload and the game booting behind the splash, so a dropped frame would otherwise jump the
	// animation ~100ms (Pixi's default catch-up cap). Clamp catch-up to one 60fps frame (≤16.7ms)
	// so a stall pauses-and-resumes instead of skipping ahead.
	catchUpMinFps: 60,
});

/** Backdrop image shown behind the intro spine (CSS background, cover). */
export const CASINO_TV_LOGO_BACKDROP = staticAssetPath(`${SPINE_BASE}/casino_tv_logo_backdrop.webp`);

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
 * logo for as long as loading takes; anywhere later and they would be watching it dissolve, and the
 * splash would sit on an empty screen — which is exactly what the removed progress bar was papering
 * over. Resuming plays 2 → 3.333s, so the fade-out still runs in full before the game is revealed.
 */
export const CASINO_TV_LOGO_HOLD_SECONDS = 2;

/**
 * The loading pulse: rather than sitting on one dead frame, the splash ping-pongs the animation across
 * this window for as long as the preload takes, so the logo breathes and the wait reads as "working".
 *
 * The motion is the ARTIST'S, not a synthesized wobble — the window is seeked out of the authored
 * animation, so it rides the real curve and cannot fight the renderer's fit transform.
 *
 * ⚠️ Tune against the MEASURED pose, not the raw JSON — the bone scale timeline is only half the
 * story. `logo_adjust` carries BOTH a bone scale ramp (1.0 → 1.254) and a mesh deform that widens the
 * logo on top of it, so the on-screen size grows faster than the scale value alone suggests. Sampled
 * from the live skeleton over the reveal (`logo_adjust` pose scaleX / slot alpha / world width):
 *
 *     t     0.6    0.7    1.0    1.5    1.8    1.9    2.0    2.4    3.0   3.2
 *     scale 1.000  1.004  1.036  1.091  1.123  1.134  1.145  1.189  1.254  1.254
 *     alpha 0      1      1      1      1      1      1      0.667  0.167  0
 *     width 1169   1175   1231   1327   1386   1406   1426   1507   1633   1648
 *
 * So 0.7 → 2.0 is the logo GROWING IN by ~21%, not a breath — pulsing across it visibly swells it.
 * The window below is the top ~3% of that ramp, which reads as a breath.
 *
 * Hard bounds: below ~0.7s the `effectsLogo` flicker is still on screen; above 2.0s alpha starts
 * dropping, so the pulse would visibly dim the logo. Widen `fromSeconds` downward for a deeper breath,
 * keep `toSeconds` at 2.0, and set the pace with `periodSeconds`.
 */
export const CASINO_TV_LOGO_PULSE = {
	fromSeconds: 1.8,
	toSeconds: CASINO_TV_LOGO_HOLD_SECONDS,
	periodSeconds: 1.8,
} as const;
