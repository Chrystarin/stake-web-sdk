import '@esotericsoftware/spine-pixi-v8';
import {
	Physics,
	Spine,
	Vector2,
	type SkeletonData,
} from '@esotericsoftware/spine-pixi-v8';
import { Application, Assets, Ticker } from 'pixi.js';

import { uiScale } from '../uiScale';
import { COIN_FOUNTAIN_ANIMATIONS, getCoinFountainAssets } from './coinFountainAsset';
import { loadSpineAsset } from './spineAssetCache';
import { readSkeletonData } from './spineSkeletonData';
import type { SpineAssetDef } from './types';

export type FountainPoint = { x: number; y: number };

/** A "this coin is about to land" callback, fired `ms` before it does. See CoinBurstOptions.leads. */
export type CoinBurstLead = { ms: number; onLead: () => void };

export type CoinBurstOptions = {
	/** Screen-space (client px) origin — the coins pour out of here (the win modal). */
	from: FountainPoint;
	/** Screen-space (client px) destination — the coins fly into here (the balance coin). */
	to: FountainPoint;
	/** How many coins to launch. Clamped to a sane range. */
	count?: number;
	/**
	 * Landing warnings: each fires once per coin, `ms` before that coin reaches the destination. The
	 * lead is taken off the coin's OWN remaining flight time, so it holds however the frame rate
	 * wanders — unlike a wall-clock timer started at launch, which has to guess the travel time and
	 * drifts out of it on a slow frame. Order doesn't matter (sorted internally).
	 */
	leads?: CoinBurstLead[];
	/**
	 * Dissolve on approach instead of landing: the coins follow the same path but fade to nothing
	 * short of `to`, and never shrink into it. For a stream that only POINTS at its destination —
	 * the in-bonus free spin's coins toward the Win field, whose value the wheel already credited —
	 * rather than one delivering a credit that lands there. `onArrive`/`leads` are meaningless with
	 * it (nothing arrives to see), so callers leave them off.
	 */
	fadeOut?: boolean;
	/** Multiplier on every coin's drawn size. Below 1 for a burst that paid less than a whole coin —
	 * the free-spin wheel's 0.5X throws one visibly smaller coin rather than half a coin. */
	sizeScale?: number;
	/** How long the launches are spread over (ms, whole burst) and how long one coin's flight takes
	 * (ms, ± ~43%). The defaults are the collect's leisurely pacing, tuned for ~40 coins pouring into
	 * the balance; a short flourish that another beat is queued behind passes something tighter. */
	staggerMs?: number;
	durationMs?: number;
	/** Fired each time a coin reaches the destination (throttled by the caller if needed). */
	onArrive?: () => void;
	/** Fired once when the last coin of this burst has landed and none remain in flight. */
	onComplete?: () => void;
};

/** Prepared skeleton data + the setup-pose content centre (skeleton units) used to anchor a coin. */
type CoinSkeleton = {
	skeletonData: SkeletonData;
	centerX: number;
	centerY: number;
	/** Setup-pose content height, so a coin can be scaled to a target pixel size. */
	contentHeight: number;
};

type FlyingCoin = {
	spine: Spine;
	skel: CoinSkeleton;
	p0: FountainPoint;
	c1: FountainPoint;
	c2: FountainPoint;
	p3: FountainPoint;
	/** ms of stagger before this coin launches (keeps them a stream, not a single clump). */
	startAt: number;
	/** ms travel time from origin to destination. */
	duration: number;
	/** ms since spawn (advances every frame, incl. the pre-launch stagger). */
	elapsed: number;
	/** target on-screen height in px (drives scale = height / contentHeight). */
	sizePx: number;
	/** extra flip speed multiplier for variety. */
	spinRate: number;
	/** Fade out short of the destination rather than landing in it (see CoinBurstOptions.fadeOut). */
	fadeOut: boolean;
	arrived: boolean;
	/** Landing warnings for this coin, sorted EARLIEST first (descending `ms`). Shared, read-only. */
	leads: CoinBurstLead[];
	/** How many of `leads` have fired — they are one-shot, and sorted, so a cursor is enough. */
	leadsFired: number;
	onArrive?: () => void;
};

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const easeInOutCubic = (t: number) =>
	t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

