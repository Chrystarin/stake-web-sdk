import '@esotericsoftware/spine-pixi-v8';
import {
	type Attachment,
	Physics,
	type Slot,
	Spine,
	type SkeletonData,
} from '@esotericsoftware/spine-pixi-v8';
import {
	Application,
	Assets,
	Container,
	Matrix,
	Sprite,
	type Texture,
	Ticker,
	UPDATE_PRIORITY,
} from 'pixi.js';

import { readSkeletonData } from './spineSkeletonData';
import {
	backdropAlias,
	bonusBackdropAlias,
	imageOverlayAlias,
	loadTextureAsset,
	registerSpineAsset,
	spineAliases,
	type SpineLoadable,
} from './spineAssetCache';
import { createWorldBounds, updateWorldBounds } from './spineBounds';
import {
	computeBackdropTransform,
	computeFitTransform,
	computeSpineOverlayTransform,
	spineFitConfig,
	type FitTransform,
} from './spineFit';
import type {
	ImageOverlayFlickerDef,
	SpineAssetDef,
	SpineImageOverlayDef,
	SpineOverlayDef,
} from './types';

/** Smoothstep, so the flicker ramps ease in and out instead of hitting a linear kink at each end. */
const smoothstep = (t: number) => t * t * (3 - 2 * t);

/**
 * Alpha multiplier (0..1) for a flickering image overlay `t` seconds into its strike: ramp up, hold at
 * full, ramp back down. Both ramps are smoothstepped so the glow swells and dies away rather than
 * sliding linearly — the difference between sheet lightning and a dimmer knob.
 */
const strikeEnvelope = (t: number, flicker: ImageOverlayFlickerDef): number => {
	const { fadeInSeconds, holdSeconds, fadeOutSeconds } = flicker;
	if (t < fadeInSeconds) return fadeInSeconds > 0 ? smoothstep(t / fadeInSeconds) : 1;
	const held = t - fadeInSeconds;
	if (held < holdSeconds) return 1;
	const out = held - holdSeconds;
	return fadeOutSeconds > 0 ? smoothstep(Math.max(0, 1 - out / fadeOutSeconds)) : 0;
};

/**
 * A window of the base animation's own timeline to hold inside, ping-ponging between the two ends.
 * See {@link SpineBackgroundRenderer.setAnimationHold}.
 */
export type AnimationHold = {
	/** Timeline point the swell rests at (seconds). */
	fromSeconds: number;
	/** Timeline point it swells to. Equal to `fromSeconds` for a plain freeze. */
	toSeconds: number;
	/** Seconds for one full out-and-back cycle. */
	periodSeconds: number;
};

const applySpineFit = (
	spine: Spine,
	width: number,
	height: number,
	bounds: ReturnType<typeof createWorldBounds>,
	config: ReturnType<typeof spineFitConfig>,
	backdropTransform?: ReturnType<typeof computeBackdropTransform>,
	backdropDef?: NonNullable<SpineAssetDef['backdrop']>,
	backdropTexture?: Texture,
): FitTransform => {
	const transform =
		backdropTransform && backdropDef && backdropTexture
			? computeSpineOverlayTransform(
					width,
					height,
					bounds,
					backdropTransform,
					backdropTexture,
					config,
					backdropDef,
				)
			: computeFitTransform(width, height, bounds, config);

	spine.scale.set(transform.scale);
	spine.position.set(transform.x, transform.y);
	return transform;
};

const applyBackdropFit = (
	backdrop: Sprite,
	width: number,
	height: number,
	backdropDef: NonNullable<SpineAssetDef['backdrop']>,
) => {
	const texture = backdrop.texture;
	const { scale, x, y } = computeBackdropTransform(width, height, texture, backdropDef);
	backdrop.anchor.set(0.5, 1);
	backdrop.scale.set(scale);
	backdrop.position.set(x, y);
};

export class SpineBackgroundRenderer {
	/** Frame-rate cap applied to this (background) app while the bonus round is active, to leave the
	 * separate ball-rendering app enough main-thread + GPU budget to stay smooth. See `applyBonusFrameRate`. */
	private static readonly BONUS_BACKGROUND_MAX_FPS = 30;
	/** Frame-rate cap applied while a full-screen overlay completely hides this canvas. See
	 * `setHiddenByOverlay`. Low, but non-zero, so state changes made behind the cover still settle.
	 * 10 is the floor Pixi will honour anyway — its `maxFPS` setter clamps to `max(minFPS, fps)`, and
	 * `minFPS` is 10 by default — so asking for less would silently land here regardless. */
	private static readonly OVERLAY_HIDDEN_MAX_FPS = 10;
	private hostElement: HTMLElement;
	private app?: Application;
	private spine?: Spine;
	private backdrop?: Sprite;
	private currentAsset?: SpineAssetDef;
	private skeletonDataCache = new Map<string, SkeletonData>();
	private fitBounds = createWorldBounds();
	private resizeObserver?: ResizeObserver;
	private fitFrameId = 0;
	/** Pixi Assets cache keys this renderer registered, for optional release on destroy. */
	private loadedAssetKeys = new Set<string>();
	/** Bonus-mode (free game) layers: overlay spines + the swapped backdrop, loaded lazily.
	 * `cycle` is present when the overlay plays on a duty cycle (see `SpineOverlayDef.cycleGapSeconds`). */
	private overlays: {
		def: SpineOverlayDef;
		spine: Spine;
		cycle?: {
			duration: number;
			/** Offset from the group's period start at which THIS overlay plays. */
			startDelay: number;
			/** Key into `bonusCycleGroups` — the schedule this overlay plays on. */
			group: string;
		};
	}[] = [];
	/**
	 * Duty-cycle schedules, keyed by `SpineOverlayDef.cycleGroup`. Kept per GROUP rather than per
	 * overlay so a staggered pair keeps its stagger: members share one period and one gap roll, so the
	 * offset between them never drifts (see `SpineOverlayDef.cycleGroup`).
	 */
	private bonusCycleGroups = new Map<
		string,
		{
			/** Period start on the bonus clock (s); advances one period at a time. */
			cycleStart: number;
			/** Group start → last member finishing, i.e. max(startDelay + duration) over members. */
			span: number;
			/** Gap re-rolled uniformly in [gapMin, gapMax] after each period (equal ⇒ fixed gap). */
			gapMin: number;
			gapMax: number;
			currentGap: number;
		}
	>();
	/** Bonus-mode plain-image layers (e.g. the free-game moon), positioned in viewport fractions.
	 * `cycle` is present when the layer blinks (see `SpineImageOverlayDef.flicker`). */
	private imageOverlays: {
		def: SpineImageOverlayDef;
		sprite: Sprite;
		cycle?: {
			/** Length of one strike: fade in + hold + fade out. */
			duration: number;
			/** Offset from the group's period start at which THIS layer strikes. */
			startDelay: number;
			/** Key into `bonusCycleGroups` — the schedule this layer blinks on. */
			group: string;
		};
	}[] = [];
	/**
	 * BASE-GAME plain-image layers (the portrait moon), positioned in viewport fractions like the bonus
	 * ones. Loaded with the base asset rather than lazily — they are part of the scene the player sees
	 * first — and hidden while bonus mode is active, where `imageOverlays` paints its own copy.
	 */
	private baseImageOverlays: { def: SpineImageOverlayDef; sprite: Sprite }[] = [];
	/** Wrapper container per `SpineOverlayDef.baseSlot`, attached into the base skeleton's draw order. */
	private slotAnchors = new Map<string, Container>();
	/** `baseSlot` → `baseSlotAfter`: where each anchor slot is moved to while bonus mode is active. */
	private slotAnchorOrder = new Map<string, string>();
	/** Shared clock (seconds) driving the splash duty cycles, advanced from the Pixi ticker. */
	private bonusElapsed = 0;
	private bonusTick?: () => void;
	/** Active animation hold (see `setAnimationHold`) and its own clock, in seconds. */
	private hold?: AnimationHold;
	private holdElapsed = 0;
	private holdTick?: () => void;
	private baseBackdropTexture?: Texture;
	private bonusBackdropTexture?: Texture;
	private bonusActive = false;
	/** True while a full-screen congratulations screen completely hides this canvas — see `setHiddenByOverlay`. */
	private hiddenByOverlay = false;
	/** Latched once the lazy bonus-asset load starts; awaited by `setBonusMode`. */
	private bonusAssetsPromise?: Promise<void>;
	/** Setup attachment object for each `bonusHiddenSlots` slot, so it can be restored on exit. Stored
	 * as the object and reassigned onto the slot's pose directly (see `applyHiddenSlots`): spine 4.3
	 * keeps the live attachment on `slot.pose`/`appliedPose`, not on the legacy `slot.attachment`. */
	private hiddenSlotSetup = new Map<string, Attachment | null>();
	/** Saved `Ticker.shared._maxElapsedMS` when this renderer clamped it (intro splash only), restored on destroy. */
	private sharedTickerRestore?: { maxElapsedMS: number };

