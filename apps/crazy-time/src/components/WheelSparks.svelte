<script lang="ts">
	/**
	 * Gold sparks thrown off the rim of the money wheel while it turns — the particle editor's "Pixie
	 * Dust" preset (short-lived specks that fly out, slow, shrink and fade) in gold, drawn on a plain
	 * 2D canvas rather than a Pixi one: the game already holds several WebGL contexts and iOS reaps
	 * them, and a few dozen sprites do not need one.
	 *
	 * Decoration only. The Wheel feeds it the disc's angular speed (`setSpeed`) and asks for a burst
	 * when it lands; it draws nothing at rest, and its frame loop stops once the last spark is gone.
	 *
	 * The canvas is the Wheel's box grown by MARGIN on every side, so sparks can leave the frame art.
	 * Everything is laid out in the canvas's LAYOUT pixels (clientWidth) and scaled to the backing
	 * store by one factor, because the game runs under CSS `zoom`.
	 */
	import { onDestroy, onMount } from 'svelte';
	import { isLite } from '../lib/deviceTier.svelte';

	type Props = {
		/** The disc's centre as fractions of the wheel box, and the radius sparks start at, as a fraction of its width. */
		cx: number;
		cy: number;
		rim: number;
	};
	let { cx, cy, rim }: Props = $props();

	/** The canvas extends this far past the wheel box on each side, as a fraction of it. */
	const MARGIN = 0.12;
	/** Disc speed, degrees per second, at which the spray is at full strength. */
	const FULL_SPEED = 700;

	type Spark = {
		on: boolean;
		/** Angle round the disc, radians clockwise from the pointer at 12 o'clock. */
		a: number;
		/** Distance from the disc's centre, px. */
		r: number;
		/** How fast it climbs off the rim, px/s at birth and at death. */
		v0: number;
		v1: number;
		age: number;
		life: number;
		size: number;
		spin: number;
		rot: number;
		twinkle: number;
	};

	let canvas: HTMLCanvasElement | undefined = $state();
	let ctx: CanvasRenderingContext2D | null = null;
	let ro: ResizeObserver | undefined;

	const lite = isLite();
	const MAX = lite ? 90 : 190;
	const reduced =
		typeof window !== 'undefined' &&
		typeof window.matchMedia === 'function' &&
		window.matchMedia('(prefers-reduced-motion: reduce)').matches;

	const pool: Spark[] = Array.from({ length: MAX }, () => ({
		on: false, a: 0, r: 0, v0: 0, v1: 0, age: 0, life: 1, size: 0, spin: 0, rot: 0, twinkle: 0,
	}));

	// Three pre-drawn four-point stars, pale to deep gold, so a frame is only drawImage calls.
	const STAR = 48;
	const makeStar = (core: string, glow: string): HTMLCanvasElement | null => {
		if (typeof document === 'undefined') return null;
		const c = document.createElement('canvas');
		c.width = c.height = STAR;
		const g = c.getContext('2d');
		if (!g) return null;
		const m = STAR / 2;
		const halo = g.createRadialGradient(m, m, 0, m, m, m);
		halo.addColorStop(0, glow);
		halo.addColorStop(0.35, glow.replace(/[\d.]+\)$/, '0.35)'));
		halo.addColorStop(1, glow.replace(/[\d.]+\)$/, '0)'));
		g.fillStyle = halo;
		g.fillRect(0, 0, STAR, STAR);
		g.fillStyle = core;
		g.beginPath();
		const long = m * 0.95;
		const waist = m * 0.14;
		for (let i = 0; i < 8; i++) {
			const a = (i * Math.PI) / 4 - Math.PI / 2;
			const rr = i % 2 === 0 ? long : waist;
			g.lineTo(m + Math.cos(a) * rr, m + Math.sin(a) * rr);
		}
		g.closePath();
		g.fill();
		return c;
	};
	let stars: (HTMLCanvasElement | null)[] = [];

	let speed = 0; // deg/s, as last reported
	let carry = 0; // fractional sparks owed
	let raf = 0;
	let last = 0;

	const geometry = () => {
		const cw = canvas!.clientWidth;
		const ch = canvas!.clientHeight;
		const w = cw / (1 + MARGIN * 2);
		const h = ch / (1 + MARGIN * 2);
		return { cw, ch, w, h, x: cx * w + MARGIN * w, y: cy * h + MARGIN * h, r: rim * w };
	};

	/**
	 * One bright spark — the head — starts at the pointer and runs clockwise round the rim at the
	 * disc's own speed, round and round while it turns. It sheds sparks along its path, which stay
	 * where they were dropped, drift off the rim and fade: a comet's trail. `head` is its angle,
	 * radians clockwise from the pointer at 12 o'clock.
	 */
	let head = 0;
	/** Seconds of landing sparkle still to run, and the sparks owed to it. */
	let shower = 0;
	let showerCarry = 0;
	const FULL = Math.PI * 2;
	/** Sparks dropped per radian of travel, so the trail has no gaps at any speed. */
	const PER_RAD = lite ? 7 : 15;

	const spawn = (a: number, big = false) => {
		const p = pool.find((s) => !s.on);
		if (!p || !canvas) return;
		const g = geometry();
		p.on = true;
		p.a = a;
		p.r = g.r * (0.96 + Math.random() * 0.08);
		p.age = 0;
		p.life = (0.35 + Math.random() * 0.3) * (big ? 1.5 : 1);
		p.v0 = g.w * (0.03 + Math.random() * 0.08);
		p.v1 = p.v0 * 0.25;
		p.size = g.w * (0.012 + Math.random() * 0.014) * (big ? 1.5 : 1);
		p.rot = Math.random() * Math.PI;
		p.spin = (Math.random() - 0.5) * 3;
		p.twinkle = Math.random() * Math.PI * 2;
	};

	const frame = (now: number) => {
		raf = 0;
		if (!canvas || !ctx) return;
		const dt = Math.min(0.05, last ? (now - last) / 1000 : 0.016);
		last = now;
		const strength = Math.min(1, speed / FULL_SPEED);

		const omega = (speed * Math.PI) / 180; // the disc's, rad/s
		if (shower > 0) {
			// The landing: a few more moments of sparkle on every part of the outline.
			shower -= dt;
			showerCarry += (lite ? 120 : 300) * dt;
			while (showerCarry >= 1) {
				showerCarry -= 1;
				spawn(Math.random() * FULL, true);
			}
		}
		if (strength > 0) {
			// Drop sparks along the stretch the head covered this frame, not just where it ended up.
			// The head laps the rim again and again for as long as the disc turns.
			const travelled = omega * dt;
			carry += travelled * PER_RAD;
			const from = head;
			const n = Math.floor(carry);
			carry -= n;
			for (let i = 1; i <= n; i++) spawn(from + (travelled * i) / n);
			head = (head + travelled) % FULL;
		}

		const g = geometry();
		const k = canvas.width / g.cw;
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.clearRect(0, 0, canvas.width, canvas.height);
		ctx.globalCompositeOperation = 'lighter';

		let alive = 0;
		for (const p of pool) {
			if (!p.on) continue;
			p.age += dt;
			const t = p.age / p.life;
			if (t >= 1) {
				p.on = false;
				continue;
			}
			alive++;
			const v = p.v0 + (p.v1 - p.v0) * t;
			p.r += v * dt;
			const px = g.x + Math.sin(p.a) * p.r;
			const py = g.y - Math.cos(p.a) * p.r;
			p.rot += p.spin * dt;
			const size = p.size * (1 - 0.8 * t) * 3.4;
			const flick = 0.75 + 0.25 * Math.sin(p.twinkle + p.age * 28);
			const star = stars[t < 0.3 ? 0 : t < 0.65 ? 1 : 2];
			if (!star) continue;
			ctx.globalAlpha = (1 - t) * flick;
			ctx.setTransform(Math.cos(p.rot) * k, Math.sin(p.rot) * k, -Math.sin(p.rot) * k, Math.cos(p.rot) * k, px * k, py * k);
			ctx.drawImage(star, -size / 2, -size / 2, size, size);
		}
		// The head itself: a bigger, steadier star at the front of the trail.
		if (strength > 0 && stars[0]) {
			const hs = g.w * 0.055 * (0.9 + 0.1 * Math.sin(now / 45));
			ctx.globalAlpha = Math.min(1, 0.4 + strength);
			ctx.setTransform(k, 0, 0, k, (g.x + Math.sin(head) * g.r) * k, (g.y - Math.cos(head) * g.r) * k);
			ctx.drawImage(stars[0], -hs / 2, -hs / 2, hs, hs);
		}
		ctx.globalAlpha = 1;

		// Keep going while anything is flying or the disc is still throwing more.
		if (alive > 0 || strength > 0 || shower > 0) raf = requestAnimationFrame(frame);
		else last = 0;
	};

	const wake = () => {
		if (!raf && ctx) raf = requestAnimationFrame(frame);
	};

	/** The disc's angular speed in degrees per second; 0 once it has stopped. */
	export const setSpeed = (degPerSec: number) => {
		if (reduced) return;
		speed = Math.abs(degPerSec);
		if (speed > 0) wake();
		else {
			head = 0; // at rest: the next spin starts again from the pointer
			carry = 0;
		}
	};

	/** A handful thrown at once — the disc has just come to rest. */
	export const burst = () => {
		if (reduced) return;
		// A ring of big sparks at even steps all round the outline, then a short shower after it.
		const n = lite ? 48 : 96;
		for (let i = 0; i < n; i++) spawn(((i + Math.random()) / n) * FULL, true);
		shower = 0.9;
		wake();
	};

	const resize = () => {
		if (!canvas) return;
		const cw = canvas.clientWidth;
		if (!cw) return;
		// Layout px -> screen px is whatever the game's zoom makes it; then the device ratio, capped
		// (a phone's 3x backing store for a handful of sparks is memory for nothing).
		const zoom = canvas.getBoundingClientRect().width / cw || 1;
		const dpr = Math.min(window.devicePixelRatio || 1, lite ? 1 : 2);
		const px = Math.max(1, Math.round(cw * zoom * dpr));
		const ratio = canvas.clientHeight / cw;
		canvas.width = px;
		canvas.height = Math.max(1, Math.round(px * ratio));
	};

	onMount(() => {
		if (!canvas) return;
		ctx = canvas.getContext('2d');
		stars = [
			makeStar('#ffe27a', 'rgba(255,214,90,0.95)'),
			makeStar('#ffc21f', 'rgba(255,184,30,0.9)'),
			makeStar('#e89400', 'rgba(230,140,0,0.8)'),
		];
		resize();
		ro = new ResizeObserver(resize);
		ro.observe(canvas);
	});

	onDestroy(() => {
		cancelAnimationFrame(raf);
		ro?.disconnect();
	});
</script>

<canvas
	bind:this={canvas}
	class="sparks"
	style="left:-{MARGIN * 100}%; top:-{MARGIN * 100}%; width:{(1 + MARGIN * 2) * 100}%; height:{(1 + MARGIN * 2) * 100}%"
	aria-hidden="true"
></canvas>

<style>
	.sparks {
		position: absolute;
		pointer-events: none;
	}
</style>
