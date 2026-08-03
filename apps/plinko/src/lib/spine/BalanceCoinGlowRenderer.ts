import '@esotericsoftware/spine-pixi-v8';
import { Physics, Spine, Vector2, type SkeletonData } from '@esotericsoftware/spine-pixi-v8';
import { Application, Assets, Ticker } from 'pixi.js';

import {
	getBalanceCoinGlowAssets,
	type BalanceCoinGlowLayerDef,
	type GlowDepth,
} from './balanceCoinGlowAsset';
import { loadSpineAsset } from './spineAssetCache';
import { readSkeletonData } from './spineSkeletonData';

/** The two boxes the burst is drawn into, straddling the coin img in the DOM. */
export type BalanceCoinGlowHosts = {
	/** Behind the coin — the big soft ray burst. */
	back: HTMLElement;
	/** Over the coin — the sparkle, so its rays read on top of the gold instead of under it. */
	front: HTMLElement;
};

/** A loaded burst skeleton plus its setup-pose content box (skeleton units), used to centre + scale it. */
type GlowLayer = {
	spine: Spine;
	/** Track-0 animation name, replayed from the top on each activation (see setActive). */
	animation: string;
	/** Slice of the timeline to loop, if not the whole thing (see BalanceCoinGlowLayerDef.loopRange). */
	loopRange?: { start: number; end: number };
	centerX: number;
	centerY: number;
	contentWidth: number;
	contentHeight: number;
	/** Size multiplier over the shared fit scale (see BalanceCoinGlowLayerDef.emphasis). */
	emphasis: number;
};

/** One canvas + the layers drawn into it. Runs on its own, since the two are lit at different times. */
type GlowCanvas = {
	depth: GlowDepth;
	host: HTMLElement;
	app: Application;
	layers: GlowLayer[];
	running: boolean;
	tick: (ticker: Ticker) => void;
};

/**
 * The light burst around the balance coin: the `glow` + `sparkle` spine starbursts, each in its own
 * small transparent Pixi canvas sized to its host element.
 *
 * TWO canvases, not one, because they straddle the coin: `glow` renders behind it (a white burst
 * drawn over the gold would wash the coin out) and `sparkle` on top of it. A Pixi canvas can only be
 * at one z-index, so the split is the DOM's, and this class keeps the pair in step — one shared fit
 * scale (see layout) so the two hold the sizes they were authored at relative to each other.
 *
 * Lifecycle mirrors CoinFountainRenderer: mounted once for the session (creating/destroying a WebGL
 * canvas mid-game can composite as an opaque white box for a frame on some GPUs — see the meter
 * notes) and left idle with the tickers STOPPED, only spinning up while the burst is on screen.
 *
 * Visibility is NOT handled here — the host elements fade via CSS (see `.balance-card-coin-burst`),
 * which keeps the fade running even while the tickers are stopped.
 */
export class BalanceCoinGlowRenderer {
	private hosts: BalanceCoinGlowHosts;
	private canvases: GlowCanvas[] = [];
	private ready = false;
	private resizeObserver?: ResizeObserver;

	constructor(hosts: BalanceCoinGlowHosts) {
		this.hosts = hosts;
	}

	async init(): Promise<void> {
		if (this.canvases.length > 0) return;
		for (const depth of ['back', 'front'] as const) {
			this.canvases.push(await this.createCanvas(depth, this.hosts[depth]));
		}

		// Sequential, not Promise.all: the two share the `skeleton.png` FILENAME as their atlas page key,
		// and loading them concurrently can race in Pixi's asset cache.
		for (const def of getBalanceCoinGlowAssets()) {
			const canvas = this.canvases.find((c) => c.depth === def.depth);
			if (!canvas) continue;
			try {
				canvas.layers.push(this.loadLayer(await this.loadSkeletonData(def), def, canvas));
			} catch (err) {
				console.error('[BalanceCoinGlowRenderer] failed to load', def.id, err);
			}
		}
		this.ready = this.canvases.some((c) => c.layers.length > 0);

		// The card is vw-sized, so the hosts rescale with the viewport. This ALSO covers init: they are
		// 0×0 behind the intro loader, and Pixi's `resizeTo` only re-reads on a WINDOW resize — so
		// without driving `app.resize()` from here the canvases would keep Pixi's 800×600 default
		// forever. ResizeObserver fires once on observe, so the first real size lands here too.
		this.resizeObserver = new ResizeObserver(() => this.resize());
		for (const canvas of this.canvases) this.resizeObserver.observe(canvas.host);
		this.resize();
	}

