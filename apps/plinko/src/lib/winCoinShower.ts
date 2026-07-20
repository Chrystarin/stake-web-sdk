/**
 * Canvas coin shower for the win celebration (see WinCelebration.svelte).
 *
 * Two-phase motion, matching the design brief:
 *   1. BURST  — coins erupt from a single point in the MIDDLE of the screen, flying outward and up
 *               like a fountain; a gentle gravity + air-drag pulls them back so they hang and drift
 *               in the upper area rather than raining straight off the bottom.
 *   2. MERGE  — "when the win is done showing", every living coin turns and streams into the balance
 *               coin, shrinking as it lands (each landing fires `onArrive`, e.g. to pulse the coin /
 *               play a flip sound / light the balance glow).
 *
 * It is a plain 2D canvas (no WebGL) so it can sit as one layer in the celebration's z-stack —
 * between the shine rays and the win text — which a separate Pixi overlay could not. Coins spin by
 * squashing horizontally (|cos|), reading as a flipping coin without a sprite sheet. The rAF loop
 * only runs while coins are alive; it idles the moment the array drains.
 */

export type ShowerPoint = { x: number; y: number };

type Coin = {
	x: number;
	y: number;
	vx: number;
	vy: number;
	/** base draw diameter in CSS px. */
	size: number;
	/** current flip phase (radians) and its rate (rad/s, signed for direction). */
	spin: number;
	spinRate: number;
	/** static base orientation (radians) — randomized per coin so they sit at all angles (some upright,
	 * some diagonal, some sideways) rather than every coin standing straight up. */
	tilt: number;
	/** clock time (ms) the coin was born, for the spawn fade-in. */
	bornAt: number;
	// --- merge ---
	merging: boolean;
	/** clock time (ms) this coin begins its run to the balance coin (staggered). */
	mergeAt: number;
	/** travel time (ms) from wherever it is to the balance coin. */
	mergeDur: number;
	started: boolean;
	mx0: number;
	my0: number;
	/** control point for the slight arc into the coin. */
	mcx: number;
	mcy: number;
	arrived: boolean;
};

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const easeInOutCubic = (t: number) =>
	t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

/** Tunables, expressed relative to the viewport's short side so it reads the same at any size. */
const BURST = {
	/** launch speed range as a fraction of the viewport short side, per second. */
	speedMin: 1.0,
	speedMax: 1.75,
	/**
	 * A FOUNTAIN, matching the reference clip: coins erupt from the middle in a WIDE upward fan (all
	 * upward directions, from up-left through straight-up to up-right), then arc over and fall back
	 * down. `spread` is the half-angle of that cone around straight-up (radians, ≈±76°).
	 */
	spread: 1.33,
	/**
	 * Gravity-DOMINANT so the coins genuinely arc up and RAIN back down (the reference look), rather
	 * than hanging in the air. Paired with only light drag below.
	 */
	gravity: 1.28,
	/** air drag (per second) — light, so the motion stays ballistic (up, over, down). */
	drag: 0.3,
	/** base coin diameter, fraction of short side. */
	size: 0.05,
	/**
	 * Coins are THROWN, not popped: they launch spread out across this window (ms) instead of all at
	 * once, so they read as a stream of coins being tossed out (alternating left/right) rather than a
	 * single instantaneous burst. Each coin sits invisibly at the origin until its turn.
	 */
	throwWindow: 900,
};

export class WinCoinShower {
	private canvas: HTMLCanvasElement;
	private ctx: CanvasRenderingContext2D;
	private img?: HTMLImageElement;
	private imgAspect = 1; // h / w
	private coins: Coin[] = [];
	private raf = 0;
	private last = 0;
	private clock = 0;
	private cssW = 0;
	private cssH = 0;
	private unit = 400;
	private running = false;

	// merge state
	private mergeTarget?: ShowerPoint;
	private merging = false;
	private onArrive?: () => void;
	private onComplete?: () => void;

