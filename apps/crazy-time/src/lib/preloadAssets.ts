import { Assets } from 'pixi.js';

import { NUMBER_PAY, NUMBER_SPOTS, ROOM_ICON, ROOM_SPOTS } from '../game/constants';
import { musicUrl, soundEffectUrls, warmSounds } from '../game/sound';
import { stateGame } from '../game/stateGame.svelte';
import { registerResidentUrl, staticNetworkUrl } from './staticUrl';
import { CASINO_TV_LOGO_BACKDROP, getCasinoTvLogoAsset } from './spine/casinoTvLogoAsset';

/**
 * ══ THE GAME'S ASSET MANIFEST ══════════════════════════════════════════════════════════════════
 *
 * Every static file the game can put on screen or play, in one place. The intro splash
 * (LoaderCasinoTvLogo.svelte) blocks on ALL of it (see {@link preloadAllGameAssets}) and the layout
 * mounts <Game> only once it has settled, so nothing is ever fetched or decoded for the first time
 * mid-game — and, because the game itself is not on screen until then, nothing is fetched twice either.
 *
 * Ported from One-Eyed Willy's Plinko (apps/plinko/src/lib/preloadAssets.ts), whose notes on WHY each
 * asset class is warmed the way it is are the authority; the short version of each is repeated at the
 * list it applies to. "Preloaded" means RESIDENT IN MEMORY, not cached and not merely referenced:
 *   • DOM images are fetched as Blobs, decoded, and published as object URLs through `staticUrl`, so
 *     whatever renders one later paints from bytes in this tab — no request, no revalidation.
 *   • Videos are warmed as ELEMENTS: the `<video>` that loads a first frame behind the splash is the
 *     very element the game later adopts, buffer and decoded frame intact.
 *   • Sound effects are warmed as the `Audio` elements `playSound` clones.
 *   • The dragon's spine stays in Pixi's cache under the aliases ChestDragon.svelte mounts it by.
 *   • Fonts are forced in through `document.fonts.load`.
 *
 * ⚠️ Adding art/audio/video to a component? Add it here too. In DEV, anything the game fetches after
 * the splash has gone is reported by {@link watchForUnpreloadedAssets} — check the console for
 * "[crazy-time] asset loaded on demand" before assuming a new asset is covered.
 */

/**
 * Images painted through the DOM (`<img src>`, SVG `<image href>`, CSS `background-image`) — every
 * one referenced through `staticUrl` / `staticPath`, which is what lets the resident copy take over.
 */
const DOM_IMAGE_PATHS: readonly string[] = [
	// ── The wheel (Game.svelte + Wheel.svelte): ring art, number badges, room badges ─────────────
	'img/wheel/frame.png',
	...NUMBER_SPOTS.map((spot) => `img/wheel/${NUMBER_PAY[spot]}.png`),
	// One picture per room, drawn on the wheel, on the bet tile, on the Top Slot reel and on the Buy
	// Bonus cards — `ROOM_ICON` is the one place all four of those read it from.
	...ROOM_SPOTS.map((spot) => ROOM_ICON[spot].src),

	// ── Top Slot cabinet (TopSlot.svelte) ─────────────────────────────────────────────────────────
	'img/top-slots/frame.png',

	// ── Chips (Game.svelte: the tray/board chips' base art and the balance rail's coin) ──────────
	// Set as CSS custom properties on the frame, so the stylesheet's `url(var(--…))` picks up the
	// resident copy; a literal `url('img/…')` in a component stylesheet cannot be redirected.
	'img/chip_base.svg',
	'img/chip_yellow.svg',

	// ── Buy Bonus: the board button, the modal and the bet stepper ───────────────────────────────
	'img/buy-bonus/buy-bonus-btn.webp',
	'img/buy-bonus/close_btn.webp',
	'img/buy-bonus/buy_bonus_panel.webp',
	'img/buy-bonus/buy_bonus_panel_landscape.webp',
	'img/buy-bonus/buy_bonus_button.webp',
	'img/buy-bonus/buy_bonus_button_hover.webp',
	'img/buy-bonus/buy_bonus_bet_container.webp',
	'img/buy-bonus/buy_bonus_bet_button_decrease.webp',
	'img/buy-bonus/buy_bonus_bet_button_increase.webp',

	// ── "Start Bonus Buy?" confirmation (ConfirmPromptModal.svelte, the bonus_buy variant only) ──
	'img/buy-bonus/confirmation_popup/bonus_buy_container.webp',
	'img/buy-bonus/confirmation_popup/bonus_buy_yes_container.webp',
	'img/buy-bonus/confirmation_popup/bonus_buy_no_container.webp',

	// ── Bonus screen (BonusRound.svelte): the sign every room's name is written on ───────────────
	'img/title_frame.png',

	// ── Pirate Plinko (RoomPiratePlinko.svelte + plinko/PlinkoBoard.svelte) ──────────────────────
	// BOTH board cuts: which one shows is the orientation at the time, and a phone rotated between
	// the splash and the room would otherwise fetch its board on entry.
	'img/pirate-plinko/board_v2.png',
	'img/pirate-plinko/board_v2_portrait.png',
	'img/pirate-plinko/cannon.png',
	'img/pirate-plinko/coin.png',
	'img/pirate-plinko/bomb.png',
	'img/pirate-plinko/explosion.png',

	// ── Bonus Wheel (RoomBonusWheel.svelte) ──────────────────────────────────────────────────────
	'img/bonus-wheel/frame.png',

	// ── Treasure Chest (RoomChest.svelte) ────────────────────────────────────────────────────────
	'img/treasure_chest/chest_close.webp',
	'img/treasure_chest/chest_open.webp',

	// ── Ocean Voyage (RoomOceanVoyage.svelte) ────────────────────────────────────────────────────
	'img/ocean-voyage/ship.png',
	'img/ocean-voyage/kraken.png',
	'img/ocean-voyage/island.png',
	'img/ocean-voyage/goal.png',
];

