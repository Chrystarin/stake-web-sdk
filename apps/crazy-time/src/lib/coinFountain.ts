/**
 * A fountain of coins, thrown up from one point and gathered into another — One-Eyed Willy Plinko's
 * win coin shower (apps/plinko/src/lib/winCoinShower.ts), brought over for Ocean Voyage: each barrel
 * collected throws its coins up off the bow, they scatter, and then stream down into the barrel of
 * gold on the deck (rooms/RoomOceanVoyageV2.svelte).
 *
 * The motion is plinko's, coin for coin:
 *   1. BURST — the coins are THROWN out of the point one after another over a short window, up into
 *      a wide fan; gravity and a light drag bring them over and back down.
 *   2. MERGE — each coin then turns and runs into the target along a gentle arc, shrinking and fading
 *      as it lands (`onArrive` per coin).
 *
 * What is different: in plinko one celebration owns the screen, so a single `merge()` call turns every
 * coin alive at once. Here a burst goes up for every barrel, and a voyage can throw the next before the
 * last has landed — so each BURST carries its own target and its own merge (`hangMs` after a coin is
 * thrown), and reports its own first landing and its own end. The target is a function, read when a
 * coin sets off, so it follows the layout. The speeds are a parameter too (`speedScale`): plinko's are
 * for coins thrown across the whole screen, these only rise a little way over the bow.
 *
 * It is a plain 2D canvas (no WebGL), drawn in the room's own layout pixels; the caller sizes it
 * (`resize`) with the scale between those and device pixels. The loop only runs while coins are
 * alive, and idles the moment the last one has landed.
 */

export type FountainPoint = { x: number; y: number };

export type FountainBurst = {
	from: FountainPoint;
	/** Where the coins go. Read as each coin sets off for it. */
	to: () => FountainPoint;
	count: number;
	/** How long the throw takes, first coin to last. */
	throwWindowMs?: number;
	/** How long a coin is in the air before it turns for the target… */
	hangMs?: number;
	/** …give or take this much, so the coins go in one after another rather than all at once. */
	mergeStaggerMs?: number;
	/** The throw's speed against plinko's (1), which throws coins across the whole screen. */
	speedScale?: number;
	/** The coins' size against plinko's (1). */
	sizeScale?: number;
	/** A coin landing in the target. */
	onArrive?: () => void;
	/** The first coin landing — once a burst. */
	onFirstArrive?: () => void;
	/** The last coin landing (or the burst being cleared away). */
	onDone?: () => void;
};

type Group = {
	burst: FountainBurst;
	alive: number;
	arrived: boolean;
	done: boolean;
};

type Coin = {
	group: Group;
	x: number;
	y: number;
	vx: number;
	vy: number;
	/** Base draw diameter. */
	size: number;
	/** Flip phase (radians) and its rate (rad/s, signed for direction). */
	spin: number;
	spinRate: number;
	/** A fixed slant, so the coins lie every which way rather than all standing upright. */
	tilt: number;
	/** When the coin is thrown (until then it waits, unseen, at the origin). */
	bornAt: number;
	/** When it turns for the target, and how long it takes to get there. */
	mergeAt: number;
	mergeDur: number;
	started: boolean;
	mx0: number;
	my0: number;
	/** The control point of the arc it takes in. */
	mcx: number;
	mcy: number;
	tx: number;
	ty: number;
};

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** Plinko's tunables, relative to the short side of the canvas so it reads the same at any size. */
const BURST = {
	/** Launch speed, as a share of the short side per second. */
	speedMin: 1.0,
	speedMax: 1.75,
	/** Half-angle of the upward fan, around straight up (≈±76°). */
	spread: 1.33,
	/** Gravity-dominant, so the coins genuinely arc up and come back down. */
	gravity: 1.28,
	/** Light air drag (per second), so the flight stays ballistic. */
	drag: 0.3,
	/** Coin diameter, as a share of the short side. */
	size: 0.05,
	throwWindow: 900,
};
/** How long a coin takes to run in to the target: at least, plus up to. */
const MERGE_MIN_MS = 450;
const MERGE_SPREAD_MS = 280;