const cubicBezier = (
	p0: FountainPoint,
	c1: FountainPoint,
	c2: FountainPoint,
	p3: FountainPoint,
	t: number,
	out: FountainPoint,
): void => {
	const u = 1 - t;
	const w0 = u * u * u;
	const w1 = 3 * u * u * t;
	const w2 = 3 * u * t * t;
	const w3 = t * t * t;
	out.x = w0 * p0.x + w1 * c1.x + w2 * c2.x + w3 * p3.x;
	out.y = w0 * p0.y + w1 * c1.y + w2 * c2.y + w3 * p3.y;
};

/**
 * Transparent, click-through, full-viewport Pixi overlay that plays the on-win coin burst: a stream
 * of spinning spine coins that erupt out of the win modal and funnel into the balance coin. Mounted
 * once for the session (creating/destroying a WebGL canvas mid-game flashes white on some GPUs — see
 * the meter notes), it sits idle with its ticker STOPPED and only spins up while coins are in flight.
 */
export class CoinFountainRenderer {
	private hostElement: HTMLElement;
	private app?: Application;
	private coinSkeletons: CoinSkeleton[] = [];
	private coins: FlyingCoin[] = [];
	private ready = false;
	private running = false;
	/** Fired when the in-flight coins drain to zero (set per burst; see CoinBurstOptions.onComplete). */
	private onBurstComplete?: () => void;
	private readonly tick = (ticker: Ticker) => this.update(ticker.deltaMS);
	private readonly scratch: FountainPoint = { x: 0, y: 0 };

	constructor(hostElement: HTMLElement) {
		this.hostElement = hostElement;
	}

	async init(): Promise<void> {
		if (this.app) return;
		const app = new Application();
		await app.init({
			resizeTo: this.hostElement,
			backgroundAlpha: 0,
			// Antialias off: a freshly cleared MSAA buffer can composite as an opaque white box for a
			// frame on some GPUs (same reasoning as the meters). The coins are alpha PNGs, so MSAA buys
			// nothing visible here anyway.
			antialias: false,
			autoDensity: true,
			resolution: typeof window !== 'undefined' ? Math.min(2, window.devicePixelRatio || 1) : 1,
			preference: 'webgl',
		});
		this.hostElement.appendChild(app.canvas);
		app.canvas.style.display = 'block';
		app.canvas.style.width = '100%';
		app.canvas.style.height = '100%';
		// Idle until the first burst — no per-frame work between wins.
		app.ticker.stop();
		app.ticker.add(this.tick);
		this.app = app;

		this.coinSkeletons = await this.loadCoinSkeletons();
		this.ready = this.coinSkeletons.length > 0;
	}

	private async loadCoinSkeletons(): Promise<CoinSkeleton[]> {
		const defs = getCoinFountainAssets();
		const loaded = await Promise.all(
			defs.map((def) =>
				this.loadOne(def).catch((err) => {
					console.error('[CoinFountainRenderer] failed to load', def.id, err);
					return undefined;
				}),
			),
		);
		return loaded.filter((s): s is CoinSkeleton => Boolean(s));
	}

	private async loadOne(asset: SpineAssetDef): Promise<CoinSkeleton> {
		// Shared cache: the intro loader preloads these coins, so this normally resolves without a fetch,
		// and the aliases are only ever added to Pixi's global resolver once (no "overwriting" warning).
		const { atlasAlias, skeletonAlias } = await loadSpineAsset(asset);
		const atlas = Assets.get(atlasAlias);
		const skeletonSource = Assets.get(skeletonAlias);
		if (!atlas || !skeletonSource) {
			throw new Error(`[CoinFountainRenderer] missing spine assets for ${asset.id}`);
		}
		const skeletonData = readSkeletonData(asset, atlas, skeletonSource);

		// Measure the setup-pose content box once so every coin of this skeleton can be centred on its
		// travel point and scaled to a target pixel height (getBounds mirrors SpineBackgroundRenderer).
		const probe = new Spine({ skeletonData, autoUpdate: false });
		probe.skeleton.setupPose();
		probe.state.apply(probe.skeleton);
		probe.skeleton.updateWorldTransform(Physics.update);
		const offset = new Vector2();
		const size = new Vector2();
		probe.skeleton.getBounds(offset, size, []);
		probe.destroy();

		const contentHeight = size.y > 0 ? size.y : skeletonData.height || 1;
		const contentWidth = size.x > 0 ? size.x : skeletonData.width || 1;
		return {
			skeletonData,
			centerX: offset.x + contentWidth / 2,
			centerY: offset.y + contentHeight / 2,
			contentHeight,
		};
	}