/**
 * Fonts declared via `@font-face` in styles/global.scss. Browsers only fetch a web font the first
 * time a glyph that needs it is rendered, so they are loaded explicitly — otherwise the first Top
 * Slot readout, the first room title, the first chip label each flash in a fallback face.
 * One spec per DECLARED weight; asking for an undeclared weight loads nothing.
 */
const FONT_SPECS: readonly string[] = [
	// A variable face — one file covers the whole axis; 400 and 900 are the cuts the game sets.
	"400 1rem 'Noto Sans'",
	"900 1rem 'Noto Sans'",
	"500 1rem 'Poppins'",
	"400 1rem 'PingFang'",
	"400 1rem 'DDIN'",
	"600 1rem 'DDIN'",
	"700 1rem 'DDIN'",
	"400 1rem 'Alexandria'",
	"600 1rem 'Alexandria'",
	"400 1rem 'AustereBlackCapsSSK'",
	"400 1rem 'PotatoSans'",
	"400 1rem 'PiecesOfEight'",
	"400 1rem 'Inter'",
	"600 1rem 'Inter'",
	"700 1rem 'Merge Pro Bold'",
	"700 1rem 'Merge Pro'",
];

/**
 * The five looping backdrops: the table's, and one per bonus room (Background.svelte and
 * BonusRound.svelte).
 *
 * Warmed as ELEMENTS, never as bytes. A Blob + `registerResidentUrl`, the way every image above is
 * warmed, cannot work for media on Stake: the page serves the game under
 * `Content-Security-Policy: default-src 'self'` with no `media-src`, and CSP does not treat `blob:` as
 * same-origin — every object URL handed to a `<video>` is refused outright (measured in the Plinko,
 * whose quick-guide clips went through exactly this). Nor is a `fetch` into the HTTP cache an answer:
 * a `<video>` that misses the cache is a black rectangle, and Stake's CDN headers refuse that reuse.
 *
 * What works is that `appendChild` MOVES a node, and a moved `<video>` keeps everything it had — its
 * buffer, its `readyState`, its decoded frame. So the element that loads behind the splash IS the
 * element that plays in the game ({@link adoptVideo}). Nothing for CSP to refuse, nothing for the CDN
 * to answer twice.
 *
 * The splash blocks on a FIRST FRAME per clip, not on the bodies: all five together are ~154 MB, and
 * a splash that waited on that would sit for minutes on an ordinary connection. What the splash is
 * buying is a decode — the reveal must not paint black — and the files are faststart, so five first
 * frames is well under a megabyte. The bodies are pulled after reveal, the table's first and then the
 * rooms one at a time ({@link preloadPostRevealAssets}), so whatever is on screen keeps the link.
 */
export type VideoKey = 'table' | 'piratePlinko' | 'bonusWheel' | 'chest' | 'oceanVoyage';

