import { BlurFilter, Graphics } from 'pixi.js';

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
	/** Gaussian blur strength (0/undefined = none) — softens distant rain. */
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

	constructor(private readonly config: RainLayerConfig) {
		this.view.alpha = config.alpha;
		this.view.visible = false;
		if (config.blur) {
			this.view.filters = [new BlurFilter({ strength: config.blur })];
		}
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

		for (const drop of this.drops) {
			g.moveTo(drop.x, drop.y);
			g.lineTo(drop.x + drop.len * RAIN_WIND, drop.y + drop.len);

			drop.y += drop.speed * deltaFrames;
			drop.x += drop.speed * RAIN_WIND * deltaFrames;
			if (drop.y - drop.len > this.height) {
				Object.assign(drop, this.spawn());
			}
		}

		// Single stroke for every streak in the layer — one batched draw call.
		g.stroke({ width: this.config.width, color: this.config.color ?? 0xcde2ff, alpha: 1 });
	}

	destroy(): void {
		this.view.destroy();
	}
}
