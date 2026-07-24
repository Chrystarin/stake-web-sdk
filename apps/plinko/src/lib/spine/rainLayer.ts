import { Graphics } from 'pixi.js';

/**
 * Free-game rain, drawn as a Pixi layer inside the background stage.
 *
 * It lives in the Pixi stage (rather than a DOM canvas over it) so it can be z-ordered against the
 * base background spine: one instance goes UNDER the spine (rain behind the waterfall) and one OVER
 * it (rain in front of the waterfall). A DOM canvas could only ever sit above the whole stage, since
 * the backdrop JPG is itself a stage sprite and would hide anything layered beneath the canvas.
 *
 * Because the whole background stage lives in `.bg-layer`, the rain is always behind the plinko board.
 */
export type RainLayerConfig = {
	/** Drops per px² of viewport — tune density here. */
	density: number;
	lenMin: number;
	lenMax: number;
	/** Fall speed in px per 60fps frame. */
	speedMin: number;
	speedMax: number;
	/** Stroke width in px. Keep thin — thick streaks read as smears, not rain. */
	width: number;
	/** Layer opacity. */
	alpha: number;
	/**
	 * Soft-edge strength (0/undefined = crisp streaks). Formerly a per-frame full-screen `BlurFilter`;
	 * now it sizes a cheap, wider "halo" stroke drawn under each streak (see `update`), which fakes the
	 * same soft falloff as ordinary batched line geometry — no render-to-texture blur pass. Larger =
	 * softer/more distant.
	 */
	blur?: number;
	color?: number;
	/** Upper bound on drop count, guarding very large viewports. */
	maxDrops?: number;
};

type Drop = { x: number; y: number; len: number; speed: number };

/** Horizontal lean, shared by every layer so all streaks stay parallel. */
export const RAIN_WIND = 0.22;

/**
 * Distant rain BEHIND the base spine (occluded by the waterfall, dock and ship) — the smallest,
 * thinnest and faintest layer, so it reads as far away.
 */
export const RAIN_BEHIND_CONFIG: RainLayerConfig = {
	density: 1 / 4200,
	lenMin: 6,
	lenMax: 13,
	speedMin: 3.5,
	speedMax: 6,
	width: 0.7,
	alpha: 0.5,
	blur: 1.2,
};

/**
 * Rain OVER the base spine — passes in front of the waterfall but still behind the plinko board.
 * Marginally longer/faster than the behind layer to give parallax, but still small and thin.
 */
export const RAIN_OVER_CONFIG: RainLayerConfig = {
	density: 1 / 5200,
	lenMin: 8,
	lenMax: 17,
	speedMin: 5.5,
	speedMax: 9,
	width: 0.8,
	alpha: 0.58,
	blur: 0.8,
};

export class RainLayer {
	readonly view = new Graphics();
	private drops: Drop[] = [];
	private width = 0;
	private height = 0;
	/** Width of the faint "halo" stroke that fakes the old blur's soft edge (0 = crisp, no halo). */
	private readonly haloWidth: number;
	/** Halo opacity, relative to the layer alpha — kept well under the core so it reads as a soft glow. */
	private static readonly HALO_ALPHA = 0.4;

	constructor(private readonly config: RainLayerConfig) {
		this.view.alpha = config.alpha;
		this.view.visible = false;
		// Replaces the old `this.view.filters = [new BlurFilter(...)]`. A full-screen blur filter cost a
		// render-to-texture pass EVERY frame on this background app, starving the separate ball app of GPU
		// budget during the bonus round. The soft edge is now baked as a wider, faint halo stroke under
		// each streak (see `update`) — pure batched geometry, no filter. Halo spans the core width plus
		// ~2× the former blur radius, so a larger `blur` still reads as softer/more distant.
		const blur = config.blur ?? 0;
		this.haloWidth = blur > 0 ? config.width + blur * 2 : 0;
	}

	resize(width: number, height: number): void {
		if (width === this.width && height === this.height) return;
		this.width = width;
		this.height = height;
		this.drops = this.buildDrops();
	}

	private buildDrops(): Drop[] {
		const { density, lenMin, lenMax, speedMin, speedMax, maxDrops = 900 } = this.config;
		const count = Math.min(maxDrops, Math.max(0, Math.round(this.width * this.height * density)));
		const drops: Drop[] = [];
		for (let i = 0; i < count; i++) {
			drops.push({ ...this.spawn(), y: Math.random() * this.height });
		}
		return drops;
	}

	/** A fresh drop above the top edge, offset left so the rightward drift still covers the left edge. */
	private spawn(): Drop {
		const { lenMin, lenMax, speedMin, speedMax } = this.config;
		const len = lenMin + Math.random() * (lenMax - lenMin);
		return {
			x: Math.random() * (this.width + this.height * RAIN_WIND) - this.height * RAIN_WIND,
			y: -len - Math.random() * 40,
			len,
			speed: speedMin + Math.random() * (speedMax - speedMin),
		};
	}

	/** @param deltaFrames Pixi ticker delta (1 = one 60fps frame), so speed is refresh-rate independent. */
	update(deltaFrames: number): void {
		const g = this.view;
		g.clear();
		if (!this.drops.length) return;

		const color = this.config.color ?? 0xcde2ff;

		// Two batched strokes over the same streaks replace the removed full-screen blur filter: a wider,
		// faint HALO drawn first, then the thin crisp CORE on top. The halo fakes the blur's soft falloff
		// with ordinary line geometry (a couple of draw calls), instead of a per-frame render-to-texture
		// blur pass — far cheaper on the GPU the balls compete for. `haloWidth === 0` ⇒ crisp, no halo.
		if (this.haloWidth > 0) {
			this.traceStreaks(g);
			g.stroke({ width: this.haloWidth, color, alpha: RainLayer.HALO_ALPHA });
		}
		this.traceStreaks(g);
		g.stroke({ width: this.config.width, color, alpha: 1 });

		// Advance every drop for the next frame (recycling any that fell past the bottom edge). Done after
		// tracing so both strokes share the exact same streak positions.
		for (const drop of this.drops) {
			drop.y += drop.speed * deltaFrames;
			drop.x += drop.speed * RAIN_WIND * deltaFrames;
			if (drop.y - drop.len > this.height) {
				Object.assign(drop, this.spawn());
			}
		}
	}

	/** Lay down the line path for every streak (shared by the halo and core stroke passes). */
	private traceStreaks(g: Graphics): void {
		for (const drop of this.drops) {
			g.moveTo(drop.x, drop.y);
			g.lineTo(drop.x + drop.len * RAIN_WIND, drop.y + drop.len);
		}
	}

	destroy(): void {
		this.view.destroy();
	}
}
