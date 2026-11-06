import '@esotericsoftware/spine-pixi-v8';
import { Spine } from '@esotericsoftware/spine-pixi-v8';
import { Application, Assets, Container, type Ticker } from 'pixi.js';

import { isLite } from '../deviceTier.svelte';
import { staticNetworkUrl } from '../staticUrl';

/**
 * The kraken's coming in Ocean Voyage (rooms/RoomOceanVoyageV2.svelte), drawn from the artist's two
 * Spine skeletons on one transparent canvas over the whole room:
 *
 * - Four TENTACLES (static/spine/kraken_tentacles), the artist's one tentacle drawn four times over,
 *   shooting up from behind the deck's rail one after another.
 * - Then the KRAKEN itself (static/spine/kraken): its animation rises up from behind the rail
 *   (0-1.6 s: up, a dip, settled) and then breathes, its tentacles gripping over the rail.
 *
 * The tentacle is authored lying on its side: its flat-cut base at the skeleton's root on the right,
 * its tip off to the left, the suckers underneath, curling up and over in two 2 s loops. It is stood
 * upright by turning the container it sits in, not its root bone — the artist warned that rotating
 * the root in Spine could break the rig (its path and IK constraints).
 *
 * The kraken is authored in the frame of the deck's own picture (v2/ship.webp, 1918x1505): its
 * skeleton's origin is on the picture's middle line, KRAKEN_ORIGIN_UP above its foot, and its empty
 * `pov_ship` slot is where the deck goes, in front of everything. The room's deck picture stands in
 * front of this canvas already, so the slot is left empty and the skeleton is laid on the deck's own
 * place and scale — the kraken then sits behind the rail exactly as in the artist's scene.
 *
 * Aliases and files are kept here so the intro preload warms exactly what this mounts.
 */
export const KRAKEN_TENTACLES = {
	skeleton: { alias: 'krakenTentacles-skeleton', path: 'spine/kraken_tentacles/skeleton.json' },
	atlas: { alias: 'krakenTentacles-atlas', path: 'spine/kraken_tentacles/skeleton.atlas' },
	pages: ['spine/kraken_tentacles/skeleton.png'],
} as const;
export const KRAKEN_BODY = {
	skeleton: { alias: 'kraken-skeleton', path: 'spine/kraken/skeleton.json' },
	atlas: { alias: 'kraken-atlas', path: 'spine/kraken/skeleton.atlas' },
	pages: ['spine/kraken/skeleton.png'],
} as const;
const BUNDLES = [KRAKEN_TENTACLES, KRAKEN_BODY] as const;
/** Every file either skeleton loads — for the preload's drift alarm. */
export const KRAKEN_FILES: readonly string[] = BUNDLES.flatMap((b) => [b.skeleton.path, b.atlas.path, ...b.pages]);

/** Register and load both skeletons into Pixi's cache. Idempotent; rejects if anything fails. */
export const loadKrakenSpines = async (): Promise<void> => {
	const aliases: string[] = [];
	for (const bundle of BUNDLES) {
		for (const { alias, path } of [bundle.skeleton, bundle.atlas]) {
			if (!Assets.resolver.hasKey(alias)) Assets.add({ alias, src: staticNetworkUrl(path) });
			aliases.push(alias);
		}
	}
	await Assets.load(aliases);
};

/** The kraken's animation, and how high its skeleton's origin is up from the deck picture's foot
    (the skeleton's setup bounds run from -151.85 to the picture's top, 1505 units up). */
const KRAKEN_ANIMATION = 'animation';
const KRAKEN_ORIGIN_UP = 151.85;
/** The deck picture's height, in its pixels (v2/ship.webp). */
const DECK_PICTURE_H = 1505;
/** How long the kraken's own rise takes in its animation: up, a dip, settled. */
export const KRAKEN_RISE_MS = 1600;

/** The tentacle's length, base to tip, and where its base is up the skeleton (y-up), in its units. */
const TENTACLE_LENGTH = 885;
const TENTACLE_BASE_Y = 191;
const TENTACLE_ANIMATIONS = ['subtle/animation', 'subtle/gentle'] as const;
/** The tentacles' curl, against the artist's own speed: 25% slower. */
const TENTACLE_SPEED = 0.75;

/**
 * One tentacle, in a square the size of the screen's short side, standing on the kraken (shares of
 * its side): where its base stands (`x`, `y`, down), how long it is, and how far it leans from
 * upright (degrees, outward positive). The left-hand ones are drawn as authored — suckers to the
 * outside — and `mirror` flips one onto the right. The tentacles come up before the kraken, so every
 * base is down below the deck's rail (which falls away to the sides, so the outer ones lower still):
 * no cut end ever shows.
 */
