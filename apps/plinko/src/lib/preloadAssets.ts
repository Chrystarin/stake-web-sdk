import { staticUrl } from './staticUrl';

/**
 * Static images the game paints on (or immediately after) the FIRST render — the board, pegs,
 * multiplier slots, the always-visible betting panel + HUD meters, and the small menu/modal icons.
 * These are the only images the intro splash blocks on, so the game is revealed fully painted.
 *
 * Heavy, feature-gated art (bonus/free-spin roulettes, buy-bonus modal, congrats/announcement
 * screens, the bonus board + level bars) is intentionally NOT here — see {@link DEFERRED_IMAGE_PATHS}.
 * Blocking the splash on all of it made the loader hold ~34 MB of decodes, so on a slow first load
 * the splash lingered (up to the timeout) on the finished, frozen logo. Keep this in sync with the
 * `staticUrl('img/…')` references used by the base game + betting panel components.
 */
const CRITICAL_IMAGE_PATHS: readonly string[] = [
	// Board / play-area art (Pixi textures + CSS backgrounds)
	'img/game_area_background.png',
	'img/ball.svg',
	'img/coin_peg.png',
	'img/multiplier_slot_spin.png',
	...[1, 2, 3, 4, 5, 6, 7].map((tier) => `img/multiplier_slot_${tier}.png`),
	...['0.2', '0.4', '1.5', '5', '20', '50', '100'].map(
		(label) => `img/multiplier_slot_text_${label}.png`,
	),

	// Free-spin meter (on screen from launch in the HUD)
	'img/free-spin-base.png',
	'img/free-spin-meter.png',
	'img/free-spin-meter-wheel.png',
	'img/free-spin-label.png',
	'img/free-spin-marker.png',

	// Bonus meter bar (on screen from launch in the HUD)
	'img/bonus-bar-base.png',
	'img/bonus-bar-fill.png',
	'img/bonus-bar-marker.png',

	// Betting panel (desktop + mobile) — always visible
	'img/betting-component-frame.png',
	'img/betting-component-input-decrease.png',
	'img/betting-component-input-increase.png',
	// Containerless (bare glyph) stepper icons used by the mobile inline steppers.
	'img/betting-component-input-decrease-containerless.png',
	'img/betting-component-input-increase-containerless.png',
	'img/play-btn.png',
	'img/main_btn_empty.png',
	'img/main_btn_play_icon.png',
	'img/pause-btn.png',
	'img/auto-bet-btn.png',
	'img/auto-bet-stop-btn.png',
	'img/fast-game-btn.png',
	'img/empty-btn.png',
	'img/loading_vector.png',
	'img/fast-game-btn-mobile.png',
	'img/auto-bet-btn-mobile.png',
	// Desktop menu button (top-hud). Mobile uses its own asset below.
	'img/menu-btn.png',
	// Mobile menu button — dedicated mobile art, top-left corner.
	'img/menu-btn-mobile.png',
	'img/coin-ico.png',
	'img/wallet-ico.png',
	// The board's Buy Bonus button is visible from launch (desktop) — the modal art it opens is deferred.
	'img/buy-bonus-btn.png',

	// Menu + modal icons (a tap away from launch; tiny)
	'img/hamburg_menu_ico_fair_settings.png',
	'img/hamburg_menu_ico_game_rules.png',
	'img/hamburg_menu_ico_history.png',
	'img/hamburg_menu_ico_how_to_play.png',
	'img/close_btn.png',
];

/**
 * Heavy, feature-gated art loaded in the BACKGROUND after the game is revealed — never on the
 * splash's critical path. None of this is on screen at launch; the player bets several times (and
 * fills a meter) before any of it is needed, which is ample time for a background fetch to finish,
 * so nothing pops in on first use. Failures are swallowed; the worst case is a single on-demand
 * fetch if the feature somehow fires before the background load reaches that asset.
 *
 * Ordered roughly by how soon each feature can trigger (free-spin roulette first → congrats last).
 */
