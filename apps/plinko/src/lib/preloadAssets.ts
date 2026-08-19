import { Assets } from 'pixi.js';

import { BOARD_LABELS } from '../game-logic/boardMultipliers';
import { isPortraitGameLayout } from './format';
import { registerResidentUrl, staticUrl } from './staticUrl';
import { getBackgroundLandscapeAsset } from './spine/backgroundLandscapeAsset';
import { getBackgroundPortraitAsset } from './spine/backgroundPortraitAsset';
import { getBalanceCoinGlowAssets } from './spine/balanceCoinGlowAsset';
import { CASINO_TV_LOGO_BACKDROP, getCasinoTvLogoAsset } from './spine/casinoTvLogoAsset';
import { getCoinFountainAssets } from './spine/coinFountainAsset';
import { getGlowNumbersAsset } from './spine/glowNumbersAsset';
import { loadSpineAsset, spineAssetTreeTasks } from './spine/spineAssetCache';
import type { SpineAssetDef } from './spine/types';

/**
 * ══ THE GAME'S ASSET MANIFEST ══════════════════════════════════════════════════════════════════
 *
 * Every static file the game can put on screen or play, in one place. The intro splash blocks on ALL
 * of it (see {@link preloadAllGameAssets}) and only dismisses once it has settled, so nothing is ever
 * fetched or decoded for the first time mid-game.
 *
 * This used to be split into a small "critical" set that gated the splash and a big "deferred" set
 * warmed in the background after reveal. That kept the splash short but made correctness depend on a
 * race — anything the player reached before its background fetch landed still popped in — and the
 * lists drifted from the components (the 1-ball board's `0.1`/`0.3` slot labels, the moon, the mobile
 * free-spin overlay and every spine skeleton were never in either list at all). One blocking manifest
 * has no race to lose.
 *
 * "Preloaded" here means RESIDENT IN MEMORY, not cached and not merely referenced. Two weaker
 * definitions were tried and both failed in production:
 *   1. warm the URL and drop it — only fills the HTTP cache, so the component that shows it later pays
 *      a request and a decode anyway;
 *   2. warm it and hold the `HTMLImageElement` — helps only if the browser REUSES that resource for a
 *      second reference, which Stake's CDN headers stop it doing. Measured live: ten manifest images
 *      (buy-bonus + confirm-prompt art, 669 KB) preloaded under their exact URLs and every one still
 *      came off the wire when its screen opened.
 * So DOM images are fetched as Blobs and published as object URLs through `staticUrl` — a handle to
 * bytes in this tab, with no cache to consult and no header that can invalidate it. Pixi art stays in
 * Pixi's own cache under the same key its consumer uses.
 *
 * ⚠️ Adding art/audio to a component? Add it here too. In DEV, anything the game fetches after the
 * splash has gone is reported by {@link watchForUnpreloadedAssets} — check the console for
 * "[plinko] asset loaded on demand" before assuming a new asset is covered.
 */

/**
 * Images painted through the DOM (`<img src>`, CSS `background-image`). Fetched as Blobs, published as
 * object URLs and decoded once (see {@link preloadImage}), so whatever renders one later paints from
 * memory — no request, no revalidation, no decode.
 *
 * Images that Pixi draws instead go in {@link PIXI_TEXTURE_PATHS}, and spine art is covered by the
 * skeleton bundles — see {@link spineAssetTasks}.
 */
