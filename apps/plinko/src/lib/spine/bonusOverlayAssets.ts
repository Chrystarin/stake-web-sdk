import { staticAssetPath } from '../staticUrl';
import type { SpineImageOverlayDef, SpineOverlayDef } from './types';

/**
 * Free-game (bonus mode) overlays. Every spine here was exported from the SAME Spine scene as the base
 * `background_{landscape,portrait}` skeletons (identical `../background/Spine/` image root and matching
 * authored world bounds), so each lines up with the base scene when rendered with the base spine's fit
 * transform and the same skeleton scale (0.5). They are painted only while the bonus round is active —
 * see `SpineBackgroundRenderer.setBonusMode`.
 *
 * Layers, from farthest to nearest:
 *  - moon  (image overlay, 50% opacity, behind the scene)   — `getBonusMoonOverlay`
 *  - lightning (image overlays, just above the moon, still UNDER the base scene; a staggered pair on
 *    desktop, a single centred glow in portrait)            — `getBonusLightningOverlays`
 *  - ship  (spine, INSIDE the base scene just above the sea) — `getBonusShipOverlay`
 *  - splash×2 (spine, inside the base scene, over the ship)  — `getBonusSplashOverlay`
 *  - tornado×2 (spine, above the scene: a big one right, a smaller one left) — `getBonusTornadoOverlay`
 *  - cloud (spine, drifting storm clouds on top)             — `getBonusCloudOverlay`
 *  - rain  (spine, on top — viewport-covering, both orientations) — `getBonusRainOverlay`
 *
 * The ship and splashes are anchored into the BASE skeleton's draw order (`baseSlot`) rather than
 * layered under the base spine as a whole: they have to paint over the sea plane while the waterfall,
 * dock, fog and the base scene's own splashes still occlude them — and those are all slots of the one
 * base skeleton, so no amount of stage ordering can put a layer between them.
 */

const CLOUD_BASE = 'spine/FG_CLOUD';
const SPLASH_BASE = 'spine/FG_SPLASH';
const SHIP_BASE = 'spine/ship';
const TORNADO_BASE = 'spine/tornado';
/** Tiled 2×2 rain field, used in BOTH orientations — see `getBonusRainOverlay`. */
const RAIN_BASE = 'spine/landscape_rain';
const MOON_IMAGE = 'img/moon.webp';
const LIGHTNING_IMAGE = 'spine/lightning.webp';

export type Orientation = 'landscape' | 'portrait';

/** Must match the base background skeletons' `skeletonScale` so world coordinates align. */
const OVERLAY_SKELETON_SCALE = 0.5;

/*
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 *  TUNING KNOBS — position & scale of the bonus-mode MOON, SHIP and TORNADO(es).
 *
 *  Landscape (desktop) and portrait (mobile) are configured INDEPENDENTLY in the two blocks below:
 *  changing a value in one block never affects the other orientation.
 *
 *  SHIP & TORNADO (animated spines, placed relative to the moving scene):
 *    • offsetXVw    — horizontal nudge, as a fraction of viewport WIDTH.  + = RIGHT, − = LEFT.
 *    • offsetYScene — vertical nudge in SCENE units (stays locked to the water on any screen shape).
 *                       − = UP, + = DOWN.   (Roughly 1 unit ≈ 1px on a ~1280px-wide desktop.)
 *    • scaleMul     — size multiplier.  1 = original size, 0.8 = 80% (smaller), 1.25 = 125% (bigger).
 *
 *  MOON and LIGHTNING (plain images, placed in viewport fractions — independent of the scene):
 *    ⚠️ the MOON knobs also place the BASE-GAME moon (`getBaseMoonOverlay`) — deliberately, so the two
 *       stay the same moon; editing xVw/yVh/widthVw moves it in the base game AND the free game.
 *       Its OPACITY is the exception: the base game runs the moon at `BASE_MOON_ALPHA` (full strength
 *       over a clear night sky) and only the free game uses the dimmed `alpha` below.
 *    • xVw / yVh    — CENTRE position, as fractions of viewport width / height (0 = left/top … 1 = right/bottom).
 *    • widthVw      — width as a fraction of viewport width (height follows automatically to keep aspect).
 *    • alpha        — opacity, 0–1  (0.5 = 50%).  For the lightning this is the alpha each blink PEAKS at.
 *                     ⚠️ 1 is a HARD ceiling — Pixi packs alpha as `worldAlpha * 255 | 0` into a colour
 *                     byte, so anything above 1 overflows the shift and corrupts the layer's colour.
 *                     To make an additive glow read brighter once it is at 1, widen it (`widthVw`)
 *                     so more of the asset's bright core lands on screen.
 *
 *  How OFTEN the lightning blinks, and how long each strike lasts, are a separate knob block — see
 *  `LIGHTNING_STRIKE` / `LIGHTNING_INTERVAL_*` below.
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 */

