import '@esotericsoftware/spine-pixi-v8';
import { Spine } from '@esotericsoftware/spine-pixi-v8';
import { Application, Assets, Container, Sprite, type Texture, type Ticker } from 'pixi.js';

import { isLite } from '../deviceTier.svelte';
import { staticNetworkUrl } from '../staticUrl';
import {
	type BackdropScene,
	type SceneKey,
	type SpineBundle,
	SCENES,
	sceneAssets,
	spineAlias,
} from './backdropScenes';

/** Register a bundle's skeleton and atlas with Pixi under {@link spineAlias}. Idempotent. */
const registerBundle = (bundle: SpineBundle): string[] => {
	const aliases: string[] = [];
	for (const path of [bundle.skeleton, bundle.atlas]) {
		const alias = spineAlias(path);
		if (!Assets.resolver.hasKey(alias)) Assets.add({ alias, src: staticNetworkUrl(path) });
		aliases.push(alias);
	}
	return aliases;
};

/**
 * Load everything the scenes draw into Pixi's cache: the skeletons, their atlases (pages and all —
 * the atlas loader fetches those itself) and the still images that go into their slots. The intro
 * preload calls this for the scenes it warms, and a renderer calls it again on init, which is then a
 * straight cache hit. Rejects if anything fails, so the caller keeps its still.
 */
export const loadBackdropAssets = async (keys: readonly SceneKey[]): Promise<void> => {
	const { bundles, images } = sceneAssets(keys);
	const aliases = bundles.flatMap(registerBundle);
	await Assets.load([...aliases, ...images.map(staticNetworkUrl)]);
};

/** The lurch (see {@link SceneSpineRenderer.lurch}): offsets as shares of the frame's height, down. */
const LURCH_KEYS: readonly [at: number, offset: number][] = [
	[0, 0],
	[0.14, 0.05],
	[0.38, -0.015],
	[0.6, 0.01],
	[0.8, -0.004],
	[1, 0],
];
const LURCH_MS = 1600;
/** Frame-time cap: a stall (an atlas upload, a hidden tab coming back) pauses, it does not skip. */
const MAX_STEP_SECONDS = 0.1;

type Options = {
	/** Painted the first frame — the component fades the canvas in over its still. */
	onReady?: () => void;
	/** The GPU took the canvas away — the component falls back to its still and rebuilds. */
	onLost?: () => void;
};

/**
 * One animated backdrop ({@link SCENES}): the scene skeleton, with the still art and the smaller
 * skeletons put back into the empty slots the artist left for them (`addSlotObject`, which draws a
 * Pixi container at that slot's place in the draw order, under that slot's bone). Cover-fitted to its
 * host, the scene's frame centred, like a CSS `background-size: cover`.
 *
 * Every skeleton runs off this app's own ticker with one shared step, so the scene and the pieces it
 * was split into (the rail fog's crossfade is half in each) never drift apart.
 *
 * Sized in the host's LAYOUT pixels with the backing store at the device's pixel ratio times any CSS
 * `zoom` above it (the Bonus Wheel room sits inside the game's zoomed frame), capped at 2, and 1 on
 * the reduced budget.
 */
export class SceneSpineRenderer {
	private readonly host: HTMLElement;
	private readonly options: Options;
	private app?: Application;
	private root?: Spine;
	private scene?: BackdropScene;
	private readonly spines: Spine[] = [];
	/** Slots of a skeleton kept empty because another skeleton draws what they hold. */
	private readonly hidden: { spine: Spine; slots: string[] }[] = [];
	/** Inner containers of the deck mounts, moved against the lurch so the deck stays put. */
	private readonly onDeck: Container[] = [];
	private resizeObserver?: ResizeObserver;
	private fitFrameId = 0;
	private fitScale = 1;
	private lurchStart = -1;
	private lurchOffset = 0;
	private paused = false;
	private destroyed = false;

	constructor(host: HTMLElement, options: Options = {}) {
		this.host = host;
		this.options = options;
	}