const DOM_IMAGE_PATHS: readonly string[] = [
	// ── Board / play area ────────────────────────────────────────────────────────────────────────
	'img/game_area_background.webp',
	// Bonus board background, swapped in for the free game.
	'img/game_area_bonus.webp',

	// ── Static background fallbacks ──────────────────────────────────────────────────────────────
	// Shown by Background.svelte until the spine stack is live (and permanently if it fails), and by
	// Game.svelte's portrait layout. The spine renderer loads its own copies as Pixi textures (see
	// `spineAssetTasks`); these entries are what the plain <img> tags read.
	'img/BG_landscape.webp',
	'img/BG_portrait.webp',
	'img/BG_landscape_FREEGAME.webp',
	'img/BG_portrait_FREEGAME.webp',

	// ── Free-spin meter (HUD, on screen from launch) ─────────────────────────────────────────────
	'img/free-spin-label.webp',
	// Mobile-only gradient under the free-spin frame (Game.svelte).
	'img/mobile_free_spin_under_frame_overlay.webp',

	// ── Bonus meter (HUD, on screen from launch) ─────────────────────────────────────────────────
	'img/bonus-bar-marker.webp',

	// ── Betting panel (desktop + mobile) — always visible ────────────────────────────────────────
	'img/betting-component-frame.webp',
	'img/betting-component-frame-mobile.webp',
	'img/betting-component-input-decrease.webp',
	'img/betting-component-input-increase.webp',
	// Containerless (bare glyph) stepper icons used by the mobile inline steppers.
	'img/betting-component-input-decrease-containerless.webp',
	'img/betting-component-input-increase-containerless.webp',
	'img/main_btn_empty.webp',
	'img/main_btn_play_icon.webp',
	'img/auto-bet-btn.webp',
	'img/auto-bet-stop-btn.webp',
	'img/auto-bet-btn-mobile.webp',
	'img/auto-bet-stop-btn-mobile.webp',
	'img/fast-game-btn.webp',
	'img/fast-game-btn-mobile.webp',
	'img/spinner_logo.webp',
	// Portrait-only strap behind the mobile action row (see .mobile-play-strap).
	'img/portait_bet_panel_strap.webp',
	// Landscape-only gradient behind the whole betting panel, total bet included (see .bp-panel-scrim).
	'img/betting_panel_bottom_overlay.webp',
	// Landscape-only bar behind the total-bet readout, on top of the one above (see .bp-total-overlay).
	'img/betting_panel_total_bet_bottom_overlay.webp',
	// Desktop menu button (top-hud). Mobile uses its own asset below.
	'img/menu-btn.webp',
	// Mobile menu button — dedicated mobile art, top-left corner.
	'img/menu-btn-mobile.webp',
	'img/coin-ico.webp',
	'img/wallet-ico.webp',
	// The board's Buy Bonus button is visible from launch; the modal art it opens is further down.
	'img/buy-bonus-btn.webp',

	// ── Menu + modal icons ───────────────────────────────────────────────────────────────────────
	'img/hamburg_menu_ico_game_rules.webp',
	'img/hamburg_menu_ico_history.webp',
	'img/hamburg_menu_ico_how_to_play.webp',
	'img/close_btn.webp',

	// ── Confirmation prompt (reachable from the player's very first interaction: arming Autobet,
	//    opening Buy Bonus, or raising the stake to a high bet). One frame + two plates per
	//    variant — see ConfirmPromptModal's LAYOUT block ────────────────────────────────────────
	...['high_bet', 'autobet', 'bonus_buy'].flatMap((variant) => [
		`img/confirmation_popup/${variant}_container.webp`,
		`img/confirmation_popup/${variant}_yes_container.webp`,
		`img/confirmation_popup/${variant}_no_container.webp`,
	]),

	// ── Bonus/free-spin congratulations banner ───────────────────────────────────────────────────
	'img/announcement-message-background.webp',
	'img/announcement-message-background-mobile.webp',

	// ── Free-spin wheel: rotating value disc + top wedge highlight + rope dividers + frame ───────
	'img/bonus_roulette_v2/wheel_values.webp',
	'img/bonus_roulette_v2/wheel_base.webp',
	'img/bonus_roulette_v2/wheel_segment_highlight.webp',
	'img/bonus_roulette_v2/wheel_divider.webp',

	// ── Bonus wheel: rotating values disc + wedge highlight + static frame ───────────────────────
	'img/free_bonus_roulette_v2/wheel_values.webp',
	'img/free_bonus_roulette_v2/wheel_base.webp',
	'img/free_bonus_roulette_v2/wheel_segment_highlight.webp',

	// ── Roulette backdrops + label ───────────────────────────────────────────────────────────────
	'img/bonus-roulette-background.webp',
	'img/bonus-roulette-background-mobile.webp',
	'img/bonus-roulette-label.webp',

	// ── In-bonus level arch + level-up card ──────────────────────────────────────────────────────
	'img/bonus-level-base.webp',
	'img/bonus-level-base-background.webp',
	'img/bonus-level-up-base.webp',
	// The 9 arch tiles + their lit variants (`BonusLevel.svelte` LEVEL_BAR_URLS). All 18 mount at once
	// with the arch, so leaving them out meant 9+ cold requests on the bonus-entry frame.
	...Array.from({ length: 9 }, (_, i) => `img/bonus-bar-level-${i + 1}.webp`),
	...Array.from({ length: 9 }, (_, i) => `img/bonus-bar-level-active-${i + 1}.webp`),

	// ── Buy Bonus modal — card frame + Activate button + per-tier art (mirrors BUY_BONUS_TIERS) ──
	'img/buy_bonus_button.webp',
	'img/buy_bonus_panel.webp',
	...['standard', 'enhanced', 'premium', 'superfury'].map((key) => `img/buy_bonus_${key}.webp`),
	// The bet stepper at the top of the same modal (BetPerBallField's `panel` skin) — container plus its
	// two buttons, all three on screen the moment the modal opens. 16 KB for the set.
	'img/buy_bonus/buy_bonus_bet_container.webp',
	'img/buy_bonus/buy_bonus_bet_button_decrease.webp',
	'img/buy_bonus/buy_bonus_bet_button_increase.webp',

	// ── Quick guide — the frame and the logo that hangs over it. Both are on screen the instant the
	//    splash clears, so both have to be in memory by then; its four video loops deliberately are
	//    NOT (see QUICK_GUIDE_VIDEO_PATHS).
	'img/quick_guide/quick_guide_container.webp',
	'img/quick_guide/quick_guide_title.webp',

	// ── Bonus-end "CONGRATULATIONS! YOU HAVE WON" treasure-win screen ────────────────────────────
	'img/congratulations_screen/treasure_table.webp',
	'img/congratulations_screen/treasure_table_mobile.webp',
	'img/congratulations_screen/sparkle.webp',
	// The coins strewn across the treasure table — they mount with it.
	'img/congratulations_screen/coin_1.webp',
	'img/congratulations_screen/coin_2.webp',
];

