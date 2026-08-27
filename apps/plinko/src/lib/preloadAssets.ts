import { Assets } from 'pixi.js';

import { BOARD_LABELS } from '../game-logic/boardMultipliers';
import { isPortraitGameLayout } from './format';
import { registerResidentUrl, staticUrl } from './staticUrl';
import { getBackgroundLandscapeAsset } from './spine/backgroundLandscapeAsset';
import { getBackgroundPortraitAsset } from './spine/backgroundPortraitAsset';
import { getBalanceCoinGlowAssets } from './spine/balanceCoinGlowAsset';
import { CASINO_TV_LOGO_BACKDROP, getCasinoTvLogoAsset } from './spine/casinoTvLogoAsset';
import { getCoinFountainAssets } from './spine/coinFountainAsset';
import { getFreeSpinMeterFullAssets } from './spine/freeSpinMeterFullAssets';
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
	// The landscape "FREE BALLS" banner; portrait uses `bonus-roulette-label.webp` below.
	'img/free_bonus_roulette_v2/free_balls_title.webp',

	// ── Roulette backdrops + portrait label ─────────────────────────────────────────────────────
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

	// ── Quick guide — both frames, the logo that hangs over them and the plate behind the nav
	//    buttons. All of it is on screen the instant the splash clears, so all of it has to be in
	//    memory by then. Its four video loops are warmed too, but as ELEMENTS rather than as bytes
	//    and only as far as a first frame — see QUICK_GUIDE_VIDEO_PATHS.
	//    BOTH frames, not just this orientation's: which one is showing is a media query, so a device
	//    rotated mid-guide swaps the art with no fetch behind it. 24 KB + 112 KB buys that outright.
	'img/quick_guide/quick_guide_container_wide.webp',
	'img/quick_guide/quick_guide_container_tall.webp',
	'img/quick_guide/quick_guide_title.webp',
	'img/quick_guide/quick_guide_button_container.webp',

	// ── Congratulations screens (pre-bonus wheel result + bonus-end treasure win) ────────────────
	// The baked CONGRATULATIONS headline art shared by both screens, plus their rope-and-lantern
	// borders: one per screen in landscape, one shared export in portrait. All of it is
	// full-screen-scale and paints on the FIRST frame the screen covers the view, so a late arrival is
	// a visible pop-in on top of an already-opaque overlay rather than a soft degrade.
	// BOTH orientations' borders, not just this one's: which pair is used is decided at mount from the
	// layout, and a device that rotates between the splash and the bonus would otherwise fetch its
	// border live. 0.7 MB for the set.
	// (The pre-bonus shine burst is absent on purpose: it reuses `img/win_popup/shine_rays.webp`, which
	// `preloadWinPopupAssets` below already loads and retains.)
	'img/congratulations_screen/congratulations_title_text.webp',
	'img/congratulations_screen/pre_congratulations_screen_overlay.webp',
	'img/congratulations_screen/post_congratulations_screen_overlay.webp',
	'img/congratulations_screen/portrait_congratulations_screen_overlay.webp',

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
 * They are warmed as ELEMENTS, not as bytes: the splash creates the four `<video>`s itself
 * ({@link getQuickGuideVideo}) and the modal ADOPTS them. That distinction is the whole of this note,
 * because warming the bytes is the obvious approach, it was shipped, and it cannot work here.
 *
 * ⚠️ Do NOT reach for a Blob + {@link registerResidentUrl}, the way every image in this module is
 * warmed. That was tried. The clips were re-cut at 960x540 and 4–10 s to afford the 38.7 MB, the
 * splash cap was re-derived to 600 s to cover it, and each clip was fetched into a Blob and published
 * as an object URL so the `<video>` would play from memory. It cannot work on Stake: the page serves
 * the game under `Content-Security-Policy: default-src 'self'` and never sets `media-src`, and CSP
 * does not treat `blob:` as same-origin — every object URL handed to a `<video>` is refused outright.
 * So the preload paid 38.7 MB of splash time on every cold load, the metadata probe that guarded the
 * bytes failed for all four clips, they were revoked, and the modal fell back to the plain same-origin
 * URL and streamed them anyway: the CDN request the blob existed to avoid, on top of a splash that had
 * already downloaded them once.
 *
 * (Blob IMAGES are unaffected and stay as they are — that CSP sets `img-src` explicitly. Only media
 * falls through to `default-src`.)
 *
 * ⚠️ Nor is a plain `fetch` into the HTTP cache ({@link preloadFile}, which is how audio is warmed) an
 * answer for these. Audio degrades to a stream; a `<video>` that misses is a black rectangle in the
 * middle of the guide, and the note on `resident` in staticUrl.ts is a measurement of these exact CDN
 * headers refusing that reuse.
 *
 * What is left is what the old note here said would take a service worker — give the `<video>` a
 * same-origin URL backed by bytes this tab already holds. It takes no such thing, because the bytes
 * never have to move between elements at all. `appendChild` MOVES a node, and a moved `<video>` keeps
 * everything it had: its buffer, its `readyState`, its decoded frame. So the element that loads behind
 * the splash is the element that plays in the well. Nothing for CSP to refuse, nothing for the CDN to
 * answer twice, no cache to trust.
 *
 * The splash blocks on a FIRST FRAME per clip and not on the bodies. What it is buying is a decode,
 * not a download (see the video-well note in QuickGuideModal.svelte), and all four files are faststart
 * — `moov` inside the first 70 KB — so four first frames is ~0.5 MB against 38.7 MB. The bodies are
 * pulled after reveal, one clip ahead of the player ({@link fillQuickGuideVideoBuffer}).
 */