	constructor(hostElement: HTMLElement) {
		this.hostElement = hostElement;
	}

	async init(asset: SpineAssetDef): Promise<void> {
		await this.waitForHostSize();

		if (!this.app) {
			const app = new Application();
			await app.init({
				resizeTo: this.hostElement,
				backgroundAlpha: 0,
				antialias: true,
				autoDensity: true,
				// Cap at 2, matching every other Pixi app in the game (PlinkoEngine's
				// MAX_RENDER_RESOLUTION, both meters, the coin fountain, the balance glow). This was the
				// last renderer still taking the raw `devicePixelRatio`, and it is the FULL-VIEWPORT one,
				// so it dominated fill rate on phones: measured at 414x896 DPR 3 its backing store was
				// 1242x2688 = 3.34 MP, against 1.48 MP for the equally full-screen overlays beside it —
				// 48% of every canvas pixel in the game, redrawn 60 times a second. Capping halves it.
				//
				// Devices at DPR <= 2 (all desktops, Retina Macs) are completely unaffected; only phones,
				// which is exactly where the frame budget is tightest. Safe visually because the scene is
				// a soft painterly backdrop with no text or hairlines, and it now simply matches the
				// sharpness of the board and balls drawn on top of it rather than exceeding them.
				resolution: Math.min(2, window.devicePixelRatio || 1),
				preference: 'webgl',
			});

			this.hostElement.appendChild(app.canvas);
			// Pixi leaves the canvas `display: inline`, which adds a baseline gap; match the game
			// background's block canvas so the splash fills its host exactly.
			app.canvas.style.display = 'block';
			this.app = app;

			// Clamp per-frame catch-up so a stall (atlas GPU upload, the game booting behind the splash)
			// pauses-and-resumes the animation instead of skipping ahead. Spine's `autoUpdate` advances
			// off the GLOBAL `Ticker.shared` (not this app's ticker), reading its clamped `deltaMS`, so the
			// clamp lives there. `_maxElapsedMS` is the max ms the ticker reports per tick (default 100 ⇒ a
			// stalled frame jumps the logo ~100ms = a visible skip); set it to one 60fps frame (16.7ms).
			// We poke the field directly rather than via `Ticker.minFPS`, whose setter does
			// `min(maxFPS, fps)` — with the default maxFPS of 0 that collapses to `Infinity`, and the same
			// quirk makes the value un-restorable through the API (the default 100 is a raw field init, not
			// settable). Saved + restored on destroy so the clamp only spans the splash; the only thing on
			// the shared ticker meanwhile is spine autoUpdate (the intro logo + spines booting behind it).
			if (asset.catchUpMinFps != null) {
				const shared = Ticker.shared as unknown as { _maxElapsedMS: number };
				this.sharedTickerRestore = { maxElapsedMS: shared._maxElapsedMS };
				shared._maxElapsedMS = 1000 / asset.catchUpMinFps;
			}

			this.resizeObserver = new ResizeObserver(() => this.scheduleFitSpine());
			this.resizeObserver.observe(this.hostElement);
		}

		await this.loadAsset(asset);

		if (!this.app || !this.spine) {
			throw new Error('[SpineBackgroundRenderer] spine layer was not created');
		}
	}

	private waitForHostSize(): Promise<void> {
		const host = this.hostElement;
		if (host.clientWidth > 0 && host.clientHeight > 0) {
			return Promise.resolve();
		}

		return new Promise((resolve) => {
			const observer = new ResizeObserver(([entry]) => {
				const { width, height } = entry.contentRect;
				if (width <= 0 || height <= 0) return;
				observer.disconnect();
				resolve();
			});
			observer.observe(host);
		});
	}

	/**
	 * Manually advance the spine animation and paint one frame. Used by the intro splash to keep
	 * rendering when `requestAnimationFrame` is throttled (e.g. a backgrounded/streamed tab), where
	 * Pixi's shared ticker — and therefore `autoUpdate` — stalls. Safe no-op before init.
	 */
	advanceFrame(deltaSeconds: number): void {
		if (!this.app || !this.spine) return;
		// A hold owns `trackTime` outright (the state's own clock is stopped), so it must be stepped
		// here too — `spine.update` alone would just re-apply the same frame forever.
		this.advanceHold(deltaSeconds);
		this.spine.update(deltaSeconds);
		this.app.render();
	}