/**
 * WIN-CELEBRATION art (`WinCelebration.svelte` + `RapidWinSparkles.svelte`). Split out of
 * {@link DOM_IMAGE_PATHS} only because it has its own idempotent entry point
 * ({@link preloadWinPopupAssets}) that those components call on mount as a backstop to the intro
 * preload. Both lists are retained the same way.
 */
const WIN_POPUP_IMAGE_PATHS: readonly string[] = [
	// Tier banners — one shows per win; which one isn't known until the round settles, so all three.
	'img/win_popup/massive_plunder.webp',
	'img/win_popup/epic_bounty.webp',
	'img/win_popup/captains_jackpot.webp',
	// Shared reveal layers
	'img/win_popup/shine_rays.webp',
	'img/win_popup/backdrop_shade.webp',
	'img/win_popup/coin.webp',
	// Counter glyphs (0–9 + the decimal dot) — also used by the 1-ball rapid sparkles
	'img/win_popup/dot.webp',
	...Array.from({ length: 10 }, (_, digit) => `img/win_popup/${digit}.webp`),
];

/**
 * The quick guide's four looping clips (`QuickGuideModal.svelte`), in page order.
 *
 * ⚠️ Deliberately NOT preloaded, and the one place in the game where that is the right answer. These
 * are 1080p H.264 masters running 13–21 s each — ~78 MB together, twice the whole rest of the blocking
 * manifest — so warming them would push the splash past its own timeout and reveal the game
 * part-loaded, the exact failure this module exists to prevent. Video also degrades the way audio does
 * rather than the way art does: an unwarmed clip streams and starts playing, where an unwarmed image is
 * a visible hole.
 *
 * The modal therefore mounts ONE `<video>` at a time, keyed on the page, so a player who reads page 1
 * and closes never pays for the other three. Exported so {@link watchForUnpreloadedAssets} can tell
 * that traffic apart from a genuine manifest gap — these live under `img/`, which it watches.
 */
export const QUICK_GUIDE_VIDEO_PATHS: readonly string[] = [
	'img/quick_guide/quick_guide_video_1.mp4',
	'img/quick_guide/quick_guide_video_2.mp4',
	'img/quick_guide/quick_guide_video_3.mp4',
	'img/quick_guide/quick_guide_video_4.mp4',
];

/**
 * Images Pixi draws, loaded through `Assets` under the SAME key their consumer uses (the resolved
 * URL) so the engine and the meters get a straight cache hit instead of re-fetching and re-decoding.
 *
 * Warming these as plain `Image()`s would only fill the HTTP cache — Pixi would still pay for its own
 * decode + `ImageBitmap` on first use, which is the stall these are here to remove.
 */
const PIXI_TEXTURE_PATHS: readonly string[] = [
	// PlinkoEngine board textures. No ball art: balls are vector circles (`drawBallsPixi`).
	'img/coin_peg.webp',
	'img/multiplier_slot_spin.webp',
	...[1, 2, 3, 4, 5, 6, 7].map((tier) => `img/multiplier_slot_${tier}.webp`),
	// Slot label art. Same derived set the engine loads (`BOARD_LABELS`), so a board re-cut can't leave
	// a tier's labels out of the preload — which is what previously made switching to 1 ball/drop fetch
	// them cold.
	...BOARD_LABELS.map((label) => `img/multiplier_slot_text_${label}.webp`),

	// BonusMeterEngine.
	'img/bonus-bar-base.webp',
	'img/bonus-bar-fill.webp',

	// FreeSpinMeterEngine.
	'img/free-spin-base.webp',
	'img/free-spin-meter.webp',
	'img/free-spin-meter-wheel.webp',
];

