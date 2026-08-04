import { Assets } from 'pixi.js';

import { isPortraitGameLayout } from './format';
import { staticUrl } from './staticUrl';
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
 * "Preloaded" here means RESIDENT, not merely cached. Warming a URL and then dropping the reference
 * only fills the HTTP cache, so the component that shows it later still pays a request and a decode —
 * invisible on a reload (the renderer's caches are already warm) but plainly visible on a cold first
 * run, which is the only run a real player gets. So DOM images are held for the session and Pixi art
 * is loaded under the same cache key its consumer uses.
 *
 * ⚠️ Adding art/audio to a component? Add it here too. In DEV, anything the game fetches after the
 * splash has gone is reported by {@link watchForUnpreloadedAssets} — check the console for
 * "[plinko] asset loaded on demand" before assuming a new asset is covered.
 */

/**
 * Images painted through the DOM (`<img src>`, CSS `background-image`). Warmed with `Image()` +
 * `decode()` and then RETAINED for the session (see {@link retainedImages}), so the element that
 * eventually shows one neither re-requests it nor re-decodes it.
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
	'img/fast-game-btn.webp',
	'img/fast-game-btn-mobile.webp',
	'img/loading_vector.webp',
	// Portrait-only strap behind the mobile action row (see .mobile-play-strap).
	'img/portait_bet_panel_strap.webp',
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
 * Images Pixi draws, loaded through `Assets` under the SAME key their consumer uses (the resolved
 * URL) so the engine and the meters get a straight cache hit instead of re-fetching and re-decoding.
 *
 * Warming these as plain `Image()`s would only fill the HTTP cache — Pixi would still pay for its own
 * decode + `ImageBitmap` on first use, which is the stall these are here to remove.
 */
const PIXI_TEXTURE_PATHS: readonly string[] = [
	// PlinkoEngine board textures.
	'img/ball.svg',
	'img/coin_peg.webp',
	'img/multiplier_slot_spin.webp',
	...[1, 2, 3, 4, 5, 6, 7].map((tier) => `img/multiplier_slot_${tier}.webp`),
	// Slot label art — mirrors `PlinkoEngine.MULTIPLIER_TEXT_LABELS`. `0.1` and `0.3` are the
	// feature-free 1-ball board's own pockets; they were missing here, so switching to 1 ball/drop
	// fetched them cold.
	...['0.1', '0.2', '0.3', '0.4', '1.5', '5', '20', '50', '100'].map(
		(label) => `img/multiplier_slot_text_${label}.webp`,
	),

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
 * Mirrors `EnableSound.svelte`'s `soundMap` plus `EnableMusic.svelte`'s two loops. The two music
 * tracks are ~12 MB of the total — by far the largest single item in the manifest — but they are also
 * the only assets whose absence is audible for a sustained stretch rather than one frame.
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
 * Load + decode a single image and hold onto it for the session. Always resolves — a missing asset
 * must never block the loader.
 */
function preloadImage(url: string): Promise<void> {
	return new Promise((resolve) => {
		const img = new Image();
		retainedImages.push(img);
		const done = () => resolve();
		img.onload = () => {
			// decode() guarantees the bitmap is ready to paint with no first-use hitch.
			if (typeof img.decode === 'function') {
				img.decode().then(done, done);
			} else {
				done();
			}
		};
		img.onerror = done;
		img.src = url;
	});
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

export type PreloadOptions = {
	/**
	 * Hard cap (ms) so a hung asset or a dead connection can never trap the player on the splash. This
	 * is a safety valve, not a budget — it is set far above any realistic full-manifest load, because
	 * firing it reveals the game part-loaded, which is the exact failure this module exists to prevent.
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
	const { timeoutMs = 120_000 } = options;

	const tasks: (() => Promise<unknown>)[] = [
		...DOM_IMAGE_PATHS.map((path) => () => preloadImage(staticUrl(path))),
		// Kept as one task: it is idempotent and may already be in flight from a component mount.
		() => preloadWinPopupAssets(),
		...PIXI_TEXTURE_PATHS.map((path) => () => Assets.load(staticUrl(path))),
		...spineAssetTasks(),
		...AUDIO_PATHS.map((path) => () => preloadFile(staticUrl(path))),
		() => preloadFonts(),
	];

	// Counted only so the timeout warning below can say how far it got — the splash shows no progress,
	// it holds the intro logo on its fully-lit frame instead (see CASINO_TV_LOGO_HOLD_SECONDS).
	let loaded = 0;
	const total = tasks.length;
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
			console.warn(
				`[plinko] asset preload hit its ${timeoutMs} ms cap at ${loaded}/${total}; revealing anyway`,
			);
			resolve();
		}, timeoutMs);
	});

	return Promise.race([work, timeout]).finally(() => window.clearTimeout(timeoutId));
}

/**
 * Fire-and-forget warm-up for the things that deliberately sit OUTSIDE the blocking manifest — today
 * just the opposite orientation's background files. Call after the splash has gone.
 */
export function preloadPostRevealAssets(): Promise<void> {
	if (typeof window === 'undefined') return Promise.resolve();
	return Promise.allSettled(otherOrientationBackgroundFiles().map(preloadFile)).then(
		() => undefined,
	);
}

/**
 * DEV-ONLY drift alarm. The manifest is hand-maintained, and the whole point of this module is that it
 * is COMPLETE — but nothing stops a new component from referencing art nobody added here, which is how
 * the previous critical/deferred split ended up missing the 1-ball slot labels, the moon and every
 * spine skeleton.
 *
 * So: once the splash is gone, watch resource timings for anything under `img/`, `sound/`, `spine/` or
 * `fonts/` that is not covered above and warn with the path to add. Silent in production.
 */
export function watchForUnpreloadedAssets(): void {
	if (!import.meta.env.DEV) return;
	if (typeof PerformanceObserver === 'undefined') return;

	const covered = coveredUrls();
	// `fonts/` is watched too, but the faces are requested by family via `document.fonts.load` during
	// the preload — i.e. before this observer starts — so a hit here means a face nobody declared.
	const watched = ['img/', 'sound/', 'spine/', 'fonts/'].map((dir) => staticUrl(dir));
	const reported = new Set<string>();

	const observer = new PerformanceObserver((list) => {
		for (const entry of list.getEntries()) {
			const url = entry.name.split('?')[0];
			if (!watched.some((prefix) => url.startsWith(prefix))) continue;
			if (covered.has(url) || reported.has(url)) continue;
			reported.add(url);
			console.warn(
				`[plinko] asset loaded on demand (add it to the manifest in lib/preloadAssets.ts): ${url}`,
			);
		}
	});
	observer.observe({ type: 'resource', buffered: false });
}