const VIDEO_PATHS: Record<VideoKey, string> = {
	table: 'videos/animated_background.mp4',
	piratePlinko: 'videos/animated_background_pirate_plinko.mp4',
	bonusWheel: 'videos/animated_background_bonus_wheel.mp4',
	chest: 'videos/animated_background_treasure_chest.mp4',
	oceanVoyage: 'videos/animated_background_ocean_voyage.mp4',
};

/** The order the bodies are filled in after reveal: the one on screen, then the rooms. */
const VIDEO_FILL_ORDER: readonly VideoKey[] = [
	'table',
	'piratePlinko',
	'bonusWheel',
	'chest',
	'oceanVoyage',
];

/**
 * The Treasure Chest's dragon, under the SAME aliases ChestDragon.svelte registers and mounts it by,
 * so its `Assets.load` is a straight cache hit. The atlas PAGE images (smallDragon.png, _2) are loaded
 * by the spine atlas loader through its own path and live on the returned `TextureAtlas`; loading the
 * atlas alias covers them, and they must never be preloaded separately (that would fetch and decode
 * every page twice). ⚠️ Keep the aliases in step with ChestDragon.svelte.
 */
const DRAGON_SPINE = {
	skeleton: { alias: 'chestDragon-skeleton', path: 'spine/dragon_fire/smallDragon.json' },
	atlas: { alias: 'chestDragon-atlas', path: 'spine/dragon_fire/smallDragon.atlas' },
	pages: ['spine/dragon_fire/smallDragon.png', 'spine/dragon_fire/smallDragon_2.png'],
} as const;

/* ── DOM image residency ─────────────────────────────────────────────────────────────────────── */

/**
 * Images kept alive for the session — every DOM image in the manifest. A preloaded `Image` with no
 * reference is GC-eligible, and when it goes so does its place in the renderer's memory cache. What
 * holding the element pins is the ENCODED resource (~7 MB for this manifest), not the decoded RGBA.
 */
const retainedImages: HTMLImageElement[] = [];

/**
 * Cap on concurrent image fetches. `fetch()` does not let the browser schedule loads the way
 * `new Image()` does, and firing a whole manifest at once makes Chrome fail requests outright with
 * ERR_INSUFFICIENT_RESOURCES — surfaced as a bare "Failed to fetch" that `allSettled` then hides.
 */
const IMAGE_FETCH_LIMIT = 10;
let imageFetchesInFlight = 0;
const imageFetchQueue: (() => void)[] = [];

async function withImageFetchSlot<T>(fn: () => Promise<T>): Promise<T> {
	if (imageFetchesInFlight >= IMAGE_FETCH_LIMIT) {
		await new Promise<void>((resolve) => imageFetchQueue.push(resolve));
	}
	imageFetchesInFlight += 1;
	try {
		return await fn();
	} finally {
		imageFetchesInFlight -= 1;
		imageFetchQueue.shift()?.();
	}
}

/**
 * Attempts per image before it is written off. A single dropped fetch would otherwise lose the asset
 * for the whole session — `registerResidentUrl` never runs, so `staticUrl` falls back to the network
 * URL, and a CSS `background-image` fetches that once with no retry of its own.
 */
const IMAGE_FETCH_ATTEMPTS = 3;
const IMAGE_RETRY_BASE_MS = 250;

/**
 * Pull one image into memory and make it resident: fetched as a Blob, published as an object URL
 * (so `staticUrl` hands the in-memory copy to whatever renders it later), decoded, and held.
 * Always resolves — a missing asset must never block the loader. Failures land on the report.
 */
async function preloadImage(url: string): Promise<void> {
	await withImageFetchSlot(async () => {
		let lastError: unknown;
		for (let attempt = 1; attempt <= IMAGE_FETCH_ATTEMPTS; attempt++) {
			try {
				// `cache: reload` on a retry: a failed first try can leave a poisoned entry in the HTTP
				// cache that a plain refetch would keep serving.
				const response = await fetch(url, {
					credentials: 'same-origin',
					cache: attempt === 1 ? 'default' : 'reload',
				});
				if (!response.ok) throw new Error(`HTTP ${response.status}`);
				const objectUrl = URL.createObjectURL(await response.blob());
				const img = new Image();
				retainedImages.push(img);
				img.src = objectUrl;
				// decode() guarantees the bitmap is ready to paint with no first-use hitch.
				if (typeof img.decode === 'function') await img.decode();
				// Published only after a successful decode, so a truncated body never becomes the URL a
				// component paints from.
				registerResidentUrl(url, objectUrl);
				return;
			} catch (error) {
				lastError = error;
				if (attempt < IMAGE_FETCH_ATTEMPTS) {
					await new Promise((r) => setTimeout(r, IMAGE_RETRY_BASE_MS * attempt));
				}
			}
		}
		recordFailure(url, String((lastError as Error)?.message ?? lastError));
	});
}

