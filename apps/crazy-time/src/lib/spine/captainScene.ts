import '@esotericsoftware/spine-pixi-v8';
import { Spine } from '@esotericsoftware/spine-pixi-v8';
import { Application, Assets, UPDATE_PRIORITY, type Ticker } from 'pixi.js';

import { isLite } from '../deviceTier.svelte';
import { staticNetworkUrl } from '../staticUrl';

/**
 * The captain on the Buy Bonus screen (components/BuyBonusModal.svelte), drawn from the artist's
 * Spine skeleton (static/spine/buy_bonus_captain) on a small transparent canvas where her still
 * (img/buy-bonus/character.webp, 932x1070) stands: the right of a WIDE landscape screen, her
 * lower half off its bottom edge. Her one animation is a 6.67 s idle (breathing, a blink, the hat,
 * hair and earrings swaying) that loops seamlessly, so it simply loops from its start.
 *
 * The skeleton was authored over the cabin's landscape picture, with the picture's foot on its
 * origin and the captain standing on it — the still is that same pose cut at the picture's foot.
 * She is laid on the still's own box (STILL_*, measured by overlaying the two), so the still under
 * the canvas and the canvas over it agree to the pixel and the hand-over between them never shows.
 *
 * The canvas is the still's box let out at the top and the left (PAD_*): her hat and hair sway a
 * little past the still's edges, and the still's box would clip them.
 *
 * Aliases and files are kept here so the intro preload warms exactly what this mounts.
 */
export const CAPTAIN_SPINE = {
	skeleton: { alias: 'buyBonusCaptain-skeleton', path: 'spine/buy_bonus_captain/skeleton.json' },
	atlas: { alias: 'buyBonusCaptain-atlas', path: 'spine/buy_bonus_captain/skeleton.atlas' },
	pages: ['spine/buy_bonus_captain/skeleton.webp'],
} as const;
/** Every file the skeleton loads — for the preload's drift alarm. */
export const CAPTAIN_FILES: readonly string[] = [
	CAPTAIN_SPINE.skeleton.path,
	CAPTAIN_SPINE.atlas.path,
	...CAPTAIN_SPINE.pages,
];

/** Register and load the skeleton into Pixi's cache. Idempotent; rejects if anything fails. */
export const loadCaptainSpine = async (): Promise<void> => {
	const { skeleton, atlas } = CAPTAIN_SPINE;
	for (const { alias, path } of [skeleton, atlas]) {
		if (!Assets.resolver.hasKey(alias)) Assets.add({ alias, src: staticNetworkUrl(path) });
	}
	await Assets.load([skeleton.alias, atlas.alias]);
};

const ANIMATION = 'animation';

/** The still's size, in its pixels. */
const STILL_W = 932;
const STILL_H = 1070;
/**
 * The skeleton in the still's frame: where its origin falls (still pixels, from the top-left) and
 * still pixels per skeleton unit.
 */
const STILL_ORIGIN_X = 463;
const STILL_ORIGIN_Y = 1070;
const STILL_PER_UNIT = 1;

/**
 * How far the canvas runs past the still's box, as shares of the still's width (left) and height
 * (top). The same two numbers are in BuyBonusModal.svelte's `.bb-captain` — keep them in step.
 */
export const PAD_LEFT = 0.04;
export const PAD_TOP = 0.06;

/** Frame-time cap: a stall pauses her rather than skipping ahead. */
const MAX_STEP_SECONDS = 0.1;

/**
 * The captain on a transparent WebGL canvas filling `host`. Backing store at the device's pixel
 * ratio times any CSS `zoom` above it, capped at 2 (1 on the reduced budget, which shows the still
 * instead and never makes one). `onLost` is called if the browser takes the canvas's context back,
 * so the screen can fall back to the still.
 */
