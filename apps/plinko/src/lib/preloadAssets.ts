import { staticUrl } from './staticUrl';

/**
 * Every static image the game paints. These are preloaded while the intro loader is on
 * screen so nothing pops in on first use — in particular the free-spin / bonus roulettes
 * and overlays, which are rendered with plain `<img>` tags and would otherwise only start
 * downloading the moment the feature is triggered mid-game.
 *
 * Keep this in sync with the `staticUrl('img/…')` references across the components.
 */
const IMAGE_PATHS: readonly string[] = [
	// Board / play-area art (Pixi textures + CSS backgrounds)
	'img/game_area_background.png',
	'img/game_area_bonus.png',
	'img/ball.svg',
	'img/coin_peg.png',
	'img/multiplier_slot_spin.png',
	...[1, 2, 3, 4, 5, 6, 7].map((tier) => `img/multiplier_slot_${tier}.png`),
	...['0.2', '0.4', '1.5', '5', '20', '50', '100'].map(
		(label) => `img/multiplier_slot_text_${label}.png`,
	),

	// Free-spin meter + roulette
	'img/free-spin-base.png',
	'img/free-spin-meter.png',
	'img/free-spin-meter-wheel.png',
	'img/free-spin-label.png',
	'img/free-spin-roulette-marker.png',
	// Free-spin wheel is composited from the blank copper disc + per-value wedge PNGs (see FreeSpinRoulette.svelte).
	'img/free_spin_roulette_segments/free_spin_roulette_empty.png',
	'img/free_spin_roulette_segments/segment_x2.png',
	'img/free_spin_roulette_segments/segment_x0.5.png',
	'img/free_spin_roulette_segments/segment_x1.png',
	'img/free_spin_roulette_segments/segment_x5.png',
	'img/free_spin_roulette_segments/segment_x10.png',
	'img/free_spin_roulette_segments/segment_bonus.png',
	'img/free_spin_roulette_segments/segment_x20.png',
	'img/free_spin_roulette_segments/segment_x15.png',
	'img/free-spin-roulette-base.png',
	'img/free-spin-marker.png',

	// Bonus meter + roulette + overlays
	'img/bonus-bar-base.png',
	'img/bonus-bar-fill.png',
	'img/bonus-bar-marker.png',
	'img/bonus-level-base.png',
	'img/bonus-level-up-base.png',
	'img/bonus-roulette-background.png',
	'img/bonus-roulette-background-mobile.png',
	'img/bonus-roulette-label.png',
	// Bonus wheel is composited from the empty ring + per-value wedge SVGs (see BonusRoulette.svelte).
	'img/bonus_roulette_segments/bonus_roulette_empty.png',
	'img/bonus_roulette_segments/segment_20.svg',
	'img/bonus_roulette_segments/segment_30.svg',
	'img/bonus_roulette_segments/segment_40.svg',
	'img/bonus_roulette_segments/segment_50.svg',
	'img/bonus_roulette_segments/segment_60.svg',
	'img/bonus_roulette_segments/segment_70.svg',
	'img/bonus_roulette_segments/segment_80.svg',
	'img/bonus_roulette_segments/segment_90.svg',
	'img/bonus_roulette_segments/segment_100.svg',
	'img/bonus-roulette-center-base.png',
	'img/bonus-spin-marker.png',
	'img/announcement-message-background.png',
	'img/announcement-message-background-mobile.png',

	// Betting panel (desktop + mobile)
	'img/betting-component-frame.png',
	'img/betting-component-input-decrease.png',
	'img/betting-component-input-increase.png',
	'img/play-btn.png',
	'img/pause-btn.png',
	'img/auto-bet-btn.png',
	'img/fast-game-btn.png',
	'img/mobile_popup_bet_modal_base.png',
	'img/empty-btn.png',
	'img/empty-btn-brown.png',
	'img/loading_vector.png',
	'img/play-btn-mobile.png',
	'img/fast-game-btn-mobile.png',
	'img/auto-bet-btn-mobile.png',
	'img/coins-btn-mobile.png',
	'img/menu-btn-mobile.png',
	'img/coin-ico.png',
	'img/wallet-ico.png',

	// Menu + modal icons
	'img/hamburg_menu_ico_fair_settings.png',
	'img/hamburg_menu_ico_game_rules.png',
	'img/hamburg_menu_ico_history.png',
	'img/hamburg_menu_ico_how_to_play.png',
	'img/close_btn.png',

	// Buy Bonus — board button + modal card frame + per-tier feature art (keys mirror BUY_BONUS_TIERS)
	// + the per-card "Activate" button background. Without these the button/logos/graphics pop in on
	// first open (fresh-launch → click Buy Bonus). NOTE: `buy-bonus-btn.png` (hyphens) is the board
	// button; `buy_bonus_button.png` (underscores) is the modal's Activate button — both are needed.
	'img/buy-bonus-btn.png',
	'img/buy_bonus_button.png',
	'img/buy_bonus_panel.png',
	...['standard', 'enhanced', 'premium', 'superfury'].map((key) => `img/buy_bonus_${key}.png`),
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
	"400 1rem 'Poppins'",
	"600 1rem 'Poppins'",
	"700 1rem 'Poppins'",
	"800 1rem 'Poppins'",
	"900 1rem 'Poppins'",
	"1rem 'PiecesOfEight'",
	"1rem 'PotatoSans'",
	"1rem 'Perpetua'",
];

/** Load + decode a single image. Always resolves — a missing asset must never block the loader. */
function preloadImage(url: string): Promise<void> {
	return new Promise((resolve) => {
		const img = new Image();
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
 * Preload every image + font the game needs while the intro loader is on screen.
 *
 * Resolves once everything has *settled* (loaded or failed) so the caller can hide the loader
 * knowing nothing will pop in mid-game. It always resolves: individual failures are swallowed
 * and `timeoutMs` guarantees it can never hang the splash forever.
 */
export function preloadAllAssets(options: PreloadOptions = {}): Promise<void> {
	if (typeof window === 'undefined') return Promise.resolve();
	const { timeoutMs = 15000 } = options;

	const work = Promise.allSettled([
		...IMAGE_PATHS.map((path) => preloadImage(staticUrl(path))),
		preloadFonts(),
	]).then(() => undefined);

	const timeout = new Promise<void>((resolve) => {
		window.setTimeout(resolve, timeoutMs);
	});

	return Promise.race([work, timeout]);
}