/* ── Videos ──────────────────────────────────────────────────────────────────────────────────── */

/**
 * Where the warmed clips sit while nothing is showing them: a 1x1, fully transparent, click-through
 * box pinned behind the page. IN the document, and not `display: none`: nothing obliges a browser to
 * run the decode pipeline for an element that is in no document or in no layout, and a decoded frame
 * is the whole point.
 */
let videoStage: HTMLElement | undefined;

function getVideoStage(): HTMLElement {
	if (videoStage?.isConnected) return videoStage;
	const stage = document.createElement('div');
	stage.setAttribute('aria-hidden', 'true');
	stage.style.cssText =
		'position:fixed;top:0;left:0;width:1px;height:1px;overflow:hidden;' +
		'opacity:0;pointer-events:none;z-index:-1;';
	document.body.appendChild(stage);
	videoStage = stage;
	return stage;
}

const videos = new Map<VideoKey, HTMLVideoElement>();

/**
 * The `<video>` for `key`, created and started on first ask. Lazy rather than preload-only so a
 * capped-out splash still hands the game an element — cold, streaming, the way every clip used to be.
 */
export function getVideo(key: VideoKey): HTMLVideoElement | undefined {
	if (typeof document === 'undefined') return undefined;
	const existing = videos.get(key);
	if (existing) return existing;
	const el = document.createElement('video');
	// Set before anything else — an unmuted `<video>` cannot autoplay, and every one of these is decor
	// with no audio track anyway. `playsInline` is what stops iOS taking it fullscreen.
	el.muted = true;
	el.defaultMuted = true;
	el.loop = true;
	el.playsInline = true;
	el.disablePictureInPicture = true;
	el.tabIndex = -1;
	el.setAttribute('aria-hidden', 'true');
	// `metadata`, not `auto`: the splash wants a first frame and nothing more (see VIDEO_PATHS).
	el.preload = 'metadata';
	// The plain same-origin URL, never a `blob:` — see the CSP note on VIDEO_PATHS.
	el.src = staticNetworkUrl(VIDEO_PATHS[key]);
	getVideoStage().appendChild(el);
	videos.set(key, el);
	return el;
}

/**
 * Move the warmed clip into `host` and start it. The caller styles it (it arrives with no class) and
 * hands it back with {@link releaseVideo} when done.
 *
 * The clip is muted, which is what lets it start without a gesture under the usual autoplay policy.
 * Under the strict one (`document-user-activation-required` — some embedded and automated browsers,
 * and a setting a player can turn on) even a muted `play()` is refused until the page has been
 * touched; the decoded first frame stays up meanwhile, and the play is retried on the first gesture
 * so the scene comes alive the moment the player does anything. Retried at most once, and only while
 * the clip is still in a host — a clip parked again in between has nothing to come alive for.
 */
export function adoptVideo(key: VideoKey, host: HTMLElement): HTMLVideoElement | undefined {
	const el = getVideo(key);
	if (!el) return undefined;
	host.appendChild(el);
	// The body is wanted now, whatever the post-reveal queue has got to.
	el.preload = 'auto';
	void el.play().catch(() => playOnFirstGesture(el, host));
	return el;
}

const GESTURE_EVENTS = ['pointerdown', 'keydown', 'touchstart'] as const;

function playOnFirstGesture(el: HTMLVideoElement, host: HTMLElement): void {
	const onGesture = () => {
		for (const type of GESTURE_EVENTS) window.removeEventListener(type, onGesture);
		if (el.parentElement === host) void el.play().catch(() => {});
	};
	for (const type of GESTURE_EVENTS) {
		window.addEventListener(type, onGesture, { passive: true, once: true });
	}
}

/**
 * Take a clip back off-screen, paused and rewound. Parked, NOT destroyed: showing it again then costs
 * nothing, because the buffer and the decoded frames are still in the same element.
 */