	/** Launch a coin burst from `from` to `to`. No-op until the skeletons have loaded. */
	burst(options: CoinBurstOptions): void {
		if (!this.ready || !this.app) return;
		const { from, to } = options;
		if (options.onComplete) this.onBurstComplete = options.onComplete;
		const count = Math.max(1, Math.min(48, Math.round(options.count ?? 26)));

		const dx = to.x - from.x;
		const dy = to.y - from.y;
		const dist = Math.max(1, Math.hypot(dx, dy));
		// Baseline coin size scales gently with viewport so it reads on phones and desktop alike.
		// (coefficient + clamp bounds cut 25% from the previous 0.042 / 22–46 for smaller coins.)
		// The bounds ride `uiScale()` for the same reason a CSS clamp's px bounds ride --ui-px: at the
		// 1024×576 reference the coefficient is what's active (0.0315 × 576 = 18.1), but on a 400×225
		// popout the raw 16.5 floor binds and the coins fly in at 2.3× their proportional size.
		const s = uiScale();
		const viewMin = Math.min(this.app.renderer.width, this.app.renderer.height) || 400;
		const baseSize =
			Math.max(16.5 * s, Math.min(34.5 * s, viewMin * 0.0315)) *
			Math.max(0.2, Math.min(2, options.sizeScale ?? 1));

		// Sorted once here, earliest warning first, so each coin only needs a cursor into it.
		const leads = [...(options.leads ?? [])].sort((a, b) => b.ms - a.ms);

		for (let i = 0; i < count; i++) {
			this.spawnCoin(from, to, dx, dy, dist, baseSize, i, count, options, leads);
		}

		if (!this.running) {
			this.running = true;
			this.app.ticker.start();
		}
	}

	private spawnCoin(
		from: FountainPoint,
		to: FountainPoint,
		dx: number,
		dy: number,
		dist: number,
		baseSize: number,
		index: number,
		count: number,
		options: CoinBurstOptions,
		leads: CoinBurstLead[],
	): void {
		const app = this.app;
		if (!app) return;
		const skel = this.coinSkeletons[index % this.coinSkeletons.length];
		const rand = Math.random;

		const spine = new Spine({ skeletonData: skel.skeletonData, autoUpdate: false });
		const anim = COIN_FOUNTAIN_ANIMATIONS[Math.floor(rand() * COIN_FOUNTAIN_ANIMATIONS.length)];
		const entry = spine.state.setAnimation(0, anim, true);
		// Desync the flip so coins don't spin in lockstep.
		entry.trackTime = rand() * 1;
		spine.alpha = 0;
		app.stage.addChild(spine);

		// Origin jitter — a small pool the coins leave from, not a single pixel.
		const p0: FountainPoint = {
			x: from.x + (rand() - 0.5) * baseSize * 1.1,
			y: from.y + (rand() - 0.5) * baseSize * 0.8,
		};
		const p3: FountainPoint = {
			x: to.x + (rand() - 0.5) * baseSize * 0.5,
			y: to.y + (rand() - 0.5) * baseSize * 0.5,
		};
		// Near-straight travel from the skull mouth to the balance coin: the bezier control points ride
		// the p0→p3 line (at ~1/3 and ~2/3) nudged only a SMALL amount perpendicular, so the path is a
		// gentle bow instead of a wide scatter-then-collect arc. Random side + a slight upward lift give
		// each coin a little individual character without leaving the line.
		const perpX = -dy / dist;
		const perpY = dx / dist;
		const side = rand() < 0.5 ? -1 : 1;
		const bow = (0.04 + rand() * 0.08) * dist * side;
		const lift = (0.015 + rand() * 0.04) * dist;
		const c1: FountainPoint = {
			x: p0.x + (p3.x - p0.x) * 0.33 + perpX * bow,
			y: p0.y + (p3.y - p0.y) * 0.33 + perpY * bow - lift,
		};
		const c2: FountainPoint = {
			x: p0.x + (p3.x - p0.x) * 0.66 + perpX * bow * 0.55,
			y: p0.y + (p3.y - p0.y) * 0.66 + perpY * bow * 0.55,
		};

		// Jitter is proportional to the pacing, so a tightened burst stays as loose (relatively) as the
		// default one rather than turning into a clump with a long random tail.
		const stagger = options.staggerMs ?? 850;
		const flight = options.durationMs ?? 1500;
		this.coins.push({
			spine,
			skel,
			p0,
			c1,
			c2,
			p3,
			// Stream the launches across the burst; slight jitter avoids a mechanical cadence.
			startAt: (index / count) * stagger + rand() * stagger * 0.153,
			// Travel time from the skull mouth into the balance coin — leisurely so the collect reads
			// clearly rather than snapping across the screen.
			duration: flight + rand() * flight * 0.433,
			elapsed: 0,
			sizePx: baseSize * (0.78 + rand() * 0.5),
			// Flip speed multiplier (the coin_act animation is a 1s flip loop; >1 spins faster).
			spinRate: 1.7 + rand() * 1.6,
			fadeOut: options.fadeOut === true,
			arrived: false,
			leads,
			leadsFired: 0,
			onArrive: options.onArrive,
		});
	}