/**
 * Sound effects + music. Warmed with a plain `fetch` that reads the body to completion, which is all
 * that is needed: Howler builds its Howls on mount (EnableSound / EnableMusic) and both its Web Audio
 * XHR path and its `html5: true` `<audio>` path serve from the HTTP cache.
 *
 * Mirrors `EnableSound.svelte`'s `soundMap` plus `EnableMusic.svelte`'s two loops.
 *
 * ⚠️ Warmed AFTER reveal ({@link preloadPostRevealAssets}), NOT on the blocking path. The two music
 * tracks alone are ~12 MB of a ~39 MB critical path, and blocking on them pushed the splash past its
 * own timeout on slow connections — which reveals the game part-loaded and makes ART pop in, the exact
 * failure this module exists to prevent. Audio degrades far more gracefully: an unwarmed track simply
 * streams (Howler's `<audio>` path is built for it), where an unwarmed image is a visible hole. So
 * pictures get the guarantee and sound gets the leftovers.
 */
const AUDIO_PATHS: readonly string[] = [
	// One-shot effects (EnableSound).
	'sound/bet.mp3',
	'sound/win.mp3',
	'sound/pocket.mp3',
	'sound/peg.wav',
	'sound/roulette_tick.wav',
	'sound/placeChip.mp3',
	'sound/clickingFail.mp3',
	'sound/startAutoPlay.mp3',
	'sound/openPopup.mp3',
	'sound/clickUIButton.mp3',
	'sound/coin_flip.wav',
	'sound/coin_peg.wav',
	// One file, played as two sprite windows (coinShuffleSingle / coinShuffleMulti).
	'sound/coin_shuffle.mp3',
	'sound/door_close.ogg',
	'sound/door_open.ogg',
	'sound/bonus_level_up.mp3',

	// Looping music (EnableMusic).
	'sound/background_music.m4a',
	'sound/background_music_bonus_mode.mpeg',
];

/**
 * Fonts declared via `@font-face` in `+layout.svelte`. Browsers only fetch a web font the first time a
 * glyph that needs it is rendered, so we load them explicitly — otherwise e.g. the roulette labels
 * (PotatoSans) flash in an unstyled fallback on first appearance.
 */
const FONT_SPECS: readonly string[] = [
	"400 1rem 'Instrument Sans'",
	"600 1rem 'Instrument Sans'",
	"700 1rem 'Instrument Sans'",
	// 300 (Light) is used by the total-bet readout, which is on screen from the first frame — without
	// it here the "Bet $x.xx" line renders in Regular until the face loads, then visibly thins out.
	// 200 (ExtraLight) is declared in +layout.svelte but nothing uses it yet, so it stays unloaded.
	"300 1rem 'Poppins'",
	"400 1rem 'Poppins'",
	"500 1rem 'Poppins'",
	"600 1rem 'Poppins'",
	"700 1rem 'Poppins'",
	"800 1rem 'Poppins'",
	"900 1rem 'Poppins'",
	"1rem 'PiecesOfEight'",
	"1rem 'PotatoSans'",
	"1rem 'Perpetua'",
	// The quick guide's body face, and it opens the moment the splash clears — without it here the
	// walkthrough's first frame renders in the Instrument Sans fallback and then reflows.
	"400 1rem 'Noto Sans'",
	"600 1rem 'Noto Sans'",
	"400 1rem 'Righteous'",
	"400 1rem 'AustereBlackCapsSSK'",
];

/**
 * Spine bundles, as load thunks. Everything except the background is orientation-agnostic; the
 * background tree is picked for the layout the game is about to mount, because a def's overlay ids are
 * shared across orientations while their files are not (see `spineAssetTreeTasks`).
 *
 * The intro logo (`casino_tv_logo`) is NOT here — the loader itself owns it, and releases it on
 * dismissal.
 */
function spineAssetTasks(): (() => Promise<unknown>)[] {
	const background = isPortraitGameLayout()
		? getBackgroundPortraitAsset()
		: getBackgroundLandscapeAsset();

	return [
		// Base scene + its backdrops, moon/lightning image layers and every free-game overlay spine
		// (ship, splashes, clouds, tornadoes, rain).
		...spineAssetTreeTasks(background),
		// Slot glow strip on the board (PlinkoEngine).
		() => loadSpineAsset(getGlowNumbersAsset()),
		// On-win coin fountain (CoinFountainRenderer) — two skeletons, randomly assigned per coin.
		...getCoinFountainAssets().map((asset) => () => loadSpineAsset(asset)),
		// Balance-coin light burst (BalanceCoinGlowRenderer) — glow behind the coin, sparkle over it.
		...getBalanceCoinGlowAssets().map((asset) => () => loadSpineAsset(asset)),
	];
}

/**
 * The OTHER orientation's background files, warmed into the HTTP cache after the game is revealed.
 *
 * They cannot be preloaded properly — one alias per overlay id means only one orientation's tree can
 * be resident in Pixi's cache at a time — but a device that rotates mid-session would otherwise
 * re-download ~15 MB of skeleton pages before the new scene appears. A raw fetch costs nothing but
 * cache space (no decode, no GPU texture), so the rotation becomes a decode instead of a download.
 */