export class CaptainScene {
	private readonly host: HTMLElement;
	private readonly onLost: () => void;
	private app?: Application;
	private captain?: Spine;
	private observer?: ResizeObserver;
	private destroyed = false;

	constructor(host: HTMLElement, onLost: () => void) {
		this.host = host;
		this.onLost = onLost;
	}

	/**
	 * Resolves true once her first frame is on the canvas — the caller hides the still then, not
	 * before — and false if the scene could not be put up (the still stays).
	 */
	async init(): Promise<boolean> {
		try {
			await loadCaptainSpine();
		} catch (error) {
			console.error('[CaptainScene] assets failed to load', error);
			return false;
		}
		if (this.destroyed || !this.host.clientWidth || !this.host.clientHeight) return false;

		const app = new Application();
		try {
			await app.init({
				width: this.host.clientWidth,
				height: this.host.clientHeight,
				backgroundAlpha: 0,
				antialias: false,
				autoDensity: true,
				resolution: this.resolution(),
				preference: 'webgl',
			});
		} catch (error) {
			console.error('[CaptainScene] no canvas', error);
			return false;
		}
		if (this.destroyed) {
			app.destroy(true);
			return false;
		}
		app.canvas.style.display = 'block';
		app.canvas.addEventListener('webglcontextlost', this.lost);
		this.host.appendChild(app.canvas);
		this.app = app;

		const captain = Spine.from({
			skeleton: CAPTAIN_SPINE.skeleton.alias,
			atlas: CAPTAIN_SPINE.atlas.alias,
			autoUpdate: false,
		});
		captain.state.setAnimation(0, ANIMATION, true);
		captain.update(0);
		app.stage.addChild(captain);
		this.captain = captain;

		this.place();
		this.observer = new ResizeObserver(() => this.place());
		this.observer.observe(this.host);
		app.ticker.add(this.tick);

		// Her first frame: a utility-priority callback runs after the ticker's own render.
		await new Promise<void>((resolve) => app.ticker.addOnce(() => resolve(), undefined, UPDATE_PRIORITY.UTILITY));
		return !this.destroyed;
	}

	destroy(): void {
		this.destroyed = true;
		this.observer?.disconnect();
		this.observer = undefined;
		const app = this.app;
		this.app = undefined;
		this.captain = undefined;
		if (!app) return;
		app.ticker.remove(this.tick);
		app.canvas.removeEventListener('webglcontextlost', this.lost);
		// `texture: false`: the atlas page stays in Pixi's cache for the next time the screen opens.
		app.destroy(true, { children: true, texture: false });
	}

	private readonly lost = (): void => {
		console.warn('[CaptainScene] WebGL context lost — showing the still');
		this.onLost();
	};

	private readonly tick = (ticker: Ticker): void => {
		this.captain?.update(Math.min(ticker.deltaMS / 1000, MAX_STEP_SECONDS));
	};

	/** Size the canvas to the host and lay her on the still's box inside it. */
	private place(): void {
		const app = this.app;
		const captain = this.captain;
		const width = this.host.clientWidth;
		const height = this.host.clientHeight;
		if (!app || !captain || !width || !height) return;
		app.renderer.resize(width, height, this.resolution());
		// Host pixels per still pixel: the host is the still's width let out by PAD_LEFT.
		const perStill = width / (STILL_W * (1 + PAD_LEFT));
		const left = STILL_W * PAD_LEFT * perStill;
		const top = STILL_H * PAD_TOP * perStill;
		captain.scale.set(perStill * STILL_PER_UNIT);
		captain.position.set(left + STILL_ORIGIN_X * perStill, top + STILL_ORIGIN_Y * perStill);
	}

	private resolution(): number {
		const width = this.host.clientWidth;
		const zoom = width ? this.host.getBoundingClientRect().width / width : 1;
		const cap = isLite() ? 1 : 2;
		return Math.min(cap, Math.max(1, (window.devicePixelRatio || 1) * (zoom || 1)));
	}
}