export class CoinFountain {
	private canvas: HTMLCanvasElement;
	private ctx: CanvasRenderingContext2D;
	private img?: HTMLImageElement;
	/** The coin picture's height over its width. */
	private imgAspect = 1;
	private coins: Coin[] = [];
	private raf = 0;
	private last = 0;
	private clock = 0;
	private cssW = 0;
	private cssH = 0;
	private unit = 400;
	private running = false;

	private readonly loop = (ts: number) => this.frame(ts);

	constructor(canvas: HTMLCanvasElement) {
		this.canvas = canvas;
		const ctx = canvas.getContext('2d');
		if (!ctx) throw new Error('[CoinFountain] 2D context unavailable');
		this.ctx = ctx;
	}

	setCoinImage(img: HTMLImageElement): void {
		this.img = img;
		if (img.naturalWidth > 0) this.imgAspect = img.naturalHeight / img.naturalWidth;
	}

	/** The canvas's size in the caller's pixels, and how many backing pixels to give each of them. */
	resize(cssW: number, cssH: number, scale: number): void {
		this.cssW = cssW;
		this.cssH = cssH;
		this.unit = Math.max(1, Math.min(cssW, cssH));
		this.canvas.width = Math.max(1, Math.round(cssW * scale));
		this.canvas.height = Math.max(1, Math.round(cssH * scale));
		this.ctx.setTransform(scale, 0, 0, scale, 0, 0);
	}

	/** Throw a burst of coins up out of `from`, to come down into `to()`. */
	burst(burst: FountainBurst): void {
		const n = clamp(Math.round(burst.count), 1, 160);
		const throwWindow = burst.throwWindowMs ?? BURST.throwWindow;
		const hang = burst.hangMs ?? 600;
		const stagger = burst.mergeStaggerMs ?? 350;
		const speedScale = burst.speedScale ?? 1;
		const base = this.unit * BURST.size * (burst.sizeScale ?? 1);
		const group: Group = { burst, alive: n, arrived: false, done: false };
		for (let i = 0; i < n; i++) {
			// Up into a wide fan, anywhere from up-left through straight up to up-right.
			const angle = -Math.PI / 2 + (Math.random() - 0.5) * 2 * BURST.spread;
			const speed = this.unit * speedScale * (BURST.speedMin + Math.random() * (BURST.speedMax - BURST.speedMin));
			// Thrown one after another across the window, not popped out all at once.
			const bornAt = this.clock + (i / n) * throwWindow + Math.random() * 45;
			this.coins.push({
				group,
				x: burst.from.x + (Math.random() - 0.5) * base * 0.6,
				y: burst.from.y + (Math.random() - 0.5) * base * 0.6,
				vx: Math.cos(angle) * speed,
				vy: Math.sin(angle) * speed,
				size: base * (0.78 + Math.random() * 0.55),
				spin: Math.random() * Math.PI * 2,
				spinRate: (Math.random() < 0.5 ? -1 : 1) * (5 + Math.random() * 6),
				tilt: Math.random() * Math.PI * 2,
				bornAt,
				mergeAt: bornAt + hang + Math.random() * stagger,
				mergeDur: MERGE_MIN_MS + Math.random() * MERGE_SPREAD_MS,
				started: false,
				mx0: 0,
				my0: 0,
				mcx: 0,
				mcy: 0,
				tx: 0,
				ty: 0,
			});
		}
		this.start();
	}

	private start(): void {
		if (this.running) return;
		this.running = true;
		this.last = 0;
		this.raf = requestAnimationFrame(this.loop);
	}

	private frame(ts: number): void {
		if (!this.last) this.last = ts;
		const dt = Math.min(0.048, Math.max(0, (ts - this.last) / 1000));
		this.last = ts;
		this.clock += dt * 1000;

		this.step(dt);
		this.draw();

		if (this.coins.length > 0) {
			this.raf = requestAnimationFrame(this.loop);
		} else {
			this.running = false;
			this.ctx.clearRect(0, 0, this.cssW, this.cssH);
		}
	}