export function releaseVideo(key: VideoKey): void {
	const el = videos.get(key);
	if (!el) return;
	el.pause();
	try {
		el.currentTime = 0;
	} catch {
		/* not seekable yet — nothing to rewind */
	}
	el.className = '';
	el.removeAttribute('style');
	getVideoStage().appendChild(el);
}

/**
 * How far into a clip to seek to force a decoded frame out of a `preload="metadata"` load.
 * `loadedmetadata` only promises duration and dimensions; a SEEK cannot be served without decoding
 * the frame it lands on, so it is the guarantee. Non-zero because a seek to the current position may
 * be treated as a no-op.
 */
const VIDEO_FIRST_FRAME_SEEK_S = 0.001;

/**
 * How long to wait for one clip's first frame before letting the splash carry on without it.
 * `preload` is a HINT, and iOS suppresses it outright on cellular — there `loadedmetadata` never
 * arrives, so nothing here would ever resolve. The global cap is not cover for this: firing it reveals
 * the game part-loaded. Giving up cancels nothing; the element keeps loading.
 */
const VIDEO_FRAME_WARM_TIMEOUT_MS = 20_000;

/** Resolve once clip `key` has a frame it can paint (`readyState` >= HAVE_CURRENT_DATA). */
function warmVideoFrame(key: VideoKey): Promise<void> {
	const el = getVideo(key);
	if (!el) return Promise.resolve();
	if (el.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) return Promise.resolve();
	// A failed media element fires `error` once and never again; waiting on it would hang to the cap.
	if (el.error) return Promise.resolve();
	return new Promise<void>((resolve) => {
		let giveUp: number | undefined;
		const settle = () => {
			window.clearTimeout(giveUp);
			el.removeEventListener('loadeddata', settle);
			el.removeEventListener('seeked', settle);
			el.removeEventListener('loadedmetadata', onMetadata);
			el.removeEventListener('error', onError);
			resolve();
		};
		const onMetadata = () => {
			if (el.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
				settle();
				return;
			}
			try {
				el.currentTime = VIDEO_FIRST_FRAME_SEEK_S;
			} catch {
				settle();
			}
		};
		const onError = () => {
			recordFailure(el.src, `media error ${el.error?.code ?? 'unknown'}`);
			settle();
		};
		el.addEventListener('loadeddata', settle);
		el.addEventListener('seeked', settle);
		el.addEventListener('loadedmetadata', onMetadata);
		el.addEventListener('error', onError);
		giveUp = window.setTimeout(settle, VIDEO_FRAME_WARM_TIMEOUT_MS);
	});
}

/**
 * Let clip `key` finish downloading. Flipping `preload` to `auto` is the only lever that leaves what
 * the element already holds alone — `load()` would reset it and re-open the decode hole the warm
 * closed. Best-effort: a browser that declines to resume buffering just streams the clip on play.
 */
function fillVideoBuffer(key: VideoKey): void {
	const el = getVideo(key);
	if (el) el.preload = 'auto';
}

/** How long one clip may hold the post-reveal fill queue before the next is started regardless. */
const VIDEO_FILL_TIMEOUT_MS = 90_000;

/** Resolve once `el` reports it can play through (or has failed, or `timeoutMs` has passed). */
function whenPlayable(el: HTMLVideoElement, timeoutMs: number): Promise<void> {
	if (el.readyState >= HTMLMediaElement.HAVE_ENOUGH_DATA || el.error) return Promise.resolve();
	return new Promise<void>((resolve) => {
		const settle = () => {
			window.clearTimeout(giveUp);
			el.removeEventListener('canplaythrough', settle);
			el.removeEventListener('error', settle);
			resolve();
		};
		const giveUp = window.setTimeout(settle, timeoutMs);
		el.addEventListener('canplaythrough', settle);
		el.addEventListener('error', settle);
	});
}

/* ── Fonts ───────────────────────────────────────────────────────────────────────────────────── */

/** Force-load every declared web font; always resolves even if a face is missing. */
async function preloadFonts(): Promise<void> {
	if (typeof document === 'undefined' || !document.fonts) return;
	await Promise.allSettled(FONT_SPECS.map((spec) => document.fonts.load(spec)));
	try {
		await document.fonts.ready;
	} catch {
		/* font set settling is best-effort */
	}
}

/* ── Spine ───────────────────────────────────────────────────────────────────────────────────── */