	private readonly loop = (ts: number) => this.frame(ts);

	constructor(canvas: HTMLCanvasElement) {
		this.canvas = canvas;
		const ctx = canvas.getContext('2d');
		if (!ctx) throw new Error('[WinCoinShower] 2D context unavailable');
		this.ctx = ctx;
	}

	setCoinImage(img: HTMLImageElement): void {
		this.img = img;
		if (img.naturalWidth > 0) this.imgAspect = img.naturalHeight / img.naturalWidth;
	}

	/** Match the backing store to the host size × DPR; draw in CSS px. */
	resize(cssW: number, cssH: number, dpr: number): void {
		this.cssW = cssW;
		this.cssH = cssH;
		this.unit = Math.max(1, Math.min(cssW, cssH));
		this.canvas.width = Math.max(1, Math.round(cssW * dpr));
		this.canvas.height = Math.max(1, Math.round(cssH * dpr));
		this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	}

	/**
	 * Erupt `count` coins from `origin` (client px). Starts the loop if idle. `throwWindowMs` spreads the
	 * launches over that span (default `BURST.throwWindow`) — pass the count-up duration so the shower
	 * erupts WHILE the value counts and finishes as it lands.
	 */
	burst(origin: ShowerPoint, count: number, throwWindowMs = BURST.throwWindow): void {
		const n = clamp(Math.round(count), 1, 160);
		const base = this.unit * BURST.size;
		for (let i = 0; i < n; i++) {
			// Launch up into a wide fan (a fountain) — anywhere from up-left through straight-up to up-right.
			const angle = -Math.PI / 2 + (Math.random() - 0.5) * 2 * BURST.spread;
			const speed = this.unit * (BURST.speedMin + Math.random() * (BURST.speedMax - BURST.speedMin));
			// Stagger the launch across the throw window so coins stream out (thrown), not pop at once.
			// `bornAt` is the moment this coin is thrown: until then it sits invisibly at the origin.
			const launchAt = this.clock + (i / n) * throwWindowMs + Math.random() * 45;
			this.coins.push({
				x: origin.x + (Math.random() - 0.5) * base * 0.6,
				y: origin.y + (Math.random() - 0.5) * base * 0.6,
				vx: Math.cos(angle) * speed,
				vy: Math.sin(angle) * speed,
				size: base * (0.78 + Math.random() * 0.55),
				spin: Math.random() * Math.PI * 2,
				spinRate: (Math.random() < 0.5 ? -1 : 1) * (5 + Math.random() * 6),
				// Random static orientation so coins are slanted every which way (diagonal, sideways, upright).
				tilt: Math.random() * Math.PI * 2,
				bornAt: launchAt,
				merging: false,
				mergeAt: 0,
				mergeDur: 0,
				started: false,
				mx0: 0,
				my0: 0,
				mcx: 0,
				mcy: 0,
				arrived: false,
			});
		}
		this.start();
	}