function otherOrientationBackgroundFiles(): string[] {
	const other = isPortraitGameLayout()
		? getBackgroundLandscapeAsset()
		: getBackgroundPortraitAsset();
	const overlays = other.bonusOverlays ?? [];
	return [
		other.skeleton,
		other.atlas,
		...Object.values(other.images),
		...overlays.flatMap((def) => [def.skeleton, def.atlas, ...Object.values(def.images)]),
	];
}

/**
 * Images kept alive for the session — EVERY DOM image in the manifest.
 *
 * A preloaded `Image` with no reference is GC-eligible, and when it goes so does its place in the
 * renderer's memory cache: the next element to reference that URL re-requests it (a revalidation at
 * best, a full fetch if the cache policy is unfriendly) and re-decodes it. That is the "it still has
 * to load when it appears" hitch, and it is FIRST-RUN ONLY — a reload finds the renderer's caches
 * already warm from the previous load, which is exactly why it looks fine the second time.
 *
 * Retention used to be limited to the win-popup art on the grounds that pinning the whole manifest
 * would cost hundreds of MB. That figure was the sum of the decoded RGBA (~226 MB), which is not what
 * holding an `HTMLImageElement` actually pins: the decoded frames live in the browser's own capped,
 * evicting decode cache, while the element keeps the ENCODED resource alive — and all 86 DOM images
 * are 5.9 MB encoded on disk. Measured on the renderer process (hold refs + GC, versus drop refs +
 * GC): **≈37 MB**. That buys "nothing loads mid-game", which is the whole point of this module.
 */
const retainedImages: HTMLImageElement[] = [];

/**
 * Pull a single image into memory and make it resident: fetched as a Blob, published as an object URL
 * (so {@link staticUrl} hands the in-memory copy to whatever renders it later), then decoded and held.
 *
 * The fetch/Blob step is what makes this independent of response headers. Setting `img.src` to the
 * network URL and keeping the element — which is what this used to do — leaves the browser free to
 * decide that a *different* element referencing the same URL needs a fresh request, and on Stake it
 * decides exactly that.
 *
 * Always resolves: a missing asset must never block the loader. Failures are recorded on the report so
 * "settled" can never be mistaken for "succeeded" — every task settling is not the same as every asset
 * arriving, and that distinction is invisible from the outside.
 */
/**
 * Cap on concurrent image fetches.
 *
 * ⚠️ Not cosmetic, and not a politeness setting. `new Image()` lets the browser schedule loads itself;
 * `fetch()` does not, and firing the whole manifest at once (~117 calls) makes Chrome fail requests
 * outright with ERR_INSUFFICIENT_RESOURCES — surfaced to JS as a bare "Failed to fetch". Caught by the
 * new failure report the moment this module switched to fetch: exactly 13 images died every run, always
 * the same ones, while serving fine over curl. `Promise.allSettled` then hid it, because a rejected
 * task still counts as settled and the splash dismissed reporting a healthy 129/129.
 *
 * 10 costs nothing on throughput: HTTP/1.1 allows 6 connections per host anyway, and over HTTP/2 the
 * large files saturate the link long before the slot count matters.
 */
const IMAGE_FETCH_LIMIT = 10;
let imageFetchesInFlight = 0;
const imageFetchQueue: (() => void)[] = [];

/** Run `fn` once a fetch slot is free. Slots are released even when `fn` throws. */
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

async function preloadImage(url: string): Promise<void> {
	return withImageFetchSlot(() => fetchDecodeAndPublish(url));
}

async function fetchDecodeAndPublish(url: string): Promise<void> {
	try {
		const response = await fetch(url, { credentials: 'same-origin' });
		if (!response.ok) throw new Error(`HTTP ${response.status}`);
		const objectUrl = URL.createObjectURL(await response.blob());
		const img = new Image();
		retainedImages.push(img);
		img.src = objectUrl;
		// decode() guarantees the bitmap is ready to paint with no first-use hitch.
		if (typeof img.decode === 'function') await img.decode();
		// Published only after a successful decode, so a truncated or corrupt body can never become the
		// URL a component paints from.
		registerResidentUrl(url, objectUrl);
	} catch (error) {
		if (report.failed.length < 100) {
			report.failed.push({ url, reason: String((error as Error)?.message ?? error) });
		}
	}
}

/**
 * Pull a file into the HTTP cache. Used for audio (whose players fetch it themselves later) and for
 * the opposite orientation's spine pages. The body must be READ, not just the headers awaited, or the
 * response is abandoned part-way and never lands in the cache.
 */
async function preloadFile(url: string): Promise<void> {
	try {
		const response = await fetch(url, { credentials: 'same-origin' });
		if (!response.ok) return;
		await response.arrayBuffer();
	} catch {
		/* best-effort — a failed warm-up just means this file is fetched on first use */
	}
}

