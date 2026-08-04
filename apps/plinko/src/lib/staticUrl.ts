import { browser } from '$app/environment';
import { base } from '$app/paths';

/**
 * Resolve paths to files in /static (build output root).
 * Uses SvelteKit `base` so assets work on CDN subpaths (paths.relative).
 */
const joinBase = (path: string): string => {
	const clean = path.replace(/^\//, '');
	return `${base}/${clean}`.replace(/\/{2,}/g, '/');
};

/** Base-relative path for Pixi/Spine asset loaders (same-origin, no absolute URL). */
export const staticAssetPath = (path: string): string => joinBase(path);

/**
 * Assets the intro preload has pulled into memory, mapped network URL -> `blob:` object URL.
 *
 * Preloading an image and holding the `HTMLImageElement` only spares a later reference a round trip if
 * the browser REUSES that resource for it — and on Stake's CDN it does not. Measured in production:
 * `confirmation_popup/autobet_*`, `buy_bonus_*` and `close_btn` were all preloaded under these exact
 * URLs and every one of them still came off the wire (669 KB) when its screen opened, which is the
 * whole reported bug. Response headers decide that reuse and the game does not control them.
 *
 * An object URL removes the question. It is a handle to bytes already in this tab's memory, so there is
 * no cache to consult, no revalidation, and no policy that can invalidate it.
 */
const resident = new Map<string, string>();

/** Point future {@link staticUrl} lookups for `url` at in-memory bytes. Browser-only. */
export const registerResidentUrl = (url: string, objectUrl: string): void => {
	resident.set(url, objectUrl);
};

/**
 * Absolute URL for static assets (img src, CSS custom properties, inline styles).
 * In the browser, resolves against the current page so CDN subpaths work.
 * During SSR, returns a base-relative path that resolves from the document when used
 * as `url(var(--name))` on an element with the variable set inline.
 *
 * Once the preload has an asset resident, this hands back its `blob:` URL instead — so a component
 * that renders after the splash paints from memory. Anything rendered DURING the splash gets the plain
 * URL, which is correct: it is already on screen and already loading.
 */
export const staticUrl = (path: string): string => {
	const relative = joinBase(path);
	if (browser) {
		const absolute = new URL(relative, window.location.href).href;
		return resident.get(absolute) ?? absolute;
	}
	return relative;
};

/**
 * Quoted `url("…")` for direct inline `background-image` on the same element.
 * For bundled SCSS + custom properties, set `--name` to `staticUrl(...)` and use
 * `background-image: url(var(--name))` in the stylesheet instead.
 */
export const staticCssUrl = (path: string): string => `url("${staticUrl(path)}")`;
