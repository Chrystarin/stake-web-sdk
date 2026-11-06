import { Container, Sprite, Texture } from 'pixi.js';

/**
 * A particle emitter in the legacy pixi-particle-emitter config format — what the artist's particle
 * editor exports — reduced to what the configs we have use: a circle spawn, straight-line flight at a
 * speed eased from start to end, and alpha, scale, colour and spin over each particle's life. Run off
 * the scene's own clock ({@link SceneSpineRenderer}), so it pauses and resumes with the Spine around it.
 */
export type EmitterConfig = {
	alpha: { start: number; end: number };
	scale: { start: number; end: number; minimumScaleMultiplier: number };
	color: { start: string; end: string };
	speed: { start: number; end: number; minimumSpeedMultiplier: number };
	/** Degrees, 0 = right, clockwise (Pixi's y-down). */
	startRotation: { min: number; max: number };
	noRotation: boolean;
	/** Degrees per second. */
	rotationSpeed: { min: number; max: number };
	/** Seconds. */
	lifetime: { min: number; max: number };
	maxParticles: number;
	/** Offset of the spawn shape from the emitter's origin. */
	pos: { x: number; y: number };
	spawnCircle: { x: number; y: number; r: number };
};

/**
 * Pirate Plinko's blowing sand — the artist's `Sand.json`, values unchanged. It spawns far faster
 * than grains die (every 1 ms), so in effect it keeps all 344 in the air: a dead grain is born again
 * on the next step. The export names no texture; {@link grainTexture} stands in for one.
 */
export const SAND: EmitterConfig = {
	alpha: { start: 0.29, end: 1 },
	scale: { start: 0.1, end: 0.01, minimumScaleMultiplier: 1 },
	color: { start: '#fce387', end: '#fcbf85' },
	speed: { start: 200, end: 50, minimumSpeedMultiplier: 1 },
	startRotation: { min: -47, max: 47 },
	noRotation: false,
	rotationSpeed: { min: -449, max: 0 },
	lifetime: { min: 0.001, max: 11.04 },
	maxParticles: 344,
	pos: { x: -320, y: 0 },
	spawnCircle: { x: 0, y: 0, r: 436 },
};

/**
 * A white grain, soft-edged and a little longer than it is wide so the spin reads; tinted per
 * particle. The export names no texture, so its size is ours: the particle editor's stock textures
 * are around 100 px, and at the config's starting scale of 0.1 this one is 11 x 7 scene units
 * (about 7 x 5 px on a 1280 screen), shrinking to nothing as it dies. Much smaller and the grains
 * vanish into the sand they are the colour of.
 */
const GRAIN_W = 110;
const GRAIN_H = 70;
let grain: Texture | undefined;
const grainTexture = (): Texture => {
	if (grain && !grain.destroyed) return grain;
	const canvas = document.createElement('canvas');
	canvas.width = GRAIN_W;
	canvas.height = GRAIN_H;
	const ctx = canvas.getContext('2d')!;
	ctx.translate(GRAIN_W / 2, GRAIN_H / 2);
	ctx.scale(1, GRAIN_H / GRAIN_W);
	const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, GRAIN_W / 2);
	glow.addColorStop(0, 'rgba(255,255,255,1)');
	glow.addColorStop(0.5, 'rgba(255,255,255,0.9)');
	glow.addColorStop(1, 'rgba(255,255,255,0)');
	ctx.fillStyle = glow;
	ctx.beginPath();
	ctx.arc(0, 0, GRAIN_W / 2, 0, Math.PI * 2);
	ctx.fill();
	grain = Texture.from(canvas);
	return grain;
};

const hex = (colour: string): [number, number, number] => {
	const n = parseInt(colour.replace('#', ''), 16);
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const between = (min: number, max: number) => min + Math.random() * (max - min);
const RAD = Math.PI / 180;

type Particle = {
	sprite: Sprite;
	age: number;
	life: number;
	dirX: number;
	dirY: number;
	speedMul: number;
	scaleMul: number;
	spin: number;
};

/** Long enough for the first wave of grains, all born at once, to have mixed into a steady drift. */
const PREWARM_SECONDS = 24;
const PREWARM_STEP = 1 / 30;

export class ParticleEmitter extends Container {
	private readonly config: EmitterConfig;
	private readonly particles: Particle[] = [];
	private readonly from: [number, number, number];
	private readonly to: [number, number, number];

	constructor(config: EmitterConfig) {
		super();
		this.config = config;
		this.from = hex(config.color.start);
		this.to = hex(config.color.end);
		const texture = grainTexture();
		for (let i = 0; i < config.maxParticles; i++) {
			const sprite = new Sprite(texture);
			sprite.anchor.set(0.5);
			const particle: Particle = { sprite, age: 0, life: 1, dirX: 1, dirY: 0, speedMul: 1, scaleMul: 1, spin: 0 };
			this.spawn(particle);
			this.particles.push(particle);
			this.addChild(sprite);
		}
		// Start mid-gust rather than on a burst out of the spawn circle.
		for (let t = 0; t < PREWARM_SECONDS; t += PREWARM_STEP) this.update(PREWARM_STEP);
	}

	update(seconds: number): void {
		for (const p of this.particles) {
			p.age += seconds;
			if (p.age >= p.life) {
				this.spawn(p);
				continue;
			}
			this.advance(p, seconds);
		}
	}

	private spawn(p: Particle): void {
		const { config } = this;
		// The legacy emitter's circle: a uniform angle and a uniform radius, so denser at the centre.
		const angle = Math.random() * Math.PI * 2;
		const radius = Math.random() * config.spawnCircle.r;
		const heading = between(config.startRotation.min, config.startRotation.max) * RAD;
		p.age = 0;
		p.life = between(config.lifetime.min, config.lifetime.max);
		p.dirX = Math.cos(heading);
		p.dirY = Math.sin(heading);
		p.speedMul = between(config.speed.minimumSpeedMultiplier, 1);
		p.scaleMul = between(config.scale.minimumScaleMultiplier, 1);
		p.spin = config.noRotation ? 0 : between(config.rotationSpeed.min, config.rotationSpeed.max) * RAD;
		p.sprite.position.set(
			config.pos.x + config.spawnCircle.x + Math.cos(angle) * radius,
			config.pos.y + config.spawnCircle.y + Math.sin(angle) * radius,
		);
		p.sprite.rotation = config.noRotation ? 0 : heading;
		this.advance(p, 0);
	}

	private advance(p: Particle, seconds: number): void {
		const { config, from, to } = this;
		const t = p.age / p.life;
		const speed = lerp(config.speed.start, config.speed.end, t) * p.speedMul;
		const { sprite } = p;
		sprite.x += p.dirX * speed * seconds;
		sprite.y += p.dirY * speed * seconds;
		sprite.rotation += p.spin * seconds;
		sprite.alpha = lerp(config.alpha.start, config.alpha.end, t);
		sprite.scale.set(lerp(config.scale.start, config.scale.end, t) * p.scaleMul);
		sprite.tint =
			(Math.round(lerp(from[0], to[0], t)) << 16) |
			(Math.round(lerp(from[1], to[1], t)) << 8) |
			Math.round(lerp(from[2], to[2], t));
	}
}