/** Force-load every declared web font; always resolves even if a face is missing. */
async function preloadFonts(): Promise<void> {
	if (typeof document === 'undefined' || !document.fonts) return;
	await Promise.allSettled(FONT_SPECS.map((spec) => document.fonts.load(spec)));
	try {
		await document.fonts.ready;
	} catch {
		/* ignore — font set settling is best-effort */
	}
}

/** Every file a spine def pulls in, as raw (possibly base-relative) paths. DEV audit only. */
function spineDefFiles(asset: SpineAssetDef): string[] {
	return [
		asset.skeleton,
		asset.atlas,
		...Object.values(asset.images),
		...(asset.backdrop ? [asset.backdrop.src] : []),
		...(asset.bonusBackdropSrc ? [asset.bonusBackdropSrc] : []),
		...(asset.imageOverlays ?? []).map((def) => def.src),
		...(asset.bonusImageOverlays ?? []).map((def) => def.src),
		...(asset.bonusOverlays ?? []).flatMap((def) => [
			def.skeleton,
			def.atlas,
			...Object.values(def.images),
		]),
	];
}

/**
 * Every file this module is responsible for, absolute. Used by the DEV on-demand-load audit, so it
 * also covers the two sets that are warmed OUTSIDE the blocking pass — the intro logo (owned by the
 * loader component) and the opposite orientation's background — which are legitimately fetched but
 * are not manifest misses.
 */
function coveredUrls(): Set<string> {
	const absolute = (path: string) => new URL(path, window.location.href).href;
	const paths = [
		...[...DOM_IMAGE_PATHS, ...WIN_POPUP_IMAGE_PATHS, ...PIXI_TEXTURE_PATHS, ...AUDIO_PATHS].map(
			(path) => staticUrl(path),
		),
		...spineDefFiles(
			isPortraitGameLayout() ? getBackgroundPortraitAsset() : getBackgroundLandscapeAsset(),
		),
		...spineDefFiles(getGlowNumbersAsset()),
		...getCoinFountainAssets().flatMap(spineDefFiles),
		...getBalanceCoinGlowAssets().flatMap(spineDefFiles),
		...spineDefFiles(getCasinoTvLogoAsset()),
		CASINO_TV_LOGO_BACKDROP,
		...otherOrientationBackgroundFiles(),
	];
	return new Set(paths.map(absolute));
}

/**
 * What the preload actually did, readable from a PRODUCTION console via `window.plinkoPreloadReport()`.
 *
 * On Stake there is otherwise no signal at all: the drift alarm below is DEV-only, so a player
 * reporting "art loads when the screen opens" leaves nothing to inspect. The two failures that produce
 * that symptom are distinguishable here and nowhere else — `cappedOut` means the splash gave up and
 * revealed a part-loaded game, whereas `lateAssets` with non-zero `transferSize` means something is
 * being fetched at display time that the manifest never covered.
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
	 * Assets the browser fetched AFTER reveal. `transferSize: 0` is a cache hit and is harmless.
	 * `expected` marks the sets that are post-reveal BY DESIGN (audio, the opposite orientation) — they
	 * are recorded for completeness but are not evidence of anything wrong.
	 *
	 * `inManifest` splits the two remaining bugs, which look identical from outside: false means the
	 * manifest simply never listed this file, true means it WAS preloaded under this exact URL and the
	 * browser fetched it again anyway (a cache that refused to keep it, or a second reference the
	 * retention did not cover).
	 */
	lateAssets: {
		url: string;
		transferSize: number;
		durationMs: number;
		expected: boolean;
		inManifest: boolean;
	}[];
	/**
	 * Manifest images that did NOT arrive. `settled` counts tasks that finished, including ones that
	 * failed — so without this a totally failed preload still reports a reassuring 129/129.
	 */
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

/** Snapshot of {@link report}. Exposed as `window.plinkoPreloadReport()` once the splash has gone. */
export function getPreloadReport(): PreloadReport {
	return { ...report, lateAssets: [...report.lateAssets], failed: [...report.failed] };
}

export type PreloadOptions = {
	/**
	 * Hard cap (ms) so a hung asset or a dead connection can never trap the player on the splash. This
	 * is a safety valve, not a budget — firing it reveals the game part-loaded, which is the exact
	 * failure this module exists to prevent.
	 *
	 * ⚠️ It must stay far above a realistic full-manifest load, and "realistic" is a function of the
	 * PAYLOAD, not of taste. The blocking set is ~27 MB (art + spine + fonts; audio was moved off it
	 * precisely because it pushed this over). Measured against a throttled connection, cold:
	 *   3.0 Mbps → reveal at ~108 s      1.8 Mbps → reveal at ~146 s
	 * The old 120 s cap sat *inside* that range, so every player below ~3 Mbps got a part-loaded game
	 * and blamed the preload. Re-derive this if the payload changes materially; do not just nudge it.
	 */
	timeoutMs?: number;
};