export const QUICK_GUIDE_VIDEO_PATHS: readonly string[] = [
	'img/quick_guide/quick_guide_video_1.mp4',
	'img/quick_guide/quick_guide_video_2.mp4',
	'img/quick_guide/quick_guide_video_3.mp4',
	'img/quick_guide/quick_guide_video_4.mp4',
];

/**
 * Where the warmed clips sit while the guide is closed: a 1x1, fully transparent, click-through box
 * pinned behind the page.
 *
 * IN the document rather than detached, deliberately. A detached `<video>` is entitled to load and in
 * Chrome it does, but nothing obliges a UA to run the DECODE pipeline for an element that is in no
 * document — and bytes without a decoded frame buy nothing here, because the hole being closed is the
 * decode one. Rendered-but-invisible is the state a first frame is actually guaranteed in.
 *
 * Not `display: none`, for the same reason: that takes the element out of layout entirely, which is
 * precisely the case a UA is free to skip work for.
 */
let quickGuideStage: HTMLElement | undefined;

function getQuickGuideStage(): HTMLElement {
	if (quickGuideStage?.isConnected) return quickGuideStage;
	const stage = document.createElement('div');
	stage.setAttribute('aria-hidden', 'true');
	stage.style.cssText =
		'position:fixed;top:0;left:0;width:1px;height:1px;overflow:hidden;' +
		'opacity:0;pointer-events:none;z-index:-1;';
	document.body.appendChild(stage);
	quickGuideStage = stage;
	return stage;
}

/** The warmed clip elements, indexed as {@link QUICK_GUIDE_VIDEO_PATHS}. Retained for the session. */
const quickGuideVideos: (HTMLVideoElement | undefined)[] = [];

/**
 * The `<video>` for clip `index`, created and started on first ask.
 *
 * Lazy rather than preload-only because the guide is reachable from the menu for the whole session: a
 * player who opens it after a capped-out splash still has to get a video, even if it is the cold
 * stream all of this exists to avoid. One code path, degrading to the old behaviour.
 *
 * `muted` is set before anything else — an unmuted `<video>` cannot autoplay without a gesture, and
 * the guide opens on a timer.
 */
export function getQuickGuideVideo(index: number): HTMLVideoElement | undefined {
	if (typeof document === 'undefined') return undefined;
	if (index < 0 || index >= QUICK_GUIDE_VIDEO_PATHS.length) return undefined;
	const existing = quickGuideVideos[index];
	if (existing) return existing;
	const el = document.createElement('video');
	el.muted = true;
	el.defaultMuted = true;
	el.loop = true;
	el.playsInline = true;
	el.disablePictureInPicture = true;
	el.tabIndex = -1;
	el.setAttribute('aria-hidden', 'true');
	// `metadata` rather than `auto`: the splash needs a first frame and nothing more, and `auto` would
	// put all 38.7 MB on the wire alongside the ~27 MB the splash is genuinely blocked on — the cold-
	// load regression that got these clips thrown off the blocking path in the first place. The bodies
	// come after reveal instead, through `fillQuickGuideVideoBuffer`.
	el.preload = 'metadata';
	// The plain same-origin URL, never a `blob:` — see the CSP note on QUICK_GUIDE_VIDEO_PATHS.
	el.src = staticUrl(QUICK_GUIDE_VIDEO_PATHS[index]);
	getQuickGuideStage().appendChild(el);
	quickGuideVideos[index] = el;
	return el;
}

/**
 * How far into a clip to seek to force a decoded frame out of a `preload="metadata"` load, in seconds.
 *
 * `loadedmetadata` only promises duration and dimensions (`readyState` 1). Most browsers go on to
 * decode a first frame to paint as the default poster, so `loadeddata` usually follows on its own —
 * but nothing in the spec requires it, and "usually" is not what the guide can be built on. A SEEK
 * cannot be served without decoding the frame it lands on, so it is the guarantee.
 *
 * Non-zero because a seek to the position the element already sits at may legitimately be treated as a
 * no-op. One millisecond into a 4–10 s loop is not a visible difference in where the clip starts.
 */