/** Position + size of an animated spine overlay (ship, tornado). See the knob descriptions above. */
type SpinePlacement = { offsetXVw: number; offsetYScene: number; scaleMul: number };
/** Position + size (+ opacity) of a plain image overlay: the moon, and each lightning glow. */
type ImagePlacement = { xVw: number; yVh: number; widthVw: number; alpha: number };

/**
 * One sheet-lightning glow. An orientation may run any number of them (desktop uses a staggered
 * left/right pair, mobile a single centred one), so they are configured as a LIST rather than as fixed
 * left/right slots.
 */
type LightningPlacement = ImagePlacement & {
	/** Suffix for the overlay id — must be unique within the orientation (`bonus_lightning_<key>`). */
	key: string;
	/** Seconds after the shared cycle's start at which THIS glow strikes. The first should be 0. */
	delaySeconds: number;
};

type OrientationTuning = {
	moon: ImagePlacement;
	/** Sheet-lightning glows, in strike order. See `LightningPlacement`. */
	lightning: LightningPlacement[];
	ship: SpinePlacement;
	/** The big right-hand tornado (shown in both orientations). */
	tornadoRight: SpinePlacement;
	/** The smaller left-hand tornado — LANDSCAPE ONLY (portrait renders just the right one). */
	tornadoLeft?: SpinePlacement;
	/** Water-splash burst at the RIGHT-hand waterfall. */
	splashRight: SpinePlacement;
	/** Water-splash burst at the LEFT-hand waterfall (a mirrored copy of the right one). */
	splashLeft: SpinePlacement;
};

/* ▼▼▼ DESKTOP / LANDSCAPE — move & resize the moon, ship and tornadoes on desktop here. ▼▼▼ */
const LANDSCAPE_TUNING: OrientationTuning = {
	moon: { xVw: 0.12, yVh: 0.13, widthVw: 0.35, alpha: 0.5 },
	// A staggered pair: the left glow strikes, the right answers a beat later.
	lightning: [
		{ key: 'left', xVw: 0.27, yVh: 0.09, widthVw: 0.58, alpha: 0.85, delaySeconds: 0 },
		{ key: 'right', xVw: 0.75, yVh: 0.08, widthVw: 0.52, alpha: 0.8, delaySeconds: 0.35 },
	],
	ship: { offsetXVw: -0.2, offsetYScene: 100, scaleMul: 1 },
	tornadoRight: { offsetXVw: 0.23, offsetYScene: -516, scaleMul: 1 },
	tornadoLeft: { offsetXVw: -0.2, offsetYScene: -554, scaleMul: 0.62 },
	splashRight: { offsetXVw: 0, offsetYScene: -55, scaleMul: 1 },
	splashLeft: { offsetXVw: 0.011, offsetYScene: -55, scaleMul: 1 },
};