	/** Resolves false if the scene could not be put up (assets failed, or torn down meanwhile). */
	async init(key: SceneKey): Promise<boolean> {
		const scene: BackdropScene = SCENES[key];
		await this.waitForHostSize();
		if (this.destroyed) return false;

		try {
			await loadBackdropAssets([key]);
		} catch (error) {
			console.error(`[SceneSpineRenderer] ${scene.id}: assets failed to load`, error);
			return false;
		}
		if (this.destroyed) return false;

		const app = new Application();
		await app.init({
			width: this.host.clientWidth,
			height: this.host.clientHeight,
			backgroundAlpha: 0,
			// Off: alpha-textured quads only, and a full-screen MSAA backbuffer is the GPU pressure that
			// gets WebGL contexts reaped on iOS.
			antialias: false,
			autoDensity: true,
			resolution: this.resolution(),
			preference: 'webgl',
		});
		if (this.destroyed) {
			app.destroy(true);
			return false;
		}
		app.canvas.style.display = 'block';
		app.canvas.addEventListener('webglcontextlost', this.contextLost);
		this.host.appendChild(app.canvas);
		this.app = app;
		this.scene = scene;

		const root = this.makeSpine(scene.bundle, scene.hideSlots);
		for (const mount of scene.mounts) {
			const holder = new Container();
			const inner = new Container();
			holder.addChild(inner);
			for (const layer of mount.layers) {
				const child =
					layer.kind === 'image'
						? this.makeImage(layer.path)
						: this.makeSpine(layer.bundle, layer.hideSlots, layer.loopSeconds);
				child.position.set(layer.x ?? 0, -(layer.y ?? 0));
				child.scale.set(layer.scale ?? 1);
				inner.addChild(child);
			}
			if (mount.onDeck) this.onDeck.push(inner);
			root.addSlotObject(mount.slot, holder);
		}
		app.stage.addChild(root);
		this.root = root;

		// Pose everything at t=0 before the first paint, so it never shows a setup pose.
		this.step(0);
		this.fit();
		app.ticker.add(this.tick);
		if (this.paused) app.ticker.stop();
		app.renderer.render(app.stage);
		this.options.onReady?.();

		this.resizeObserver = new ResizeObserver(() => this.scheduleFit());
		this.resizeObserver.observe(this.host);
		return true;
	}

	/** Hold the scene on its current frame (the table under a bonus room), or let it run again. */
	setPaused(paused: boolean): void {
		this.paused = paused;
		const ticker = this.app?.ticker;
		if (!ticker) return;
		if (paused) ticker.stop();
		else ticker.start();
	}

