import { staticAssetPath } from './staticUrl';

/**
 * Which cut of the landscape backdrop art a device should load.
 *
 * `BG_landscape.webp` / `BG_landscape_FREEGAME.webp` are 2879×1620 — 17.8 MB of decoded RGBA EACH,
 * resident in Pixi's cache for the session and uploaded to the background renderer's GPU context.
 * A phone never needs that: the widest phone viewport (932 CSS px) at the renderer's resolution cap
 * of 2 is a 1864 px backbuffer, so the cover fit samples the image DOWN — the extra pixels buy
 * nothing on screen and, without mipmaps, minifying a 2879 px texture to 1864 px is also the less
 * cache-friendly way to draw it. The `_phone` cuts are 1920×1080 (7.9 MB each): at or above every
 * phone backbuffer width, so pixel-for-pixel the same picture, at 44% of the memory. Two backdrops
 * → ~20 MB less on exactly the device class where iOS reaps WebGL contexts under memory pressure.
 *
 * Desktops and tablets keep the full cut: a 1440p / Retina display draws the backdrop wider than
 * 1920 px and would see the difference.
 *
 * Decided by SCREEN, not by viewport or layout: a phone held sideways is still a phone, and the
 * choice has to be stable for the session — the preloader and the renderer must name the same file.
 * Touch hardware plus a long screen edge of ≤ 960 CSS px covers every iPhone (max 932) and no iPad
 * (min 1024). Portrait art is left alone: `BG_portrait.webp` is 922×1761, already ~1:1 on a phone.
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

/** Static-relative paths (`img/…`) of the base and free-game landscape backdrops for this device. */
export const landscapeBackdropImagePaths = (): { base: string; bonus: string } =>
	isPhoneScreen()
		? { base: 'img/BG_landscape_phone.webp', bonus: 'img/BG_landscape_FREEGAME_phone.webp' }
		: { base: 'img/BG_landscape.webp', bonus: 'img/BG_landscape_FREEGAME.webp' };

/** Same, resolved through `staticAssetPath` for the spine asset defs. */
export const landscapeBackdropAssetPaths = (): { base: string; bonus: string } => {
	const paths = landscapeBackdropImagePaths();
	return { base: staticAssetPath(paths.base), bonus: staticAssetPath(paths.bonus) };
};