	private async createCanvas(depth: GlowDepth, host: HTMLElement): Promise<GlowCanvas> {
		const app = new Application();
		await app.init({
			resizeTo: host,
			backgroundAlpha: 0,
			// Antialias off for the same reason as the coin fountain: a freshly cleared MSAA buffer can
			// flash as an opaque white box on some GPUs, and these are alpha PNGs so MSAA buys nothing.
			antialias: false,
			autoDensity: true,
			resolution: typeof window !== 'undefined' ? Math.min(2, window.devicePixelRatio || 1) : 1,
			preference: 'webgl',
		});
		host.appendChild(app.canvas);
		app.canvas.style.display = 'block';
		app.canvas.style.width = '100%';
		app.canvas.style.height = '100%';

		const canvas: GlowCanvas = {
			depth,
			host,
			app,
			layers: [],
			running: false,
			// Each canvas advances only its OWN layers: both tickers run, so a shared handler would step
			// every skeleton twice per frame (double speed).
			tick: (ticker: Ticker) => {
				const dt = Math.min(48, Math.max(0, ticker.deltaMS)) / 1000;
				for (const layer of canvas.layers) layer.spine.update(dt);
			},
		};
		// Idle until the first merge — no per-frame work between wins.
		app.ticker.stop();
		app.ticker.add(canvas.tick);
		return canvas;
	}

	private async loadSkeletonData(asset: BalanceCoinGlowLayerDef): Promise<SkeletonData> {
		// Shared cache — preloaded by the intro loader, and registered with Pixi's resolver exactly once.
		const { atlasAlias, skeletonAlias } = await loadSpineAsset(asset);
		const atlas = Assets.get(atlasAlias);
		const skeletonSource = Assets.get(skeletonAlias);
		if (!atlas || !skeletonSource) {
			throw new Error(`[BalanceCoinGlowRenderer] missing spine assets for ${asset.id}`);
		}
		return readSkeletonData(asset, atlas, skeletonSource);
	}

	private loadLayer(
		skeletonData: SkeletonData,
		asset: BalanceCoinGlowLayerDef,
		canvas: GlowCanvas,
	): GlowLayer {
		// BEFORE `new Spine`: the skeleton copies the setup pose when it is built, and the bounds
		// measured below have to see the grown art or the fit basis would be short.
		this.applyBoneScale(skeletonData, asset);

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

		const contentWidth = size.x > 0 ? size.x : skeletonData.width || 1;
		const contentHeight = size.y > 0 ? size.y : skeletonData.height || 1;
		const layer: GlowLayer = {
			spine,
			animation: asset.animation,
			loopRange: asset.loopRange,
			centerX: offset.x + contentWidth / 2,
			centerY: offset.y + contentHeight / 2,
			contentWidth,
			contentHeight,
			emphasis: asset.emphasis,
		};
		this.playFromStart(layer);
		canvas.app.stage.addChild(spine);
		return layer;
	}

	/**
	 * Start (or restart) a layer's loop at the top of whatever it loops — see setActive for why every
	 * activation replays rather than resumes.
	 */
	private playFromStart(layer: GlowLayer): void {
		const entry = layer.spine.state.setAnimation(0, layer.animation, true);
		if (!layer.loopRange) return;
		// A looping track wraps inside [animationStart, animationEnd], and trackTime 0 maps to
		// animationStart — so this both trims the loop and starts it at the range's top.
		entry.animationStart = layer.loopRange.start;
		entry.animationEnd = layer.loopRange.end;
	}

	/**
	 * Grow what a bone carries without moving where it sits — see BalanceCoinGlowLayerDef.boneScale.
	 * Safe to mutate: `readSkeletonData` parses a fresh SkeletonData per asset rather than handing back
	 * a shared cached one, so this can't compound across renderers or reloads.
	 */
	private applyBoneScale(skeletonData: SkeletonData, asset: BalanceCoinGlowLayerDef): void {
		const spec = asset.boneScale;
		if (!spec) return;
		for (const name of spec.bones) {
			const bone = skeletonData.findBone(name);
			if (!bone) {
				console.warn('[BalanceCoinGlowRenderer]', asset.id, 'has no bone', name);
				continue;
			}
			bone.setupPose.scaleX *= spec.scale;
			bone.setupPose.scaleY *= spec.scale;
		}
	}