type Placement = { x: number; y: number; length: number; lean: number; mirror: boolean };
type Pair = Omit<Placement, 'mirror'>;
/**
 * Landscape: out at the sides of the kraken and just inside its edges. Portrait: the square IS the
 * screen's width, so there is no outside; one pair at the screen's edges and one further in, both
 * long enough to curl up over the top of the kraken's head.
 */
const PAIRS: Record<'landscape' | 'portrait', readonly [outer: Pair, inner: Pair]> = {
	landscape: [
		{ x: -0.14, y: 1.02, length: 0.95, lean: 14 },
		{ x: 0.05, y: 1.02, length: 1.05, lean: 4 },
	],
	portrait: [
		{ x: 0.04, y: 1.02, length: 1.15, lean: 8 },
		{ x: 0.26, y: 1.02, length: 1.25, lean: 2 },
	],
};
/** In the order they come up: one side and then the other, outer pair first. */
const placements = (portrait: boolean): Placement[] =>
	PAIRS[portrait ? 'portrait' : 'landscape'].flatMap((pair) => [
		{ ...pair, mirror: false },
		{ ...pair, x: 1 - pair.x, mirror: true },
	]);

/**
 * How a tentacle comes up: it shoots up from behind the rail — rising GROW_RISE of its length and
 * growing from GROW_FROM of its size — over GROW_MS, overshooting a little and settling, each one
 * GROW_STAGGER_MS after the one before. Both 25% slower than they were (380 and 150 ms).
 */
const GROW_FROM = 0.35;
const GROW_RISE = 0.35;
const GROW_MS = Math.round(380 / TENTACLE_SPEED);
const GROW_STAGGER_MS = Math.round(150 / TENTACLE_SPEED);
/** When the last of the four is all the way up, after the first one starts. */
export const TENTACLES_UP_MS = 3 * GROW_STAGGER_MS + GROW_MS;
/** Frame-time cap: a stall pauses the animations rather than skipping them. */
const MAX_STEP_SECONDS = 0.1;

const easeOutBack = (t: number) => {
	const c = 1.4;
	return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2;
};

/** Where things stand, in the room's layout pixels — the room recomputes it on every resize. */
export type KrakenLayout = {
	/** The tentacles' square: its middle across, its foot down the room, and its side. */
	square: { cx: number; foot: number; side: number };
	/** The deck picture: its middle across, its top down the room, and room pixels per its pixel. */
	deck: { cx: number; top: number; scale: number };
	/**
	 * How much smaller than the deck's frame the kraken is drawn (1: exactly in it), shrunk about the
	 * point `pivotY` down the room on its middle line — the top of the rail, so it stays sat behind
	 * it. A phone's deck is drawn large for the wheel, and the kraken in its frame would be nearly
	 * twice the screen's width.
	 */
	krakenFit: number;
	pivotY: number;
};

/** The kraken's widest part (its front tentacles), in its skeleton's units. */
export const KRAKEN_SPAN = 1177;

type Tentacle = { spine: Spine; holder: Container; placement: Placement; delay: number };

/**
 * The kraken scene, on a transparent WebGL canvas filling `host`. The tentacles start `tentaclesAtMs`
 * after it is made, one by one; the kraken's rise starts at `krakenAtMs`. Backing store at the
 * device's pixel ratio times any CSS `zoom` above it, capped at 2, and 1 on the reduced budget.
 */
export class KrakenScene {
	private readonly host: HTMLElement;
	private readonly options: { tentaclesAtMs: number; krakenAtMs: number; portrait: boolean };
	private readonly startedAt = performance.now();
	private app?: Application;
	private kraken?: Spine;
	private readonly tentacles: Tentacle[] = [];
	private layout?: KrakenLayout;
	private destroyed = false;

	constructor(host: HTMLElement, options: { tentaclesAtMs: number; krakenAtMs: number; portrait: boolean }) {
		this.host = host;
		this.options = options;
	}

