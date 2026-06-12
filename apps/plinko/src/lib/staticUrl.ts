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
 * Absolute URL for static assets (img src, CSS custom properties, inline styles).
 * In the browser, resolves against the current page so CDN subpaths work.
 * During SSR, returns a base-relative path that resolves from the document when used
 * as `url(var(--name))` on an element with the variable set inline.
 */
export const staticUrl = (path: string): string => {
	const relative = joinBase(path);
	if (browser) {
		return new URL(relative, window.location.href).href;
	}
	return relative;
};

/**
 * Quoted `url("…")` for direct inline `background-image` on the same element.
 * For bundled SCSS + custom properties, set `--name` to `staticUrl(...)` and use
 * `background-image: url(var(--name))` in the stylesheet instead.
 */
export const staticCssUrl = (path: string): string => `url("${staticUrl(path)}")`;
