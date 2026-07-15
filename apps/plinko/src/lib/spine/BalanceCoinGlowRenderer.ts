import '@esotericsoftware/spine-pixi-v8';
import { Physics, Spine, Vector2, type SkeletonData } from '@esotericsoftware/spine-pixi-v8';
import { Application, Assets, Ticker } from 'pixi.js';

import { getBalanceCoinGlowAssets } from './balanceCoinGlowAsset';
import { readSkeletonData } from './spineSkeletonData';
import type { SpineAssetDef } from './types';

/** A loaded burst skeleton plus its setup-pose content box (skeleton units), used to centre + scale it. */
type GlowLayer = {
	spine: Spine;
	/** Track-0 animation name, replayed from the top on each activation (see setActive). */
	animation: string;
	centerX: number;
	centerY: number;
	contentWidth: number;
	contentHeight: number;
};

/**
 * The light burst behind the balance coin: the `glow` + `sparkle` spine starbursts layered in one
 * small transparent Pixi canvas, sized to its host element.
 *
 * Lifecycle mirrors CoinFountainRenderer: mounted once for the session (creating/destroying a WebGL
 * canvas mid-game can composite as an opaque white box for a frame on some GPUs — see the meter
 * notes) and left idle with its ticker STOPPED, only spinning up while the burst is on screen.
 *
 * Visibility is NOT handled here — the host element fades via CSS (see `.balance-card-coin-glow`),
 * which keeps the fade running even while the ticker is stopped.
 */
export class BalanceCoinGlowRenderer {
	private hostElement: HTMLElement;
	private app?: Application;
	private layers: GlowLayer[] = [];
	private ready = false;
	private running = false;
	private resizeObserver?: ResizeObserver;
	private readonly tick = (ticker: Ticker) => this.update(ticker.deltaMS);

	constructor(hostElement: HTMLElement) {
		this.hostElement = hostElement;
	}

	async init(): Promise<void> {
		if (this.app) return;
		const app = new Application();
		await app.init({
			resizeTo: this.hostElement,
			backgroundAlpha: 0,
			// Antialias off for the same reason as the coin fountain: a freshly cleared MSAA buffer can
			// flash as an opaque white box on some GPUs, and these are alpha PNGs so MSAA buys nothing.
			antialias: false,
			autoDensity: true,
			resolution: typeof window !== 'undefined' ? Math.min(2, window.devicePixelRatio || 1) : 1,
			preference: 'webgl',
		});
		this.hostElement.appendChild(app.canvas);
		app.canvas.style.display = 'block';
		app.canvas.style.width = '100%';
		app.canvas.style.height = '100%';
		// Idle until the first merge — no per-frame work between wins.
		app.ticker.stop();
		app.ticker.add(this.tick);
		this.app = app;

		this.layers = await this.loadLayers();
		this.ready = this.layers.length > 0;

		// The card is vw-sized, so the host rescales with the viewport. This ALSO covers init: the host
		// is 0×0 behind the intro loader, and Pixi's `resizeTo` only re-reads on a WINDOW resize — so
		// without driving `app.resize()` from here the canvas would keep Pixi's 800×600 default forever.
		// ResizeObserver fires once on observe, so the first real size lands here too.
		this.resizeObserver = new ResizeObserver(() => this.resize());
		this.resizeObserver.observe(this.hostElement);
		this.resize();
	}

	private async loadLayers(): Promise<GlowLayer[]> {
		const defs = getBalanceCoinGlowAssets();
		// Sequential, not Promise.all: the two share the `skeleton.png` FILENAME as their atlas page key,
		// and loading them concurrently can race in Pixi's asset cache.
		const layers: GlowLayer[] = [];
		for (const def of defs) {
			try {
				layers.push(await this.loadOne(def));
			} catch (err) {
				console.error('[BalanceCoinGlowRenderer] failed to load', def.id, err);
			}
		}
		return layers;
	}