	/**
	 * A sudden drop and a few quick bobs dying away, for everything behind the rail — the knock of a
	 * bonus room's icon slamming back into the wheel. The deck mounts (`onDeck`) are held where they
	 * are, so it reads as the sea heaving rather than the screen shaking.
	 */
	lurch(): void {
		if (!this.app || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
		this.lurchStart = performance.now();
	}

	destroy(): void {
		this.destroyed = true;
		cancelAnimationFrame(this.fitFrameId);
		this.resizeObserver?.disconnect();
		this.resizeObserver = undefined;
		const app = this.app;
		this.app = undefined;
		if (app) {
			app.canvas.removeEventListener('webglcontextlost', this.contextLost);
			app.ticker.remove(this.tick);
		}
		this.root?.destroy({ children: true });
		this.root = undefined;
		this.spines.length = 0;
		this.onDeck.length = 0;
		// `texture: false`: the art stays in Pixi's cache, warmed by the preload, for the next mount.
		app?.destroy(true, { children: true, texture: false });
	}

	private makeImage(path: string): Sprite {
		const sprite = new Sprite(Assets.get<Texture>(staticNetworkUrl(path)));
		// Bottom centre on the slot bone: the scene's frames are all authored foot-centred.
		sprite.anchor.set(0.5, 1);
		return sprite;
	}

	private makeSpine(bundle: SpineBundle, hideSlots?: readonly string[], loopSeconds?: number): Spine {
		const spine = Spine.from({
			skeleton: spineAlias(bundle.skeleton),
			atlas: spineAlias(bundle.atlas),
			autoUpdate: false,
		});
		const animation = spine.skeleton.data.animations[0];
		if (animation) {
			const entry = spine.state.setAnimation(0, animation.name, true);
			if (loopSeconds) entry.animationEnd = loopSeconds;
		}
		if (hideSlots?.length) this.hidden.push({ spine, slots: [...hideSlots] });
		this.spines.push(spine);
		return spine;
	}

	private readonly tick = (ticker: Ticker): void => {
		this.step(Math.min(ticker.deltaMS / 1000, MAX_STEP_SECONDS));
		if (this.lurchStart >= 0) this.applyLurch();
	};

	private step(seconds: number): void {
		// Emptied every step rather than once: nothing in the animations sets them, but a slot handed
		// back to its setup pose would otherwise draw the hidden fog a second time.
		for (const { spine, slots } of this.hidden) {
			for (const name of slots) spine.skeleton.findSlot(name)?.pose.setAttachment(null);
		}
		for (const spine of this.spines) spine.update(seconds);
	}

	private applyLurch(): void {
		const t = (performance.now() - this.lurchStart) / LURCH_MS;
		let offset = 0;
		if (t >= 1) {
			this.lurchStart = -1;
		} else {
			const i = LURCH_KEYS.findIndex(([at]) => at > t);
			const [a, from] = LURCH_KEYS[i - 1];
			const [b, to] = LURCH_KEYS[i];
			const u = (t - a) / (b - a);
			offset = from + (to - from) * u * u * (3 - 2 * u);
		}
		this.lurchOffset = offset * (this.scene?.frame.height ?? 0);
		for (const inner of this.onDeck) inner.y = -this.lurchOffset;
		this.place();
	}

	private resolution(): number {
		const width = this.host.clientWidth;
		const zoom = width ? this.host.getBoundingClientRect().width / width : 1;
		const cap = isLite() ? 1 : 2;
		return Math.min(cap, Math.max(1, (window.devicePixelRatio || 1) * (zoom || 1)));
	}

	private waitForHostSize(): Promise<void> {
		if (this.host.clientWidth > 0 && this.host.clientHeight > 0) return Promise.resolve();
		return new Promise((resolve) => {
			const observer = new ResizeObserver(() => {
				if (this.host.clientWidth <= 0 || this.host.clientHeight <= 0) return;
				observer.disconnect();
				resolve();
			});
			observer.observe(this.host);
		});
	}

	private scheduleFit(): void {
		cancelAnimationFrame(this.fitFrameId);
		this.fitFrameId = requestAnimationFrame(() => this.fit());
	}

	/** Size the canvas to the host and cover-fit the scene's frame into it, centred. */
	private fit(): void {
		const { app, scene } = this;
		if (!app || !scene) return;
		const width = this.host.clientWidth;
		const height = this.host.clientHeight;
		if (!width || !height) return;
		app.renderer.resize(width, height, this.resolution());
		this.fitScale = Math.max(width / scene.frame.width, height / scene.frame.height);
		this.place();
		// A resize clears the canvas; repaint now rather than on the next tick, which a paused scene
		// would never get.
		app.renderer.render(app.stage);
	}

	/** The root at the host's centre less half the frame (the frame hangs ABOVE the root, y-up). */
	private place(): void {
		const { root, scene, app } = this;
		if (!root || !scene || !app) return;
		const scale = this.fitScale;
		root.scale.set(scale);
		root.position.set(
			app.screen.width / 2,
			app.screen.height / 2 + (scene.frame.height / 2 + this.lurchOffset) * scale,
		);
	}

	private readonly contextLost = (event: Event): void => {
		event.preventDefault();
		this.options.onLost?.();
	};
}