/**
 * Load + decode + retain the win-celebration art ({@link WIN_POPUP_IMAGE_PATHS}) so the reveal never
 * waits on a fetch or a decode. Idempotent: the first call owns the work and every later caller gets
 * the same promise, so the components can safely warm it on mount as a backstop to the intro preload.
 */
let winPopupWarmup: Promise<void> | undefined;
export function preloadWinPopupAssets(): Promise<void> {
	if (typeof window === 'undefined') return Promise.resolve();
	winPopupWarmup ??= Promise.allSettled(
		WIN_POPUP_IMAGE_PATHS.map((path) => preloadImage(staticUrl(path))),
	).then(() => undefined);
	return winPopupWarmup;
}

/**
 * Preload EVERYTHING in the manifest — DOM images, Pixi textures, spine bundles, audio and fonts —
 * while the intro loader is on screen. Resolves once every task has *settled* (loaded or failed), so
 * the splash can dismiss knowing nothing is left to fetch OR decode — the DOM images are held for the
 * session (see {@link retainedImages}) and the rest stay resident in Pixi's cache.
 *
 * It always resolves: individual failures are swallowed (a missing asset degrades one feature, it must
 * never trap the player) and `timeoutMs` caps the whole pass.
 */
export function preloadAllGameAssets(options: PreloadOptions = {}): Promise<void> {
	if (typeof window === 'undefined') return Promise.resolve();
	const { timeoutMs = 300_000 } = options;

	const tasks: (() => Promise<unknown>)[] = [
		...DOM_IMAGE_PATHS.map((path) => () => preloadImage(staticUrl(path))),
		// Kept as one task: it is idempotent and may already be in flight from a component mount.
		() => preloadWinPopupAssets(),
		...PIXI_TEXTURE_PATHS.map((path) => () => Assets.load(staticUrl(path))),
		...spineAssetTasks(),
		() => preloadFonts(),
		// Audio is deliberately absent — see AUDIO_PATHS. It is warmed after reveal instead.
	];

	// Counted for the timeout warning and for {@link getPreloadReport} — the splash itself shows no
	// progress, it holds the intro logo on its fully-lit frame (see CASINO_TV_LOGO_HOLD_SECONDS).
	let loaded = 0;
	const total = tasks.length;
	const startedAt = performance.now();
	report.total = total;
	report.startedAt = startedAt;
	const settled = tasks.map((task) =>
		Promise.resolve()
			.then(task)
			.catch(() => undefined)
			.then(() => {
				loaded += 1;
			}),
	);

	const work = Promise.all(settled).then(() => undefined);
	// Cancelled once the work wins, or the timer still fires `timeoutMs` into a perfectly healthy
	// session and cries wolf ("hit its cap at 148/148") long after the splash has gone.
	let timeoutId: number | undefined;
	const timeout = new Promise<void>((resolve) => {
		timeoutId = window.setTimeout(() => {
			report.cappedOut = true;
			console.warn(
				`[plinko] asset preload hit its ${timeoutMs} ms cap at ${loaded}/${total}; revealing anyway`,
			);
			resolve();
		}, timeoutMs);
	});

	return Promise.race([work, timeout]).finally(() => {
		window.clearTimeout(timeoutId);
		report.settled = loaded;
		report.elapsedMs = Math.round(performance.now() - startedAt);
	});
}

/**
 * Fire-and-forget warm-up for the things that deliberately sit OUTSIDE the blocking manifest: all
 * audio ({@link AUDIO_PATHS}) and the opposite orientation's background files. Call after the splash
 * has gone.
 *
 * The two are NOT equally urgent, so they are not warmed together. Audio starts immediately — a player
 * can reach a sound within a second of the reveal. The opposite orientation is ~15 MB that only
 * matters if the device is rotated, so it waits for idle rather than competing with the audio (and
 * with whatever the player is doing) over a slow link.
 */
export function preloadPostRevealAssets(): Promise<void> {
	if (typeof window === 'undefined') return Promise.resolve();

	const warmOtherOrientation = () => {
		void Promise.allSettled(otherOrientationBackgroundFiles().map(preloadFile));
	};
	if (typeof requestIdleCallback === 'function') {
		requestIdleCallback(warmOtherOrientation, { timeout: 10_000 });
	} else {
		setTimeout(warmOtherOrientation, 3_000);
	}

	return Promise.allSettled(AUDIO_PATHS.map((path) => preloadFile(staticUrl(path)))).then(
		() => undefined,
	);
}

/**
 * Drift alarm + production black box. The manifest is hand-maintained, and the whole point of this
 * module is that it is COMPLETE — but nothing stops a new component from referencing art nobody added
 * here, which is how the previous critical/deferred split ended up missing the 1-ball slot labels, the
 * moon and every spine skeleton.
 *
 * So: once the splash is gone, watch resource timings for anything under `img/`, `sound/`, `spine/` or
 * `fonts/` and record it on {@link report}. In DEV, anything not in the manifest also warns with the
 * path to add.
 *
 * The RECORDING half runs in production too, and `window.plinkoPreloadReport()` is published here.
 * Without it a live "assets load when the screen opens" report is unfalsifiable — every candidate cause
 * looks identical from the outside. Recording is a handful of resource entries and no console noise.
 */
