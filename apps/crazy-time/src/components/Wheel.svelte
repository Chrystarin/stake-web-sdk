<script lang="ts">
	/**
	 * A money wheel drawn in SVG and spun with a CSS transition to an AUTHORED segment.
	 *
	 * Generic on purpose: the 54-segment main wheel and the 36-wedge Lucky Wheel room are the same
	 * component with different `segments`. Nothing here decides an outcome — `spinTo(index)` is the
	 * only way it moves, and the index comes from the book.
	 */
	import { onDestroy } from 'svelte';

	export type WheelSegment = {
		label: string;
		fill: string;
		text: string;
		/** Draw the label larger (numbers) or smaller and radial (room names). */
		kind?: 'number' | 'room' | 'value';
	};

	/**
	 * Optional art frame around the disc. `hole` is the transparent circle of the frame image, as
	 * fractions of the image box (centre and radius); the disc is fitted to it, slightly oversized so
	 * the wedge edges run under the ring. `center` is a static hub image placed on the hole centre,
	 * `centerWidth` its width as a fraction of the image box. The frame's own pointer at 12 o'clock
	 * is the flapper, so the CSS one is not drawn.
	 */
	export type WheelFrame = {
		src: string;
		aspect: number; // width / height of the frame image
		hole: { cx: number; cy: number; r: number }; // r as a fraction of the image WIDTH
		/** Optional static hub image (omit when the frame art already carries its own hub). */
		center?: string;
		centerWidth?: number;
		/**
		 * How far past the hole edge the wedges run, as a fraction of the hole radius. A hair of
		 * overscan hides the anti-aliased seam between wedge edge and ring; the ring covers it.
		 */
		overscan?: number;
	};

	type Props = {
		segments: readonly WheelSegment[];
		frame?: WheelFrame;
		/** Inner radius of the wedges, in viewBox units out of 200. */
		innerRadius?: number;
		/** Fired whenever a new segment passes under the flapper while spinning. */
		onTick?: (index: number) => void;
		/** Fires with the resting segment when a spin ends. */
		onLand?: (index: number) => void;
		/** Highlight this segment (after landing). */
		highlight?: number | null;
		/** Hub label. */
		hub?: string;
	};

	let {
		segments,
		frame,
		innerRadius = 62,
		onTick,
		onLand,
		highlight = null,
		hub = '',
	}: Props = $props();

	const R = 200; // viewBox radius
	const OUTER = 190;
	const INNER = $derived(innerRadius);

	/**
	 * Disc box inside the frame, as percentages of the frame box. The wedges' outer edge (OUTER of
	 * R) is placed exactly on the hole radius, plus the frame's overscan.
	 */
	const discBox = $derived.by(() => {
		if (!frame) return null;
		const rw = frame.hole.r * (1 + (frame.overscan ?? 0)) * (R / OUTER); // fraction of width
		const rh = rw * frame.aspect; // as a fraction of height
		return {
			left: (frame.hole.cx - rw) * 100,
			top: (frame.hole.cy - rh) * 100,
			width: rw * 2 * 100,
			height: rh * 2 * 100,
		};
	});
	const step = $derived(360 / segments.length);

	const polar = (r: number, deg: number) => {
		const a = ((deg - 90) * Math.PI) / 180;
		return { x: R + r * Math.cos(a), y: R + r * Math.sin(a) };
	};

	/** Wedge `i` is centred on angle i*step, measured clockwise from the flapper at 12 o'clock. */
	const wedgePath = (i: number) => {
		const a0 = i * step - step / 2;
		const a1 = i * step + step / 2;
		const o0 = polar(OUTER, a0);
		const o1 = polar(OUTER, a1);
		const i0 = polar(INNER, a0);
		const i1 = polar(INNER, a1);
		const large = step > 180 ? 1 : 0;
		if (INNER <= 0) {
			return `M${o0.x},${o0.y} A${OUTER},${OUTER} 0 ${large} 1 ${o1.x},${o1.y} L${R},${R}Z`;
		}
		return `M${o0.x},${o0.y} A${OUTER},${OUTER} 0 ${large} 1 ${o1.x},${o1.y} L${i1.x},${i1.y} A${INNER},${INNER} 0 ${large} 0 ${i0.x},${i0.y}Z`;
	};

	let rotation = $state(0);
	let spinning = $state(false);
	let durationMs = $state(4500);
	let wheelEl: HTMLDivElement | undefined = $state();
	let raf = 0;

	/** The segment under the flapper for a given clockwise rotation of the disc. */
	const indexAt = (deg: number) => {
		const n = segments.length;
		const norm = ((-deg % 360) + 360) % 360;
		return Math.round(norm / step) % n;
	};

	/** Live rotation off the computed transform, so ticks follow the eased motion, not a timer. */
	const liveRotation = () => {
		if (!wheelEl) return rotation;
		const t = getComputedStyle(wheelEl).transform;
		if (!t || t === 'none') return rotation;
		const m = new DOMMatrixReadOnly(t);
		let deg = (Math.atan2(m.b, m.a) * 180) / Math.PI;
		if (deg < 0) deg += 360;
		return deg;
	};

	let lastTick = -1;
	const track = () => {
		const idx = indexAt(liveRotation());
		if (idx !== lastTick) {
			lastTick = idx;
			onTick?.(idx);
		}
		if (spinning) raf = requestAnimationFrame(track);
	};

	let resolveSpin: (() => void) | null = null;

	/**
	 * Spin forward to rest with `index` under the flapper. Resolves when the disc has stopped.
	 * `turns` full rotations are added so a short delta still reads as a proper spin.
	 */
	export const spinTo = (index: number, opts: { turns?: number; ms?: number } = {}): Promise<void> => {
		const turns = opts.turns ?? 5;
		durationMs = opts.ms ?? 4500;
		const target = -index * step; // rotation that puts `index` at the top
		const current = ((rotation % 360) + 360) % 360;
		const targetNorm = ((target % 360) + 360) % 360;
		let delta = targetNorm - current;
		if (delta <= 0) delta += 360;
		const next = rotation + turns * 360 + delta;

		return new Promise((resolve) => {
			resolveSpin = resolve;
			spinning = true;
			lastTick = indexAt(rotation);
			// Two frames so the transition picks up the new duration before the angle changes.
			requestAnimationFrame(() => {
				requestAnimationFrame(() => {
					rotation = next;
					cancelAnimationFrame(raf);
					raf = requestAnimationFrame(track);
				});
			});
			// Safety net in case transitionend never fires (tab hidden, element replaced).
			setTimeout(() => finish(index), durationMs + 400);
		});
	};

	const finish = (index: number) => {
		if (!spinning) return;
		spinning = false;
		cancelAnimationFrame(raf);
		onLand?.(index);
		resolveSpin?.();
		resolveSpin = null;
	};

	const onTransitionEnd = (event: TransitionEvent) => {
		if (event.propertyName !== 'transform') return;
		finish(indexAt(rotation));
	};

	onDestroy(() => cancelAnimationFrame(raf));

	const labelPos = (i: number, kind: WheelSegment['kind']) => {
		const r = kind === 'room' ? 128 : 160;
		return polar(r, i * step);
	};