	/**
	 * Hold the base animation inside a window of its OWN timeline, ping-ponging between the two ends,
	 * instead of letting it play on. `undefined` releases it to continue from wherever the hold left it.
	 *
	 * The intro splash uses this to keep the logo alive while the asset preload runs: a dead-frozen
	 * frame reads as a hang, whereas a slow swell reads as "working". Because the motion is seeked out
	 * of the authored animation rather than synthesized on the display object, it uses the artist's own
	 * curve and amplitude and cannot fight the fit transform — set `fromSeconds === toSeconds` for a
	 * plain freeze.
	 *
	 * While held, the animation state's clock is stopped (`timeScale = 0`) and `trackTime` is driven by
	 * hand, so nothing else can advance it underneath us.
	 */
	setAnimationHold(hold: AnimationHold | undefined): void {
		const app = this.app;
		const spine = this.spine;
		if (!app || !spine) return;

		if (this.holdTick) {
			Ticker.shared.remove(this.holdTick);
			this.holdTick = undefined;
		}
		this.hold = hold;

		if (!hold) {
			spine.state.timeScale = 1;
			return;
		}

		spine.state.timeScale = 0;
		// Start the phase where the animation ALREADY is, by inverting the raised cosine over the rising
		// half. Engaging the hold at the top of the window (which is what the splash does) would otherwise
		// snap trackTime back to `fromSeconds` on the very first frame — a visible pop into the pulse.
		const span = hold.toSeconds - hold.fromSeconds;
		const current = spine.state.getTrack(0)?.trackTime ?? hold.fromSeconds;
		const progress = span > 0 ? Math.min(1, Math.max(0, (current - hold.fromSeconds) / span)) : 0;
		this.holdElapsed = (Math.acos(1 - 2 * progress) / (Math.PI * 2)) * hold.periodSeconds;

		const tick = () => {
			try {
				this.advanceHold(Ticker.shared.deltaMS / 1000);
			} catch (error) {
				// An exception escaping a ticker listener aborts Pixi's rAF loop, which would freeze the
				// whole canvas. Detach and leave the logo on its last frame instead.
				console.error('[SpineBackgroundRenderer] animation hold failed; freezing instead', error);
				Ticker.shared.remove(tick);
				this.holdTick = undefined;
			}
		};
		this.holdTick = tick;
		// ⚠️ `Ticker.shared`, NOT `app.ticker`, and at a priority above spine's own update. Spine drives
		// `autoUpdate` off the SHARED ticker (`Ticker.shared.add(this.internalUpdate)`), while this app was
		// created without `sharedTicker` — so `app.ticker` is a second, independent rAF loop. Driving the
		// pulse from it meant (a) no ordering guarantee, so some frames applied a stale `trackTime` and
		// others skipped one, and (b) a mismatched clock: `app.ticker` keeps Pixi's default 100 ms
		// catch-up cap while the shared ticker is clamped to 16.7 ms by `catchUpMinFps`, so every stall
		// leapt the phase ~6x further than the render actually advanced. Both read as judder.
		Ticker.shared.add(tick, undefined, UPDATE_PRIORITY.HIGH);
	}

	/**
	 * Step the ping-pong. Split out of the ticker callback so {@link advanceFrame} can drive it too:
	 * while the tab is hidden the app ticker is not running, and the splash hand-drives frames from a
	 * timer instead — without this the pulse would stall there while the canvas kept repainting.
	 */
	private advanceHold(deltaSeconds: number): void {
		const hold = this.hold;
		const entry = this.spine?.state.getTrack(0);
		if (!hold || !entry) return;

		this.holdElapsed += deltaSeconds;
		const span = hold.toSeconds - hold.fromSeconds;
		if (span <= 0 || hold.periodSeconds <= 0) {
			entry.trackTime = hold.fromSeconds;
			return;
		}
		// Raised cosine: 0 at both ends of the cycle, 1 in the middle. Unlike a triangle wave it has
		// zero velocity at the turns, so the swell eases in and out instead of visibly ticking over.
		const phase = (this.holdElapsed % hold.periodSeconds) / hold.periodSeconds;
		entry.trackTime = hold.fromSeconds + span * ((1 - Math.cos(phase * Math.PI * 2)) / 2);
	}

	/**
	 * Seconds into the base animation, read off the spine's own track rather than a wall clock — the
	 * two diverge, deliberately, whenever `catchUpMinFps` clamps a stalled frame's catch-up (the whole
	 * point of that clamp is that a stall makes the animation lag real time instead of skipping).
	 *
	 * Keeps counting past the animation's own length: spine leaves a finished non-looping entry on the
	 * track with `trackEnd = MAX_VALUE`, so this can be compared against the authored duration to tell
	 * when the logo has played out. `Infinity` if the track has been cleared, `0` before init.
	 */
	getAnimationTime(): number {
		if (!this.spine) return 0;
		return this.spine.state.getTrack(0)?.trackTime ?? Number.POSITIVE_INFINITY;
	}

	/**
	 * @param options.releaseAssets Unload this renderer's textures from the global Pixi `Assets`
	 *   cache. Long-lived background renderers leave this off (assets are reused); short-lived
	 *   renderers like the intro splash MUST set it, otherwise their atlas pages (tens of MB of
	 *   GPU memory) linger for the whole session and starve the game's ball renderer.
	 */
	destroy(options?: { releaseAssets?: boolean }): void {
		if (this.sharedTickerRestore) {
			(Ticker.shared as unknown as { _maxElapsedMS: number })._maxElapsedMS =
				this.sharedTickerRestore.maxElapsedMS;
			this.sharedTickerRestore = undefined;
		}
		cancelAnimationFrame(this.fitFrameId);
		this.resizeObserver?.disconnect();
		this.resizeObserver = undefined;
		if (this.bonusTick) {
			this.app?.ticker.remove(this.bonusTick);
			this.bonusTick = undefined;
		}
		if (this.holdTick) {
			// Registered on the SHARED ticker (see `setAnimationHold`), which outlives this app — leaving
			// it attached would keep a destroyed renderer's callback running for the rest of the session.
			Ticker.shared.remove(this.holdTick);
			this.holdTick = undefined;
		}
		this.hold = undefined;
		this.holdElapsed = 0;
		this.bonusElapsed = 0;
		this.overlays.forEach(({ spine }) => spine.destroy({ children: true }));
		this.overlays = [];
		// The wrappers themselves are children of the base spine, destroyed with it below.
		this.slotAnchors.clear();
		this.slotAnchorOrder.clear();
		this.bonusCycleGroups.clear();
		this.imageOverlays.forEach(({ sprite }) => sprite.destroy());
		this.imageOverlays = [];
		this.baseImageOverlays.forEach(({ sprite }) => sprite.destroy());
		this.baseImageOverlays = [];
		this.backdrop?.destroy();
		this.backdrop = undefined;
		this.spine?.destroy({ children: true });
		this.spine = undefined;
		this.app?.destroy(true, { children: true });
		this.app = undefined;
		this.currentAsset = undefined;
		this.baseBackdropTexture = undefined;
		this.bonusBackdropTexture = undefined;
		this.bonusActive = false;
		this.bonusAssetsPromise = undefined;
		this.hiddenSlotSetup.clear();

		if (options?.releaseAssets) {
			this.releaseLoadedAssets();
		}
	}

	private releaseLoadedAssets(): void {
		const keys = [...this.loadedAssetKeys];
		this.loadedAssetKeys.clear();
		this.skeletonDataCache.clear();
		// Fire-and-forget: unload frees the texture sources from the shared cache + GPU.
		void Promise.allSettled(keys.map((key) => Assets.unload(key))).catch(() => {});
	}

