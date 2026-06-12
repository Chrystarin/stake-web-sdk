import {
	Physics,
	Spine,
	type SkeletonData,
} from '@esotericsoftware/spine-pixi-v8';
import { Application, Assets } from 'pixi.js';

import { readSkeletonData } from './spineSkeletonData';
import { createWorldBounds, updateWorldBounds } from './spineBounds';
import type { SpineAssetDef } from './types';

export class SpineBackgroundRenderer {
	private hostElement: HTMLElement;
	private app?: Application;
	private spine?: Spine;
	private currentAsset?: SpineAssetDef;
	private skeletonDataCache = new Map<string, SkeletonData>();
	private worldBounds = createWorldBounds();
	private resizeObserver?: ResizeObserver;
	private fitFrameId = 0;

	constructor(hostElement: HTMLElement) {
		this.hostElement = hostElement;
	}

	async init(asset: SpineAssetDef): Promise<void> {
		if (!this.app) {
			const app = new Application();
			await app.init({
				resizeTo: this.hostElement,
				backgroundAlpha: 0,
				antialias: true,
				autoDensity: true,
				resolution: window.devicePixelRatio || 1,
			});

			this.hostElement.appendChild(app.canvas);
			this.app = app;

			this.resizeObserver = new ResizeObserver(() => this.scheduleFitSpine());
			this.resizeObserver.observe(this.hostElement);
		}

		await this.loadAsset(asset);
	}

	destroy(): void {
		cancelAnimationFrame(this.fitFrameId);
		this.resizeObserver?.disconnect();
		this.resizeObserver = undefined;
		this.spine?.destroy({ children: true });
		this.spine = undefined;
		this.app?.destroy(true, { children: true });
		this.app = undefined;
		this.currentAsset = undefined;
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

		const loaded = await Assets.load<Record<string, unknown>>([atlasAlias, skeletonAlias]);
		const atlas = loaded[atlasAlias];
		const skeletonSource = loaded[skeletonAlias];

		if (!atlas || !skeletonSource) {
			throw new Error(
				`[SpineBackgroundRenderer] missing spine assets (atlas: ${Boolean(atlas)}, skeleton: ${Boolean(skeletonSource)})`,
			);
		}

		const skeletonData = readSkeletonData(asset, atlas, skeletonSource);
		this.skeletonDataCache.set(cacheKey, skeletonData);
		return skeletonData;
	}

	private async loadAsset(asset: SpineAssetDef): Promise<void> {
		const app = this.app;
		if (!app) return;

		const skeletonData = await this.loadSkeletonData(asset);

		this.spine?.destroy({ children: true });

		const spine = new Spine({
			skeletonData,
			autoUpdate: true,
		});
		spine.state.data.defaultMix = 0.2;
		spine.state.setAnimation(0, asset.animation, true);
		spine.skeleton.setupPose();
		spine.state.apply(spine.skeleton);
		spine.skeleton.updateWorldTransform(Physics.update);

		app.stage.removeChildren();
		app.stage.addChild(spine);

		this.spine = spine;
		this.currentAsset = asset;
		this.scheduleFitSpine();
	}

	private scheduleFitSpine(): void {
		cancelAnimationFrame(this.fitFrameId);
		this.fitFrameId = requestAnimationFrame(() => {
			this.fitFrameId = requestAnimationFrame(() => this.fitSpine());
		});
	}

	private fitSpine(): void {
		const app = this.app;
		const spine = this.spine;
		const asset = this.currentAsset;
		if (!app || !spine || !asset) return;

		const width = this.hostElement.clientWidth;
		const height = this.hostElement.clientHeight;
		if (!width || !height) return;

		updateWorldBounds(spine.skeleton, asset, this.worldBounds);

		const { offset, size } = this.worldBounds;
		if (!size.x || !size.y) return;

		const centerX = offset.x + size.x / 2;
		const centerY = offset.y + size.y / 2;

		const scale =
			asset.widthFillScale != null
				? (width / size.x) * asset.widthFillScale
				: Math.max(width / size.x, height / size.y);

		spine.scale.set(scale);

		const offsetX = (asset.offsetXVw ?? 0) * width;
		const offsetY = (asset.offsetYVh ?? 0) * height;

		if (asset.widthFillScale != null || asset.fitAnchor === 'bottom') {
			// object-position: center bottom — width fill, bottom pinned, height cropped
			spine.position.set(
				width / 2 - centerX * scale + offsetX,
				height - (offset.y + size.y) * scale + offsetY,
			);
		} else {
			spine.position.set(
				width / 2 - centerX * scale + offsetX,
				height / 2 - centerY * scale + offsetY,
			);
		}
	}
}