	/** One coin gone (landed, or culled): the burst ends with its last. */
	private retire(coin: Coin, landed: boolean): void {
		const group = coin.group;
		if (landed) {
			group.burst.onArrive?.();
			if (!group.arrived) {
				group.arrived = true;
				group.burst.onFirstArrive?.();
			}
		}
		group.alive--;
		if (group.alive <= 0 && !group.done) {
			group.done = true;
			group.burst.onDone?.();
		}
	}

	private step(dt: number): void {
		const g = this.unit * BURST.gravity;
		const dragMul = Math.exp(-BURST.drag * dt);
		const cullMargin = this.unit * 0.5;

		const survivors: Coin[] = [];
		for (const coin of this.coins) {
			coin.spin += coin.spinRate * dt;

			// Not thrown yet: waiting, unseen, at the origin.
			if (this.clock < coin.bornAt) {
				survivors.push(coin);
				continue;
			}

			if (this.clock >= coin.mergeAt) {
				if (!coin.started) {
					coin.started = true;
					const to = coin.group.burst.to();
					coin.tx = to.x;
					coin.ty = to.y;
					coin.mx0 = coin.x;
					coin.my0 = coin.y;
					// A control point most of the way in and lifted a little, so the coin arcs in over the
					// rim rather than sliding straight at it.
					coin.mcx = coin.mx0 + (coin.tx - coin.mx0) * 0.6;
					coin.mcy = Math.min(coin.my0, coin.ty) - this.unit * (0.04 + Math.random() * 0.05);
				}
				const t = clamp((this.clock - coin.mergeAt) / coin.mergeDur, 0, 1);
				const e = easeInOutCubic(t);
				const u = 1 - e;
				coin.x = u * u * coin.mx0 + 2 * u * e * coin.mcx + e * e * coin.tx;
				coin.y = u * u * coin.my0 + 2 * u * e * coin.mcy + e * e * coin.ty;
				if (t >= 1) {
					this.retire(coin, true);
					continue;
				}
				survivors.push(coin);
				continue;
			}

			// In the air.
			coin.vy += g * dt;
			coin.vx *= dragMul;
			coin.vy *= dragMul;
			coin.x += coin.vx * dt;
			coin.y += coin.vy * dt;
			// Every coin turns for the target in the end, so only one thrown clean off the canvas is lost.
			if (coin.y > this.cssH + cullMargin || coin.x < -cullMargin || coin.x > this.cssW + cullMargin) {
				this.retire(coin, false);
				continue;
			}
			survivors.push(coin);
		}
		this.coins = survivors;
	}

	private draw(): void {
		const ctx = this.ctx;
		ctx.clearRect(0, 0, this.cssW, this.cssH);
		const img = this.img;
		if (!img) return;

		for (const coin of this.coins) {
			// In over its first moments; smaller and fading over the last of its run in.
			let alpha = clamp((this.clock - coin.bornAt) / 90, 0, 1);
			let shrink = 1;
			if (coin.started) {
				const t = clamp((this.clock - coin.mergeAt) / coin.mergeDur, 0, 1);
				shrink = 1 - 0.55 * t;
				if (t > 0.7) alpha *= clamp(1 - (t - 0.7) / 0.3, 0.15, 1);
			}
			if (alpha <= 0) continue;
			// Spun by squashing it across: a coin flipping, without a sprite sheet.
			const sx = Math.max(0.16, Math.abs(Math.cos(coin.spin)));
			const w = coin.size * shrink;
			const h = w * this.imgAspect;

			ctx.save();
			ctx.globalAlpha = alpha;
			ctx.translate(coin.x, coin.y);
			ctx.rotate(coin.tilt);
			ctx.scale(sx, 1);
			ctx.drawImage(img, -w / 2, -h / 2, w, h);
			ctx.restore();
		}
	}

	/** Drop every coin and stop; each burst still in the air is reported done. */
	clear(): void {
		if (this.raf) cancelAnimationFrame(this.raf);
		this.raf = 0;
		this.running = false;
		const groups = new Set(this.coins.map((c) => c.group));
		this.coins = [];
		this.ctx.clearRect(0, 0, this.cssW, this.cssH);
		for (const group of groups) {
			if (group.done) continue;
			group.done = true;
			group.burst.onDone?.();
		}
	}

	destroy(): void {
		this.clear();
	}
}