/** Register + load the dragon's bundle into Pixi's cache under ChestDragon's aliases. */
async function preloadDragonSpine(): Promise<void> {
	const { skeleton, atlas } = DRAGON_SPINE;
	for (const { alias, path } of [skeleton, atlas]) {
		if (!Assets.resolver.hasKey(alias)) Assets.add({ alias, src: staticNetworkUrl(path) });
	}
	try {
		await Assets.load([skeleton.alias, atlas.alias]);
	} catch (error) {
		recordFailure(staticNetworkUrl(atlas.path), String((error as Error)?.message ?? error));
	}
}

/* ── Game boot ───────────────────────────────────────────────────────────────────────────────── */

/**
 * The last step of "initialisation" the splash reports on: the game itself standing. Resolved by
 * Game.svelte's `onMount` (see {@link markGameBooted}); online, that is on the far side of the RGS
 * `/wallet/authenticate` round trip, so the bar's final step is genuinely the session coming up.
 */
let resolveBooted: () => void = () => {};
const booted = new Promise<void>((resolve) => {
	resolveBooted = resolve;
});

/** Game.svelte calls this once it has mounted. Idempotent. */
export function markGameBooted(): void {
	resolveBooted();
}

/**
 * How long the splash waits for the game to stand before revealing whatever is there. Authentication
 * failing leaves the game unmounted with its error surfaced underneath — and a splash that never
 * lifted would hide that. Generous, because a slow RGS is not a failure.
 */
const BOOT_TIMEOUT_MS = 45_000;

/* ── The report ──────────────────────────────────────────────────────────────────────────────── */

/**
 * What the preload actually did, readable from a PRODUCTION console via
 * `window.crazyTimePreloadReport()`. On Stake there is otherwise no signal at all.
 */
type PreloadReport = {
	total: number;
	settled: number;
	startedAt: number;
	elapsedMs: number;
	/** True if the splash revealed the game before the manifest finished. */
	cappedOut: boolean;
	revealedAt: number;
	/**
	 * Assets the browser fetched AFTER reveal. `transferSize: 0` is a cache hit and harmless. `expected`
	 * marks the sets that stream after reveal BY DESIGN (video bodies, the music). `inManifest` splits
	 * the two remaining bugs: false means the manifest never listed the file, true means it WAS
	 * preloaded under this URL and re-fetched anyway.
	 */
	lateAssets: {
		url: string;
		transferSize: number;
		durationMs: number;
		expected: boolean;
		inManifest: boolean;
	}[];
	/** Manifest entries that did NOT arrive — `settled` counts failures too. */
	failed: { url: string; reason: string }[];
};

const report: PreloadReport = {
	total: 0,
	settled: 0,
	startedAt: 0,
	elapsedMs: 0,
	cappedOut: false,
	revealedAt: 0,
	lateAssets: [],
	failed: [],
};

function recordFailure(url: string, reason: string): void {
	if (report.failed.length < 100) report.failed.push({ url, reason });
}

/** Snapshot of the report. Exposed as `window.crazyTimePreloadReport()` once the splash has gone. */
export function getPreloadReport(): PreloadReport {
	return { ...report, lateAssets: [...report.lateAssets], failed: [...report.failed] };
}

/* ── The blocking pass ───────────────────────────────────────────────────────────────────────── */

export type PreloadProgress = {
	/** Tasks settled so far (loaded OR failed — see the report for which). */
	loaded: number;
	total: number;
	/** `loaded / total`, 0..1. */
	fraction: number;
	/** What the pass is on: the manifest, or — everything in — the game itself standing. */
	phase: 'assets' | 'boot';
};

export type PreloadOptions = {
	/** Called after every task settles, and once more when the game has booted. */
	onProgress?: (progress: PreloadProgress) => void;
	/**
	 * Hard cap (ms) so a hung asset or a dead connection can never trap the player on the splash. A
	 * safety valve, not a budget — firing it reveals the game part-loaded, the exact failure this module
	 * exists to prevent, so it sits far above a realistic full-manifest load. The blocking set here is
	 * ~30 MB (art 20 MB, spine 5.5 MB, fonts 1.7 MB, effects 0.2 MB, five video first frames); the
	 * Plinko measured ~27 MB at 1.8 Mbps as ~146 s, and this is the same ~2x margin over that.
	 */
	timeoutMs?: number;
};

/**
 * DEV knob: `?preloadDelay=<ms>` runs the tasks ONE AT A TIME with that long between them, so the
 * progress bar can be watched filling on a local server that would otherwise finish in a blink.
 * (Padding the tasks while they still ran in parallel was tried first: fifty tasks each waiting
 * 150 ms all finish 150 ms later, together.) Ignored in production builds.
 */
