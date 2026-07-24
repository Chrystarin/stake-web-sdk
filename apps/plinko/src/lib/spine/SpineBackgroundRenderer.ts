import '@esotericsoftware/spine-pixi-v8';
import {
	type Attachment,
	Physics,
	type Slot,
	Spine,
	type SkeletonData,
} from '@esotericsoftware/spine-pixi-v8';
import { Application, Assets, Sprite, type Texture } from 'pixi.js';

import { readSkeletonData } from './spineSkeletonData';
import { createWorldBounds, updateWorldBounds } from './spineBounds';
import { RainLayer, RAIN_BEHIND_CONFIG, RAIN_OVER_CONFIG } from './rainLayer';
import {
	computeBackdropTransform,
	computeFitTransform,
	computeSpineOverlayTransform,
	spineFitConfig,
	type FitTransform,
} from './spineFit';
import type { SpineAssetDef, SpineOverlayDef } from './types';

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
	/** Free-game rain, split either side of the base spine (behind vs. over the waterfall). */
	private rainBehind?: RainLayer;
	private rainOver?: RainLayer;
	/** Synced copy of the base skeleton rendering only `bonusUnderlaySlots`, drawn beneath the overlays. */
	private underlaySpine?: Spine;
	private underlaySlots: string[] = [];
	/** Resolved once: every slot the underlay copy must blank (i.e. all but the lifted ones). */
	private underlayHiddenSlots: Slot[] = [];
	/** Shared clock (seconds) driving the splash duty cycles + rain, advanced from the Pixi ticker. */
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
		this.rainBehind?.destroy();
		this.rainBehind = undefined;
		this.rainOver?.destroy();
		this.rainOver = undefined;
		this.underlaySpine?.destroy({ children: true });
		this.underlaySpine = undefined;
		this.underlaySlots = [];
		this.underlayHiddenSlots = [];
		this.bonusElapsed = 0;
		this.overlays.forEach(({ spine }) => spine.destroy({ children: true }));
		this.overlays = [];
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
		// Lifted slots are hidden on the main spine too — the underlay copy draws them instead.
		const hidden = [...(asset.bonusHiddenSlots ?? []), ...(asset.bonusUnderlaySlots ?? [])];
		for (const slotName of hidden) {
			const slot = spine.skeleton.findSlot(slotName);
			this.hiddenSlotSetup.set(slotName, slot?.pose.attachment ?? null);
		}
	}

	private hasBonusAssets(asset: SpineAssetDef): boolean {
		return Boolean(
			asset.bonusBackdropSrc || asset.bonusOverlays?.length || asset.bonusUnderlaySlots?.length,
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

		const [bonusTexture, overlays] = await Promise.all([backdropPromise, overlaysPromise]);
		if (bonusTexture) this.bonusBackdropTexture = bonusTexture;

		// The renderer may have been torn down (destroy) while these loaded — bail so we don't attach
		// orphan children to a destroyed stage.
		if (!this.app || !this.spine) {
			overlays.forEach(({ spine }) => spine.destroy({ children: true }));
			return;
		}

		const baseSpine = this.spine;

		// Everything below is inserted at the base spine's index, so each insertion lands directly above
		// the previous one: rainBehind → underlay(ship) → behindBase overlays → baseSpine.

		// Rain BEHIND the waterfall: under the base spine (but above the backdrop sprite).
		this.rainBehind = new RainLayer(RAIN_BEHIND_CONFIG);
		app.stage.addChildAt(this.rainBehind.view, app.stage.getChildIndex(baseSpine));

		// Slots lifted out of the base scene (the distant ship) — redrawn here so the bonus overlays,
		// which sit just above, pass in FRONT of them while the rest of the base scene stays on top.
		this.underlaySlots = asset.bonusUnderlaySlots ?? [];
		if (this.underlaySlots.length) {
			const underlay = new Spine({ skeletonData: await this.loadSkeletonData(asset), autoUpdate: false });
			underlay.state.setAnimation(0, asset.animation, asset.loop ?? true);
			underlay.visible = false;
			this.underlaySpine = underlay;
			const lifted = new Set(this.underlaySlots);
			this.underlayHiddenSlots = underlay.skeleton.slots.filter(
				(slot: Slot) => !lifted.has(slot.data.name),
			);
			app.stage.addChildAt(underlay, app.stage.getChildIndex(baseSpine));
		}

		// Most overlays paint on top of the base spine (topmost background layer, still behind the game
		// board which is a separate canvas above this one). `behindBase` ones are inserted UNDER the base
		// spine so the waterfalls/ship occlude them for depth.
		overlays.forEach(({ def, spine }) => {
			if (def.behindBase) {
				app.stage.addChildAt(spine, app.stage.getChildIndex(baseSpine));
			} else {
				app.stage.addChild(spine);
			}
		});

		// Rain OVER the waterfall: added last, so it passes in front of the whole background scene —
		// still inside this canvas, hence always behind the plinko board.
		this.rainOver = new RainLayer(RAIN_OVER_CONFIG);
		app.stage.addChild(this.rainOver.view);

		this.overlays = overlays;
		this.startBonusTicker();
		this.fitSpine();
	}

	/**
	 * Drives the rain simulation and the splash duty cycles off the shared Pixi ticker, so both are
	 * frame-rate independent and pause with the app.
	 */
	private startBonusTicker(): void {
		const app = this.app;
		if (!app || this.bonusTick) return;

		const tick = () => {
			if (!this.bonusActive) return;
			try {
				const { deltaTime, deltaMS } = app.ticker;
				this.bonusElapsed += deltaMS / 1000;
				this.rainBehind?.update(deltaTime);
				this.rainOver?.update(deltaTime);
				this.syncUnderlay();
				this.advanceBonusCycles();
			} catch (error) {
				// An exception escaping a ticker listener aborts Pixi's rAF loop, which silently freezes
				// the ENTIRE background (no repaint at all). Detach instead so the base scene keeps running.
				console.error('[SpineBackgroundRenderer] bonus tick failed; disabling rain/splash cycle', error);
				app.ticker.remove(tick);
				this.bonusTick = undefined;
			}
		};
		this.bonusTick = tick;
		app.ticker.add(tick);
	}

	/**
	 * Keeps the lifted-slot copy frame-locked to the base scene and restricted to just those slots, so
	 * the ship animates identically to how it would inside the base spine — only at a lower depth.
	 */
	private syncUnderlay(): void {
		const underlay = this.underlaySpine;
		const base = this.spine;
		if (!underlay || !base) return;

		const baseEntry = base.state.getTrack(0);
		const entry = underlay.state.getTrack(0);
		if (baseEntry && entry) entry.trackTime = baseEntry.trackTime;
		underlay.update(0);

		// Blank every non-lifted slot, AFTER `update` so attachment timelines can't re-add them.
		// ⚠️ Don't shrink `skeleton.drawOrder` to do this: the spine renderer walks `drawOrder` and
		// `slots` in parallel, so a shorter array throws mid-render — which escapes the ticker and
		// silently kills Pixi's rAF loop (the whole background stops repainting).
		for (const slot of this.underlayHiddenSlots) {
			slot.pose.attachment = null;
			slot.appliedPose.attachment = null;
		}
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
	 * Toggle bonus mode (free game): swap to the FREEGAME backdrop, hide the base ambient clouds, and
	 * reveal the FG_CLOUD/FG_SPLASH overlays — or reverse all three when leaving. Safe to call before
	 * the bonus assets finish loading; it awaits them.
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
	 * The bonus scene layers heavy per-frame work onto this renderer — two full-viewport rain layers
	 * (each behind a Gaussian blur filter, which forces a full-screen render-to-texture pass every
	 * frame), the duty-cycled splash overlays, and a synced *duplicate* of the base skeleton drawn at a
	 * lower depth for the ship. This app runs on its OWN dedicated ticker, but it still competes for the
	 * single main thread and the GPU with the SEPARATE Pixi app that renders the balls, so at 60fps it
	 * starves the ball drop of frame budget and the balls visibly stutter (base game has none of this
	 * work, which is why it stays smooth).
	 *
	 * Halving the background's frame rate hands roughly half that budget back to the ball app; the
	 * ambient rain/waterfall/splashes look identical at 30fps because every layer is delta-time driven
	 * (rain uses the ticker `deltaTime`, the spines `deltaMS`), so motion speed is unchanged — there are
	 * simply fewer repaints of the out-of-focus background. `maxFPS = 0` removes the cap for the base game.
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

		if (this.rainBehind) this.rainBehind.view.visible = bonus;
		if (this.rainOver) this.rainOver.view.visible = bonus;
		// The underlay only exists to re-depth lifted slots during bonus; outside bonus the main spine
		// draws them again (their attachments are restored by `applyHiddenSlots`).
		if (this.underlaySpine) this.underlaySpine.visible = bonus;
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
		// The lifted-slot copy shares the base spine's exact transform — it's the same skeleton.
		if (this.underlaySpine) {
			this.underlaySpine.scale.set(baseTransform.scale);
			this.underlaySpine.position.set(baseTransform.x, baseTransform.y);
		}
		// Rain covers the whole background viewport, independent of the spine's fit transform.
		this.rainBehind?.resize(width, height);
		this.rainOver?.resize(width, height);

		// `captureFitBounds` (above, when bounds were empty) runs `setupPose`, which re-adds the cloud
		// attachments — re-hide them so a resize mid-bonus doesn't flash the base clouds back in.
		if (this.bonusActive) this.applyHiddenSlots(true);
	}

	/**
	 * Place each bonus overlay by reusing the base spine's exact fit transform. The overlays were
	 * authored in the same Spine scene / world coordinates as the base skeleton (and parsed at the same
	 * skeleton scale), so an identical scale + position lands their content pixel-aligned with the base
	 * scene. Per-overlay `offset{X,Y}` allow a small viewport-relative nudge for fine-tuning; `mirror`
	 * flips the layer across the scene centre (for a left/right symmetric feature like the waterfalls).
	 */
	private applyOverlayFit(base: FitTransform, width: number, height: number): void {
		for (const { def, spine } of this.overlays) {
			const offsetX = (def.offsetXVw ?? 0) * width;
			const offsetY = (def.offsetYVh ?? 0) * height;
			// Mirroring reflects about the skeleton ROOT (world x=0) — `base.x` is exactly where world x=0
			// lands, so negating scale.x reflects there with no extra term.
			// ⚠️ Do NOT reflect about the fit-bounds centre: the landscape skeleton's box is lopsided
			// (authored −1887..+1657, centre −57.6 world) while the scene is actually symmetric about
			// ~world +8 (the midpoint of the two waterfall bones, −1169 / +1201). Using the box centre
			// threw the mirrored layer ~144px too far left at a 1600px viewport. Any residual is dialled
			// in per-overlay via `offsetXVw`.
			spine.scale.set(def.mirror ? -base.scale : base.scale, base.scale);
			spine.position.set(base.x + offsetX, base.y + offsetY);
		}
	}
}
