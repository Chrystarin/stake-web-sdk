import '@esotericsoftware/spine-pixi-v8';
import {
	type Attachment,
	Physics,
	Spine,
	type SkeletonData,
} from '@esotericsoftware/spine-pixi-v8';
import { Application, Assets, Sprite, type Texture } from 'pixi.js';

import { readSkeletonData } from './spineSkeletonData';
import { createWorldBounds, updateWorldBounds } from './spineBounds';
import {
	computeBackdropTransform,
	computeFitTransform,
	computeSpineOverlayTransform,
	spineFitConfig,
	type FitTransform,
} from './spineFit';
import type { SpineAssetDef, SpineImageOverlayDef, SpineOverlayDef } from './types';

/** Structural subset shared by the base asset and bonus overlays — everything needed to load a spine. */
type SpineLoadable = Pick<
	SpineAssetDef,
	'id' | 'format' | 'skeleton' | 'atlas' | 'images' | 'skeletonScale'
>;

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
			/** Gap re-rolled uniformly in [gapMin, gapMax] after each play (equal ⇒ fixed gap). */
			gapMin: number;
			gapMax: number;
			startDelay: number;
			/** Elapsed clock (s) at which the current play began; advances one period at a time. */
			cycleStart: number;
			/** The gap chosen for the current period, in seconds. */
			currentGap: number;
		};
	}[] = [];
	/** Bonus-mode plain-image layers (e.g. the free-game moon), positioned in viewport fractions. */
	private imageOverlays: { def: SpineImageOverlayDef; sprite: Sprite }[] = [];
	/** Shared clock (seconds) driving the splash duty cycles, advanced from the Pixi ticker. */
	private bonusElapsed = 0;
	private bonusTick?: () => void;
	private baseBackdropTexture?: Texture;
	private bonusBackdropTexture?: Texture;
	private bonusActive = false;
	/** Latched once the lazy bonus-asset load starts; awaited by `setBonusMode`. */
	private bonusAssetsPromise?: Promise<void>;
	/** Setup attachment object for each `bonusHiddenSlots` slot, so it can be restored on exit. Stored
	 * as the object and reassigned onto the slot's pose directly (see `applyHiddenSlots`): spine 4.3
	 * keeps the live attachment on `slot.pose`/`appliedPose`, not on the legacy `slot.attachment`. */
	private hiddenSlotSetup = new Map<string, Attachment | null>();

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
				resolution: window.devicePixelRatio || 1,
				preference: 'webgl',
			});

			this.hostElement.appendChild(app.canvas);
			// Pixi leaves the canvas `display: inline`, which adds a baseline gap; match the game
			// background's block canvas so the splash fills its host exactly.
			app.canvas.style.display = 'block';
			this.app = app;

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
		this.spine.update(deltaSeconds);
		this.app.render();
	}

	/**
	 * @param options.releaseAssets Unload this renderer's textures from the global Pixi `Assets`
	 *   cache. Long-lived background renderers leave this off (assets are reused); short-lived
	 *   renderers like the intro splash MUST set it, otherwise their atlas pages (tens of MB of
	 *   GPU memory) linger for the whole session and starve the game's ball renderer.
	 */
	destroy(options?: { releaseAssets?: boolean }): void {
		cancelAnimationFrame(this.fitFrameId);
		this.resizeObserver?.disconnect();
		this.resizeObserver = undefined;
		if (this.bonusTick) {
			this.app?.ticker.remove(this.bonusTick);
			this.bonusTick = undefined;
		}
		this.bonusElapsed = 0;
		this.overlays.forEach(({ spine }) => spine.destroy({ children: true }));
		this.overlays = [];
		this.imageOverlays.forEach(({ sprite }) => sprite.destroy());
		this.imageOverlays = [];
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

		const atlasAlias = `${asset.id}-atlas`;
		const skeletonAlias = `${asset.id}-skeleton`;

		Assets.add({
			alias: atlasAlias,
			src: asset.atlas,
			data: { images: asset.images },
		});
		Assets.add({ alias: skeletonAlias, src: asset.skeleton });

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

		const alias = `${asset.id}-backdrop`;
		Assets.add({ alias, src: backdropDef.src });
		this.loadedAssetKeys.add(alias);
		const texture = await Assets.load(alias);
		this.baseBackdropTexture = texture;
		return Sprite.from(texture);
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

		const [skeletonData, backdrop] = await Promise.all([
			this.loadSkeletonData(asset),
			this.loadBackdrop(asset),
		]);

		this.spine?.destroy({ children: true });
		this.backdrop?.destroy();

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

		this.backdrop = backdrop;
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
						cycle = {
							duration,
							gapMin,
							gapMax,
							startDelay,
							cycleStart: startDelay,
							currentGap: gapMin + Math.random() * (gapMax - gapMin),
						};
					}
				}
				return { def, spine, cycle };
			}),
		);

		const imageDefs = asset.bonusImageOverlays ?? [];
		const imagesPromise = Promise.all(
			imageDefs.map(async (def) => {
				const sprite = await this.loadImageOverlaySprite(def);
				return { def, sprite };
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
		// the base spine (and above the previously inserted behind-layer). On-top layers are appended, so
		// each lands above the last. The bonus asset arrays are ordered so the stack reads, bottom→top:
		// backdrop → moon → ship → splashes → tornadoes → baseSpine → clouds → rain.

		const addBehindBase = (child: Parameters<typeof app.stage.addChild>[0]) =>
			app.stage.addChildAt(child, app.stage.getChildIndex(baseSpine));

		// Image overlays first, so a `behindBase` image (the moon) sits beneath the spine overlays.
		imageOverlays.forEach(({ def, sprite }) => {
			if (def.behindBase) addBehindBase(sprite);
			else app.stage.addChild(sprite);
		});

		// Most overlays paint on top of the base spine (topmost background layer, still behind the game
		// board which is a separate canvas above this one). `behindBase` ones are inserted UNDER the base
		// spine so the waterfalls/dock occlude them for depth.
		overlays.forEach(({ def, spine }) => {
			if (def.behindBase) addBehindBase(spine);
			else app.stage.addChild(spine);
		});

		this.overlays = overlays;
		this.imageOverlays = imageOverlays;
		this.startBonusTicker();
		this.fitSpine();
	}

	/** Load a bonus image-overlay texture and build its sprite (hidden, centre-anchored) until activated. */
	private async loadImageOverlaySprite(def: SpineImageOverlayDef): Promise<Sprite> {
		const alias = `${def.id}-image-overlay`;
		Assets.add({ alias, src: def.src });
		this.loadedAssetKeys.add(alias);
		const texture = await Assets.load(alias);
		const sprite = Sprite.from(texture);
		sprite.anchor.set(0.5);
		sprite.alpha = def.alpha ?? 1;
		sprite.visible = false;
		return sprite;
	}

	/**
	 * Drives the splash duty cycles off the Pixi ticker, so they're frame-rate independent and pause
	 * with the app. (The rain/tornado/cloud overlays self-animate via `autoUpdate`.)
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
				console.error('[SpineBackgroundRenderer] bonus tick failed; disabling splash cycle', error);
				app.ticker.remove(tick);
				this.bonusTick = undefined;
			}
		};
		this.bonusTick = tick;
		app.ticker.add(tick);
	}

	/**
	 * Duty-cycled overlays (the two splashes) play their animation once, then hide for `gap` seconds
	 * before replaying. `startDelay` staggers the pair so the left fires first and the right joins
	 * partway through, instead of both bursting in unison.
	 */
	private advanceBonusCycles(): void {
		for (const { spine, cycle } of this.overlays) {
			if (!cycle) continue;

			// Advance one period at a time, re-rolling the gap after each play so replays aren't
			// metronomic. A `while` (not `if`) catches up if the ticker dropped several periods' worth
			// of frames at once.
			while (this.bonusElapsed >= cycle.cycleStart + cycle.duration + cycle.currentGap) {
				cycle.cycleStart += cycle.duration + cycle.currentGap;
				cycle.currentGap = cycle.gapMin + Math.random() * (cycle.gapMax - cycle.gapMin);
			}

			const t = this.bonusElapsed - cycle.cycleStart;
			// Before the first play (during `startDelay`) or inside the post-play gap, stay hidden.
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
	}

	private async loadBonusBackdropTexture(assetId: string, src: string): Promise<Texture> {
		const alias = `${assetId}-bonus-backdrop`;
		Assets.add({ alias, src });
		this.loadedAssetKeys.add(alias);
		return Assets.load(alias);
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
		this.applyBonusFrameRate(active);
		await this.ensureBonusAssets();
		if (!this.spine || this.bonusActive !== active) return;

		this.applyBackdropTexture(active);
		this.applyHiddenSlots(active);
		this.applyOverlayVisibility(active);
		this.fitSpine();
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
	private applyBonusFrameRate(active: boolean): void {
		const ticker = this.app?.ticker;
		if (!ticker) return;
		ticker.maxFPS = active ? SpineBackgroundRenderer.BONUS_BACKGROUND_MAX_FPS : 0;
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

		for (const { sprite } of this.imageOverlays) {
			sprite.visible = bonus;
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
		if (this.bonusActive) this.applyHiddenSlots(true);
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
			spine.scale.set(def.mirror ? -scale : scale, scale);
			spine.position.set(base.x + offsetX, base.y + offsetY);
		}
	}

	/**
	 * Place each bonus image overlay (e.g. the moon) in plain viewport-fraction coordinates: centre at
	 * (`xVw`·w, `yVh`·h), width `widthVw`·w with the height following to preserve aspect. Independent of
	 * the scene fit transform, so it's trivial to align against the reference.
	 */
	private applyImageOverlayFit(width: number, height: number): void {
		for (const { def, sprite } of this.imageOverlays) {
			const texWidth = sprite.texture.width || 1;
			const scale = (def.widthVw * width) / texWidth;
			sprite.scale.set(scale);
			sprite.position.set(def.xVw * width, def.yVh * height);
		}
	}
}
