import '@esotericsoftware/spine-pixi-v8';
import {
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
} from './spineFit';
import type { SpineAssetDef } from './types';

const applySpineFit = (
	spine: Spine,
	width: number,
	height: number,
	bounds: ReturnType<typeof createWorldBounds>,
	config: ReturnType<typeof spineFitConfig>,
	backdropTransform?: ReturnType<typeof computeBackdropTransform>,
	backdropDef?: NonNullable<SpineAssetDef['backdrop']>,
	backdropTexture?: Texture,
) => {
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
		this.backdrop?.destroy();
		this.backdrop = undefined;
		this.spine?.destroy({ children: true });
		this.spine = undefined;
		this.app?.destroy(true, { children: true });
		this.app = undefined;
		this.currentAsset = undefined;

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

	private async loadSkeletonData(asset: SpineAssetDef): Promise<SkeletonData> {
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
		// Atlas page textures are cached by their image URL — track them so they free too.
		for (const imageUrl of Object.values(asset.images)) {
			this.loadedAssetKeys.add(imageUrl);
		}

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

		this.captureFitBounds(spine, asset);
		this.fitSpine();
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

		applySpineFit(
			spine,
			width,
			height,
			this.fitBounds,
			spineFitConfig(asset),
			backdropTransform,
			backdropDef,
			backdropTexture,
		);
	}
}