/* ▼▼▼ MOBILE / PORTRAIT — move & resize the moon, ship and tornado on mobile here. ▼▼▼ */
const PORTRAIT_TUNING: OrientationTuning = {
	moon: { xVw: 0.175, yVh: 0.05, widthVw: 0.5, alpha: 0.5 },
	// ONE glow on mobile, centred on the top edge — portrait simply has no room for a staggered pair.
	//
	// ⚠️ It has to be much wider than either desktop glow, for two reasons that compound. The sprite is
	// centre-anchored, so pinning it to the top edge pushes most of it off-screen; and the skull arch
	// covers the top-CENTRE, which is exactly where the asset's bright core now sits. What actually
	// reaches the player is the glow's lower wings, spilling into the sky slivers either side of the
	// arch — so the asset is scaled well past the viewport width to put enough brightness out there.
	// Measured: lifting a glow 0.02vh in portrait costs ~40-50% of its peak brightness, so any further
	// vertical move needs `widthVw` re-tuned with it.
	lightning: [
		{ key: 'center', xVw: 0.5, yVh: 0.05, widthVw: 1.85, alpha: 0.95, delaySeconds: 0 },
	],
	ship: { offsetXVw: -0.07, offsetYScene: -50, scaleMul: 0.9 },
	tornadoRight: { offsetXVw: 0.3, offsetYScene: -645, scaleMul: 0.7 },
	// (no left tornado on mobile)
	// The FG_SPLASH is authored at the landscape waterfalls; in portrait the board fills the frame, so
	// the two splashes are separated to the lower-left / lower-right sea and scaled down to stay visible.
	splashRight: { offsetXVw: -0.1, offsetYScene: -400, scaleMul: 0.5 },
	splashLeft: { offsetXVw: 0.1, offsetYScene: -400, scaleMul: 0.5 },
};

const TUNING: Record<Orientation, OrientationTuning> = {
	landscape: LANDSCAPE_TUNING,
	portrait: PORTRAIT_TUNING,
};

/**
 * Where the ship and the splashes are drawn inside the base scene: the `moon` slot, moved during bonus
 * to sit directly after the sea plane (see `SpineOverlayDef.baseSlot` / `baseSlotAfter`).
 *
 * The depth wanted is "one step above the sea, below everything else the scene draws" — but no slot at
 * that depth can be anchored to: an anchor lends its bone transform AND its slot alpha to whatever is
 * attached, and every slot between the sea and the waterfall pulses alpha (the clouds swing 0x00↔0xff,
 * the water band 0x51↔0x8b). `moon` can: static `root` bone, no colour timeline, and its art is already
 * hidden for the whole bonus round (`bonusHiddenSlots`), so relocating it is invisible. Neither
 * background animation has a draw-order timeline, so nothing fights the move; the setup order is
 * restored when bonus ends.
 */
const ANCHOR_SLOT: Record<Orientation, string> = {
	landscape: 'moon',
	portrait: 'moon',
};
/** The sea plane the anchor is parked directly above — note the capital O in the portrait scene. */
const SEA_SLOT: Record<Orientation, string> = {
	landscape: 'ocean',
	portrait: 'Ocean',
};

export const getBonusCloudOverlay = (): SpineOverlayDef => ({
	id: 'fg_cloud',
	format: 'json',
	skeleton: staticAssetPath(`${CLOUD_BASE}/skeleton.json`),
	atlas: staticAssetPath(`${CLOUD_BASE}/skeleton.atlas`),
	images: {
		'skeleton.png': staticAssetPath(`${CLOUD_BASE}/skeleton.webp`),
	},
	animation: 'animation',
	loop: true,
	skeletonScale: OVERLAY_SKELETON_SCALE,
});

/**
 * Pause between splashes, so each waterfall bursts intermittently rather than looping continuously.
 * Randomized in this range and re-rolled after every play, so the bursts feel irregular rather than
 * metronomic.
 */