const VIDEO_FIRST_FRAME_SEEK_S = 0.001;

/**
 * How long to wait for one clip's first frame before giving up on it and letting the splash carry on
 * without it.
 *
 * The global {@link PreloadOptions.timeoutMs} is NOT cover for this. It caps the whole pass at 300 s
 * and firing it reveals the game part-loaded — so a warm that can hang has to cap itself long before
 * that, or four `<video>`s become the one thing able to hold the splash for five minutes.
 *
 * And hanging is a real case, not a hypothetical: `preload` is a HINT, and iOS suppresses it outright
 * on a cellular connection. There `loadedmetadata` never arrives, so neither does the seek that would
 * force the frame, so nothing resolves. Every other route to a first frame goes through the same
 * event, so there is nothing cleverer to do than stop waiting.
 *
 * 20 s against a first frame of ~100 KB: on the 1.8 Mbps floor these preload timings were measured at,
 * sharing the link ten ways with the rest of the manifest, that is ~4.4 s of transfer. The margin is
 * for queueing, not for transfer. Giving up does not cancel anything either — the element keeps
 * loading, and on a link that was merely slow it is usually ready well before the guide is opened.
 */
const VIDEO_FRAME_WARM_TIMEOUT_MS = 20_000;

/**
 * Resolve once clip `index` has a frame it can paint (`readyState` >= HAVE_CURRENT_DATA). This — and
 * NOT the rest of the clip — is what the splash blocks on; the bodies are `fillQuickGuideVideoBuffer`.
 *
 * Always resolves. A clip that errors is recorded and left alone: the guide then streams it on open,
 * which is what every clip did before any of this existed.
 */
