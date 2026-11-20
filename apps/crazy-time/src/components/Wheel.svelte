<script lang="ts">
	/**
	 * A money wheel drawn in SVG and spun with a CSS transition to an AUTHORED segment.
	 *
	 * Generic on purpose: the 54-segment main wheel and the 36-wedge Bonus Wheel room are the same
	 * component with different `segments`. Nothing here decides an outcome — `spinTo(index)` is the
	 * only way it moves, and the index comes from the book.
	 */
	import { onDestroy } from 'svelte';
	import WheelSparks from './WheelSparks.svelte';

	export type WheelSegment = {
		label: string;
		fill: string;
		text: string;
		/**
		 * How the label is set: `number` is one centred word, while `room` (bonus names) and `value`
		 * (Bonus Wheel multipliers) are lettered down the wedge glyph by glyph — see roomGlyphs().
		 * `wide` is for a disc with few, broad wedges: the crest with the name set ACROSS the wedge in
		 * one or two big lines rather than down it.
		 */
		kind?: 'number' | 'room' | 'value' | 'wide';
		/** Badge art drawn in place of the text label, upright on the label ring. */
		image?: { src: string; aspect: number };
		/**
		 * The wedge's width relative to the others; 1 unless stated. Unused by the game's two discs
		 * today (the Bonus Wheel draws its 1,000x sliver at full width, see README); kept for a disc
		 * that wants unequal arcs.
		 */
		weight?: number;
		/**
		 * The width the LABEL is sized for, when the wedge itself is too narrow to hold one: a
		 * narrow wedge's figure set as if on a full one, spilling over its neighbours. Its own
		 * `weight` unless stated.
		 */
		inkWeight?: number;
		/**
		 * Glow the lettering in the wedge's own colour, as a room name does — so a label that spills
		 * past a narrow wedge still names the wedge it belongs to.
		 */
		glow?: boolean;
	};

	/**
	 * Optional art frame around the disc. `hole` is the transparent circle of the frame image, as
	 * fractions of the image box (centre and radius); the disc is fitted to it, slightly oversized so
	 * the wedge edges run under the ring. `center` is a static hub image placed on the hole centre,
	 * `centerWidth` its width as a fraction of the image box.
	 */
	export type WheelFrame = {
		src: string;
		aspect: number; // width / height of the frame image
		hole: { cx: number; cy: number; r: number }; // r as a fraction of the image WIDTH
		/** Optional static hub image (omit when the frame art already carries its own hub). */
		center?: string;
		centerWidth?: number;
		/** Crop and hinge for a movable pointer cut from the frame art, in fractions of the frame. */
		flapper?: {
			left: number;
			right: number;
			bottom: number;
			pivotX: number;
			pivotY: number;
			tipY: number;
			outline: string;
		};
		/**
		 * How far past the hole edge the wedges run, as a fraction of the hole radius. A hair of
		 * overscan hides the anti-aliased seam between wedge edge and ring; the ring covers it.
		 */
		overscan?: number;
		/**
		 * The radius the frame's own art reaches IN to over the disc — its pointer, its rope wraps,
		 * whatever hangs past the ring — as a fraction of the image WIDTH, the same units as
		 * `hole.r`. Label ink outside this is liable to be covered by it. Omit if nothing overhangs.
		 */
		overhang?: number;
	};

	type Props = {
		segments: readonly WheelSegment[];
		frame?: WheelFrame;
		/** Inner radius of the wedges, in viewBox units out of 200. */
		innerRadius?: number;
		/**
		 * Fired whenever a new segment passes under the flapper while spinning. `build` is the
		 * anticipation (see `anticipate`), 0 until the disc starts to slow and 1 as it comes to rest,
		 * so a caller can bring its tick up with it.
		 */
		onTick?: (index: number, build: number) => void;
		/**
		 * Ease out of the spin and build the tick cue as the disc slows. On landing, the pointer flares
		 * and the winning wedge's outline pulses gold. The landing remains the book's `spinTo` index.
		 */
		anticipate?: boolean;
		/** Fires with the resting segment when a spin ends. */
		onLand?: (index: number) => void;
		/** Highlight this segment (after landing). */
		highlight?: number | null;
		/** Hub label. */
		hub?: string;
		/**
		 * Degrees of wedge the INK is sized for, when that is not the real wedge. The buy-bonus disc
		 * shows four rooms on quarter wedges; crests and names sized honestly to 90° would drown the
		 * frame, so it states a wedge the size of a few of the main wheel's and keeps its scale.
		 */
		sizeStep?: number;
		/** Wash the disc white: on, it sweeps in; off, it fades away. Used to cover a segment swap. */
		flash?: boolean;
		/**
		 * Radius of the frame's hub art, in viewBox units out of 200: a glyph run's last letter stops
		 * its ink there. The default fits the main wheel's ship's-wheel hub.
		 */
		hubRadius?: number;
		/** A segment whose badge art is hidden: lifted off the disc by something drawn over it. */
		liftedIcon?: number | null;
		/** Throw gold sparks off the rim while the disc turns (needs a `frame`). */
		sparks?: boolean;
	};

	let {
		segments,
		frame,
		innerRadius = 62,
		onTick,
		onLand,
		highlight = null,
		hub = '',
		hubRadius = 69,
		sizeStep,
		flash = false,
		liftedIcon = null,
		sparks = false,
		anticipate = false,
	}: Props = $props();

	/**
	 * The anticipation (`anticipate`): how far into the slow-down the disc is, 0 to 1. It starts at
	 * BUILD_FROM of the spin's run, when the top-speed phase ends. The tick cue samples it when the
	 * flapper releases.
	 */
	const BUILD_FROM = 3 / 7;
	let spinStartAt = 0;
	/** The pointer's flare as the disc comes to rest. */
	let flare = $state(false);
	let flareTimer: ReturnType<typeof setTimeout> | undefined;
	const FLARE_MS = 900;
	onDestroy(() => clearTimeout(flareTimer));
	const buildAt = (now: number) => {
		if (!spinStartAt) return 0;
		const t = (now - spinStartAt) / durationMs;
		return Math.min(1, Math.max(0, (t - BUILD_FROM) / (1 - BUILD_FROM)));
	};

	let sparkLayer: WheelSparks | undefined = $state();
	/** Sparks start on the frame's outer ring: its art runs about 1.23x the hole's radius. */
	const SPARK_RIM = 1.2;
	let lastDeg = 0;
	let lastAt = 0;

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
	/**
	 * Wedges are laid clockwise from the flapper at 12 o'clock, wedge 0 centred on it, each as wide
	 * as its `weight` says. Equal weights give the familiar 360/n step; unequal ones are allowed,
	 * so every angle here comes from the cumulative layout.
	 */
	const weights = $derived(segments.map((seg) => seg.weight ?? 1));
	const totalWeight = $derived(weights.reduce((sum, w) => sum + w, 0));
	/** Degrees of arc wedge `i` covers. */
	const spanOf = (i: number) => (360 * weights[i]) / totalWeight;
	/** Leading (anticlockwise) edge of each wedge, in degrees clockwise from the flapper. */
	const starts = $derived.by(() => {
		const out: number[] = [];
		let a = -spanOf(0) / 2;
		for (let i = 0; i < segments.length; i++) {
			out.push(a);
			a += spanOf(i);
		}
		return out;
	});
	/** Angle of wedge `i`'s centre line. */
	const centreOf = (i: number) => starts[i] + spanOf(i) / 2;
	/** Degrees of wedge the lettering and badges on `i` are sized against — its own unless told otherwise. */
	const inkSpanOf = (i: number) =>
		sizeStep ?? (360 * (segments[i].inkWeight ?? weights[i])) / totalWeight;

	const polar = (r: number, deg: number) => {
		const a = ((deg - 90) * Math.PI) / 180;
		return { x: R + r * Math.cos(a), y: R + r * Math.sin(a) };
	};

	const wedgePath = (i: number) => {
		const a0 = starts[i];
		const a1 = starts[i] + spanOf(i);
		const o0 = polar(OUTER, a0);
		const o1 = polar(OUTER, a1);
		const i0 = polar(INNER, a0);
		const i1 = polar(INNER, a1);
		const large = spanOf(i) > 180 ? 1 : 0;
		if (INNER <= 0) {
			return `M${o0.x},${o0.y} A${OUTER},${OUTER} 0 ${large} 1 ${o1.x},${o1.y} L${R},${R}Z`;
		}
		return `M${o0.x},${o0.y} A${OUTER},${OUTER} 0 ${large} 1 ${o1.x},${o1.y} L${i1.x},${i1.y} A${INNER},${INNER} 0 ${large} 0 ${i0.x},${i0.y}Z`;
	};

	/** Each divider has a lit brass face and a recessed side in the neighboring segment. */
	const dividerBevel = $derived.by(() => {
		const faces = { light: '', shadow: '', seam: '' };
		for (const [index, angle] of starts.entries()) {
			const previous = (index + starts.length - 1) % starts.length;
			const width = Math.min(0.29, spanOf(index) * 0.065, spanOf(previous) * 0.065);
			const outer = polar(OUTER, angle);
			const inner = polar(INNER, angle);
			const face = (edge: number) => {
				const outside = polar(OUTER, edge);
				const inside = polar(INNER, edge);
				return `M${inner.x},${inner.y}L${outer.x},${outer.y}L${outside.x},${outside.y}L${inside.x},${inside.y}Z`;
			};
			faces.light += face(angle + width);
			faces.shadow += face(angle - width);
			faces.seam += `M${inner.x},${inner.y}L${outer.x},${outer.y}`;
		}
		return faces;
	});

	let rotation = $state(0);
	let spinning = $state(false);
	let durationMs = $state(4500);
	let wheelEl: HTMLDivElement | undefined = $state();
	let raf = 0;

	/** The segment under the flapper for a given clockwise rotation of the disc. */
	const indexAt = (deg: number) => {
		const n = segments.length;
		// The flapper's angle in the disc's own frame, measured from wedge 0's leading edge, then
		// walked wedge by wedge until it is spent.
		let a = (((-deg - starts[0]) % 360) + 360) % 360;
		for (let i = 0; i < n; i++) {
			a -= spanOf(i);
			if (a < 0) return i;
		}
		return n - 1;
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
	let hasTicked = $state(false);
	/** The segment under the flapper right now, while the disc is moving. Null when it is at rest. */
	let passing = $state<number | null>(null);
	/**
	 * Which segment wears the outline: the one being passed while the disc turns, and then the one it
	 * came to rest on — `highlight` outlives the spin, so the outline stays through the result and
	 * goes when the round is cleared.
	 */
	const outlined = $derived(passing ?? highlight);
	let flapperEl: HTMLImageElement | undefined = $state();

	const flapperGeometry = $derived.by(() => {
		const marker = frame?.flapper;
		if (!frame || !marker) return null;
		return {
			offset: marker.pivotX - frame.hole.cx,
			hinge: (frame.hole.cy - marker.pivotY) / frame.aspect,
			length: (marker.tipY - marker.pivotY) / frame.aspect,
		};
	});

	/** Follow the divider with the tip until the spring releases. The tick belongs to the release. */
	const trackFlapper = (deg: number, index: number, speed: number) => {
		if (!flapperEl || !flapperGeometry) return index;
		const { offset, hinge, length } = flapperGeometry;
		const span = spanOf(index);
		const divider = ((deg + starts[index] + span) % 360 + 360) % 360;
		// Release before the midpoint so the flapper is free when the result comes to rest.
		const releaseAt = Math.min(2.7, span * 0.42);
		const angle = (Math.min(divider, releaseAt) * Math.PI) / 180;
		// Intersect the divider's radial line with the arc traced by the hinged tip.
		const projection = (hinge * Math.sin(angle) - offset * Math.cos(angle)) / length;
		const tilt = Math.max(0, Math.asin(Math.max(-1, Math.min(1, projection))) - angle);
		const returnArc = Math.min(speed * 0.05, span * 0.28);
		const progress = divider < releaseAt ? 0 : returnArc > 0 ? Math.min(1, (divider - releaseAt) / returnArc) : 1;
		const spring = (1 - progress) ** 2 * Math.cos(progress * Math.PI * 1.5);
		flapperEl.style.rotate = `${(-tilt * spring * 180) / Math.PI}deg`;
		return divider < releaseAt ? (index + 1) % segments.length : index;
	};

	const track = () => {
		const deg = liveRotation();
		const now = performance.now();
		// The disc turns clockwise only, so a drop in angle is the wrap past 360.
		const speed = lastAt && now > lastAt ? (((deg - lastDeg + 360) % 360) * 1000) / (now - lastAt) : 0;
		lastDeg = deg;
		lastAt = now;
		sparkLayer?.setSpeed(speed);
		const idx = trackFlapper(deg, indexAt(deg), speed);
		passing = idx;
		if (idx !== lastTick) {
			lastTick = idx;
			if (anticipate) hasTicked = true;
			onTick?.(idx, anticipate ? buildAt(now) : 0);
		}
		if (spinning) raf = requestAnimationFrame(track);
	};

	let resolveSpin: (() => void) | null = null;
	let spinTimer: ReturnType<typeof setTimeout> | undefined;

	/**
	 * Spin forward to rest with `index` under the flapper. Resolves when the disc has stopped.
	 * `turns` full rotations are added so a short delta still reads as a proper spin.
	 */
	export const spinTo = (index: number, opts: { turns?: number; ms?: number } = {}): Promise<void> => {
		const turns = opts.turns ?? 5;
		durationMs = opts.ms ?? 4500;
		const target = -centreOf(index); // rotation that puts `index` at the top
		const current = ((rotation % 360) + 360) % 360;
		const targetNorm = ((target % 360) + 360) % 360;
		let delta = targetNorm - current;
		if (delta <= 0) delta += 360;
		const next = rotation + turns * 360 + delta;

		return new Promise((resolve) => {
			resolveSpin = resolve;
			stopIcon();
			spinning = true;
			flare = false;
			clearTimeout(flareTimer);
			lastTick = indexAt(rotation);
			hasTicked = false;
			// Two frames so the transition picks up the new duration before the angle changes.
			requestAnimationFrame(() => {
				requestAnimationFrame(() => {
					spinStartAt = performance.now();
					rotation = next;
					cancelAnimationFrame(raf);
					raf = requestAnimationFrame(track);
				});
			});
			// Safety net in case transitionend never fires (tab hidden, element replaced).
			spinTimer = setTimeout(() => finish(index), durationMs + 400);
		});
	};

	/**
	 * Put the disc back at rest with segment 0 under the flapper, without turning it. Only for a
	 * moment when the disc cannot be seen moving — a segment swap under the flash — and never while
	 * it spins.
	 */
	export const resetRotation = () => {
		if (spinning) return;
		rotation = 0;
	};

	/**
	 * Set the disc at rest with `index` under the flapper, without turning it: for a wheel that is
	 * off the stage, so it comes back already showing the result. Never while it spins.
	 */
	export const jumpTo = (index: number) => {
		if (spinning) return;
		rotation = -centreOf(index);
	};

	/**
	 * Segment `index`'s badge plays a motion once through: `motion` names a global `motion-*` class
	 * (Game.svelte defines them, for the bet tiles' icons too) and `ms` is how long it runs. A spin
	 * cuts it short.
	 */
	let moving = $state<{ index: number; motion: string } | null>(null);
	let movingTimer: ReturnType<typeof setTimeout> | undefined;
	const stopIcon = () => {
		clearTimeout(movingTimer);
		moving = null;
	};
	export const playIcon = (index: number, motion: string, ms: number) => {
		stopIcon();
		moving = { index, motion };
		movingTimer = setTimeout(() => (moving = null), ms);
	};
	onDestroy(() => clearTimeout(movingTimer));

	/** Where segment `index`'s badge art is on the screen, as a client rect; null if it has none. */
	/**
	 * Something has just been slammed down onto segment `index`: its wedge flashes and its badge
	 * shakes, for `SLAM_MS`.
	 */
	let slammed = $state<number | null>(null);
	const SLAM_MS = 450;
	let slamTimer: ReturnType<typeof setTimeout> | undefined;
	export const slam = (index: number) => {
		clearTimeout(slamTimer);
		slammed = index;
		slamTimer = setTimeout(() => (slammed = null), SLAM_MS);
	};

	export const iconRect = (index: number): DOMRect | null => {
		// Worked out from the disc's RESTING angle rather than read off the drawn badge: a spin
		// resolves on its safety timer when the page is not being painted (a background tab), with
		// the transition still part-way round, and the drawn badge would be wherever that left it.
		const img = wheelEl?.querySelector<SVGImageElement>(`image[data-seg="${index}"]`);
		const disc = discOnScreen();
		if (!img || !disc) return null;
		const w = img.width.baseVal.value;
		const h = img.height.baseVal.value;
		const px = img.x.baseVal.value + w / 2 - R;
		const py = img.y.baseVal.value + h / 2 - R;
		const a = (rotation * Math.PI) / 180;
		const k = disc.d / (R * 2);
		const cx = disc.cx + (px * Math.cos(a) - py * Math.sin(a)) * k;
		const cy = disc.cy + (px * Math.sin(a) + py * Math.cos(a)) * k;
		return new DOMRect(cx - (w * k) / 2, cy - (h * k) / 2, w * k, h * k);
	};

	/**
	 * The disc's centre and diameter on the screen, in client pixels, whatever angle it is at.
	 */
	export const discOnScreen = (): { cx: number; cy: number; d: number } | null => {
		const holder = wheelEl?.parentElement;
		if (!wheelEl || !holder) return null;
		// The centre does not move as the disc turns, so the turned rect's middle is good at any
		// angle. The size is the disc's own layout width, scaled by whatever its holder is scaled by
		// on the screen (the game's zoom), which a turn does not touch either.
		const r = wheelEl.getBoundingClientRect();
		const scale = holder.offsetWidth ? holder.getBoundingClientRect().width / holder.offsetWidth : 1;
		return {
			cx: r.left + r.width / 2,
			cy: r.top + r.height / 2,
			d: wheelEl.offsetWidth * scale,
		};
	};

	/**
	 * Segment `index`'s badge as it stands on the screen: its centre and drawn width in client
	 * pixels, and the angle it is turned to in degrees — for something to be laid exactly over it.
	 * Null if it has none.
	 */
	export const iconPose = (
		index: number,
	): { cx: number; cy: number; w: number; angle: number } | null => {
		const img = wheelEl?.querySelector<SVGImageElement>(`image[data-seg="${index}"]`);
		const disc = discOnScreen();
		if (!img || !disc) return null;
		const r = img.getBoundingClientRect();
		return {
			cx: r.left + r.width / 2,
			cy: r.top + r.height / 2,
			w: (img.width.baseVal.value * disc.d) / (R * 2),
			angle: rotation + centreOf(index),
		};
	};

	const finish = (index: number) => {
		if (!spinning) return;
		spinning = false;
		passing = null;
		cancelAnimationFrame(raf);
		clearTimeout(spinTimer);
		if (flapperEl) flapperEl.style.rotate = '0deg';
		lastAt = 0;
		if (sparkLayer) {
			sparkLayer.setSpeed(0);
			sparkLayer.burst();
		}
		if (anticipate) {
			spinStartAt = 0;
			flare = true;
			flareTimer = setTimeout(() => (flare = false), FLARE_MS);
		}
		onLand?.(index);
		resolveSpin?.();
		resolveSpin = null;
	};

	const onTransitionEnd = (event: TransitionEvent) => {
		if (event.target !== wheelEl || event.propertyName !== 'transform') return;
		finish(indexAt(rotation));
	};

	onDestroy(() => {
		cancelAnimationFrame(raf);
		clearTimeout(spinTimer);
	});

	const LABEL_R = 160; // the ring the number labels sit on; bonus wedges start their crest here
	const labelPos = (i: number) => polar(LABEL_R, centreOf(i));

	/**
	 * Labels that run down the wedge, glyph by glyph, instead of sitting on it as one centred word:
	 * a room's name (roomGlyphs) and a Bonus Wheel multiplier (uprightGlyphs). Both taper towards
	 * the hub as the wedge narrows, and in both the glyphs touch, so a run reads as one piece of
	 * lettering rather than a column of separate characters — but they are set at right angles to
	 * each other, and that is the whole difference between the two functions.
	 *
	 * A room's name is turned on its side: reading runs down the wedge, so a glyph's ADVANCE is its
	 * radial extent and its ink HEIGHT is what has to fit across the wedge. It is also headed by a
	 * crest, which sits on the numbers' own ring so the outer edge of the wheel reads as one band,
	 * with the name starting underneath it. A multiplier is left upright and stacked, so those two
	 * dimensions swap over, and with nothing above it, it starts at the rim itself.
	 */
	const ROOM_OVERFLOW = 1.25; // how far a letter should spill past the wedge's arc width
	const RUN_OVERFLOW = 0.6; // a digit stays inside it: the wedge either side is a number too, and
	// two runs of figures that touch are two numbers that cannot be told apart at a glance
	const RUN_TAPER = 0.93; // one digit's size over the one above it — see uprightGlyphs()
	const RUN_LEAD = 1.7; // and how far apart they are set, as a multiple of their own ink height
	const RUN_PREFIX = 0.72; // the leading `x` is a marker, not a figure, and is cut down to this
	const ROOM_GLYPH_H = 1.13; // Pieces of Eight ink height, as a fraction of font size (measured)
	const ROOM_TRACK = 0.72; // advance between glyph centres, likewise — a little over the face's
	const ROOM_TRACK_MIN = 0.52; // and the tightest setting before the letters are shrunk instead
	const ROOM_CREST_GAP = 10; // clear space between the crest art and the first letter, in units
	const RUN_RIM_GAP = 4; // clear space between a multiplier's first glyph and a bare rim
	const RUN_TUCK = 3; // and how far a frame's overhang is let over that glyph when there is one

	/**
	 * Alexandria Bold — the face the balance and the wager are set in — measured off the file: each
	 * glyph's INK box as fractions of the font size. A run is only as big as its most awkward glyph
	 * allows, and these are not an even set: `1` is two thirds the width of `0`, and the `x` is a
	 * true lowercase, three quarters the height of the figures it stands in front of. Sizing a whole
	 * number off one worst case would cost a third of the type, so every glyph is measured.
	 *
	 * A multiplier is `x${value}`, so these eleven are the whole alphabet a run can draw on.
	 */
	const RUN_INK: Record<string, { w: number; h: number }> = {
		'0': { w: 0.703, h: 0.713 },
		'1': { w: 0.419, h: 0.701 },
		'2': { w: 0.605, h: 0.708 },
		'3': { w: 0.603, h: 0.709 },
		'4': { w: 0.608, h: 0.701 },
		'5': { w: 0.625, h: 0.709 },
		'6': { w: 0.63, h: 0.716 },
		'7': { w: 0.589, h: 0.701 },
		'8': { w: 0.631, h: 0.716 },
		'9': { w: 0.629, h: 0.716 },
		x: { w: 0.611, h: 0.54 },
	};
	const RUN_INK_FALLBACK = { w: 0.703, h: 0.716 };
	const runInk = (ch: string) => RUN_INK[ch] ?? RUN_INK_FALLBACK;

	/**
	 * The disc's visible rim: the wedges themselves run out to OUTER, but a frame's overscan tucks
	 * that last sliver under the ring art, so ink placed past this radius would disappear under wood.
	 */
	const RIM_R = $derived(frame ? OUTER / (1 + (frame.overscan ?? 0)) : OUTER);
	/**
	 * Where a run puts the outer ink edge of its first glyph, which is not the rim: a frame's pointer
	 * and its rope wraps hang over the disc well inside the ring, and a number set against the rim
	 * spends its whole first character underneath them. It is set to where that art ends, and then
	 * RUN_TUCK back out again — the overhang takes a bite out of the top of the first glyph rather
	 * than the number shying away from it, which reads as one piece of art instead of two. With no
	 * overhang declared there is nothing to tuck under and it simply keeps clear of the rim.
	 */
	const RUN_TOP = $derived(
		frame?.overhang ? RIM_R * (frame.overhang / frame.hole.r) + RUN_TUCK : RIM_R - RUN_RIM_GAP,
	);

	/** Arc width of wedge `i`'s ink at radius `r`, in viewBox units. */
	const wedgeWidth = (r: number, i: number) => r * ((inkSpanOf(i) * Math.PI) / 180);

	/**
	 * Badge art stands upright on the label ring. Number wedges sit just inside their width; a room's
	 * crest spans the full wedge, with the name lettered below it.
	 */
	const BADGE_FILL = 0.95;
	const CREST_FILL = 1;
	const badgeBox = (aspect: number, fill: number, i: number) => {
		const w = fill * wedgeWidth(LABEL_R, i);
		return { w, h: w / aspect };
	};

	type RoomGlyph = { ch: string; x: number; y: number; size: number };

	/**
	 * A `wide` label: the name split at its spaces into at most two lines, set across the wedge under
	 * the crest, big. Each line's centre sits on its own ring; the text is rotated with the wedge so
	 * it reads level when the wedge is at the top.
	 */
	const WIDE_FONT = 17;
	const WIDE_LEAD = 1.05;
	const WIDE_GAP = 5; // between the crest's bottom edge and the first line's top
	/**
	 * A wide wedge's crest does not take the label ring's full-wedge setting: at that size it runs
	 * out past the rim and under the frame. It is cut to WIDE_CREST_W and hung WIDE_RIM_GAP inside
	 * the visible rim, so the crest and the name under it stay on the painted wedge.
	 */
	const WIDE_CREST_W = 56;
	const WIDE_RIM_GAP = 14;
	const wideCrest = (i: number, aspect: number) => {
		const w = WIDE_CREST_W;
		const h = w / aspect;
		const r = RIM_R - WIDE_RIM_GAP - h / 2;
		const p = polar(r, centreOf(i));
		return { x: p.x - w / 2, y: p.y - h / 2, w, h, cx: p.x, cy: p.y, bottom: r - h / 2 };
	};
	const wideLines = (i: number, label: string, crest?: { aspect: number }) => {
		const words = label.split(' ');
		const lines = words.length > 2 ? [words[0], words.slice(1).join(' ')] : words;
		const top = (crest ? wideCrest(i, crest.aspect).bottom : RIM_R - WIDE_RIM_GAP) - WIDE_GAP; // outer ink edge of the first line
		// The last line has to stay clear of the hub, so the type gives way before it does.
		const span = 1 + (lines.length - 1) * WIDE_LEAD;
		const size = Math.min(WIDE_FONT, (top - hubRadius) / span);
		return lines.map((text, k) => {
			const r = top - size * 0.5 - k * size * WIDE_LEAD;
			const p = polar(r, centreOf(i));
			return { text, x: p.x, y: p.y, size };
		});
	};

	/** Labels set glyph by glyph down the wedge rather than as one centred word. */
	const isRun = (seg: WheelSegment) => seg.kind === 'room' || seg.kind === 'value';

	const roomGlyphs = (i: number, label: string, crest: { aspect: number }): RoomGlyph[] => {
		const angle = centreOf(i);
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
		const crestH = badgeBox(crest.aspect, CREST_FILL, i).h;
		const outerEdge = LABEL_R - crestH / 2 - ROOM_CREST_GAP;
		let perRadius = (ROOM_OVERFLOW * ((inkSpanOf(i) * Math.PI) / 180)) / ROOM_GLYPH_H; // size per radius
		let track = ROOM_TRACK;
		for (let pass = 0; pass < 4 && label.length > 1; pass++) {
			const half = (perRadius * track) / 2;
			const r1 = outerEdge / (1 + half);
			// The last glyph's own half-advance has to clear the hub too, so the centre stops short of
			// it by that much — which is why the limit is scaled rather than a flat radius.
			const ratio = Math.pow(hubRadius / (1 - half) / r1, 1 / (label.length - 1));
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

	/**
	 * A multiplier, set upright and stacked from the rim down the wedge — each digit's ink resting
	 * directly on the one below, so the number reads as a single column rather than four loose
	 * characters.
	 *
	 * The sizing is the one thing that could not be carried over from a name. Scaling every glyph by
	 * its own radius, which is what tapers a name so nicely, is far more violent on a digit standing
	 * up: an upright glyph is about half as wide again in the radial direction as a sideways one, so
	 * a run of four covers the same ground in far bigger steps and ends with an `x` a quarter the
	 * size of the first digit — a mistake rather than a taper. So the taper is set directly instead,
	 * at RUN_TAPER a step, and the run is sized as one block.
	 *
	 * That block has a closed form. With the first glyph's size S the sizes are S·f^j, and stacking
	 * puts each centre at `outerEdge - S·c[j]` — every radius affine in S — so each constraint (every
	 * glyph inside the wedge's width at its OWN radius, in its OWN cut, and the last one's ink clear
	 * of the hub) is one division, and the setting is the smallest S they all allow. Whichever binds
	 * decides how the run behaves: a short number is held by the width and stops above the hub, a
	 * long one is held by the hub and shrinks to reach it.
	 */
	const uprightGlyphs = (i: number, label: string): RoomGlyph[] => {
		if (!label) return [];
		const angle = centreOf(i);
		const outerEdge = RUN_TOP;
		const chars = [...label];
		const last = chars.length - 1;
		/**
		 * Glyph j's size, per unit of S: the taper, and then the leading `x` cut down again — it
		 * introduces the number rather than being part of it, and left at the head of the taper it
		 * would be the biggest thing on the wedge, which is not what an `x50` says.
		 */
		const weights = chars.map(
			(ch, j) => Math.pow(RUN_TAPER, j) * (j === 0 && ch === 'x' ? RUN_PREFIX : 1),
		);
		const scale = (j: number) => weights[j];

		/**
		 * c[j]: how far glyph j's centre sits below the run's outer ink edge, per unit of S. Half of
		 * the first glyph's own ink to reach its centre, then a leaded line to each one after it —
		 * measured off the two glyphs it runs between, since they are neither the same size nor, with
		 * a lowercase `x` in front of the figures, the same height.
		 */
		const c: number[] = [];
		let drop = (runInk(chars[0]).h * scale(0)) / 2;
		for (let j = 0; j <= last; j++) {
			c.push(drop);
			if (j < last) {
				drop +=
					(RUN_LEAD * (runInk(chars[j]).h * scale(j) + runInk(chars[j + 1]).h * scale(j + 1))) / 2;
			}
		}

		// How much of the wedge a glyph's ink may take across it, per unit radius.
		const allowed = (RUN_OVERFLOW * (inkSpanOf(i) * Math.PI)) / 180;
		let size = Infinity;
		for (let j = 0; j <= last; j++) {
			// inkW·size_j <= allowed·r_j, with r_j written out in terms of the first glyph's size.
			const across = runInk(chars[j]).w * scale(j) + allowed * c[j];
			size = Math.min(size, (allowed * outerEdge) / across);
		}
		const reach = c[last] + (runInk(chars[last]).h * scale(last)) / 2;
		size = Math.min(size, (outerEdge - hubRadius) / reach);

		return chars.map((ch, j) => {
			const p = polar(outerEdge - size * c[j], angle);
			return { ch, x: p.x, y: p.y, size: size * scale(j) };
		});
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
		class:anticipate
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
					class:slam={slammed === i}
				/>
			{/each}
			<g class="divider-bevel">
				<path d={dividerBevel.shadow} class="divider-shadow" />
				<path d={dividerBevel.light} class="divider-light" />
				<path d={dividerBevel.seam} class="divider-seam" />
			</g>
			<circle cx={R} cy={R} r={OUTER} fill="url(#rim)" />
			{#each segments as seg, i (i)}
				{#if seg.image && seg.kind === 'wide'}
					{@const c = wideCrest(i, seg.image.aspect)}
					<!-- The wedge's turn is on the group, so the badge is free to move about its own box
					     (`playIcon`). -->
					<g transform="rotate({centreOf(i)} {c.cx} {c.cy})">
						<image
							href={seg.image.src}
							x={c.x}
							y={c.y}
							width={c.w}
							height={c.h}
							data-seg={i}
							opacity={liftedIcon === i ? 0 : 1}
							class:slam={slammed === i}
							class={moving?.index === i ? `motion-${moving.motion}` : undefined}
						/>
					</g>
				{:else if seg.image}
					{@const p = labelPos(i)}
					{@const box = badgeBox(seg.image.aspect, seg.kind === 'room' ? CREST_FILL : BADGE_FILL, i)}
					<g transform="rotate({centreOf(i)} {p.x} {p.y})">
						<image
							href={seg.image.src}
							x={p.x - box.w / 2}
							y={p.y - box.h / 2}
							width={box.w}
							height={box.h}
							data-seg={i}
							opacity={liftedIcon === i ? 0 : 1}
							class:slam={slammed === i}
							class={moving?.index === i ? `motion-${moving.motion}` : undefined}
						/>
					</g>
				{:else if !isRun(seg)}
					{@const p = labelPos(i)}
					<text
						x={p.x}
						y={p.y}
						fill={seg.text}
						class="label {seg.kind ?? 'number'}"
						transform="rotate({centreOf(i)} {p.x} {p.y})"
						text-anchor="middle"
						dominant-baseline="central">{seg.label}</text
					>
				{/if}
			{/each}
			{#each segments as seg, i (i)}
				{#if seg.kind === 'wide'}
					<g class="run glow" style="--wedge:{seg.fill}">
						{#each wideLines(i, seg.label, seg.image) as line, k (k)}
							<text
								x={line.x}
								y={line.y}
								fill={seg.text}
								class="label wide"
								style="font-size:{line.size}px"
								transform="rotate({centreOf(i)} {line.x} {line.y})"
								text-anchor="middle"
								dominant-baseline="central">{line.text}</text
							>
						{/each}
					</g>
				{:else if isRun(seg)}
					{@const run =
						seg.kind === 'room' && seg.image
							? roomGlyphs(i, seg.label, seg.image)
							: uprightGlyphs(i, seg.label)}
					<g class="run" class:glow={seg.kind === 'room' || seg.glow} style="--wedge:{seg.fill}">
						{#each run as g, j (j)}
							<text
								x={g.x}
								y={g.y}
								fill={seg.text}
								class="label"
								class:upright={seg.kind !== 'room'}
								style="font-size:{g.size}px"
								transform="rotate({centreOf(i) + (seg.kind === 'room' ? 90 : 0)} {g.x} {g.y})"
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
			{#if !frame && INNER > 4}
				<circle cx={R} cy={R} r={INNER - 4} class="hub" />
			{/if}
			{#if hub && !frame}
				<text x={R} y={R} class="hub-label" text-anchor="middle" dominant-baseline="central">{hub}</text>
			{/if}
		</svg>
		<!-- One wedge outline on whichever segment is under the flapper. Its geometry is redrawn as
		     the flapper crosses into the next wedge (wedges are not all the same width, so a rotated
		     copy of wedge 0 would not do). It is a SECOND svg, on a layer of its own (`.passing`), not
		     a path inside the disc's: a path redrawn inside the disc's svg has the browser re-rasterise
		     that svg's tiles — the lettering, its glow filters and all — on every tick, thirty and
		     more times a second at the top of a spin. Out here each tick repaints one stroked path on
		     an otherwise empty layer, and the disc underneath is never touched while it turns. -->
		<svg
			viewBox="0 0 {R * 2} {R * 2}"
			class="passing"
			aria-hidden="true"
		>
			{#if outlined !== null}
				<!-- Keyed on the wedge so the winner's pulse starts afresh on every landing. -->
				{#key `${outlined}:${passing === null}`}
					<path d={wedgePath(outlined)} class="passing-recess" />
					<path
						d={wedgePath(outlined)}
						class="passing-edge"
						class:tick={hasTicked && passing !== null}
						class:won={anticipate && passing === null && highlight !== null}
					/>
				{/key}
			{/if}
		</svg>
	</div>
	<!-- The white wash a segment swap hides behind. Same box as the disc, under the frame art. -->
	<div
		class="flash"
		class:on={flash}
		style:left={discBox ? `${discBox.left}%` : null}
		style:top={discBox ? `${discBox.top}%` : null}
		style:width={discBox ? `${discBox.width}%` : null}
		style:height={discBox ? `${discBox.height}%` : null}
		aria-hidden="true"
	></div>
	{#if frame}
		{#if frame.flapper}
			{@const marker = frame.flapper}
			<div
				class="frame-shell"
				style="--cut-left:{marker.left * 100}%; --cut-right:{marker.right * 100}%; --cut-bottom:{marker.bottom * 100}%"
				aria-hidden="true"
			>
				<img class="frame frame-cut" src={frame.src} alt="" draggable="false" />
				<!-- Sample the adjoining rim to fill the wood behind the moving pointer. -->
				<div class="frame-patch">
					<img
						class="frame patch-art"
						src={frame.src}
						alt=""
						draggable="false"
						style="transform-origin:{frame.hole.cx * 100}% {frame.hole.cy * 100}%"
					/>
				</div>
			</div>
			<img
				class="flapper-art"
				bind:this={flapperEl}
				src={frame.src}
				alt=""
				draggable="false"
				style="clip-path:{marker.outline}; transform-origin:{marker.pivotX * 100}% {marker.pivotY * 100}%"
			/>
		{:else}
			<img class="frame" src={frame.src} alt="" draggable="false" />
		{/if}
		{#if frame.center}
			<img
				class="center"
				src={frame.center}
				alt=""
				draggable="false"
				style="left:{frame.hole.cx * 100}%; top:{frame.hole.cy * 100}%; width:{(frame.centerWidth ?? 0.29) * 100}%"
			/>
		{/if}
		{#if anticipate && flare}
			<div
				class="pointer-landing-flare"
				style="left:{frame.hole.cx * 100}%; top:{(frame.hole.cy - frame.hole.r * frame.aspect) *
					100}%; width:{frame.hole.r * 70}%"
				aria-hidden="true"
			></div>
		{/if}
		{#if sparks}
			<WheelSparks
				bind:this={sparkLayer}
				cx={frame.hole.cx}
				cy={frame.hole.cy}
				rim={frame.hole.r * SPARK_RIM}
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
	.frame,
	.frame-shell,
	.frame-patch,
	.flapper-art {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		pointer-events: none;
		user-select: none;
	}
	.frame,
	.frame-shell {
		filter: drop-shadow(0 0.6vw 1.4vw rgba(0, 0, 0, 0.6));
	}
	.frame-shell .frame {
		filter: none;
	}
	.frame-cut {
		clip-path: polygon(
			0 0, var(--cut-left) 0, var(--cut-left) var(--cut-bottom),
			var(--cut-right) var(--cut-bottom), var(--cut-right) 0, 100% 0, 100% 100%, 0 100%
		);
	}
	.frame-patch {
		clip-path: inset(
			0 calc(100% - var(--cut-right) - 1px) calc(100% - var(--cut-bottom))
			calc(var(--cut-left) - 1px)
		);
	}
	.patch-art {
		rotate: 14deg;
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
	.disc.spinning.anticipate {
		transition-timing-function: cubic-bezier(0.3, 0.457, 0.57, 1);
		/* Distance along the seven-second spin. Hold a constant slope through 3s, then ease down
		   to rest at 7s. The slope is the wheel's speed. */
		transition-timing-function: linear(
			0,
			0.6521739 42.857143%,
			0.7040009 46.428571%,
			0.7508951 50%,
			0.7930237 53.571429%,
			0.8305602 57.142857%,
			0.8636849 60.714286%,
			0.8925857 64.285714%,
			0.9174592 67.857143%,
			0.9385125 71.428571%,
			0.9559641 75%,
			0.970047 78.571429%,
			0.9810117 82.142857%,
			0.9891304 85.714286%,
			0.994705 89.285714%,
			0.9980785 92.857143%,
			0.9996603 96.428571%,
			1
		);
	}
	svg {
		width: 100%;
		height: 100%;
		display: block;
	}
	/* The outline's own layer, over the disc's svg in the same box: see the markup. */
	.passing {
		position: absolute;
		inset: 0;
		pointer-events: none;
		will-change: transform;
	}
	.rim-ring {
		fill: #2a1a0c;
		stroke: #f0c65a;
		stroke-width: 4;
	}
	.wedge {
		transition: filter 300ms ease, opacity 300ms ease;
	}
	.divider-bevel {
		pointer-events: none;
	}
	.divider-shadow {
		fill: rgba(52, 21, 8, 0.64);
	}
	.divider-light {
		fill: rgba(255, 205, 108, 0.78);
	}
	.divider-seam {
		fill: none;
		stroke: #ac6625;
		stroke-width: 0.4;
	}
	.wedge.lit {
		filter: brightness(1.35) saturate(1.2);
	}
	/* Slammed (see `slam`): the wedge flares and settles back, and its badge rattles in place. The
	   badge's turn is its `transform` attribute, so the rattle is on `translate`, which adds to it
	   rather than replacing it. */
	.wedge.slam {
		animation: wedge-slam 450ms ease-out;
	}
	@keyframes wedge-slam {
		0% {
			filter: brightness(2.1) saturate(1.3);
		}
		100% {
			filter: brightness(1.35) saturate(1.2);
		}
	}
	image.slam {
		animation: badge-slam 380ms linear;
	}
	@keyframes badge-slam {
		0% {
			translate: 0 0;
		}
		15% {
			translate: -4px 3px;
		}
		30% {
			translate: 4px -3px;
		}
		45% {
			translate: -3px 2px;
		}
		60% {
			translate: 2px -2px;
		}
		80% {
			translate: -1px 1px;
		}
		100% {
			translate: 0 0;
		}
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
	/* The warm lip sits over a darker edge, like a raised brass frame around the active wedge. */
	.passing-edge,
	.passing-recess {
		fill: none;
		pointer-events: none;
		stroke-linejoin: round;
	}
	.passing-recess {
		stroke: rgba(110, 49, 14, 0.9);
		stroke-width: 2.5;
	}
	.passing-edge {
		stroke: rgba(255, 226, 153, 0.82);
		stroke-width: 1.1;
	}
	.passing-edge.tick {
		animation: edge-tick 160ms ease-out;
	}
	@keyframes edge-tick {
		from {
			stroke: #fff2c4;
			stroke-width: 1.8;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.passing-edge.tick {
			animation: none;
		}
	}
	/* The wedge it came to rest on: a gold outline that pulses three times and then stays. The layer
	   is its own (see the markup), so the pulse repaints one path and never the disc. */
	.passing-edge.won {
		stroke: #ffd75a;
		stroke-width: 2.2;
		animation: edge-won 520ms ease-in-out 3;
	}
	@keyframes edge-won {
		0%,
		100% {
			stroke-width: 2.2;
			stroke: #ffd75a;
		}
		45% {
			stroke-width: 3.5;
			stroke: #fff6c8;
		}
	}
	/* A brief flare at the tip after the wheel lands. */
	.pointer-landing-flare {
		position: absolute;
		aspect-ratio: 1;
		transform: translate(-50%, -50%);
		border-radius: 50%;
		pointer-events: none;
		background: radial-gradient(
			circle,
			rgba(255, 244, 196, 0.85) 0%,
			rgba(255, 210, 90, 0.45) 30%,
			rgba(255, 180, 40, 0) 68%
		);
		mix-blend-mode: screen;
		animation: pointer-flare 900ms ease-out forwards;
	}
	@keyframes pointer-flare {
		0% {
			opacity: 1;
			scale: 1.5;
		}
		100% {
			opacity: 0;
			scale: 1;
		}
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
	/* A wide label reads across a broad wedge: one or two lines, big, in the room lettering. */
	.label.wide {
		letter-spacing: 0.02em;
		stroke-width: 2.2;
	}
	.flash {
		position: absolute;
		inset: 0;
		border-radius: 50%;
		background: radial-gradient(circle, #ffffff 0%, #fff8e1 70%, #ffe9a8 100%);
		opacity: 0;
		pointer-events: none;
		transition: opacity 420ms ease-out;
	}
	.flash.on {
		opacity: 1;
		transition: opacity 160ms ease-in;
	}
	/* A multiplier is a figure, not a name: it is set in the balance's own face rather than the ship's
	   lettering the room names wear, so a x50 on the wheel and the x50 in the read-out below are
	   recognisably the same number. Its metrics are measured — see RUN_INK — so this is not a free
	   swap; and the stroke is lighter than a name's, because these are lighter letterforms and the
	   room names' 2.4 closes up Alexandria's counters. */
	.label.upright {
		font-family: 'Alexandria', sans-serif;
		font-weight: 700;
		/*
		 * Cut out of the wedge rather than laid on top of it: the outline and the shadow are both
		 * the wedge's OWN colour taken down towards black, so a number reads as something stamped
		 * into the paint. Flat black around all thirty-six of them put a dark ring through the
		 * middle of the disc and flattened the palette the wedges are there to show off.
		 *
		 * Half of `stroke-width` shows, `paint-order` keeping the rest under the fill, so 2.2 draws
		 * a 1.1 line. The shadow's offset is in viewBox units and every glyph carries its own
		 * filter, so it falls below the character as it is SET — down the wedge, whichever way round
		 * the disc has turned it — rather than down the screen, which would light the numbers from
		 * thirty-six directions at once.
		 */
		stroke: color-mix(in srgb, var(--wedge) 45%, #000);
		stroke-width: 2.2;
		filter: drop-shadow(0 1.5px 1.4px color-mix(in srgb, var(--wedge) 30%, rgba(0, 0, 0, 0.72)));
	}
	/* Run glyphs are sized inline, per letter — see roomGlyphs(). A room name also glows in its own
	   wedge colour, so where the letters spill onto a neighbour the halo still names the segment;
	   a multiplier is a short run on a big wedge and reads on its stroke alone. */
	.run.glow {
		filter: drop-shadow(0 0 3px var(--wedge)) drop-shadow(0 0 9px var(--wedge));
	}
	/* A room name is the smallest lettering on the disc that has to be read, and on a phone it is
	   tiny: a darker keyline than a number's keeps it off its wedge's colour. Darker, not thicker —
	   Pieces of Eight's counters close up past the 2.4 a label already has ("R" reads as "F"). Only
	   on the names (not the multipliers, whose stroke is their own wedge colour, `.label.upright`). */
	.run.glow .label:not(.upright) {
		stroke: rgba(12, 6, 0, 0.82);
	}
	/* The reduced budget (lib/deviceTier.svelte.ts): the lettering on its stroke alone. Every glow
	   is two blurs over a run of glyphs, and every figure its own shadow filter, all rasterised in
	   software whenever the disc is redrawn — the one thing a weak phone pays for most on this
	   screen. The wedge colour the glow named still shows under the letters. */
	:global(html[data-tier='lite']) .run.glow,
	:global(html[data-tier='lite']) .label.upright {
		filter: none;
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
