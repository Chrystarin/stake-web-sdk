<script lang="ts">
	/**
	 * A money wheel drawn in SVG and spun with a CSS transition to an AUTHORED segment.
	 *
	 * Generic on purpose: the 54-segment main wheel and the 36-wedge Jackpot Wheel room are the same
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
		/** Badge art drawn in place of the text label, upright on the label ring. */
		image?: { src: string; aspect: number };
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
	/** The segment under the flapper right now, while the disc is moving. Null when it is at rest. */
	let passing = $state<number | null>(null);
	/**
	 * Which segment wears the outline: the one being passed while the disc turns, and then the one it
	 * came to rest on — `highlight` outlives the spin, so the outline stays through the result and
	 * goes when the round is cleared.
	 */
	const outlined = $derived(passing ?? highlight);

	const track = () => {
		const idx = indexAt(liveRotation());
		passing = idx;
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
		passing = null;
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

	const LABEL_R = 160; // the ring the number labels sit on; bonus wedges start their crest here
	const labelPos = (i: number) => polar(LABEL_R, i * step);

	/**
	 * Room (bonus) labels are set glyph by glyph down the wedge instead of as one centred word: each
	 * letter is sized in proportion to its radius, so the word tapers with the wedge — big and a
	 * little over-wide at the rim, small at the hub — and runs much deeper along the segment. The
	 * head of the run is a crest, not a letter, and it sits on the numbers' own ring so the outer
	 * edge of the wheel reads as one band; the name starts underneath it.
	 */
	const ROOM_OVERFLOW = 1.25; // how far a glyph should spill past the wedge's arc width
	const ROOM_GLYPH_H = 1.13; // Pieces of Eight ink height, as a fraction of font size (measured)
	const ROOM_TRACK = 0.72; // advance between glyph centres, likewise — a little over the face's
	const ROOM_TRACK_MIN = 0.52; // and the tightest setting before the letters are shrunk instead
	const ROOM_CREST_GAP = 10; // clear space between the crest art and the first letter, in units
	const ROOM_HUB_R = 69; // the last glyph's INK stops here; the frame's hub art starts just below

	/** Arc width of one wedge at radius `r`, in viewBox units. */
	const wedgeWidth = (r: number) => r * ((step * Math.PI) / 180);

	/**
	 * Badge art stands upright on the label ring. Number wedges sit just inside their width; a room's
	 * crest spans the full wedge, with the name lettered below it.
	 */
	const BADGE_FILL = 0.95;
	const CREST_FILL = 1;
	const badgeBox = (aspect: number, fill: number) => {
		const w = fill * wedgeWidth(LABEL_R);
		return { w, h: w / aspect };
	};

	type RoomGlyph = { ch: string; x: number; y: number; size: number };

	const roomGlyphs = (i: number, label: string, crest?: { aspect: number }): RoomGlyph[] => {
		const angle = i * step;
		/**
		 * The whole name has to sit between the crest and the hub, and a long one cannot do that at
		 * a short one's setting: fourteen glyphs down the span that holds six have to give somewhere.
		 * They give in tracking first — the letters keep the size that spills them slightly past the
		 * wedge, and close up towards ROOM_TRACK_MIN — and only shrink once that floor is reached.
		 *
		 * `r1` depends on the setting and the setting on `r1`, so it settles over a few passes. The
		 * crest's gap is measured to the first glyph's OUTER edge, a fixed radius, so it comes out
		 * identical on every name however the letters end up set.
		 */
		const crestH = crest ? badgeBox(crest.aspect, CREST_FILL).h : 0;
		const outerEdge = LABEL_R - crestH / 2 - ROOM_CREST_GAP;
		let perRadius = (ROOM_OVERFLOW * ((step * Math.PI) / 180)) / ROOM_GLYPH_H; // size per radius
		let track = ROOM_TRACK;
		for (let pass = 0; pass < 4 && label.length > 1; pass++) {
			const half = (perRadius * track) / 2;
			const r1 = outerEdge / (1 + half);
			// The last glyph's own half-advance has to clear the hub too, so the centre stops short of
			// it by that much — which is why the limit is scaled rather than a flat radius.
			const ratio = Math.pow(ROOM_HUB_R / (1 - half) / r1, 1 / (label.length - 1));
			const neededHalf = (1 - ratio) / (1 + ratio); // half an advance, per unit radius
			const neededTrack = (2 * neededHalf) / perRadius;
			if (neededTrack >= ROOM_TRACK) {
				track = ROOM_TRACK; // it fits at the face's own spacing, with room to spare
				break;
			}
			track = Math.max(ROOM_TRACK_MIN, neededTrack);
			if (neededTrack < ROOM_TRACK_MIN) perRadius = (2 * neededHalf) / ROOM_TRACK_MIN;
		}

		const half = (perRadius * track) / 2; // half an advance between letters, per unit radius
		let r = outerEdge / (1 + half);

		const glyphs: RoomGlyph[] = [];
		for (const ch of label) {
			const p = polar(r, angle);
			glyphs.push({ ch, x: p.x, y: p.y, size: perRadius * r });
			r *= (1 - half) / (1 + half);
		}
		return glyphs;
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
				/>
			{/each}
			<circle cx={R} cy={R} r={OUTER} fill="url(#rim)" />
			{#each segments as seg, i (i)}
				{#if seg.image}
					{@const p = labelPos(i)}
					{@const box = badgeBox(seg.image.aspect, seg.kind === 'room' ? CREST_FILL : BADGE_FILL)}
					<image
						href={seg.image.src}
						x={p.x - box.w / 2}
						y={p.y - box.h / 2}
						width={box.w}
						height={box.h}
						transform="rotate({i * step} {p.x} {p.y})"
					/>
				{:else if seg.kind !== 'room'}
					{@const p = labelPos(i)}
					<text
						x={p.x}
						y={p.y}
						fill={seg.text}
						class="label {seg.kind ?? 'number'}"
						transform="rotate({i * step} {p.x} {p.y})"
						text-anchor="middle"
						dominant-baseline="central">{seg.label}</text
					>
				{/if}
			{/each}
			{#each segments as seg, i (i)}
				{#if seg.kind === 'room'}
					<g class="room-word" style="--glow:{seg.fill}">
						{#each roomGlyphs(i, seg.label, seg.image) as g, j (j)}
							<text
								x={g.x}
								y={g.y}
								fill={seg.text}
								class="label room"
								style="font-size:{g.size}px"
								transform="rotate({i * step + 90} {g.x} {g.y})"
								text-anchor="middle"
								dominant-baseline="central">{g.ch}</text
							>
						{/each}
					</g>
				{/if}
			{/each}
			{#each segments as seg, i (i)}
				<path d={wedgePath(i)} class="shade" class:on={highlight !== null && highlight !== i} />
			{/each}
			{#if outlined !== null}
				<!-- One wedge outline, rotated onto whichever segment is under the flapper. Rotating a
				     static path costs one attribute per frame; redrawing its geometry would cost the
				     whole path, and a blur filter would re-rasterise on every tick. -->
				<g class="passing" transform="rotate({outlined * step} {R} {R})">
					<path d={wedgePath(0)} class="passing-edge" />
				</g>
			{/if}
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
		stroke: #f0c65a;
		stroke-width: 1;
		transition: filter 300ms ease, opacity 300ms ease;
	}
	.wedge.lit {
		filter: brightness(1.35) saturate(1.2);
	}
	/* Losing wedges are covered, not faded: a black copy of the wedge laid over everything drawn in
	   it — fill, badge and lettering alike — so the winner reads as lit rather than merely opaque. */
	.shade {
		fill: #000;
		opacity: 0;
		pointer-events: none;
		transition: opacity 300ms ease;
	}
	.shade.on {
		opacity: 0.55;
	}
	/* The segment being pointed at as the wheel turns: one thin light rim on the wedge's own edge. */
	.passing-edge {
		fill: none;
		pointer-events: none;
		stroke-linejoin: round;
		stroke: rgba(255, 246, 194, 0.8);
		stroke-width: 1.6;
	}
	.label {
		font-family: 'PiecesOfEight', 'Alexandria', sans-serif;
		font-weight: 400;
		pointer-events: none;
		paint-order: stroke;
		stroke: rgba(0, 0, 0, 0.45);
		stroke-width: 2.4;
	}
	.label.number {
		font-size: 21px;
	}
	.label.value {
		font-size: 18px;
	}
	/* Room glyphs are sized inline, per letter — see roomGlyphs(). Each word glows in its own wedge
	   colour, so where the letters spill onto a neighbour the halo still names the segment. */
	.room-word {
		filter: drop-shadow(0 0 3px var(--glow)) drop-shadow(0 0 9px var(--glow));
	}
	.hub {
		fill: #1c1410;
		stroke: #f0c65a;
		stroke-width: 3;
	}
	.hub-label {
		font-family: 'PiecesOfEight', 'Alexandria', sans-serif;
		font-weight: 400;
		font-size: 22px;
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
