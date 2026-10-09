import { base } from '$app/paths';

import { isPhoneScreen } from './deviceTier.svelte';

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
	`${base}/${phoneCut(path).replace(/^\//, '')}`.replace(/\/{2,}/g, '/');

/**
 * Art that ships in a second, smaller cut for phones, as `<name>_phone.webp` beside the original —
 * the pieces a phone paints at well under half their pixels (a 3x phone is 1179 px across in
 * portrait and 2556 in landscape; these are drawn at 200-1100 of that), so the original was decoded
 * at two to five times the size anything would ever sample it at. The cut is chosen by SCREEN
 * (lib/deviceTier.svelte.ts `isPhoneScreen`), not by viewport or budget, so the preloader, the
 * components and the drift alarm all name the same file for the whole session, rotation included.
 * Desktops and iPads keep the originals. Cut with Pillow (LANCZOS, webp q90) from the PNG sources.
 */
const PHONE_CUTS: ReadonlySet<string> = new Set([
	'img/bonus-wheel/frame_bare.webp',
	'img/pirate-plinko/board_v2.webp',
	'img/pirate-plinko/cannon.webp',
	'img/top-slots/frame.webp',
]);
const phone = isPhoneScreen();
const phoneCut = (path: string): string =>
	phone && PHONE_CUTS.has(path.replace(/^\//, ''))
		? path.replace(/\.webp$/, '_phone.webp')
		: path;

const inBrowser = typeof window !== 'undefined';

/** The page-absolute form of a base-relative path — the key everything below is filed under. */
const absolute = (relative: string): string => new URL(relative, window.location.href).href;

/**
 * Images the intro preload has pulled into memory, mapped network URL -> `blob:` object URL.
 *
 * Preloading an image and holding the `HTMLImageElement` only spares a later reference a round trip if
 * the browser REUSES that resource for it — and on Stake's CDN it does not (measured in One-Eyed
 * Willy's Plinko: art preloaded under its exact URL still came off the wire when its screen opened,
 * because the response headers decide that reuse and the game does not control them). An object URL
 * removes the question: it is a handle to bytes already in this tab's memory, so there is no cache to
 * consult, no revalidation, and no policy that can invalidate it.
 *
 * Only IMAGES go through here. Media (`<video>`, `<audio>`) must keep its plain same-origin URL — the
 * Stake page's CSP has no `media-src`, so media falls through to `default-src 'self'`, which does not
 * admit `blob:`. See the video note in lib/preloadAssets.ts.
 */
const resident = new Map<string, string>();

/** Point future {@link staticUrl} / {@link staticPath} lookups for `url` at in-memory bytes. */
export const registerResidentUrl = (url: string, objectUrl: string): void => {
	resident.set(url, objectUrl);
};

/**
 * Base-relative path — for anything that resolves against the document (`src`, CSS `url()`).
 *
 * Once the preload has the asset resident this hands back its `blob:` URL instead, so a component
 * that renders after the splash paints from memory rather than asking the network again.
 */
export const staticPath = (path: string): string => {
	const relative = joinBase(path);
	if (!inBrowser) return relative;
	return resident.get(absolute(relative)) ?? relative;
};

/**
 * Absolute URL for a static asset.
 *
 * Loaders that resolve against something other than the document — `new Audio()`, and any library
 * given a bare path — need the full thing, so the URL is built against the page itself. Like
 * {@link staticPath}, it answers with the resident `blob:` copy once the preload has one.
 */
export const staticUrl = (path: string): string => {
	const relative = joinBase(path);
	if (!inBrowser) return relative;
	const url = absolute(relative);
	return resident.get(url) ?? url;
};

/**
 * The NETWORK URL for a static asset, never the resident copy. This is what the preloader fetches,
 * and what it files the result under, so the two `staticUrl` variants above can find it again.
 */
export const staticNetworkUrl = (path: string): string => {
	const relative = joinBase(path);
	return inBrowser ? absolute(relative) : relative;
};

/** Quoted `url("…")`, for an inline `background-image` on the element that needs it. */
export const staticCssUrl = (path: string): string => `url("${staticUrl(path)}")`;