const SPLASH_GAP_MIN_SECONDS = 5;
const SPLASH_GAP_MAX_SECONDS = 7;
/**
 * The LEFT splash fires first; the RIGHT one follows 0.5s later. (Left is the mirrored copy, hence
 * the `mirror ? 0 : …`.) The two never burst together: they share one duty cycle (`cycleGroup`), so
 * the offset is a property of the schedule rather than a head start that decays.
 */
const SPLASH_RIGHT_DELAY_SECONDS = 0.5;
/** Shared duty-cycle schedule for the mirrored splash pair — see `SpineOverlayDef.cycleGroup`. */
const SPLASH_CYCLE_GROUP = 'fg_splash_pair';

/**
 * The FG_SPLASH asset authors a single splash at the RIGHT-hand waterfall. `mirror` produces a second
 * instance flipped across the scene centre so the LEFT waterfall gets a matching splash. Position/scale
 * come from the tuning block above (`splashRight` / `splashLeft`, per orientation).
 */
export const getBonusSplashOverlay = (
	orientation: Orientation,
	mirror = false,
): SpineOverlayDef => ({
	id: mirror ? 'fg_splash_left' : 'fg_splash',
	format: 'json',
	skeleton: staticAssetPath(`${SPLASH_BASE}/skeleton.json`),
	atlas: staticAssetPath(`${SPLASH_BASE}/skeleton.atlas`),
	images: {
		'skeleton.png': staticAssetPath(`${SPLASH_BASE}/skeleton.webp`),
		'skeleton_2.png': staticAssetPath(`${SPLASH_BASE}/skeleton_2.webp`),
		'skeleton_3.png': staticAssetPath(`${SPLASH_BASE}/skeleton_3.webp`),
	},
	animation: 'animation',
	loop: true,
	skeletonScale: OVERLAY_SKELETON_SCALE,
	mirror,
	...(mirror ? TUNING[orientation].splashLeft : TUNING[orientation].splashRight),
	cycleGapMinSeconds: SPLASH_GAP_MIN_SECONDS,
	cycleGapMaxSeconds: SPLASH_GAP_MAX_SECONDS,
	cycleStartDelaySeconds: mirror ? 0 : SPLASH_RIGHT_DELAY_SECONDS,
	// Both copies run off ONE schedule, so the half-second stagger holds for every burst instead of
	// drifting apart (and occasionally colliding) as each side re-rolls its own random gap.
	cycleGroup: SPLASH_CYCLE_GROUP,
	// Same anchor as the ship, and later in `getBonusOverlays`, so the splash paints OVER the ship while
	// everything the base scene draws above the sea — the waterfalls, its own splashes, the flags, the
	// dock, the lamps and the fog — still covers it.
	baseSlot: ANCHOR_SLOT[orientation],
	baseSlotAfter: SEA_SLOT[orientation],
	behindBase: true,
});

/**
 * The distant sailing ship, authored in the portrait scene's coordinate frame. It is drawn inside the
 * base scene just above the sea plane, so the water no longer washes over the hull, while the dock,
 * waterfall, fog and the splashes above it still occlude it. Per-orientation nudges align it with the
 * reference.
 */
export const getBonusShipOverlay = (orientation: Orientation): SpineOverlayDef => ({
	id: 'bonus_ship',
	format: 'json',
	skeleton: staticAssetPath(`${SHIP_BASE}/portrait.json`),
	atlas: staticAssetPath(`${SHIP_BASE}/portrait.atlas`),
	images: {
		'portrait.png': staticAssetPath(`${SHIP_BASE}/portrait.webp`),
	},
	animation: 'animation',
	loop: true,
	skeletonScale: OVERLAY_SKELETON_SCALE,
	// Above the sea, under everything else the base scene draws (`behindBase` is only the fallback if
	// the anchor slot is ever renamed out of the skeleton).
	baseSlot: ANCHOR_SLOT[orientation],
	baseSlotAfter: SEA_SLOT[orientation],
	behindBase: true,
	// Position/scale from the tuning block above. `offsetYScene` (not offsetYVh) keeps the ship's hull
	// on the water horizon across viewport aspect ratios.
	...TUNING[orientation].ship,
});