const DEFERRED_IMAGE_PATHS: readonly string[] = [
	// Bonus board background (swapped in only during the free game)
	'img/game_area_bonus.png',

	// Free-spin wheel: rotating value disc + top wedge highlight + rope dividers + frame.
	'img/bonus_roulette_v2/wheel_values.png',
	'img/bonus_roulette_v2/wheel_base.png',
	'img/bonus_roulette_v2/wheel_segment_highlight.png',
	'img/bonus_roulette_v2/wheel_divider.png',

	// Bonus wheel: rotating values disc + wedge highlight + static frame.
	'img/free_bonus_roulette_v2/wheel_values.png',
	'img/free_bonus_roulette_v2/wheel_base.png',
	'img/free_bonus_roulette_v2/wheel_segment_highlight.png',

	// Roulette backdrops + label + in-bonus level bars
	'img/bonus-roulette-background.png',
	'img/bonus-roulette-background-mobile.png',
	'img/bonus-roulette-label.png',
	'img/bonus-level-base.png',
	'img/bonus-level-base-background.png',
	'img/bonus-level-up-base.png',
	// The 9 level-arch tiles + their lit variants (`BonusLevel.svelte` LEVEL_BAR_URLS). All 18 mount at
	// once with the arch, so leaving them out meant 9+ cold requests fired on the bonus-entry frame.
	// Tiny (~156 kB the lot), so there is no reason for them not to be warmed with the rest of the arch.
	...Array.from({ length: 9 }, (_, i) => `img/bonus-bar-level-${i + 1}.png`),
	...Array.from({ length: 9 }, (_, i) => `img/bonus-bar-level-active-${i + 1}.png`),

	// Free-game backdrops. The landscape one also loads through the spine renderer (which GPU-warms it),
	// but the PORTRAIT one is a plain CSS background on mobile with nothing else warming it.
	'img/BG_landscape_FREEGAME.jpg',
	'img/BG_portrait_FREEGAME.jpg',

	// Announcement banner (feature intro)
	'img/announcement-message-background.png',
	'img/announcement-message-background-mobile.png',

	// Buy Bonus modal — card frame + Activate button + per-tier feature art (keys mirror BUY_BONUS_TIERS)
	'img/buy_bonus_button.png',
	'img/buy_bonus_panel.png',
	...['standard', 'enhanced', 'premium', 'superfury'].map((key) => `img/buy_bonus_${key}.png`),

	// Bonus-end "CONGRATULATIONS! YOU HAVE WON" treasure-win screen (needed last)
	'img/congratulations_screen/treasure_table.png',
	'img/congratulations_screen/treasure_table_mobile.png',
	'img/congratulations_screen/sparkle.png',
	// The coins strewn across the treasure table — they mount with it, so they were cold-fetched on the
	// bonus-END frame, which is exactly where a hitch is most visible.
	'img/congratulations_screen/coin_1.png',
	'img/congratulations_screen/coin_2.png',
];

/**
 * WIN-CELEBRATION art (`WinCelebration.svelte` + `RapidWinSparkles.svelte`). Unlike the rest of the
 * deferred set this can fire on the player's very FIRST drop — any round paying ≥ the total bet pops
 * it — so it is warmed ahead of the feature art, and its images are RETAINED (see `preloadImage`)
 * rather than left for the GC: the banners are large enough that a dropped decode means the reveal
 * visibly waits on a re-decode, which is exactly the "still loading" hitch this list exists to kill.
 */
const WIN_POPUP_IMAGE_PATHS: readonly string[] = [
	// Tier banners — one shows per win; which one isn't known until the round settles, so all three.
	'img/win_popup/massive_plunder.png',
	'img/win_popup/epic_bounty.png',
	'img/win_popup/captains_jackpot.png',
	// Shared reveal layers
	'img/win_popup/shine_rays.png',
	'img/win_popup/backdrop_shade.png',
	'img/win_popup/coin.png',
	// Counter glyphs (0–9 + the decimal dot) — also used by the 1-ball rapid sparkles
	'img/win_popup/dot.png',
	...Array.from({ length: 10 }, (_, digit) => `img/win_popup/${digit}.png`),
];