	private async loadSkeletonData(asset: SpineLoadable): Promise<SkeletonData> {
		const cacheKey = `${asset.atlas}|${asset.skeleton}|${asset.skeletonScale ?? 1}`;
		const cached = this.skeletonDataCache.get(cacheKey);
		if (cached) return cached;

		// Registered through the shared cache so the aliases are added to Pixi's global resolver exactly
		// once, no matter how many renderers mount this def or whether the intro loader already
		// preloaded it — a repeat `Assets.add` logs a "[Resolver] already has key … overwriting" warning.
		const { atlasAlias, skeletonAlias } = registerSpineAsset(asset);

		this.loadedAssetKeys.add(atlasAlias);
		this.loadedAssetKeys.add(skeletonAlias);
		// NOTE: do NOT track the atlas page image URLs (skeleton.png, skeleton2.png, …) here.
		// The spine atlas loader loads pages via its own low-level `loader.load()` and stores them
		// inside the TextureAtlas — they are never registered as `Assets` cache entries under their
		// URLs. They are freed when the atlas ALIAS is unloaded (Assets.unload → atlas loader
		// unload() → TextureAtlas.dispose() → SpineTexture.dispose() → texture.destroy()). Adding the
		// page URLs made `releaseLoadedAssets()` call `Assets.unload(<pageUrl>)` on ids that aren't in
		// the cache, which logs a noisy "Asset id … was not found in the Cache" warning and no-ops.

		await Assets.load([atlasAlias, skeletonAlias]);

		const atlas = Assets.get(atlasAlias);
		const skeletonSource = Assets.get(skeletonAlias);

		if (!atlas || !skeletonSource) {
			throw new Error(
				`[SpineBackgroundRenderer] missing spine assets (atlas: ${Boolean(atlas)}, skeleton: ${Boolean(skeletonSource)})`,
			);
		}

		const skeletonData = readSkeletonData(asset, atlas, skeletonSource);
		this.skeletonDataCache.set(cacheKey, skeletonData);
		return skeletonData;
	}

	private async loadBackdrop(asset: SpineAssetDef): Promise<Sprite | undefined> {
		const backdropDef = asset.backdrop;
		if (!backdropDef) return undefined;

		const alias = backdropAlias(asset.id);
		this.loadedAssetKeys.add(alias);
		const texture = await loadTextureAsset(alias, backdropDef.src);
		this.baseBackdropTexture = texture;
		return Sprite.from(texture);
	}

	/**
	 * Load the base-game image layers (`SpineAssetDef.imageOverlays`) with the rest of the base asset, so
	 * they appear with the scene instead of popping in later. The sprites come back hidden; `loadAsset`
	 * places them on the stage and reveals them.
	 */
	private async loadBaseImageOverlays(
		asset: SpineAssetDef,
	): Promise<{ def: SpineImageOverlayDef; sprite: Sprite }[]> {
		return Promise.all(
			(asset.imageOverlays ?? []).map(async (def) => ({
				def,
				sprite: await this.loadImageOverlaySprite(def),
			})),
		);
	}

	private captureFitBounds(spine: Spine, asset: SpineAssetDef): void {
		spine.skeleton.setupPose();
		spine.state.apply(spine.skeleton);
		spine.skeleton.updateWorldTransform(Physics.update);
		updateWorldBounds(spine.skeleton, asset, this.fitBounds);
	}

	private async loadAsset(asset: SpineAssetDef): Promise<void> {
		const app = this.app;
		if (!app) {
			throw new Error('[SpineBackgroundRenderer] pixi application missing');
		}

		const [skeletonData, backdrop, baseImageOverlays] = await Promise.all([
			this.loadSkeletonData(asset),
			this.loadBackdrop(asset),
			this.loadBaseImageOverlays(asset),
		]);

		this.spine?.destroy({ children: true });
		this.backdrop?.destroy();
		this.baseImageOverlays.forEach(({ sprite }) => sprite.destroy());

		const spine = new Spine({
			skeletonData,
			autoUpdate: true,
		});
		spine.state.data.defaultMix = 0.2;
		spine.state.setAnimation(0, asset.animation, asset.loop ?? true);

		app.stage.removeChildren();

		if (backdrop) {
			app.stage.addChild(backdrop);
		}
		app.stage.addChild(spine);

		// Base-game image layers straddle the base spine in array order: `behindBase` ones are inserted
		// directly under it (so the scene's own art occludes them — the moon sits in the sky, with the
		// ambient clouds drifting across it), the rest go on top. They stay off while bonus is active,
		// which paints its own copy; `setBonusMode` owns the flag from here on.
		baseImageOverlays.forEach(({ def, sprite }) => {
			if (def.behindBase) app.stage.addChildAt(sprite, app.stage.getChildIndex(spine));
			else app.stage.addChild(sprite);
			sprite.visible = !this.bonusActive;
		});

		this.backdrop = backdrop;
		this.baseImageOverlays = baseImageOverlays;
		this.spine = spine;
		this.currentAsset = asset;

		this.captureSetupAttachments(spine, asset);
		this.captureFitBounds(spine, asset);
		this.fitSpine();

		// Warm the bonus layers (FREEGAME backdrop + FG_CLOUD/FG_SPLASH overlays) in the background so
		// entering the bonus round doesn't stutter on a first-time load. Fire-and-forget; failures are
		// swallowed and simply mean the bonus overlays are absent (base scene still renders).
		if (this.hasBonusAssets(asset)) {
			void this.ensureBonusAssets().catch(() => {});
		}
	}

	/** Remember each `bonusHiddenSlots` slot's setup attachment (the object) so it can be restored on
	 * exit. Read from the live pose after construction; the cloud slots have no attachment timeline, so
	 * this stays the correct attachment for the session. */
	private captureSetupAttachments(spine: Spine, asset: SpineAssetDef): void {
		this.hiddenSlotSetup.clear();
		for (const slotName of asset.bonusHiddenSlots ?? []) {
			const slot = spine.skeleton.findSlot(slotName);
			this.hiddenSlotSetup.set(slotName, slot?.pose.attachment ?? null);
		}
	}

	private hasBonusAssets(asset: SpineAssetDef): boolean {
		return Boolean(
			asset.bonusBackdropSrc ||
				asset.bonusOverlays?.length ||
				asset.bonusImageOverlays?.length,
		);
	}

	/** Idempotent lazy load of the bonus backdrop texture + overlay spines (hidden until activated). */
	private ensureBonusAssets(): Promise<void> {
		if (!this.bonusAssetsPromise) {
			this.bonusAssetsPromise = this.loadBonusAssets();
		}
		return this.bonusAssetsPromise;
	}