/**
 * A swirling waterspout/tornado on the horizon. The asset is authored near the scene centre, so it's
 * pushed to either side by `offsetXVw`; the reference shows a large one to the right and a smaller,
 * fainter one to the left, so the left copy is scaled down. Drawn on top of the base scene and the
 * drifting clouds (so the funnel reads against the cloudy sky), but under the rain. `left` picks the
 * smaller left-hand copy.
 */
export const getBonusTornadoOverlay = (
	orientation: Orientation,
	left = false,
): SpineOverlayDef => {
	// Position/scale from the tuning block above. `offsetYScene` keeps the tornado's touchdown on the
	// water horizon across viewport aspect ratios. `tornadoLeft` is landscape-only; fall back to the
	// right-hand tuning if it's somehow missing.
	const place = left
		? (TUNING[orientation].tornadoLeft ?? TUNING[orientation].tornadoRight)
		: TUNING[orientation].tornadoRight;
	return {
		id: left ? 'bonus_tornado_left' : 'bonus_tornado',
		format: 'json',
		skeleton: staticAssetPath(`${TORNADO_BASE}/skeleton.json`),
		atlas: staticAssetPath(`${TORNADO_BASE}/skeleton.atlas`),
		images: {
			// The tornado atlas is TWO pages — frames 7–9 live on `skeleton_2.png`. Both must be mapped
			// or those frames of the 58-frame sequence render blank.
			'skeleton.png': staticAssetPath(`${TORNADO_BASE}/skeleton.webp`),
			'skeleton_2.png': staticAssetPath(`${TORNADO_BASE}/skeleton_2.webp`),
		},
		animation: 'animation',
		loop: true,
		skeletonScale: OVERLAY_SKELETON_SCALE,
		...place,
	};
};

/**
 * Diagonal free-game rain, drawn on top of the scene (still inside the background canvas, so always
 * behind the plinko board). `coverViewport` re-anchors it to the VIEWPORT rather than to the scene it
 * rides, so it fills the screen at every window size and keeps filling it through a resize.
 *
 * It has to be re-anchored because the scene is width-filled and bottom-anchored: on any viewport
 * taller than the aspect the scene was authored for, the scene's top edge sits below the top of the
 * screen and an overlay riding its fit transform stopped there with it — a bare strip above the rain,
 * ~15px at 1600×900 and over 200px at 4:3.
 *
 * BOTH orientations use the LANDSCAPE skeleton. It is four copies of the same 29-frame `rainFreeGame`
 * flipbook tiled 2×2 over a ~16:9 field, so covering a portrait screen scales it about as much as a
 * desktop one does and the drops come out the same size in both. The portrait-specific skeleton
 * (`spine/portrait_rain`, still on disk, no longer referenced) is two overlapping quads covering only
 * the upper sky — roughly the top half of the visible height — and covering with it meant ~2× drops.
 */
export const getBonusRainOverlay = (): SpineOverlayDef => ({
	id: 'bonus_rain',
	format: 'json',
	skeleton: staticAssetPath(`${RAIN_BASE}/skeleton.json`),
	atlas: staticAssetPath(`${RAIN_BASE}/skeleton.atlas`),
	images: {
		'skeleton.png': staticAssetPath(`${RAIN_BASE}/skeleton.webp`),
	},
	animation: 'animation',
	loop: true,
	skeletonScale: OVERLAY_SKELETON_SCALE,
	coverViewport: true,
});

/**
 * The free-game moon — a soft, dimmed moon in the upper-left sky, replacing the base scene's moon (which
 * is hidden during bonus). Positioned in plain viewport fractions and rendered behind the scene so the
 * clouds drift in front of it.
 */
export const getBonusMoonOverlay = (orientation: Orientation): SpineImageOverlayDef => ({
	id: 'bonus_moon',
	src: staticAssetPath(MOON_IMAGE),
	behindBase: true,
	// Position/size/opacity from the tuning block above.
	...TUNING[orientation].moon,
});