</script>

<div class="wheel" class:framed={Boolean(frame)} style={frame ? `aspect-ratio:${frame.aspect}` : ''}>
	{#if !frame}
		<div class="flapper" aria-hidden="true"></div>
	{/if}
	<div
		class="disc"
		style:left={discBox ? `${discBox.left}%` : null}
		style:top={discBox ? `${discBox.top}%` : null}
		style:width={discBox ? `${discBox.width}%` : null}
		style:height={discBox ? `${discBox.height}%` : null}
		class:spinning
		bind:this={wheelEl}
		style="--rotation:{rotation}deg; --duration:{durationMs}ms"
		ontransitionend={onTransitionEnd}
	>
		<svg viewBox="0 0 {R * 2} {R * 2}" aria-hidden="true">
			<defs>
				<radialGradient id="rim" cx="50%" cy="50%" r="50%">
					<stop offset="88%" stop-color="rgba(0,0,0,0)" />
					<stop offset="100%" stop-color="rgba(0,0,0,0.45)" />
				</radialGradient>
			</defs>
			<circle cx={R} cy={R} r={OUTER + 8} class="rim-ring" />
			{#each segments as seg, i (i)}
				<path
					d={wedgePath(i)}
					fill={seg.fill}
					class="wedge"
					class:lit={highlight === i}
					class:dim={highlight !== null && highlight !== i}
				/>
			{/each}
			<circle cx={R} cy={R} r={OUTER} fill="url(#rim)" />
			{#each segments as seg, i (i)}
				{@const p = labelPos(i, seg.kind)}
				<text
					x={p.x}
					y={p.y}
					fill={seg.text}
					class="label {seg.kind ?? 'number'}"
					transform="rotate({i * step + (seg.kind === 'room' ? 90 : 0)} {p.x} {p.y})"
					text-anchor="middle"
					dominant-baseline="central">{seg.label}</text
				>
			{/each}
			{#if !frame && INNER > 4}
				<circle cx={R} cy={R} r={INNER - 4} class="hub" />
			{/if}
			{#if hub && !frame}
				<text x={R} y={R} class="hub-label" text-anchor="middle" dominant-baseline="central">{hub}</text>
			{/if}
		</svg>
	</div>
	{#if frame}
		<img class="frame" src={frame.src} alt="" draggable="false" />
		{#if frame.center}
			<img
				class="center"
				src={frame.center}
				alt=""
				draggable="false"
				style="left:{frame.hole.cx * 100}%; top:{frame.hole.cy * 100}%; width:{(frame.centerWidth ?? 0.29) * 100}%"
			/>
		{/if}
	{/if}
</div>

<style>
	.wheel {
		position: relative;
		width: 100%;
		aspect-ratio: 1;
	}
	.disc {
		width: 100%;
		height: 100%;
		transform: rotate(var(--rotation));
		filter: drop-shadow(0 0.6vw 1.4vw rgba(0, 0, 0, 0.6));
	}
	/* Framed: the disc is fitted to the frame's hole and the art sits over it. */
	.framed .disc {
		position: absolute;
		filter: none;
	}
	.framed .rim-ring {
		display: none;
	}
	.frame {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		pointer-events: none;
		user-select: none;
		filter: drop-shadow(0 0.6vw 1.4vw rgba(0, 0, 0, 0.6));
	}
	.center {
		position: absolute;
		transform: translate(-50%, -50%);
		pointer-events: none;
		user-select: none;
		filter: drop-shadow(0 0.3vw 0.6vw rgba(0, 0, 0, 0.6));
	}
	.disc.spinning {
		transition: transform var(--duration) cubic-bezier(0.1, 0.72, 0.08, 1);
	}
	svg {
		width: 100%;
		height: 100%;
		display: block;
	}
	.rim-ring {
		fill: #2a1a0c;
		stroke: #f0c65a;
		stroke-width: 4;
	}
	.wedge {
		stroke: rgba(255, 255, 255, 0.55);
		stroke-width: 0.8;
		transition: filter 300ms ease, opacity 300ms ease;
	}
	.wedge.lit {
		filter: brightness(1.35) saturate(1.2);
	}
	.wedge.dim {
		opacity: 0.55;
	}
	.label {
		font-family: 'Alexandria', sans-serif;
		font-weight: 700;
		pointer-events: none;
		paint-order: stroke;
		stroke: rgba(0, 0, 0, 0.35);
		stroke-width: 2;
	}
	.label.number {
		font-size: 17px;
	}
	.label.value {
		font-size: 15px;
	}
	.label.room {
		font-size: 9px;
		letter-spacing: 0.5px;
	}
	.hub {
		fill: #1c1410;
		stroke: #f0c65a;
		stroke-width: 3;
	}
	.hub-label {
		font-family: 'Alexandria', sans-serif;
		font-weight: 700;
		font-size: 18px;
		fill: #ffe14d;
	}
	/* The flapper: fixed at 12 o'clock, pointing down into the rim. */
	.flapper {
		position: absolute;
		top: -2.2%;
		left: 50%;
		width: 7%;
		aspect-ratio: 1 / 1.3;
		transform: translateX(-50%);
		background: linear-gradient(180deg, #fff2b8 0%, #f0c65a 60%, #b8860b 100%);
		clip-path: polygon(0 0, 100% 0, 50% 100%);
		filter: drop-shadow(0 0.15vw 0.3vw rgba(0, 0, 0, 0.6));
		z-index: 2;
	}
</style>