	private async loadBonusAssets(): Promise<void> {
		const app = this.app;
		const asset = this.currentAsset;
		if (!app || !asset) return;

		const backdropPromise = asset.bonusBackdropSrc
			? this.loadBonusBackdropTexture(asset.id, asset.bonusBackdropSrc)
			: Promise.resolve(undefined);

		const overlayDefs = asset.bonusOverlays ?? [];
		const overlaysPromise = Promise.all(
			overlayDefs.map(async (def) => {
				const skeletonData = await this.loadSkeletonData(def);
				const spine = new Spine({ skeletonData, autoUpdate: true });
				spine.state.data.defaultMix = 0.2;
				const isCycled = def.cycleGapMinSeconds != null || def.cycleGapSeconds != null;
				// Cycled overlays stay on a looping track (so the entry never completes/clears) but have
				// their `trackTime` driven by hand from the ticker — see `advanceBonusCycles`.
				spine.state.setAnimation(0, def.animation, isCycled || (def.loop ?? true));
				spine.visible = false;
				spine.autoUpdate = false;

				let cycle: (typeof this.overlays)[number]['cycle'];
				if (isCycled) {
					const duration = skeletonData.findAnimation(def.animation)?.duration ?? 0;
					if (duration > 0) {
						// Randomized gap wins when a min/max pair is given; otherwise fall back to the fixed gap.
						const gapMin = def.cycleGapMinSeconds ?? def.cycleGapSeconds ?? 0;
						const gapMax = def.cycleGapMaxSeconds ?? def.cycleGapSeconds ?? gapMin;
						const startDelay = def.cycleStartDelaySeconds ?? 0;
						// Overlays without an explicit group get a private one, so they behave as before.
						const group = def.cycleGroup ?? def.id;
						cycle = { duration, startDelay, group };
						this.registerBonusCycleGroup(group, startDelay + duration, gapMin, gapMax);
					}
				}
				return { def, spine, cycle };
			}),
		);

		const imageDefs = asset.bonusImageOverlays ?? [];
		const imagesPromise = Promise.all(
			imageDefs.map(async (def) => {
				const sprite = await this.loadImageOverlaySprite(def);

				let cycle: (typeof this.imageOverlays)[number]['cycle'];
				const flicker = def.flicker;
				if (flicker) {
					const duration =
						flicker.fadeInSeconds + flicker.holdSeconds + flicker.fadeOutSeconds;
					if (duration > 0) {
						const startDelay = flicker.startDelaySeconds ?? 0;
						const group = flicker.group ?? def.id;
						cycle = { duration, startDelay, group };
						this.registerBonusCycleGroup(
							group,
							startDelay + duration,
							flicker.gapMinSeconds,
							flicker.gapMaxSeconds,
						);
					}
				}
				return { def, sprite, cycle };
			}),
		);

		const [bonusTexture, overlays, imageOverlays] = await Promise.all([
			backdropPromise,
			overlaysPromise,
			imagesPromise,
		]);
		if (bonusTexture) this.bonusBackdropTexture = bonusTexture;

		// The renderer may have been torn down (destroy) while these loaded — bail so we don't attach
		// orphan children to a destroyed stage.
		if (!this.app || !this.spine) {
			overlays.forEach(({ spine }) => spine.destroy({ children: true }));
			imageOverlays.forEach(({ sprite }) => sprite.destroy());
			return;
		}

		const baseSpine = this.spine;

		// `behindBase` layers are inserted at the base spine's index, so each new one lands directly under
		// the base spine (and above the previously inserted behind-layer). Spine overlays are appended, so
		// each lands above the last. `baseSlot` layers go INSIDE the base skeleton's draw order instead.
		// The bonus asset arrays are ordered so the stack reads, bottom→top:
		// backdrop → moon → lightning → [base scene … sea → ship → splashes → waterfall/dock/fog] → clouds
		// → tornadoes → rain.

		const addBehindBase = (child: Parameters<typeof app.stage.addChild>[0]) =>
			app.stage.addChildAt(child, app.stage.getChildIndex(baseSpine));

		// On-top image overlays are inserted directly ABOVE the base spine rather than appended, so they
		// stay UNDER every spine overlay added below — that's what puts the lightning glow behind the
		// drifting clouds. `aboveBaseCount` keeps the group's own order (and the base spine's index moves
		// as `addBehindBase` inserts under it, hence the lookup per call).
		let aboveBaseCount = 0;
		const addAboveBase = (child: Parameters<typeof app.stage.addChild>[0]) => {
			app.stage.addChildAt(child, app.stage.getChildIndex(baseSpine) + 1 + aboveBaseCount);
			aboveBaseCount += 1;
		};

		// Image overlays first, so a `behindBase` image (the moon) sits beneath the spine overlays.
		imageOverlays.forEach(({ def, sprite }) => {
			if (def.behindBase) addBehindBase(sprite);
			else addAboveBase(sprite);
		});

		// Overlays anchored into the base skeleton (`baseSlot`) share one wrapper container per slot, in
		// bonus-overlay order, so their relative z-order survives the move (ship under splashes).
		const anchors = new Map<string, Container>();

		// Most overlays paint on top of the base spine (topmost background layer, still behind the game
		// board which is a separate canvas above this one). `behindBase` ones are inserted UNDER the base
		// spine so the waterfalls/dock occlude them for depth.
		overlays.forEach(({ def, spine }) => {
			if (def.baseSlot && baseSpine.skeleton.findSlot(def.baseSlot)) {
				let wrapper = anchors.get(def.baseSlot);
				if (!wrapper) {
					wrapper = new Container();
					anchors.set(def.baseSlot, wrapper);
				}
				wrapper.addChild(spine);
				if (def.baseSlotAfter) this.slotAnchorOrder.set(def.baseSlot, def.baseSlotAfter);
				return;
			}
			if (def.baseSlot) {
				console.warn(
					`[SpineBackgroundRenderer] base slot "${def.baseSlot}" not in the skeleton; ` +
						`falling back to ${def.behindBase ? 'behind' : 'above'} the base scene for ${def.id}`,
				);
			}
			if (def.behindBase) addBehindBase(spine);
			else app.stage.addChild(spine);
		});

		for (const [slotName, wrapper] of anchors) {
			// `addSlotObject` reparents the wrapper onto the base spine and draws it at that slot's place
			// in the skeleton's draw order. `applyOverlayFit` then undoes the slot bone's transform.
			baseSpine.addSlotObject(slotName, wrapper);
			this.slotAnchors.set(slotName, wrapper);
		}

		this.overlays = overlays;
		this.imageOverlays = imageOverlays;
		this.startBonusTicker();
		this.fitSpine();
		this.warmBonusTexturesToGpu(overlayDefs, imageOverlays);
	}