function devTaskDelayMs(): number {
	if (!import.meta.env.DEV || typeof window === 'undefined') return 0;
	const raw = new URLSearchParams(window.location.search).get('preloadDelay');
	const value = raw ? Number(raw) : 0;
	return Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Preload EVERYTHING in the manifest — DOM images, the dragon spine, fonts, sound effects and a first
 * frame of every video — then flip `stateGame.assetsReady` (which is what mounts <Game>) and wait for
 * the game to boot. Resolves once every task has *settled* (loaded or failed) and the game is up, so
 * the splash can dismiss knowing nothing is left to fetch OR decode.
 *
 * It always resolves: individual failures are swallowed (a missing asset degrades one feature, it must
 * never trap the player), `timeoutMs` caps the manifest, and the boot has its own cap.
 */
export function preloadAllGameAssets(options: PreloadOptions = {}): Promise<void> {
	if (typeof window === 'undefined') return Promise.resolve();
	const { onProgress, timeoutMs = 300_000 } = options;

	const tasks: (() => Promise<unknown>)[] = [
		...DOM_IMAGE_PATHS.map((path) => () => preloadImage(staticNetworkUrl(path))),
		() => preloadDragonSpine(),
		() => preloadFonts(),
		// Every effect as its own task — `warmSounds` warms the very `Audio` elements `playSound` clones.
		...warmSounds().map((promise) => () => promise),
		// A first frame of every backdrop. The bodies stream after reveal (preloadPostRevealAssets).
		...VIDEO_FILL_ORDER.map((key) => () => warmVideoFrame(key)),
	];

	let loaded = 0;
	// +1 for the boot step, so the bar only reads 100% once the game is actually standing.
	const total = tasks.length + 1;
	const startedAt = performance.now();
	report.total = total;
	report.startedAt = startedAt;
	const delay = devTaskDelayMs();
	const notify = (phase: PreloadProgress['phase']) =>
		onProgress?.({ loaded, total, fraction: total ? loaded / total : 1, phase });

	const runTask = (task: () => Promise<unknown>) =>
		Promise.resolve()
			.then(task)
			.catch(() => undefined)
			.then(() => {
				loaded += 1;
				notify('assets');
			});
	const work = delay
		? tasks.reduce(
				(chain, task) =>
					chain.then(() => new Promise((r) => setTimeout(r, delay))).then(() => runTask(task)),
				Promise.resolve(),
			)
		: Promise.all(tasks.map(runTask)).then(() => undefined);

	let timeoutId: number | undefined;
	const timeout = new Promise<void>((resolve) => {
		timeoutId = window.setTimeout(() => {
			report.cappedOut = true;
			console.warn(
				`[crazy-time] asset preload hit its ${timeoutMs} ms cap at ${loaded}/${total - 1}; revealing anyway`,
			);
			resolve();
		}, timeoutMs);
	});

	return Promise.race([work, timeout])
		.finally(() => window.clearTimeout(timeoutId))
		.then(async () => {
			// Everything resident (or written off): let the game mount, then wait for it to stand.
			stateGame.assetsReady = true;
			notify('boot');
			await Promise.race([
				booted,
				new Promise<void>((resolve) => window.setTimeout(resolve, BOOT_TIMEOUT_MS)),
			]);
			loaded += 1;
			notify('boot');
		})
		.finally(() => {
			stateGame.assetsReady = true;
			report.settled = loaded;
			report.elapsedMs = Math.round(performance.now() - startedAt);
		});
}

/**
 * Fire-and-forget: the video bodies. The table's first — it is on screen now — and then the four
 * rooms ONE AT A TIME, each once the previous can play through (or has had its turn), because five
 * parallel 20–40 MB downloads would leave the clip actually playing with a fifth of the link.
 * The music is deliberately absent: `startMusic` streams it from the game's first frame.
 */
export function preloadPostRevealAssets(): void {
	if (typeof window === 'undefined') return;
	void (async () => {
		for (const key of VIDEO_FILL_ORDER) {
			const el = getVideo(key);
			if (!el) continue;
			fillVideoBuffer(key);
			await whenPlayable(el, VIDEO_FILL_TIMEOUT_MS);
		}
	})();
}

/* ── Drift alarm + black box ─────────────────────────────────────────────────────────────────── */

/** Every file this module is responsible for, absolute — the manifest plus the sets it warms by hand. */
function coveredUrls(): Set<string> {
	const logo = getCasinoTvLogoAsset();
	return new Set([
		...DOM_IMAGE_PATHS.map(staticNetworkUrl),
		...Object.values(VIDEO_PATHS).map(staticNetworkUrl),
		...[DRAGON_SPINE.skeleton.path, DRAGON_SPINE.atlas.path, ...DRAGON_SPINE.pages].map(
			staticNetworkUrl,
		),
		...soundEffectUrls(),
		musicUrl(),
		logo.skeleton,
		logo.atlas,
		...Object.values(logo.images),
		CASINO_TV_LOGO_BACKDROP,
	]);
}

/**
 * The manifest is hand-maintained, and the whole point of this module is that it is COMPLETE — but
 * nothing stops a new component from referencing art nobody added here. So: once the splash is gone,
 * watch resource timings for anything under the static folders and record it on the report. In DEV,
 * anything not in the manifest also warns with the path to add.
 *
 * The RECORDING half runs in production too, and `window.crazyTimePreloadReport()` is published here.
 * The offending paths are also printed inline after 8 s, because on Stake the game runs in an iframe
 * and a console evaluating against the top frame cannot see the hook at all.
 */
export function watchForUnpreloadedAssets(): void {
	if (typeof PerformanceObserver === 'undefined') return;

	report.revealedAt = performance.now();
	(window as unknown as { crazyTimePreloadReport?: () => PreloadReport }).crazyTimePreloadReport =
		getPreloadReport;

	const covered = coveredUrls();
	const watched = ['img/', 'sound/', 'spine/', 'fonts/', 'videos/'].map(staticNetworkUrl);
	// Fetched after reveal on purpose: the video bodies, and the music `startMusic` streams itself.
	const byDesign = new Set([...Object.values(VIDEO_PATHS).map(staticNetworkUrl), musicUrl()]);
	const reported = new Set<string>();

	const observer = new PerformanceObserver((list) => {
		for (const entry of list.getEntries()) {
			const url = entry.name.split('?')[0];
			if (!watched.some((prefix) => url.startsWith(prefix))) continue;
			if (reported.has(url)) continue;
			reported.add(url);

			const timing = entry as PerformanceResourceTiming;
			if (report.lateAssets.length < 200) {
				report.lateAssets.push({
					url,
					transferSize: timing.transferSize ?? 0,
					durationMs: Math.round(timing.duration),
					expected: byDesign.has(url),
					inManifest: covered.has(url),
				});
			}
			if (import.meta.env.DEV && !covered.has(url) && !byDesign.has(url)) {
				console.warn(
					`[crazy-time] asset loaded on demand (add it to the manifest in lib/preloadAssets.ts): ${url}`,
				);
			}
		}
	});
	observer.observe({ type: 'resource', buffered: false });

	window.setTimeout(() => {
		const strip = (url: string) => url.replace(/^https?:\/\/[^/]+\//, '');
		if (report.failed.length > 0) {
			console.warn(
				`[crazy-time] ${report.failed.length} manifest asset(s) never arrived during the preload:\n` +
					report.failed.map((f) => `  ${f.reason.padEnd(12)} ${strip(f.url)}`).join('\n'),
			);
		}
		const paid = report.lateAssets.filter((a) => a.transferSize > 0 && !a.expected);
		if (!report.cappedOut && paid.length === 0) return;
		const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`;
		const lines = paid
			.sort((a, b) => b.transferSize - a.transferSize)
			.map(
				(a) =>
					`  ${a.inManifest ? 'IN-MANIFEST    ' : 'NOT-IN-MANIFEST'} ${kb(a.transferSize).padStart(9)}  ` +
					`${a.durationMs} ms  ${strip(a.url)}`,
			);
		console.warn(
			`[crazy-time] preload did not cover the session: settled ${report.settled}/${report.total} in ` +
				`${report.elapsedMs} ms${report.cappedOut ? ' (HIT THE CAP — game revealed part-loaded)' : ''}; ` +
				`${paid.length} asset(s) fetched from the network after reveal ` +
				`(${kb(paid.reduce((sum, a) => sum + a.transferSize, 0))}):\n` +
				lines.join('\n') +
				`\n  NOT-IN-MANIFEST = never preloaded, add it to lib/preloadAssets.ts.` +
				`\n  IN-MANIFEST = preloaded under this exact URL and re-fetched anyway.`,
		);
	}, 8_000);
}