	/**
	 * Turn every living coin toward the balance coin. Coins launch staggered (so they stream in
	 * rather than all at once) and each fires `onArrive` as it lands; `onComplete` fires once the
	 * last one has.
	 */
	merge(target: ShowerPoint, opts: { onArrive?: () => void; onComplete?: () => void } = {}): void {
		this.mergeTarget = target;
		this.merging = true;
		this.onArrive = opts.onArrive;
		this.onComplete = opts.onComplete;
		const stagger = 480;
		for (const coin of this.coins) {
			if (coin.merging) continue;
			coin.merging = true;
			coin.started = false;
			coin.mergeAt = this.clock + Math.random() * stagger;
			coin.mergeDur = 620 + Math.random() * 430;
		}
		// If nothing was in flight, signal completion so the caller isn't left waiting.
		if (this.coins.length === 0) {
			this.merging = false;
			opts.onComplete?.();
		} else {
			this.start();
		}
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
			if (this.merging) {
				this.merging = false;
				const done = this.onComplete;
				this.onComplete = undefined;
				done?.();
			}
		}
	}

	private step(dt: number): void {
		const g = this.unit * BURST.gravity;
		const dragMul = Math.exp(-BURST.drag * dt);
		const target = this.mergeTarget;
		const cullMargin = this.unit * 0.5;

		const survivors: Coin[] = [];
		for (const coin of this.coins) {
			coin.spin += coin.spinRate * dt;

			// Not thrown yet — sit invisibly at the origin (see draw's fade-in on bornAt) until its turn.
			if (this.clock < coin.bornAt) {
				survivors.push(coin);
				continue;
			}

			const traveling = coin.merging && target && this.clock >= coin.mergeAt;
			if (traveling && target) {
				if (!coin.started) {
					coin.started = true;
					coin.mx0 = coin.x;
					coin.my0 = coin.y;
					// Control point ~2/3 of the way in, lifted a touch, for a gentle arc rather than a
					// dead-straight slide into the coin.
					coin.mcx = coin.mx0 + (target.x - coin.mx0) * 0.6;
					coin.mcy = Math.min(coin.my0, target.y) - this.unit * (0.04 + Math.random() * 0.05);
				}
				const localT = clamp((this.clock - coin.mergeAt) / coin.mergeDur, 0, 1);
				const e = easeInOutCubic(localT);
				const u = 1 - e;
				coin.x = u * u * coin.mx0 + 2 * u * e * coin.mcx + e * e * target.x;
				coin.y = u * u * coin.my0 + 2 * u * e * coin.mcy + e * e * target.y;
				if (localT >= 1) {
					coin.arrived = true;
					this.onArrive?.();
					continue; // drop it
				}
				survivors.push(coin);
				continue;
			}

			// Burst / hang phase (also covers a merging coin still waiting out its stagger).
			coin.vy += g * dt;
			coin.vx *= dragMul;
			coin.vy *= dragMul;
			coin.x += coin.vx * dt;
			coin.y += coin.vy * dt;

			// Only cull far-gone coins while NOT heading anywhere — once merging, they always resolve.
			if (
				!coin.merging &&
				(coin.y > this.cssH + cullMargin ||
					coin.x < -cullMargin ||
					coin.x > this.cssW + cullMargin)
			) {
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
			// Fade in on spawn; fade out over the last third of the merge run.
			let alpha = clamp((this.clock - coin.bornAt) / 90, 0, 1);
			let shrink = 1;
			if (coin.started && coin.mergeDur > 0) {
				const localT = clamp((this.clock - coin.mergeAt) / coin.mergeDur, 0, 1);
				shrink = 1 - 0.55 * localT;
				if (localT > 0.7) alpha *= clamp(1 - (localT - 0.7) / 0.3, 0.15, 1);
			}
			const sx = Math.max(0.16, Math.abs(Math.cos(coin.spin)));
			const w = coin.size * shrink;
			const h = w * this.imgAspect;

			ctx.save();
			ctx.globalAlpha = alpha;
			ctx.translate(coin.x, coin.y);
			ctx.rotate(coin.tilt); // random per-coin slant
			ctx.scale(sx, 1); // flip squash, along the (now-rotated) axis
			ctx.drawImage(img, -w / 2, -h / 2, w, h);
			ctx.restore();
		}
	}

	/** Any coins currently alive? */
	get activeCount(): number {
		return this.coins.length;
	}

	/** Wipe everything and stop (used on unmount / interrupt). */
	clear(): void {
		if (this.raf) cancelAnimationFrame(this.raf);
		this.raf = 0;
		this.running = false;
		this.merging = false;
		this.coins = [];
		this.onArrive = undefined;
		this.onComplete = undefined;
		this.ctx.clearRect(0, 0, this.cssW, this.cssH);
	}

	destroy(): void {
		this.clear();
	}
}