	/**
	 * Push the bonus-mode textures onto the GPU while the player is still in the base game.
	 *
	 * Loading an asset only gets it as far as a decoded bitmap in CPU memory — Pixi defers the actual
	 * `texImage2D` upload until a texture is first DRAWN. Every bonus layer is drawn for the first time
	 * on the same frame the bonus round opens, so all of it uploaded at once and the entry visibly
	 * hitched (measured: 6 uploads, ~1.2s total, dominated by the two 1977×2032 FG_SPLASH atlas pages
	 * and the 2879×1620 FREEGAME backdrop; nothing uploads during play or on exit).
	 *
	 * Uploads are done ONE PER IDLE CALLBACK rather than in a single pass: the work is the same, but
	 * spread over idle time it never forms one long task, so it can't trade a bonus-entry hitch for a
	 * base-game one. GPU textures are per-WebGL-context, so this must run on THIS renderer — the one
	 * that draws these layers.
	 */
	private warmBonusTexturesToGpu(
		overlayDefs: readonly SpineOverlayDef[],
		imageOverlays: { sprite: Sprite }[],
	): void {
		const textureSystem = (
			this.app?.renderer as { texture?: { initSource?: (source: unknown) => void } } | undefined
		)?.texture;
		// WebGPU exposes a different texture system; skip rather than guess (we request `webgl` above).
		if (typeof textureSystem?.initSource !== 'function') return;
		const upload = textureSystem.initSource.bind(textureSystem);

		const sources = new Set<unknown>();
		const addTexture = (texture: Texture | undefined) => {
			if (texture?.source) sources.add(texture.source);
		};

		addTexture(this.bonusBackdropTexture);
		imageOverlays.forEach(({ sprite }) => addTexture(sprite.texture));
		for (const def of overlayDefs) {
			// Atlas pages are not registered as `Assets` entries under their own URLs (see
			// `loadSkeletonData`) — they live on the TextureAtlas the alias resolves to.
			const atlas = Assets.get(spineAliases(def).atlasAlias) as
				| { pages?: { texture?: { texture?: Texture } }[] }
				| undefined;
			atlas?.pages?.forEach((page) => addTexture(page.texture?.texture));
		}

		const queue = [...sources];
		const schedule =
			typeof requestIdleCallback === 'function'
				? (fn: () => void) => requestIdleCallback(() => fn(), { timeout: 2000 })
				: (fn: () => void) => window.setTimeout(fn, 0);

		const uploadNext = () => {
			// Bail if the renderer was torn down (or the context lost) between callbacks.
			if (!this.app) return;
			const source = queue.shift();
			if (!source) return;
			try {
				upload(source);
			} catch {
				/* best-effort — a failed warm-up just means this texture uploads on first draw */
			}
			if (queue.length) schedule(uploadNext);
		};
		if (queue.length) schedule(uploadNext);
	}

	/**
	 * Register (or widen) a duty-cycle schedule. Shared by the spine overlays and the flickering image
	 * overlays, so a `cycleGroup` may mix both. The group's period must cover its LAST member's play
	 * (`memberEnd` = that member's `startDelay + duration`), else a member whose delay runs past the
	 * period start would be cut off by the next period.
	 */
	private registerBonusCycleGroup(
		group: string,
		memberEnd: number,
		gapMin: number,
		gapMax: number,
	): void {
		const existing = this.bonusCycleGroups.get(group);
		this.bonusCycleGroups.set(group, {
			cycleStart: 0,
			span: Math.max(existing?.span ?? 0, memberEnd),
			gapMin,
			gapMax,
			currentGap: existing?.currentGap ?? gapMin + Math.random() * (gapMax - gapMin),
		});
	}

	/** Load an image-overlay texture and build its sprite (hidden, centre-anchored) until activated. */
	private async loadImageOverlaySprite(def: SpineImageOverlayDef): Promise<Sprite> {
		const alias = imageOverlayAlias(def.id);
		this.loadedAssetKeys.add(alias);
		const texture = await loadTextureAsset(alias, def.src);
		const sprite = Sprite.from(texture);
		sprite.anchor.set(0.5);
		// A flickering layer starts dark; the ticker ramps it up to `alpha` on its first strike.
		sprite.alpha = def.flicker ? 0 : (def.alpha ?? 1);
		if (def.blendMode) sprite.blendMode = def.blendMode;
		sprite.visible = false;
		return sprite;
	}

	/**
	 * Drives the splash + lightning duty cycles off the Pixi ticker, so they're frame-rate independent
	 * and pause with the app. (The rain/tornado/cloud overlays self-animate via `autoUpdate`.)
	 */
	private startBonusTicker(): void {
		const app = this.app;
		if (!app || this.bonusTick) return;

		const tick = () => {
			if (!this.bonusActive) return;
			try {
				this.bonusElapsed += app.ticker.deltaMS / 1000;
				this.advanceBonusCycles();
			} catch (error) {
				// An exception escaping a ticker listener aborts Pixi's rAF loop, which silently freezes
				// the ENTIRE background (no repaint at all). Detach instead so the base scene keeps running.
				console.error('[SpineBackgroundRenderer] bonus tick failed; disabling duty cycles', error);
				app.ticker.remove(tick);
				this.bonusTick = undefined;
			}
		};
		this.bonusTick = tick;
		app.ticker.add(tick);
	}

	/**
	 * Duty-cycled layers (the two splashes, the two lightning glows) play once, then hide for `gap`
	 * seconds before replaying. Members of a `cycleGroup` share one period, each playing at its own
	 * `startDelay` into it — so the left splash always leads the right by exactly that offset, every
	 * burst, rather than the two drifting into each other over time.
	 */
	private advanceBonusCycles(): void {
		// Advance each group one period at a time, re-rolling the gap after each so replays aren't
		// metronomic. A `while` (not `if`) catches up if the ticker dropped several periods' worth of
		// frames at once.
		for (const group of this.bonusCycleGroups.values()) {
			while (this.bonusElapsed >= group.cycleStart + group.span + group.currentGap) {
				group.cycleStart += group.span + group.currentGap;
				group.currentGap = group.gapMin + Math.random() * (group.gapMax - group.gapMin);
			}
		}

		for (const { spine, cycle } of this.overlays) {
			if (!cycle) continue;
			const group = this.bonusCycleGroups.get(cycle.group);
			if (!group) continue;

			const t = this.bonusElapsed - (group.cycleStart + cycle.startDelay);
			// Before this member's turn in the period, or after its play, stay hidden.
			const playing = t >= 0 && t < cycle.duration;
			spine.visible = playing;
			if (!playing) continue;

			// spine 4.3 exposes the live entry as `getTrack(i)` (there is no `getCurrent`).
			const entry = spine.state.getTrack(0);
			if (!entry) continue;
			entry.trackTime = t;
			// autoUpdate is off for cycled overlays: apply the pose we just seeked to.
			spine.update(0);
		}

		for (const { def, sprite, cycle } of this.imageOverlays) {
			if (!cycle || !def.flicker) continue;
			const group = this.bonusCycleGroups.get(cycle.group);
			if (!group) continue;

			const t = this.bonusElapsed - (group.cycleStart + cycle.startDelay);
			const striking = t >= 0 && t < cycle.duration;
			sprite.visible = striking;
			if (!striking) continue;
			sprite.alpha = (def.alpha ?? 1) * strikeEnvelope(t, def.flicker);
		}
	}

	private async loadBonusBackdropTexture(assetId: string, src: string): Promise<Texture> {
		const alias = bonusBackdropAlias(assetId);
		this.loadedAssetKeys.add(alias);
		return loadTextureAsset(alias, src);
	}