function warmQuickGuideVideoFrame(index: number): Promise<void> {
	const el = getQuickGuideVideo(index);
	if (!el) return Promise.resolve();
	if (el.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) return Promise.resolve();
	// Already dead before the splash asked (the element can predate this call — see getQuickGuideVideo).
	// A failed media element fires `error` once and never again, so waiting on it would hang to the cap.
	if (el.error) return Promise.resolve();
	return new Promise<void>((resolve) => {
		// Declared ahead of `settle` so the arrow form can close over it. An arrow and not a hoisted
		// `function`, because TypeScript drops the narrowing that proved `el` is defined across one.
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
				// An element that cannot even be seeked has nothing more to give the splash.
				settle();
			}
		};
		const onError = () => {
			if (report.failed.length < 100) {
				report.failed.push({ url: el.src, reason: `media error ${el.error?.code ?? 'unknown'}` });
			}
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
 * Let clip `index` finish downloading. Flipping `preload` to `auto` is the only lever that leaves what
 * the element already holds alone — `load()` would reset the element and re-open the very decode hole
 * the warm exists to close.
 *
 * Called ONE clip at a time (the first at reveal, then a page ahead of the player) rather than for all
 * four at once: at 7.5–15 MB for 4–10 s these sit well above real-time bitrate on a slow link, so four
 * parallel downloads would leave the clip actually on screen with a quarter of the connection.
 *
 * Best-effort. A UA that declines to resume buffering on a `preload` change just streams the clip when
 * it plays — the old behaviour, and still with a warm first frame in front of it.
 */
export function fillQuickGuideVideoBuffer(index: number): void {
	const el = getQuickGuideVideo(index);
	if (el) el.preload = 'auto';
}

/**
 * Take the clips back off-screen when the guide closes, paused and rewound. Parked, NOT destroyed:
 * reopening from the menu then costs nothing, because the buffers and the decoded frames are still
 * sitting in the same elements.
 */
export function releaseQuickGuideVideos(): void {
	if (typeof document === 'undefined') return;
	const stage = getQuickGuideStage();
	for (const el of quickGuideVideos) {
		if (!el) continue;
		el.pause();
		el.currentTime = 0;
		stage.appendChild(el);
	}
}

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
	// Held on loop under the post-bonus treasure screen (EnableSound).
	'sound/post_bonus_clinking_coins.mpeg',
	// Congratulations-screen fanfare, both screens (EnableSound).
	'sound/bonus_congratulations.mp3',

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
	// The "YOU WON N DROPS" / "YOU HAVE WON" row on both congratulations screens. Only the SemiBold cut
	// is declared (see +layout.svelte) — asking for any other weight here would just load nothing.
	"600 1rem 'Prompt'",
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
		// FREE SPIN meter's full-bar celebration (FreeSpinMeterEngine) — bar shine + helm glow/ring.
		...getFreeSpinMeterFullAssets().map((asset) => () => loadSpineAsset(asset)),
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
		...[
			...DOM_IMAGE_PATHS,
			...WIN_POPUP_IMAGE_PATHS,
			...PIXI_TEXTURE_PATHS,
			...AUDIO_PATHS,
			...QUICK_GUIDE_VIDEO_PATHS,
		].map((path) => staticUrl(path)),
		...spineDefFiles(
			isPortraitGameLayout() ? getBackgroundPortraitAsset() : getBackgroundLandscapeAsset(),
		),
		...spineDefFiles(getGlowNumbersAsset()),
		...getCoinFountainAssets().flatMap(spineDefFiles),
		...getBalanceCoinGlowAssets().flatMap(spineDefFiles),
		...getFreeSpinMeterFullAssets().flatMap(spineDefFiles),
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
	 * PAYLOAD, not of taste. Measured against a throttled connection, cold, when the blocking set was
	 * ~27 MB (art + spine + fonts; audio was moved off it precisely because it pushed this over):
	 *   3.0 Mbps → reveal at ~108 s      1.8 Mbps → reveal at ~146 s
	 * The 120 s cap of the day sat *inside* that range, so every player below ~3 Mbps got a part-loaded
	 * game and blamed the preload.
	 *
	 * The blocking set is ~27 MB. It briefly ran to ~66 MB when the quick guide's four clips joined it
	 * whole, and this cap went to 600 s to hold its margin over the ~355 s that 1.8 Mbps implied at that
	 * size; the clips are back on it, but only a first frame each (~0.5 MB — see
	 * QUICK_GUIDE_VIDEO_PATHS), which is inside the noise. So the derivation still stands on the
	 * measurements above: ~1.7x over the 146 s slow case, i.e. 300 s.
	 *
	 * Re-derive this if the payload changes materially; do not just nudge it.
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
		// The quick guide's four clips — a first frame each, not the bodies. The guide slides in 400 ms
		// after this splash clears (SPLASH_HANDOVER_MS in QuickGuideModal.svelte), far too soon for a
		// cold `<video>` to have anything but black to paint. ~0.5 MB for all four; see
		// QUICK_GUIDE_VIDEO_PATHS for why it is elements rather than bytes, and why only a frame.
		...QUICK_GUIDE_VIDEO_PATHS.map((_, index) => () => warmQuickGuideVideoFrame(index)),
		// Audio is deliberately absent — see AUDIO_PATHS. It is warmed after reveal instead, as are the
		// clip BODIES above (fillQuickGuideVideoBuffer).
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
 * Fire-and-forget warm-up for the things that deliberately sit OUTSIDE the blocking manifest: the
 * quick guide's first clip body, all audio ({@link AUDIO_PATHS}) and the opposite orientation's
 * background files. Call after the splash has gone.
 *
 * These are NOT equally urgent, so they are not warmed together. The guide's first clip goes first: it
 * is on screen 400 ms from now, where a sound is merely reachable. Audio starts immediately after — a
 * player can trigger one within a second of the reveal. The opposite orientation is ~15 MB that only
 * matters if the device is rotated, so it waits for idle rather than competing with either (and with
 * whatever the player is doing) over a slow link.
 */
export function preloadPostRevealAssets(): Promise<void> {
	if (typeof window === 'undefined') return Promise.resolve();

	// Ahead of the audio, and not on idle: the guide is 400 ms behind this call and its first page is
	// the one thing the player is about to look at. Only the FIRST clip — the other three are pulled a
	// page ahead of the player by the modal, so they never compete with the one on screen.
	fillQuickGuideVideoBuffer(0);

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
	// Fetched after reveal on purpose — warmed by `preloadPostRevealAssets`, the guide's clip bodies
	// included. Without this the black box flags a perfectly healthy
	// session — the opposite orientation alone is a few hundred KB of honest traffic right after the
	// splash — and an alarm that always fires tells you nothing.
	const byDesign = new Set([
		...AUDIO_PATHS.map((path) => staticUrl(path)),
		// Only a first frame of each is on the blocking path; the bodies stream in afterwards, a page
		// ahead of the player (see QUICK_GUIDE_VIDEO_PATHS). They sit under `img/`, so without this a
		// perfectly healthy guide reads as a manifest gap.
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

			// `byDesign` is checked here too, not just in the report above. Everything it covers is in the
			// manifest, so `covered` already silences all of it — but the two are different claims:
			// `covered` says the module knows about the file, `byDesign` says a fetch for it AFTER reveal
			// is the intended behaviour rather than a gap. The clip bodies are both, on purpose.
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
