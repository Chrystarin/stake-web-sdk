import { base } from '$app/paths';

/**
 * Resolve a path to a file in `static/` (the build output root).
 *
 * Stake Engine serves a game from a CDN subpath — `https://<team>.live.stake-engine.com/<game>/v<n>/`
 * — and the version moves with every upload. So an asset addressed as `/img/x.svg` is asked for at
 * the DOMAIN root, one level above the build, and comes back 500. Everything has to be addressed
 * relative to wherever the build happens to be sitting, which is what SvelteKit's `base` is for
 * (see `paths.relative` in svelte.config.js).
 *
 * Nothing about this is visible in development, where the game is served from `/` and a root-absolute
 * path is accidentally correct — which is exactly how the whole game came to be written with them.
 */
const joinBase = (path: string): string =>
	`${base}/${path.replace(/^\//, '')}`.replace(/\/{2,}/g, '/');

/** Base-relative path — for anything that resolves against the document (`src`, CSS `url()`). */
export const staticPath = (path: string): string => joinBase(path);

/**
 * Absolute URL for a static asset.
 *
 * Loaders that resolve against something other than the document — `new Audio()`, and any library
 * given a bare path — need the full thing, so the URL is built against the page itself.
 */
export const staticUrl = (path: string): string => {
	const relative = joinBase(path);
	return typeof window === 'undefined' ? relative : new URL(relative, window.location.href).href;
};

/** Quoted `url("…")`, for an inline `background-image` on the element that needs it. */
export const staticCssUrl = (path: string): string => `url("${staticUrl(path)}")`;