	private update(deltaMs: number): void {
		const app = this.app;
		if (!app) return;
		const dt = Math.min(48, Math.max(0, deltaMs));

		for (const coin of this.coins) {
			if (coin.arrived) continue;
			coin.elapsed += dt;

			// Announce the landing ahead of time, off this coin's own clock — what the balance coin's
			// light layers ride in on, so each is up by the time the coin merges (see CoinFountain).
			// Sorted earliest-first, so everything now due is at the cursor.
			while (coin.leadsFired < coin.leads.length) {
				const lead = coin.leads[coin.leadsFired];
				if (coin.elapsed < coin.startAt + coin.duration - lead.ms) break;
				coin.leadsFired++;
				lead.onLead();
			}

			const tRaw = (coin.elapsed - coin.startAt) / coin.duration;

			if (tRaw <= 0) {
				// Pre-launch: park invisibly at the origin, but keep the flip advancing.
				coin.spine.update((dt / 1000) * coin.spinRate);
				coin.spine.alpha = 0;
				continue;
			}

			if (tRaw >= 1) {
				coin.arrived = true;
				coin.onArrive?.();
				continue;
			}

			const t = clamp01(tRaw);
			const eased = easeInOutCubic(t);
			cubicBezier(coin.p0, coin.c1, coin.c2, coin.p3, eased, this.scratch);

			// Pop the coin up to size at launch, then shrink as it drops into the balance coin. A fading
			// coin keeps its size — it dissolves in mid-air, so there is nothing for it to shrink into.
			const popIn = Math.min(1, t / 0.12);
			const shrink = coin.fadeOut ? 1 : t > 0.82 ? lerp(1, 0.35, (t - 0.82) / 0.18) : 1;
			const size = coin.sizePx * popIn * shrink;
			const scale = size / coin.skel.contentHeight;

			coin.spine.scale.set(scale);
			coin.spine.position.set(
				this.scratch.x - coin.skel.centerX * scale,
				this.scratch.y - coin.skel.centerY * scale,
			);
			// Spawn fade-in, then either the small dip as it merges (landing coins) or a full dissolve
			// that finishes well short of the destination (fading coins — gone by 0.9 of the way).
			let alpha = t < 0.08 ? t / 0.08 : 1;
			if (coin.fadeOut) {
				if (t > 0.55) alpha = clamp01(lerp(1, 0, (t - 0.55) / 0.35));
			} else if (t > 0.9) {
				alpha = lerp(1, 0.1, (t - 0.9) / 0.1);
			}
			coin.spine.alpha = alpha;
			coin.spine.update((dt / 1000) * coin.spinRate);
		}

		// Reap finished coins.
		if (this.coins.some((c) => c.arrived)) {
			for (const coin of this.coins) {
				if (coin.arrived) coin.spine.destroy();
			}
			this.coins = this.coins.filter((c) => !c.arrived);
		}

		if (this.coins.length === 0) {
			// Nothing left in flight — draw one clear (transparent) frame, then idle the ticker.
			this.running = false;
			app.renderer.render(app.stage);
			app.ticker.stop();
			// Signal the burst finished (only if one was in progress) so the caller can hide the swirl.
			const done = this.onBurstComplete;
			this.onBurstComplete = undefined;
			done?.();
		}
	}

	destroy(): void {
		if (this.app) {
			this.app.ticker.remove(this.tick);
		}
		for (const coin of this.coins) coin.spine.destroy();
		this.coins = [];
		const canvas = this.app?.canvas as HTMLCanvasElement | undefined;
		if (canvas) canvas.style.visibility = 'hidden';
		this.app?.destroy(true, { children: true, texture: false });
		this.app = undefined;
		this.ready = false;
		this.running = false;
	}
}