/**
 * Opacity of the BASE-GAME moon — full strength, unlike the free game's dimmed `moon.alpha`.
 *
 * The free game dims its moon to 50% because the storm is meant to be rolling in over it (and its
 * backdrop, cloud bank and rain all pile on top). The base game's sky is clear, so the same 50% left the
 * moon washed out against it; at 1 it reads as an actual moon while the ambient clouds still drift in
 * front. ⚠️ 1 is a hard ceiling — see the alpha note in the knob block above.
 */
const BASE_MOON_ALPHA = 1;

/**
 * The BASE-GAME moon, for a scene that doesn't draw one itself (the portrait skeleton has no moon slot,
 * so without this the base game's mobile sky is empty while the free game's has a moon).
 *
 * It is the same image at the same place and size as the free-game moon — it reads as the SAME moon,
 * the storm rolling in over it rather than a different sky — so it deliberately shares that layer's
 * tuning knobs (`TUNING[orientation].moon`) instead of copying the numbers, and the two can never drift
 * apart. Only the opacity differs (`BASE_MOON_ALPHA`). `behindBase` likewise, so the scene's ambient
 * clouds drift in front of it.
 *
 * The renderer hides this while bonus is active and shows `getBonusMoonOverlay` in its place: same
 * moon, same spot, so the hand-off is just a dimming — but running both at once would stack their
 * alphas into one over-bright disc.
 */
export const getBaseMoonOverlay = (orientation: Orientation): SpineImageOverlayDef => ({
	id: 'base_moon',
	src: staticAssetPath(MOON_IMAGE),
	behindBase: true,
	...TUNING[orientation].moon,
	alpha: BASE_MOON_ALPHA,
});

/*
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 *  TUNING KNOBS — how the bonus-mode LIGHTNING blinks. (Where each glow sits, how big and how bright
 *  it is, and how long after the beat it strikes, are the `lightning` lists in the orientation blocks
 *  above.) This shape is shared by every glow in both orientations.
 *
 *    • fadeInSeconds / holdSeconds / fadeOutSeconds — one strike: swell up, stay lit, die away.
 *    • LIGHTNING_INTERVAL_{MIN,MAX}_SECONDS — how often lightning strikes, measured strike-to-strike
 *                          and re-rolled inside the range every cycle so the storm never feels
 *                          metronomic. Raise both to make lightning rarer.
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 */
const LIGHTNING_STRIKE = {
	// The glow swells in and is then snuffed out — a long ramp up, a brief peak, a quick cut back to
	// dark. ⚠️ Don't shorten `fadeOutSeconds` much further: the background app is capped at 30fps during
	// bonus (`BONUS_BACKGROUND_MAX_FPS`), so anything under ~0.1s is only two or three drawn frames and
	// snaps off instead of fading.
	fadeInSeconds: 0.35,
	holdSeconds: 0.06,
	fadeOutSeconds: 0.32,
};
/** How long one strike lasts, start to fully dark. */
const LIGHTNING_STRIKE_SECONDS =
	LIGHTNING_STRIKE.fadeInSeconds + LIGHTNING_STRIKE.holdSeconds + LIGHTNING_STRIKE.fadeOutSeconds;

/**
 * Time from one strike to the next, re-rolled in this range after every cycle.
 *
 * These are the OBSERVED interval, not the renderer's `gap` knob — the renderer's cycle period is
 * `span + gap`, where the span covers the last glow's strike (its start delay plus the strike length).
 * `getBonusLightningOverlays` subtracts that span, so a 6-7s setting here means lightning is seen every
 * 6-7s, and the two orientations agree despite desktop's staggered pair having a longer span.
 */