export function watchForUnpreloadedAssets(): void {
	if (typeof PerformanceObserver === 'undefined') return;

	report.revealedAt = performance.now();
	(window as unknown as { plinkoPreloadReport?: () => PreloadReport }).plinkoPreloadReport =
		getPreloadReport;

	const covered = coveredUrls();
	// `fonts/` is watched too, but the faces are requested by family via `document.fonts.load` during
	// the preload — i.e. before this observer starts — so a hit here means a face nobody declared.
	const watched = ['img/', 'sound/', 'spine/', 'fonts/'].map((dir) => staticUrl(dir));
	const reported = new Set<string>();
	// Warmed after reveal on purpose (see preloadPostRevealAssets). Without this the black box flags a
	// perfectly healthy session — the opposite orientation alone is a few hundred KB of honest traffic
	// right after the splash — and an alarm that always fires tells you nothing.
	const byDesign = new Set([
		...AUDIO_PATHS.map((path) => staticUrl(path)),
		// Streamed on demand, one page at a time — see QUICK_GUIDE_VIDEO_PATHS for why they are not in
		// the manifest. They sit under `img/`, so without this every guide open reads as a manifest gap.
		...QUICK_GUIDE_VIDEO_PATHS.map((path) => staticUrl(path)),
		...otherOrientationBackgroundFiles().map((path) => new URL(path, window.location.href).href),
	]);

	const observer = new PerformanceObserver((list) => {
		for (const entry of list.getEntries()) {
			const url = entry.name.split('?')[0];
			if (!watched.some((prefix) => url.startsWith(prefix))) continue;
			if (reported.has(url)) continue;
			reported.add(url);

			// Recorded in every build. A `transferSize` of 0 is a cache/memory hit and costs nothing;
			// a non-zero one means this was genuinely pulled off the wire while the player waited.
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

			// `byDesign` is checked here too, not just in the report above: the audio it covers is also in
			// the manifest (so `covered` already silences it), but the quick-guide videos deliberately are
			// not — and telling the developer to add 78 MB of video to the blocking preload is the exact
			// opposite of what should happen.
			if (import.meta.env.DEV && !covered.has(url) && !byDesign.has(url)) {
				console.warn(
					`[plinko] asset loaded on demand (add it to the manifest in lib/preloadAssets.ts): ${url}`,
				);
			}
		}
	});
	observer.observe({ type: 'resource', buffered: false });

	// Self-report, in every build. Nothing is logged when the preload did its job, so a healthy session
	// stays silent. 8 s is long enough for the first screens to have been reached but short enough that
	// the player is still in the session that produced it.
	//
	// ⚠️ The offending paths are printed INLINE rather than parked behind `plinkoPreloadReport()`.
	// On Stake the game runs in an iframe, so a console evaluating against the top frame cannot see the
	// hook at all ("is not a function") — a report nobody can read is not a report. The hook stays for
	// local use; the log is what actually travels.
	window.setTimeout(() => {
		const paid = report.lateAssets.filter((a) => a.transferSize > 0 && !a.expected);
		if (report.failed.length > 0) {
			console.warn(
				`[plinko] ${report.failed.length} manifest image(s) never arrived during the preload:\n` +
					report.failed
						.map((f) => `  ${f.reason.padEnd(12)} ${f.url.replace(/^https?:\/\/[^/]+\//, '')}`)
						.join('\n'),
			);
		}
		if (!report.cappedOut && paid.length === 0) return;
		const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`;
		const lines = paid
			.sort((a, b) => b.transferSize - a.transferSize)
			.map(
				(a) =>
					`  ${a.inManifest ? 'IN-MANIFEST    ' : 'NOT-IN-MANIFEST'} ${kb(a.transferSize).padStart(9)}  ` +
					`${a.durationMs} ms  ${a.url.replace(/^https?:\/\/[^/]+\//, '')}`,
			);
		console.warn(
			`[plinko] preload did not cover the session: settled ${report.settled}/${report.total} in ` +
				`${report.elapsedMs} ms${report.cappedOut ? ' (HIT THE CAP — game revealed part-loaded)' : ''}; ` +
				`${paid.length} asset(s) fetched from the network after reveal ` +
				`(${kb(paid.reduce((sum, a) => sum + a.transferSize, 0))}):\n` +
				lines.join('\n') +
				`\n  NOT-IN-MANIFEST = never preloaded, add it to lib/preloadAssets.ts.` +
				`\n  IN-MANIFEST = preloaded under this exact URL and re-fetched anyway.`,
		);
	}, 8_000);
}