	/**
	 * Match each renderer to its host's current size, then re-fit. Paints a frame when idle (tickers
	 * stopped) so a resize doesn't leave a stale/stretched last frame to fade back in on the next win.
	 */
	private resize(): void {
		for (const canvas of this.canvases) {
			if (!canvas.host.clientWidth || !canvas.host.clientHeight) continue;
			canvas.app.resize();
		}
		this.layout();
		for (const canvas of this.canvases) {
			if (!canvas.running) canvas.app.renderer.render(canvas.app.stage);
		}
	}

	/**
	 * Centre every burst on its host and scale them all from ONE basis: the largest emphasised layer,
	 * fitted to the host (contain). Sharing the basis is what preserves the sizes the skeletons were
	 * authored at relative to each other (glow 232u vs sparkle 139u) — fitting each to its own host
	 * would blow the smaller `sparkle` up to the size of `glow`. It also means the hosts can be sized
	 * as one box in CSS: the basis is emphasised too, so a host sized to hold the emphasised `glow`
	 * still lands `sparkle` at exactly its authored fraction of it.
	 */
	private layout(): void {
		const layers = this.canvases.flatMap((c) => c.layers);
		if (layers.length === 0) return;
		const basisW = Math.max(...layers.map((l) => l.contentWidth * l.emphasis));
		const basisH = Math.max(...layers.map((l) => l.contentHeight * l.emphasis));

		for (const canvas of this.canvases) {
			const w = canvas.host.clientWidth;
			const h = canvas.host.clientHeight;
			if (!w || !h) continue;
			const fit = Math.min(w / basisW, h / basisH);
			for (const layer of canvas.layers) {
				const scale = fit * layer.emphasis;
				layer.spine.scale.set(scale);
				layer.spine.position.set(w / 2 - layer.centerX * scale, h / 2 - layer.centerY * scale);
			}
		}
	}

	/**
	 * Run one depth's burst while `active`. Per depth, not both at once: CoinFountain lights the
	 * sparkle earlier than the glow and holds it longer, so the two run on their own windows.
	 * Stopping a ticker leaves the last frame on that canvas — invisible, because its host is fading
	 * out via CSS at the same time.
	 *
	 * Each activation REPLAYS from the top rather than resuming. The glow's authored loop is a
	 * one-shot burst with a dead tail — it fades in over ~0.6s, holds to ~1.7s, fades out by ~2.3s,
	 * then sits FULLY TRANSPARENT for the rest of its 4.33s (~47% of the loop). Resuming wherever the
	 * ticker last froze would therefore show nothing at all on roughly half of all merges. (The
	 * sparkle sidesteps the dead tail differently — it loops only its star window; see loopRange.)
	 * CoinFountain starts each layer BEFORE the first coin lands so the ramp-in is done as they merge.
	 */
	setActive(depth: GlowDepth, active: boolean): void {
		const canvas = this.canvases.find((c) => c.depth === depth);
		if (!this.ready || !canvas) return;
		if (active === canvas.running) return;
		canvas.running = active;
		if (!active) {
			canvas.app.ticker.stop();
			return;
		}
		for (const layer of canvas.layers) this.playFromStart(layer);
		canvas.app.ticker.start();
	}

	destroy(): void {
		this.resizeObserver?.disconnect();
		this.resizeObserver = undefined;
		for (const canvas of this.canvases) {
			canvas.app.ticker.remove(canvas.tick);
			for (const layer of canvas.layers) layer.spine.destroy();
			const element = canvas.app.canvas as HTMLCanvasElement | undefined;
			if (element) element.style.visibility = 'hidden';
			// texture: false — the atlas pages stay in the shared Assets cache for the session, like the
			// coin fountain's.
			canvas.app.destroy(true, { children: true, texture: false });
		}
		this.canvases = [];
		this.ready = false;
	}
}