const LIGHTNING_INTERVAL_MIN_SECONDS = 6;
const LIGHTNING_INTERVAL_MAX_SECONDS = 7;
/**
 * Every glow runs off ONE schedule, so a staggered set keeps its stagger for every strike instead of
 * decaying into unison as each member re-rolls its own random gap (see `ImageOverlayFlickerDef.group`).
 * Harmless for a single-glow orientation, which simply has one member on the schedule.
 */
const LIGHTNING_CYCLE_GROUP = 'bonus_lightning_pair';

/**
 * The free-game sheet lightning: soft white glows blinking in the storm clouds at the top of the
 * screen. Desktop runs a staggered left/right pair; portrait has no room for that and runs a single
 * wide glow centred on the top edge. Both are configured by the orientation's `lightning` list.
 *
 * `lightning.png` is not a bolt — it's a wide, soft elliptical glow (peak alpha ~0.5, pure white), so
 * it's drawn ADDITIVELY: over the night sky that reads as the cloud bank lighting up from within,
 * where normal alpha blending would just paste a grey haze on top.
 *
 * They belong to the distant-sky group: `behindBase` puts them UNDER the base scene, so its sky, fog
 * and foreground art (dock, flags, waterfalls) all occlude the flash instead of being washed over by
 * it — and of course the bonus clouds and rain above the scene pass in front too. They are built after
 * the moon and each `behindBase` layer inserts directly under the base spine, so they land just ABOVE
 * the moon: backdrop → moon → lightning → base scene → clouds → tornadoes → rain.
 */
export const getBonusLightningOverlays = (orientation: Orientation): SpineImageOverlayDef[] => {
	const glows = TUNING[orientation].lightning;
	// The renderer restarts the cycle every `span + gap` seconds, where the span reaches the END of the
	// last glow's strike. Subtracting it here is what makes LIGHTNING_INTERVAL_* mean the strike-to-strike
	// interval a player actually sees, for a single glow and a staggered pair alike.
	const span = Math.max(...glows.map((g) => g.delaySeconds)) + LIGHTNING_STRIKE_SECONDS;
	return glows.map(({ key, delaySeconds, ...placement }) => ({
		id: `bonus_lightning_${key}`,
		src: staticAssetPath(LIGHTNING_IMAGE),
		blendMode: 'add' as const,
		behindBase: true,
		flicker: {
			...LIGHTNING_STRIKE,
			gapMinSeconds: Math.max(0, LIGHTNING_INTERVAL_MIN_SECONDS - span),
			gapMaxSeconds: Math.max(0, LIGHTNING_INTERVAL_MAX_SECONDS - span),
			startDelaySeconds: delaySeconds,
			group: LIGHTNING_CYCLE_GROUP,
		},
		...placement,
	}));
};

/**
 * Spine overlays in z-order (earlier = further back). The ship and splashes are drawn inside the base
 * scene at `ANCHOR_SLOT` — sharing one anchor, so this array's order is what keeps the ship under
 * the splashes. The rest paint on top of the whole base scene — clouds first, then the tornadoes (so
 * the funnels read against the cloudy sky), then rain in front of everything.
 */
export const getBonusOverlays = (orientation: Orientation): SpineOverlayDef[] => [
	getBonusShipOverlay(orientation),
	getBonusSplashOverlay(orientation, false),
	getBonusSplashOverlay(orientation, true),
	getBonusCloudOverlay(),
	getBonusTornadoOverlay(orientation, false),
	// Landscape shows a second, smaller tornado on the left; portrait has only the right-hand one.
	...(orientation === 'landscape' ? [getBonusTornadoOverlay(orientation, true)] : []),
	getBonusRainOverlay(),
];

/**
 * Plain-image overlays, in z-order. Both the moon and the lightning are `behindBase`, so the base
 * scene occludes them — and because each `behindBase` layer is inserted directly under the base spine,
 * this array's order is what puts the lightning above the moon rather than below it.
 */
export const getBonusImageOverlays = (orientation: Orientation): SpineImageOverlayDef[] => [
	getBonusMoonOverlay(orientation),
	...getBonusLightningOverlays(orientation),
];