	private async loadOne(asset: SpineAssetDef): Promise<GlowLayer> {
		const atlasAlias = `${asset.id}-atlas`;
		const skeletonAlias = `${asset.id}-skeleton`;
		Assets.add({ alias: atlasAlias, src: asset.atlas, data: { images: asset.images } });
		Assets.add({ alias: skeletonAlias, src: asset.skeleton });
		await Assets.load([atlasAlias, skeletonAlias]);
		const atlas = Assets.get(atlasAlias);
		const skeletonSource = Assets.get(skeletonAlias);
		if (!atlas || !skeletonSource) {
			throw new Error(`[BalanceCoinGlowRenderer] missing spine assets for ${asset.id}`);
		}
		const skeletonData: SkeletonData = readSkeletonData(asset, atlas, skeletonSource);

		const spine = new Spine({ skeletonData, autoUpdate: false });

		// Measure the SETUP-pose content box once, so the burst can be centred on the host and scaled to
		// it (mirrors CoinFountainRenderer / SpineBackgroundRenderer).
		// ORDER MATTERS: measure BEFORE setting the animation. `state.apply` with a track already set
		// bakes in frame 0 of the burst — which starts collapsed — so measuring after would read a
		// fraction of the real size (glow 119u instead of 232u) and, worse, a DIFFERENT fraction per
		// skeleton, destroying the authored size relationship the shared scale below relies on.
		spine.skeleton.setupPose();
		spine.state.apply(spine.skeleton);
		spine.skeleton.updateWorldTransform(Physics.update);
		const offset = new Vector2();
		const size = new Vector2();
		spine.skeleton.getBounds(offset, size, []);

		spine.state.setAnimation(0, asset.animation, true);

		const contentWidth = size.x > 0 ? size.x : skeletonData.width || 1;
		const contentHeight = size.y > 0 ? size.y : skeletonData.height || 1;
		this.app?.stage.addChild(spine);
		return {
			spine,
			animation: asset.animation,
			centerX: offset.x + contentWidth / 2,
			centerY: offset.y + contentHeight / 2,
			contentWidth,
			contentHeight,
		};
	}

	/**
	 * Match the renderer to the host's current size, then re-fit. Paints a frame when idle (ticker
	 * stopped) so a resize doesn't leave a stale/stretched last frame to fade back in on the next win.
	 */
	private resize(): void {
		const app = this.app;
		if (!app) return;
		if (!this.hostElement.clientWidth || !this.hostElement.clientHeight) return;
		app.resize();
		this.layout();
		if (!this.running) app.renderer.render(app.stage);
	}

	/**
	 * Centre every burst on the host and scale them all by ONE factor, chosen so the LARGEST layer fits
	 * (contain). Sharing the factor preserves the sizes the two were authored at relative to each other
	 * — fitting each independently would blow the smaller `sparkle` up to the size of `glow`.
	 */
	private layout(): void {
		if (!this.app || this.layers.length === 0) return;
		const w = this.hostElement.clientWidth;
		const h = this.hostElement.clientHeight;
		if (!w || !h) return;

		const maxW = Math.max(...this.layers.map((l) => l.contentWidth));
		const maxH = Math.max(...this.layers.map((l) => l.contentHeight));
		const scale = Math.min(w / maxW, h / maxH);

		for (const layer of this.layers) {
			layer.spine.scale.set(scale);
			layer.spine.position.set(w / 2 - layer.centerX * scale, h / 2 - layer.centerY * scale);
		}
	}

	/**
	 * Run the burst while `active`. Stopping the ticker leaves the last frame on the canvas — invisible,
	 * because the host is fading out via CSS at the same time.
	 *
	 * Each activation REPLAYS the animation from the top. The authored loop is a one-shot burst with a
	 * dead tail — it fades in over ~0.6s, holds to ~1.7s, fades out by ~2.3s, then sits FULLY
	 * TRANSPARENT for the rest of its 4.33s (~47% of the loop). Resuming wherever the ticker last froze
	 * would therefore show nothing at all on roughly half of all merges.
	 */
	setActive(active: boolean): void {
		if (!this.ready || !this.app) return;
		if (active === this.running) return;
		this.running = active;
		if (!active) {
			this.app.ticker.stop();
			return;
		}
		for (const layer of this.layers) {
			layer.spine.state.setAnimation(0, layer.animation, true);
		}
		this.app.ticker.start();
	}

	private update(deltaMs: number): void {
		const dt = Math.min(48, Math.max(0, deltaMs)) / 1000;
		for (const layer of this.layers) layer.spine.update(dt);
	}

	destroy(): void {
		this.resizeObserver?.disconnect();
		this.resizeObserver = undefined;
		this.app?.ticker.remove(this.tick);
		for (const layer of this.layers) layer.spine.destroy();
		this.layers = [];
		const canvas = this.app?.canvas as HTMLCanvasElement | undefined;
		if (canvas) canvas.style.visibility = 'hidden';
		// texture: false — the atlas pages stay in the shared Assets cache for the session, like the
		// coin fountain's.
		this.app?.destroy(true, { children: true, texture: false });
		this.app = undefined;
		this.ready = false;
		this.running = false;
	}
}