/**
 * Fonts declared via `@font-face` in `+layout.svelte`. Browsers only fetch a web font the
 * first time a glyph that needs it is rendered, so we load them explicitly here — otherwise
 * e.g. the roulette labels (PotatoSans) flash in an unstyled fallback on first appearance.
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
 * Images kept alive for the session. A preloaded `Image` with no reference is GC-eligible, and when
 * it goes so can its decoded bitmap — leaving the HTTP bytes cached but the next `<img>` still paying
 * for a decode on first paint. Holding the element pins the decode. Only used where a mid-game hitch
 * would be visible (the win reveal); the rest stay collectable.
 */
const retainedImages: HTMLImageElement[] = [];

/** Load + decode a single image. Always resolves — a missing asset must never block the loader. */
function preloadImage(url: string, options: { retain?: boolean } = {}): Promise<void> {
	return new Promise((resolve) => {
		const img = new Image();
		if (options.retain) retainedImages.push(img);
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

export type PreloadOptions = {
	/** Hard cap (ms) so a hung/slow asset can never trap the player on the splash. */
	timeoutMs?: number;
};

/**
 * Preload the FIRST-VIEW images + fonts while the intro loader is on screen — the small set the
 * game paints on reveal (board, betting panel, HUD meters, fonts). Resolves once everything has
 * *settled* (loaded or failed) so the loader can dismiss knowing the first frame is fully painted.
 *
 * It always resolves: individual failures are swallowed and `timeoutMs` guarantees it can never
 * hang the splash forever. Heavy feature art is loaded separately by {@link preloadDeferredAssets}.
 */
export function preloadCriticalAssets(options: PreloadOptions = {}): Promise<void> {
	if (typeof window === 'undefined') return Promise.resolve();
	const { timeoutMs = 15000 } = options;

	const work = Promise.allSettled([
		...CRITICAL_IMAGE_PATHS.map((path) => preloadImage(staticUrl(path))),
		preloadFonts(),
	]).then(() => undefined);

	const timeout = new Promise<void>((resolve) => {
		window.setTimeout(resolve, timeoutMs);
	});

	return Promise.race([work, timeout]);
}

/**
 * Load + decode + RETAIN the win-celebration art ({@link WIN_POPUP_IMAGE_PATHS}) so the reveal never
 * waits on a fetch or a decode. Idempotent: the first call owns the work and every later caller gets
 * the same promise, so the components can safely warm it on mount as a backstop to the deferred pass.
 */
let winPopupWarmup: Promise<void> | undefined;
export function preloadWinPopupAssets(): Promise<void> {
	if (typeof window === 'undefined') return Promise.resolve();
	winPopupWarmup ??= Promise.allSettled(
		WIN_POPUP_IMAGE_PATHS.map((path) => preloadImage(staticUrl(path), { retain: true })),
	).then(() => undefined);
	return winPopupWarmup;
}

/**
 * Preload the heavy, feature-gated art ({@link DEFERRED_IMAGE_PATHS}) in the background. Kicked off
 * fire-and-forget once the game is revealed, so it warms the cache well before any feature triggers
 * without ever gating the splash. Always resolves; failures are swallowed.
 *
 * The win-celebration art goes FIRST — every path here is requested at once (subject to the browser's
 * per-host connection limit), so being early in the list is what buys it the first free sockets, and
 * it's the only feature in this set that can fire on the player's first drop.
 */
export function preloadDeferredAssets(): Promise<void> {
	if (typeof window === 'undefined') return Promise.resolve();
	return Promise.allSettled([
		preloadWinPopupAssets(),
		...DEFERRED_IMAGE_PATHS.map((path) => preloadImage(staticUrl(path))),
	]).then(() => undefined);
}