	/**
	 * Toggle bonus mode (free game): swap to the FREEGAME backdrop, hide the base ambient clouds + moon +
	 * ship, and reveal the free-game overlays (moon, ship, splashes, tornadoes, clouds, rain) — or reverse
	 * it all when leaving. Safe to call before the bonus assets finish loading; it awaits them.
	 */
	async setBonusMode(active: boolean): Promise<void> {
		const asset = this.currentAsset;
		if (!asset || !this.hasBonusAssets(asset)) return;

		// Latch synchronously so the newest call wins: an in-flight older call bails after its await.
		this.bonusActive = active;
		// Throttle the background straight away (before the asset await) so the balls get their frame
		// budget back the instant the bonus round begins, not once the overlays finish loading.
		this.applyBonusFrameRate();
		await this.ensureBonusAssets();
		if (!this.spine || this.bonusActive !== active) return;

		this.applyBackdropTexture(active);
		this.applyHiddenSlots(active);
		this.applyAnchorDrawOrder(active);
		this.applyOverlayVisibility(active);
		this.fitSpine();
	}

	/**
	 * Drop this app to a trickle frame rate while a full-screen overlay (the bonus entry / bonus-end
	 * congratulations screens) completely hides it, and restore its normal rate the moment that screen
	 * starts sliding away.
	 *
	 * Nothing here is on screen while the flag is on, but the free-game scene is the heaviest thing this
	 * renderer ever draws (full-viewport rain, two tornadoes, drifting clouds, duty-cycled splashes) and it
	 * kept drawing at full rate into a canvas nobody could see — competing for the GPU with the
	 * congratulations screen's own coin/sparkle animations. That competition is invisible on a 1× Windows
	 * display and decisive on a Retina Mac, which pays 4× the fill rate for the same scene.
	 *
	 * Deliberately a low cap rather than `ticker.stop()`: the bonus-mode swap that runs at full cover still
	 * needs frames to land (and to settle before the screen lifts), it just doesn't need 60 of them a
	 * second. Everything spine-driven is delta-time based, so the animations resume mid-motion rather than
	 * jumping.
	 */
	setHiddenByOverlay(hidden: boolean): void {
		this.hiddenByOverlay = hidden;
		this.applyBonusFrameRate();
	}

	/**
	 * Cap the BACKGROUND app's frame rate while the bonus round is active, then restore it on exit.
	 *
	 * The bonus scene layers a lot of extra per-frame work onto this renderer — the full-viewport rain
	 * spine, two tornado spines, the drifting clouds and the duty-cycled splash overlays. This app runs
	 * on its OWN dedicated ticker, but it still competes for the single main thread and the GPU with the
	 * SEPARATE Pixi app that renders the balls, so at 60fps it starves the ball drop of frame budget and
	 * the balls visibly stutter (the base game has none of this work, which is why it stays smooth).
	 *
	 * Halving the background's frame rate hands roughly half that budget back to the ball app; the ambient
	 * rain/waterfall/splashes look identical at 30fps because every spine is delta-time driven, so motion
	 * speed is unchanged — there are simply fewer repaints of the out-of-focus background. `maxFPS = 0`
	 * removes the cap for the base game.
	 */
	private applyBonusFrameRate(): void {
		const ticker = this.app?.ticker;
		if (!ticker) return;
		// Hidden behind a full-screen overlay beats every other consideration — there is nothing to see.
		if (this.hiddenByOverlay) {
			ticker.maxFPS = SpineBackgroundRenderer.OVERLAY_HIDDEN_MAX_FPS;
			return;
		}
		ticker.maxFPS = this.bonusActive ? SpineBackgroundRenderer.BONUS_BACKGROUND_MAX_FPS : 0;
	}

	private applyBackdropTexture(bonus: boolean): void {
		const backdrop = this.backdrop;
		if (!backdrop) return;
		const texture = bonus ? this.bonusBackdropTexture : this.baseBackdropTexture;
		if (texture && backdrop.texture !== texture) {
			backdrop.texture = texture;
		}
	}

	private applyHiddenSlots(bonus: boolean): void {
		const spine = this.spine;
		if (!spine) return;
		for (const [slotName, setupAttachment] of this.hiddenSlotSetup) {
			const slot = spine.skeleton.findSlot(slotName);
			if (!slot) continue;
			// spine 4.3: set the unconstrained `pose` (source of truth) AND `appliedPose` (what renders)
			// so the change takes effect on the current frame, not just after the next constraint pass.
			const next = bonus ? null : setupAttachment;
			slot.pose.attachment = next;
			slot.appliedPose.attachment = next;
		}
	}

	/**
	 * Slot-anchored overlays (`baseSlot`) draw at their anchor slot's place in the base skeleton's draw
	 * order — but the slot that is SAFE to anchor to (static bone, no colour timeline, art that's hidden
	 * during bonus) is rarely the slot at the depth we want. `baseSlotAfter` closes that gap: while
	 * bonus is active the anchor slot is spliced in directly after the named slot, and on exit the
	 * skeleton's setup order is restored.
	 *
	 * Safe here because neither background animation has a draw-order timeline — nothing else writes
	 * this list. `appliedPose` is the SAME array as `pose` unless a constraint splits them (spine's
	 * `DrawOrder.unconstrained`), hence the identity check before moving it twice.
	 */
	private applyAnchorDrawOrder(bonus: boolean): void {
		const skeleton = this.spine?.skeleton;
		if (!skeleton || this.slotAnchorOrder.size === 0) return;

		if (!bonus) {
			skeleton.drawOrder.setupPose();
			return;
		}

		for (const [anchorName, afterName] of this.slotAnchorOrder) {
			const anchor = skeleton.findSlot(anchorName);
			const after = skeleton.findSlot(afterName);
			if (!anchor || !after) {
				console.warn(
					`[SpineBackgroundRenderer] cannot re-order "${anchorName}" after "${afterName}" — slot missing`,
				);
				continue;
			}
			const move = (order: Slot[]) => {
				const from = order.indexOf(anchor);
				if (from < 0) return;
				order.splice(from, 1);
				order.splice(order.indexOf(after) + 1, 0, anchor);
			};
			const { pose, appliedPose } = skeleton.drawOrder;
			move(pose);
			if (appliedPose !== pose) move(appliedPose);
		}
	}