	/** Resolves false if the scene could not be put up; the room then shows its still kraken. */
	async init(): Promise<boolean> {
		try {
			await loadKrakenSpines();
		} catch (error) {
			console.error('[KrakenScene] assets failed to load', error);
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
			console.error('[KrakenScene] no canvas', error);
			return false;
		}
		if (this.destroyed) {
			app.destroy(true);
			return false;
		}
		app.canvas.style.display = 'block';
		this.host.appendChild(app.canvas);
		this.app = app;

		placements(this.options.portrait).forEach((placement, i) => {
			const spine = Spine.from({
				skeleton: KRAKEN_TENTACLES.skeleton.alias,
				atlas: KRAKEN_TENTACLES.atlas.alias,
				autoUpdate: false,
			});
			// Its base on the holder's origin.
			spine.y = TENTACLE_BASE_Y;
			// Stood upright: turned a quarter clockwise, so the tip (authored to the left) points up.
			const upright = new Container();
			upright.rotation = Math.PI / 2;
			upright.addChild(spine);
			const holder = new Container();
			holder.addChild(upright);
			holder.visible = false;
			app.stage.addChild(holder);

			// Neighbours never curl in step: alternate loops, each its own speed and place in it.
			const entry = spine.state.setAnimation(0, TENTACLE_ANIMATIONS[i % TENTACLE_ANIMATIONS.length], true);
			entry.trackTime = (i * 0.37) % 2;
			entry.timeScale = (0.8 + ((i * 7) % 5) * 0.08) * TENTACLE_SPEED;
			spine.update(0);
			this.tentacles.push({ spine, holder, placement, delay: i * GROW_STAGGER_MS });
		});

		// The kraken, over its tentacles. Its animation plays once: the rise, then ~15 s of breathing,
		// longer than it is ever on screen.
		const kraken = Spine.from({ skeleton: KRAKEN_BODY.skeleton.alias, atlas: KRAKEN_BODY.atlas.alias, autoUpdate: false });
		kraken.state.setAnimation(0, KRAKEN_ANIMATION, false);
		kraken.update(0);
		kraken.visible = false;
		app.stage.addChild(kraken);
		this.kraken = kraken;

		this.place();
		app.ticker.add(this.tick);
		return true;
	}

	/** Where everything stands (the room calls this on every resize). */
	setLayout(layout: KrakenLayout): void {
		this.layout = layout;
		this.place();
	}

	destroy(): void {
		this.destroyed = true;
		const app = this.app;
		this.app = undefined;
		app?.ticker.remove(this.tick);
		this.tentacles.length = 0;
		this.kraken = undefined;
		// `texture: false`: the atlas pages stay in Pixi's cache for the next kraken.
		app?.destroy(true, { children: true, texture: false });
	}

	private readonly tick = (ticker: Ticker): void => {
		const seconds = Math.min(ticker.deltaMS / 1000, MAX_STEP_SECONDS);
		const elapsed = performance.now() - this.startedAt;
		const side = this.layout?.square.side ?? 0;

		const since = elapsed - this.options.tentaclesAtMs;
		for (const { spine, holder, placement, delay } of this.tentacles) {
			spine.update(seconds);
			const t = (since - delay) / GROW_MS;
			holder.visible = t > 0 && side > 0;
			if (!holder.visible) continue;
			const e = t >= 1 ? 1 : easeOutBack(t);
			const grow = GROW_FROM + (1 - GROW_FROM) * e;
			const size = (placement.length * side * grow) / TENTACLE_LENGTH;
			holder.scale.set(placement.mirror ? -size : size, size);
			holder.y = this.baseY(placement) + (1 - e) * GROW_RISE * placement.length * side;
			holder.alpha = Math.min(1, t * 4);
		}

		const kraken = this.kraken;
		if (kraken && elapsed >= this.options.krakenAtMs) {
			// Its first frame lands on its own t=0, however late the tick.
			if (!kraken.visible) kraken.visible = true;
			else kraken.update(seconds);
		}
	};

	/** Size the canvas to the host, stand each tentacle on its base and lay the kraken on the deck. */
	private place(): void {
		const app = this.app;
		const layout = this.layout;
		const width = this.host.clientWidth;
		const height = this.host.clientHeight;
		if (!app || !layout || !width || !height) return;
		app.renderer.resize(width, height, this.resolution());
		const { square, deck } = layout;
		for (const { holder, placement } of this.tentacles) {
			holder.position.set(square.cx + (placement.x - 0.5) * square.side, this.baseY(placement));
			// Outward is anticlockwise (to the left) on the left; a mirrored one leans the other way.
			holder.rotation = ((placement.mirror ? 1 : -1) * placement.lean * Math.PI) / 180;
		}
		if (this.kraken) {
			const fit = layout.krakenFit;
			const originY = deck.top + (DECK_PICTURE_H - KRAKEN_ORIGIN_UP) * deck.scale;
			this.kraken.scale.set(deck.scale * fit);
			this.kraken.position.set(deck.cx, layout.pivotY + (originY - layout.pivotY) * fit);
		}
	}

	/** A base's height down the room: `y` of the square's side down from its top. */
	private baseY(placement: Placement): number {
		const square = this.layout?.square;
		return square ? square.foot + (placement.y - 1) * square.side : 0;
	}

	private resolution(): number {
		const width = this.host.clientWidth;
		const zoom = width ? this.host.getBoundingClientRect().width / width : 1;
		const cap = isLite() ? 1 : 2;
		return Math.min(cap, Math.max(1, (window.devicePixelRatio || 1) * (zoom || 1)));
	}
}