	private applyOverlayVisibility(bonus: boolean): void {
		for (const { spine, cycle } of this.overlays) {
			if (cycle) {
				// Duty-cycled: the ticker owns `visible`; just make sure it's off when leaving bonus and
				// keep autoUpdate off so only the manual seek drives it.
				spine.autoUpdate = false;
				if (!bonus) spine.visible = false;
				continue;
			}
			spine.visible = bonus;
			spine.autoUpdate = bonus;
		}

		for (const { def, sprite, cycle } of this.imageOverlays) {
			if (cycle) {
				// Flickering: the ticker owns `visible`/`alpha`. Just make sure the layer is dark when
				// leaving bonus, so it can't be caught mid-strike and re-enter already lit.
				if (!bonus) {
					sprite.visible = false;
					sprite.alpha = 0;
				}
				continue;
			}
			sprite.visible = bonus;
			sprite.alpha = def.alpha ?? 1;
		}

		// Base-game layers are the mirror image: on in the base game, off while the free game paints its
		// own copy over the same spot (the portrait moon is in both, at different opacities, so leaving
		// this one up would stack the two into one over-bright disc).
		for (const { def, sprite } of this.baseImageOverlays) {
			sprite.visible = !bonus;
			sprite.alpha = def.alpha ?? 1;
		}
	}

	private scheduleFitSpine(): void {
		cancelAnimationFrame(this.fitFrameId);
		this.fitFrameId = requestAnimationFrame(() => {
			this.fitFrameId = requestAnimationFrame(() => this.fitSpine());
		});
	}

	private fitSpine(): void {
		const spine = this.spine;
		const asset = this.currentAsset;
		if (!this.app || !spine || !asset) return;

		const width = this.hostElement.clientWidth;
		const height = this.hostElement.clientHeight;
		if (!width || !height) return;

		if (!this.fitBounds.size.x || !this.fitBounds.size.y) {
			this.captureFitBounds(spine, asset);
		}

		const { size } = this.fitBounds;
		if (!size.x || !size.y) return;

		const backdrop = this.backdrop;
		const backdropDef = asset.backdrop;
		const backdropTexture = backdrop?.texture;
		const backdropTransform =
			backdrop && backdropDef && backdropTexture
				? computeBackdropTransform(width, height, backdropTexture, backdropDef)
				: undefined;

		if (backdrop && backdropDef && backdropTransform) {
			applyBackdropFit(backdrop, width, height, backdropDef);
		}

		const baseTransform = applySpineFit(
			spine,
			width,
			height,
			this.fitBounds,
			spineFitConfig(asset),
			backdropTransform,
			backdropDef,
			backdropTexture,
		);

		this.applyOverlayFit(baseTransform, width, height);
		this.applyImageOverlayFit(width, height);

		// `captureFitBounds` (above, when bounds were empty) runs `setupPose`, which re-adds the cloud
		// attachments — re-hide them so a resize mid-bonus doesn't flash the base clouds back in.
		if (this.bonusActive) {
			this.applyHiddenSlots(true);
			this.applyAnchorDrawOrder(true);
		}
	}

	/**
	 * Place each bonus overlay by reusing the base spine's exact fit transform. The overlays were
	 * authored in the same Spine scene / world coordinates as the base skeleton (and parsed at the same
	 * skeleton scale), so an identical scale + position lands their content pixel-aligned with the base
	 * scene. Per-overlay `offset{X,Y}` allow a small viewport-relative nudge for fine-tuning; `scaleMul`
	 * draws it larger/smaller than authored (scaled about world x=0, so pair with `offsetXVw` to place
	 * it); `mirror` flips the layer across the scene centre (for a symmetric feature like the waterfalls).
	 */
	private applyOverlayFit(base: FitTransform, width: number, height: number): void {
		// World transform of each `baseSlot` wrapper, so an anchored overlay's local transform can be
		// derived from the same world placement every other overlay gets. Computed once per fit.
		const anchorWorld = new Map<string, Matrix>();
		for (const slotName of this.slotAnchors.keys()) {
			const matrix = this.slotAnchorWorldTransform(slotName, base);
			if (matrix) anchorWorld.set(slotName, matrix);
		}

		for (const { def, spine } of this.overlays) {
			const offsetX = (def.offsetXVw ?? 0) * width;
			// `offsetYScene` is in base-scene units (× base.scale) so it tracks the scene/water across
			// aspect ratios; `offsetYVh` is a viewport-height fraction (drifts with aspect). Both supported.
			const offsetY = (def.offsetYVh ?? 0) * height + (def.offsetYScene ?? 0) * base.scale;
			const scale = base.scale * (def.scaleMul ?? 1);
			// Mirroring reflects about the skeleton ROOT (world x=0) — `base.x` is exactly where world x=0
			// lands, so negating scale.x reflects there with no extra term. `scaleMul` likewise scales the
			// content about world x=0 (the position anchor), so an asset authored near centre barely shifts.
			// ⚠️ Do NOT reflect about the fit-bounds centre: the landscape skeleton's box is lopsided
			// (authored −1887..+1657, centre −57.6 world) while the scene is actually symmetric about
			// ~world +8 (the midpoint of the two waterfall bones, −1169 / +1201). Using the box centre
			// threw the mirrored layer ~144px too far left at a 1600px viewport. Any residual is dialled
			// in per-overlay via `offsetXVw`.
			const scaleX = def.mirror ? -scale : scale;
			const x = base.x + offsetX;
			const y = base.y + offsetY;

			// Anchored overlays hang off a base slot, so `spine.position/scale` are relative to that slot's
			// bone rather than the stage. Re-express the same world placement in the wrapper's space.
			const parent = def.baseSlot ? anchorWorld.get(def.baseSlot) : undefined;
			if (parent) {
				const world = new Matrix(scaleX, 0, 0, scale, x, y);
				spine.setFromMatrix(parent.clone().invert().append(world));
				continue;
			}

			spine.scale.set(scaleX, scale);
			spine.position.set(x, y);
		}
	}

	/**
	 * World transform of a `baseSlot` wrapper: the base spine's own fit transform combined with the
	 * anchor slot's bone matrix, built exactly the way `Spine.updateSlotObject` builds it (note the
	 * negated `b`/`d` — spine's y axis points up, Pixi's down). Anything attached to the slot inherits
	 * this, so `applyOverlayFit` divides it back out.
	 */
	private slotAnchorWorldTransform(slotName: string, base: FitTransform): Matrix | undefined {
		const bone = this.spine?.skeleton.findSlot(slotName)?.bone.appliedPose;
		if (!bone) return undefined;
		return new Matrix(base.scale, 0, 0, base.scale, base.x, base.y).append(
			new Matrix(bone.a, bone.c, -bone.b, -bone.d, bone.worldX, bone.worldY),
		);
	}

	/**
	 * Place each image overlay (e.g. the moon) in plain viewport-fraction coordinates: centre at
	 * (`xVw`·w, `yVh`·h), width `widthVw`·w with the height following to preserve aspect. Independent of
	 * the scene fit transform, so it's trivial to align against the reference. Base-game and bonus layers
	 * are placed identically — that's what lets the two moons hand over without the disc moving (each
	 * keeps its own `alpha`, so the free game's is the dimmer of the two).
	 */
	private applyImageOverlayFit(width: number, height: number): void {
		for (const { def, sprite } of [...this.baseImageOverlays, ...this.imageOverlays]) {
			const texWidth = sprite.texture.width || 1;
			const scale = (def.widthVw * width) / texWidth;
			sprite.scale.set(scale);
			sprite.position.set(def.xVw * width, def.yVh * height);
		}
	}
}
