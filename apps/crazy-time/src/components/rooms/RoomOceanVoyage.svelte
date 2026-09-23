<script lang="ts">
	/**
	 * Ocean Voyage room: ten stops of three buoys between the harbour at the foot of the board and
	 * the island at its head. The ship sails up the board one stop at a time, to whichever buoy is
	 * chosen at each; a buoy it reaches safely turns into an island with the stop's multiplier on
	 * it, and the last island reached is the one that pays. Somewhere on the way a kraken is
	 * waiting: the stop it is at ends the voyage, and the ship keeps what it had. Clearing all ten
	 * stops sails the ship into port for the top multiplier.
	 *
	 * The player picks the course. Every buoy at the next stop is open to them, and the ship sails
	 * to the one they tap. Nothing on the board says what a stop is worth until the ship has been
	 * there.
	 *
	 * The voyage is AUTHORED. The book says how many stops the ship reaches (`dived`), and that is
	 * what pays: every buoy at a stop before that one is safe, and every buoy at that stop holds the
	 * kraken — so no course changes what the round pays, the same as a shuffled live board. The
	 * rules page must say so. The book's own `path` and `krakenTile` are only sailed when nobody is
	 * choosing: a player who was not in the bonus, or one whose clock runs out, who has the rest of
	 * the voyage sailed for them.
	 *
	 * How many buoys a stop has is the CLIENT's number (`TILES_PER_DEPTH`), not the book's: the
	 * buoys are cosmetic, and books published before the count changed still carry tile indices
	 * from the old width, which are folded onto the board with a modulo rather than trusted.
	 *
	 * Each stop gets its own clock (`PICK_SECONDS`), not the voyage as a whole: ten picks at one
	 * every second and a half would rush the very run the player most wants to savour, and a player
	 * who has walked away is still only ever waited for once.
	 */
	import { onDestroy } from 'svelte';
	import { PICK_SECONDS, TILES_PER_DEPTH } from '../../game/constants';
	import type { BookEventOceanVoyage } from '../../game/typesBookEvent';
	import { playSound } from '../../game/sound';
	import { staticPath } from '../../lib/staticUrl';
	import { waitForTimeout } from 'utils-shared/wait';
	import RoomHint from './RoomHint.svelte';

	type Props = { room: BookEventOceanVoyage; interactive?: boolean; portrait?: boolean };
	let { room, interactive = false, portrait = false }: Props = $props();

	const PICK_MS = PICK_SECONDS * 1000;

	/**
	 * The art. All four are PNGs with transparent air around them; the ship's is cut to the drawing
	 * (204x216, the hull dead centre of it) so that putting its middle on a buoy puts the SHIP on
	 * the buoy rather than a corner of its canvas.
	 */
	const SHIP = staticPath('img/ocean-voyage/ship.png');
	const KRAKEN = staticPath('img/ocean-voyage/kraken.png');
	const ISLAND = staticPath('img/ocean-voyage/island.png');
	const GOAL = staticPath('img/ocean-voyage/goal.png');

	/** What to tell the player while a course is theirs to pick. One line per drain — see `RoomHint`. */
	const HINT = ['Chart your', 'course'];
	/** The caption, as a share of the board's width — the one knob the room is drawn off (`--voyage-w`). */
	const HINT_SIZE = 'calc(var(--voyage-w) * 0.042)';

	/** The ship crossing from one stop to the next. */
	const SAIL_MS = 620;
	/** The ship's last leg, into port. A little longer: it is the longest crossing on the board. */
	const PORT_MS = 780;
	/** A beat on a fresh island before the auto-pilot sails on, or before the last leg into port. */
	const ARRIVE_MS = 420;
	/** The ship going down under the kraken. Matches the `sink` animation below. */
	const SINK_MS = 1100;
	/** The outcome on the board before the screen moves on to the win line. */
	const END_HOLD_MS = 900;

	/**
	 * The board, as shares of its own width.
	 *
	 * Everything that has a place on it — the buoys, the ship, the wake curling behind it — is drawn
	 * off these few numbers, so the ship's arithmetic and the buoys' CSS cannot disagree about
	 * where a stop is. In landscape they are all there is; portrait stretches them to fill the
	 * stage (see `fill`).
	 *
	 * The buoys are spread wide on purpose: the course the player draws through them is the thing
	 * the room is about, and it needs open water to curl in. The vertical shares are kept small so
	 * that the height, which is what binds on every screen, buys as wide a board as it can: ten
	 * stops come to 0.985 of the width, so a 16:9 stage gets a board about two fifths of the
	 * screen across. The side padding is what sets the column pitch — 0.265 for three
	 * columns, about the same as the four-column board had — so the island and the harbour keep
	 * the width to themselves and the buoys sit in a band down the middle.
	 */
	const BASE = {
		/** From the board's edge to the outer buoys' edges. */
		padX: 0.2,
		/** A buoy, across. */
		node: 0.07,
		/** Centre to centre, one stop to the next. */
		rowPitch: 0.08,
		/** The island at the head of the board. */
		goalH: 0.13,
		/** The harbour at its foot, where the ship starts. */
		startH: 0.065,
	};
	/** The harbour on a stretched board: room for the whole ship, which the square one lets hang
	    over the foot of the board. */
	const TALL_START_H = 0.12;
	const depths = $derived(room.depths.length);
	const cols = TILES_PER_DEPTH;

	/**
	 * How tall the stage is, in board widths, when the board is to fill it; null draws it at its
	 * own shape.
	 *
	 * A phone's stage is far taller than the board is wide, and the square board left the bottom
	 * half of it empty water. So in portrait the height goes to the gaps between stops: the width,
	 * and with it every buoy, the island and the ship, stays exactly the size it was. A stage too
	 * short to give the stops even their landscape gap keeps the square board.
	 *
	 * Both numbers are the elements' own pixels (`clientWidth`/`clientHeight`), so the game's CSS
	 * `zoom` cancels out of the share.
	 */
	let fill = $state<number | null>(null);
	let voyageEl = $state<HTMLDivElement>();
	$effect(() => {
		const el = voyageEl;
		const stage = el?.parentElement;
		if (!el || !stage || !portrait) {
			fill = null;
			return;
		}
		const measure = () => {
			const w = el.clientWidth;
			// A pixel short, so a rounded-up board never pushes the footer.
			fill = w > 0 ? (stage.clientHeight - 1) / w : null;
		};
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(stage);
		observer.observe(el);
		return () => observer.disconnect();
	});

	const L = $derived.by(() => {
		if (fill === null) return BASE;
		const rowPitch = (fill - BASE.goalH - TALL_START_H - BASE.node) / (room.depths.length - 1);
		return rowPitch > BASE.rowPitch ? { ...BASE, rowPitch, startH: TALL_START_H } : BASE;
	});
	const colPitch = $derived((1 - 2 * L.padX - L.node) / (cols - 1));
	const rowsH = $derived((depths - 1) * L.rowPitch + L.node);
	const boardH = $derived(L.goalH + rowsH + L.startH);

	type Pt = { x: number; y: number };
	/** A buoy's centre. Stop 0 is the bottom row, nearest the harbour. */
	const buoy = (depth: number, tile: number): Pt => ({
		x: L.padX + L.node / 2 + tile * colPitch,
		y: L.goalH + L.node / 2 + (depths - 1 - depth) * L.rowPitch,
	});
	const harbour = $derived<Pt>({ x: 0.5, y: L.goalH + rowsH + L.startH * 0.55 });
	/** The ship pulls in at the island's shore, low on the drawing where the water is. */
	const port = $derived<Pt>({ x: 0.5, y: L.goalH * 0.6 });

	/**
	 * One leg of the voyage, as a cubic curve.
	 *
	 * The ship always arrives at a stop bow-first, heading up the board, and leaves it the same way:
	 * so a leg sets out straight up from where it is, bends across to the column it is bound for,
	 * and straightens again to come in over the buoy. Both handles are vertical — the first above
	 * the start, the second below the end — which is what makes a leg to the same column a straight
	 * line and a leg across the board an S, and keeps every curve inside the two columns it joins.
	 * The handles are cut from the leg's HEIGHT, not its length: cut from the length, a leg right
	 * across the board would loop above its start and below its end before coming in.
	 */
	type Leg = { a: Pt; c1: Pt; c2: Pt; b: Pt };
	const leg = (a: Pt, b: Pt): Leg => {
		const reach = Math.max(Math.abs(b.y - a.y) * 0.75, 0.03);
		return { a, c1: { x: a.x, y: a.y - reach }, c2: { x: b.x, y: b.y + reach }, b };
	};
	const along = (l: Leg, t: number): Pt => {
		const u = 1 - t;
		const w0 = u * u * u,
			w1 = 3 * u * u * t,
			w2 = 3 * u * t * t,
			w3 = t * t * t;
		return {
			x: w0 * l.a.x + w1 * l.c1.x + w2 * l.c2.x + w3 * l.b.x,
			y: w0 * l.a.y + w1 * l.c1.y + w2 * l.c2.y + w3 * l.b.y,
		};
	};
	/** The bow's heading at `t`, in degrees clockwise from straight up the board. */
	const heading = (l: Leg, t: number): number => {
		const u = 1 - t;
		const dx = 3 * (u * u * (l.c1.x - l.a.x) + 2 * u * t * (l.c2.x - l.c1.x) + t * t * (l.b.x - l.c2.x));
		const dy = 3 * (u * u * (l.c1.y - l.a.y) + 2 * u * t * (l.c2.y - l.c1.y) + t * t * (l.b.y - l.c2.y));
		return (Math.atan2(dx, -dy) * 180) / Math.PI;
	};
	/** The part of a leg from its start to `t` — de Casteljau's split, kept as a curve of its own. */
	const upTo = (l: Leg, t: number): Leg => {
		const mix = (p: Pt, q: Pt): Pt => ({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
		const p01 = mix(l.a, l.c1),
			p12 = mix(l.c1, l.c2),
			p23 = mix(l.c2, l.b);
		const p012 = mix(p01, p12),
			p123 = mix(p12, p23);
		return { a: l.a, c1: p01, c2: p012, b: mix(p012, p123) };
	};

	/** Stops cleared so far; the ship is at stop `reached - 1`, or in the harbour. */
	let reached = $state(0);
	/** The buoy taken at each cleared stop — the player's, or the book's when sailed for them. */
	let taken = $state<number[]>([]);
	/** The buoy the kraken rose from, once it has. */
	let kraken = $state<{ depth: number; tile: number } | null>(null);
	let ended = $state<'kraken' | 'port' | null>(null);
	/** True while the ship is between stops: the buoys wait for it. */
	let moving = $state(false);
	/** True while a pick is being waited for. Bumped per pick, so the hint's clock restarts. */
	let picking = $state(false);
	let pickRound = $state(0);
	/** True once the player's clock has run out and the book is sailing the rest. */
	let autopilot = $state(false);
	let sunk = $state(false);

	/**
	 * Where the ship has been, as STOPS rather than points: the board's shape follows the stage in
	 * portrait, so a buoy's point moves when the screen does, and a course kept in points would
	 * leave the ship and its wake behind on the old board. Everything drawn is derived from these.
	 */
	type Stop = 'harbour' | 'port' | { depth: number; tile: number };
	const spot = (s: Stop): Pt => (s === 'harbour' ? harbour : s === 'port' ? port : buoy(s.depth, s.tile));
	/** Every stop made, harbour first, and the one under way with how far along the leg the ship is. */
	let course = $state<Stop[]>(['harbour']);
	let underway = $state<{ to: Stop; t: number } | null>(null);
	const here = $derived(course[course.length - 1]);
	const legs = $derived(course.slice(1).map((s, i) => leg(spot(course[i]), spot(s))));
	const crossing = $derived(underway ? leg(spot(here), spot(underway.to)) : null);
	/** The ship, in board shares, and its heading. */
	const ship = $derived(crossing && underway ? along(crossing, underway.t) : spot(here));
	const tilt = $derived(crossing && underway ? Math.max(-75, Math.min(75, heading(crossing, underway.t))) : 0);

	let alive = true;
	onDestroy(() => (alive = false));

	/**
	 * The ship under way along a leg. An ease-out so it leaves at speed and settles on the buoy,
	 * its bow following the curve; the wake follows the ship itself, so the line grows with the
	 * crossing rather than appearing behind it.
	 *
	 * Frame-driven, with a clock behind it. A tab in the background is given no frames at all, and
	 * a crossing that waited on one would stand the whole voyage still until the player came back
	 * (Plinko's rAF-only waits froze the same way on iOS). The clock lands the ship where the frames
	 * were taking it; on a visible screen the frames get there first and the clock is never heard.
	 */
	const sail = (to: Stop, ms: number): Promise<void> =>
		new Promise((resolve) => {
			const t0 = performance.now();
			let done = false;
			const finish = () => {
				if (done) return;
				done = true;
				clearTimeout(clock);
				course = [...course, to];
				underway = null;
				resolve();
			};
			const clock = setTimeout(finish, ms + 80);
			const frame = (now: number) => {
				if (done) return;
				if (!alive) return finish();
				const t = Math.min(1, (now - t0) / ms);
				underway = { to, t: 1 - Math.pow(1 - t, 3) };
				if (t < 1) requestAnimationFrame(frame);
				else finish();
			};
			requestAnimationFrame(frame);
		});

	/** The ship to `tile` at the next stop, and what it finds there. */
	const sailTo = async (tile: number) => {
		const depth = reached;
		moving = true;
		playSound('whoosh');
		await sail({ depth, tile }, SAIL_MS);

		if (depth >= room.dived) {
			// The stop the book ends the voyage at: whichever buoy was chosen, the kraken is under it.
			kraken = { depth, tile };
			sunk = true;
			playSound('doorClose');
			await waitForTimeout(SINK_MS);
			ended = 'kraken';
		} else {
			taken = [...taken, tile];
			reached = depth + 1;
			playSound('pop', 1 + depth * 0.04);
			if (reached >= depths) {
				await waitForTimeout(ARRIVE_MS);
				playSound('whoosh');
				await sail('port', PORT_MS);
				ended = 'port';
				playSound('win');
			}
		}
		moving = false;
	};

	let resolvePick: ((tile: number) => void) | null = null;

	/** The player's next buoy, or -1 when their clock runs out first. */
	const waitForPick = (): Promise<number> =>
		new Promise((resolve) => {
			pickRound += 1;
			picking = true;
			const deadline = setTimeout(() => {
				resolvePick = null;
				picking = false;
				resolve(-1);
			}, PICK_MS);
			resolvePick = (tile) => {
				clearTimeout(deadline);
				resolvePick = null;
				picking = false;
				resolve(tile);
			};
		});

	const choose = (depth: number, tile: number) => {
		if (!picking || moving || ended !== null || depth !== reached || !resolvePick) return;
		resolvePick(tile);
	};

	export const play = async (): Promise<number> => {
		await waitForTimeout(500);
		if (interactive) {
			while (ended === null) {
				const tile = await waitForPick();
				if (tile < 0) {
					autopilot = true;
					break;
				}
				playSound('click');
				await sailTo(tile);
			}
		}
		// Whatever is left is sailed along the book's own course.
		let first = true;
		while (ended === null) {
			const depth = reached;
			const tile = (depth < room.dived ? room.path[depth] : (room.krakenTile ?? 0)) % cols;
			if (!first || autopilot) await waitForTimeout(ARRIVE_MS);
			first = false;
			await sailTo(tile);
		}
		await waitForTimeout(END_HOLD_MS);
		return room.total;
	};

	/** The wake: every leg sailed, and the leg under way as far as the ship has got along it. */
	const pt = (p: Pt) => `${(p.x * 1000).toFixed(1)} ${(p.y * 1000).toFixed(1)}`;
	const curve = (l: Leg) => `C ${pt(l.c1)} ${pt(l.c2)} ${pt(l.b)}`;
	const wake = $derived.by(() => {
		const drawn = crossing && underway ? [...legs, upTo(crossing, underway.t)] : legs;
		if (drawn.length === 0) return '';
		return `M ${pt(drawn[0].a)} ${drawn.map(curve).join(' ')}`;
	});
	const at = (p: Pt) =>
		`left: calc(var(--voyage-w) * ${p.x}); top: calc(var(--voyage-w) * ${p.y})`;
</script>

<div class="voyage" bind:this={voyageEl} style="--board-h:{boardH}; --node:{L.node}">
	<div class="board">
		<!-- The island at the head of the board. It lights when the ship makes port. -->
		<img class="goal" class:lit={ended === 'port'} src={GOAL} alt="" />

		{#each Array.from({ length: depths }, (_, d) => d) as depth (depth)}
			{@const cleared = depth < reached}
			{@const open = picking && !moving && ended === null && depth === reached}
			{#each Array.from({ length: cols }, (_, t) => t) as tile (tile)}
				{@const island = cleared && taken[depth] === tile}
				{@const wreck = kraken?.depth === depth && kraken.tile === tile}
				<button
					class="buoy"
					class:island
					class:wreck
					class:open
					style={at(buoy(depth, tile))}
					disabled={!open}
					onclick={() => choose(depth, tile)}
					aria-label={open ? `Sail to buoy ${tile + 1}` : undefined}
				>
					{#if island}
						<img class="art" src={ISLAND} alt="" />
						<!-- The stop's multiplier, on the island it was earned at, cut in the letters every
						     other multiplier in the game is cut in — `.mult-badge` is the table's own. Once
						     the voyage is over, the LAST island's number is the one that paid, and it glows
						     and breathes so the eye lands on it. -->
						<div class="value mult-badge" class:won={ended !== null && depth === reached - 1}>
							<span class="mult-stroke" aria-hidden="true">{room.depths[depth]}x</span>
							<span class="mult-fill">{room.depths[depth]}x</span>
						</div>
					{:else if wreck}
						<img class="art kraken" src={KRAKEN} alt="" />
					{/if}
				</button>
			{/each}
		{/each}

		<!-- The wake: a broken line curling through every stop the ship has made, following the ship
		     itself on each leg. A dark line under a light one, so it reads over water and sand alike.
		     The viewBox is the board in thousandths of its width, the same units every position above
		     is in. -->
		<svg class="wake" viewBox="0 0 1000 {boardH * 1000}" aria-hidden="true">
			<path class="wake-shadow" d={wake} />
			<path class="wake-line" d={wake} />
		</svg>

		<img
			class="ship"
			class:sunk
			src={SHIP}
			alt=""
			style="--sx:{ship.x}; --sy:{ship.y}; --tilt:{tilt.toFixed(2)}deg"
		/>
	</div>

	<!-- What the voyage is doing, in the voice the other rooms speak in — see `RoomHint`. The pick
	     line drains over the player's clock and is re-keyed per stop, so each pick gets a fresh one;
	     the other lines have no clock to draw. It hangs off the bottom of the room's sign, over the
	     rope, rather than taking a row under the board: the board is the tallest thing in the game
	     and every row it gives up is a row of buoys drawn smaller. `BonusRound` lifts this room's
	     stage over the header so the words are not cut off by the plaque. -->
	<div class="caption">
		{#if ended === 'kraken'}
			<!-- What it paid is struck over the middle of the screen (`MultiplierBurst`, from
			     BonusRound), so the caption only says how the voyage ended. -->
			<RoomHint size={HINT_SIZE}>Kraken at stop {(kraken?.depth ?? 0) + 1}</RoomHint>
		{:else if ended === 'port'}
			<RoomHint size={HINT_SIZE}>Made port</RoomHint>
		{:else if interactive && !autopilot}
			{#key pickRound}
				<RoomHint lines={HINT} durationMs={picking ? PICK_MS : null} size={HINT_SIZE} />
			{/key}
		{:else}
			<RoomHint lines={[autopilot ? 'Sailing on' : 'Setting sail']} size={HINT_SIZE} />
		{/if}
	</div>
</div>

<style>
	/*
	 * Everything on the board is a share of its width, and the width is the one number that changes
	 * between a wide screen and a tall one. The board is 0.985 times as tall as it is wide (the
	 * caption hangs above it and takes no row), and the bonus stage is about two thirds of the
	 * screen tall, so the two bounds meet near 16:9: a wider screen is bound by height, a squarer
	 * one by width.
	 */
	.voyage {
		--voyage-w: min(40vw, 68vh);
		position: relative;
		/* At the TOP of the stage rather than its middle: the caption hangs off the room's sign, and
		   the sign is at the stage's top edge, so the room has to be too — on a long phone, where the
		   board is bound by width and the stage has air to spare, the air goes below the harbour. */
		align-self: flex-start;
		width: var(--voyage-w);
	}
	.board {
		position: relative;
		width: var(--voyage-w);
		height: calc(var(--voyage-w) * var(--board-h));
	}
	/* The island at the head of the board, over the middle of the water. */
	.goal {
		position: absolute;
		top: 0;
		left: 50%;
		width: calc(var(--voyage-w) * 0.28);
		height: auto;
		transform: translateX(-50%);
		filter: drop-shadow(0 calc(var(--voyage-w) * 0.01) calc(var(--voyage-w) * 0.02) rgba(0, 0, 0, 0.6));
		transition: filter 400ms ease;
		pointer-events: none;
	}
	.goal.lit {
		filter: drop-shadow(0 0 calc(var(--voyage-w) * 0.03) rgba(255, 214, 90, 0.95))
			drop-shadow(0 0 calc(var(--voyage-w) * 0.06) rgba(255, 180, 50, 0.6));
	}

	/*
	 * A buoy: a disc of open water at three-quarter strength until the ship has been there. Its
	 * place is written on the element (see `buoy`), the same arithmetic the ship sails by. The row
	 * that is the player's to pick from is fully lit and breathes; a buoy with an island or the
	 * kraken on it is solid.
	 */
	.buoy {
		position: absolute;
		width: calc(var(--voyage-w) * var(--node));
		height: calc(var(--voyage-w) * var(--node));
		padding: 0;
		border-radius: 50%;
		transform: translate(-50%, -50%);
		background: radial-gradient(circle at 40% 35%, rgba(70, 150, 210, 0.95), rgba(10, 45, 95, 0.95) 75%);
		border: calc(var(--voyage-w) * 0.004) solid rgba(160, 220, 255, 0.45);
		opacity: 0.75;
		cursor: default;
		transition:
			background 250ms ease,
			opacity 250ms ease,
			transform 250ms ease,
			box-shadow 250ms ease;
	}
	.buoy.open {
		opacity: 1;
		cursor: pointer;
		border-color: rgba(220, 245, 255, 0.85);
		animation: breathe 1100ms ease-in-out infinite alternate;
	}
	.buoy.open:hover {
		transform: translate(-50%, -50%) scale(1.1);
		box-shadow: 0 0 calc(var(--voyage-w) * 0.025) rgba(160, 230, 255, 0.9);
	}
	@keyframes breathe {
		from {
			box-shadow: 0 0 0 rgba(160, 230, 255, 0);
		}
		to {
			box-shadow: 0 0 calc(var(--voyage-w) * 0.02) rgba(160, 230, 255, 0.7);
		}
	}
	/* An island and its number stand OVER the wake, which is drawn after the buoys and would
	   otherwise be dashed across the multiplier; the plain water buoys stay under it. */
	.buoy.island,
	.buoy.wreck {
		z-index: 1;
	}
	.buoy.island {
		opacity: 1;
		background: radial-gradient(circle at 40% 35%, rgba(80, 190, 200, 0.95), rgba(20, 110, 140, 0.95) 75%);
		border-color: rgba(255, 230, 150, 0.7);
	}
	.buoy.wreck {
		opacity: 1;
		background: radial-gradient(circle at 50% 45%, rgba(200, 60, 40, 0.95) 0%, rgba(80, 10, 10, 0.95) 100%);
		border-color: rgba(255, 120, 90, 0.8);
	}
	/* The drawing on a buoy, standing a little wider than the disc so it reads as a thing ON the
	   water rather than a texture of it. Decoration: the buoy is the control. */
	.art {
		position: absolute;
		left: 50%;
		top: 50%;
		width: 125%;
		height: auto;
		transform: translate(-50%, -50%);
		pointer-events: none;
		filter: drop-shadow(0 calc(var(--voyage-w) * 0.004) calc(var(--voyage-w) * 0.008) rgba(0, 0, 0, 0.6));
		animation: art-in 420ms cubic-bezier(0.3, 1.5, 0.5, 1) both;
	}
	.art.kraken {
		width: 150%;
		animation: kraken-in 520ms cubic-bezier(0.3, 1.5, 0.5, 1) both;
	}
	@keyframes art-in {
		from {
			transform: translate(-50%, -50%) scale(0.3);
			opacity: 0;
		}
	}
	@keyframes kraken-in {
		from {
			transform: translate(-50%, -20%) scale(0.2);
			opacity: 0;
		}
	}
	/*
	 * The multiplier, on the island. Laid on a pool of shadow with a warm glow round its edge so it
	 * reads over the island's own colours (the same trick the chest's number uses), and held back a
	 * beat behind the island so the two do not land as one.
	 */
	.value {
		position: absolute;
		left: 50%;
		top: 50%;
		transform: translate(-50%, -50%);
		font-size: calc(var(--voyage-w) * 0.03);
		white-space: nowrap;
		pointer-events: none;
		animation: art-in 420ms cubic-bezier(0.3, 1.5, 0.5, 1) 180ms both;
	}
	.value::before {
		content: '';
		position: absolute;
		inset: -30% -25%;
		z-index: -1;
		border-radius: 50%;
		background:
			radial-gradient(ellipse closest-side, rgba(8, 4, 0, 0.85) 0%, rgba(8, 4, 0, 0.5) 55%, rgba(8, 4, 0, 0) 78%),
			radial-gradient(
				ellipse closest-side,
				rgba(255, 214, 90, 0.8) 50%,
				rgba(255, 180, 50, 0.4) 74%,
				rgba(255, 160, 30, 0) 100%
			);
	}

	/* The wake, over the buoys and under the ship. Stroke widths are in the viewBox's own units:
	   thousandths of the board's width. */
	.wake {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		pointer-events: none;
		overflow: visible;
	}
	.wake path {
		fill: none;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	.wake-shadow {
		stroke: rgba(0, 10, 30, 0.7);
		stroke-width: 11;
		stroke-dasharray: 18 14;
	}
	.wake-line {
		stroke: #ffe9a8;
		stroke-width: 6;
		stroke-dasharray: 18 14;
	}

	/* The ship. Its place is two shares of the board, written on the element; the translate puts
	   its middle on them, and the heading is on top so it turns about its own hull. */
	.ship {
		position: absolute;
		left: 0;
		top: 0;
		height: calc(var(--voyage-w) * 0.14);
		width: auto;
		transform: translate(calc(var(--voyage-w) * var(--sx)), calc(var(--voyage-w) * var(--sy)))
			translate(-50%, -50%) rotate(var(--tilt));
		filter: drop-shadow(0 calc(var(--voyage-w) * 0.008) calc(var(--voyage-w) * 0.012) rgba(0, 0, 0, 0.7));
		pointer-events: none;
		z-index: 2;
	}
	/* Going down under the kraken: it slides down the board and fades as it goes, listing a little
	   and drawing in as the water takes it. On the drawing's own `translate`/`scale`/`rotate`, which
	   compose with the transform that places it rather than replacing it. */
	.ship.sunk {
		animation: sink 1100ms ease-in both;
	}
	@keyframes sink {
		to {
			translate: 0 calc(var(--voyage-w) * 0.07);
			scale: 0.7;
			rotate: 14deg;
			opacity: 0;
		}
	}

	/* Only a place: what the line looks like is `RoomHint`'s. Hung above the board, up into the
	   header, so it sits on the sign's lower rope: the timber ends about 0.05 of the board's width
	   above the stage, and the rope and skulls run on down to the stage's edge. The goal island
	   starts at the board's top edge, just under it. */
	.caption {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 100%;
		margin-bottom: calc(var(--voyage-w) * -0.012);
		z-index: 3;
	}
	/*
	 * The number that paid. A gold glow round the letters and a slow breath, in and out, for as
	 * long as the outcome is on the board. It replaces the landing pop, which has long since
	 * finished by the time the voyage is over.
	 */
	.value.won {
		z-index: 3;
		filter: drop-shadow(0 0 calc(var(--voyage-w) * 0.012) rgba(255, 220, 90, 1))
			drop-shadow(0 0 calc(var(--voyage-w) * 0.03) rgba(255, 180, 40, 0.85));
		animation: won-breathe 900ms ease-in-out infinite alternate;
	}
	@keyframes won-breathe {
		from {
			transform: translate(-50%, -50%) scale(1.15);
		}
		to {
			transform: translate(-50%, -50%) scale(1.6);
		}
	}
	/* The island that paid stands over everything but the ship. */
	.buoy.island:has(.value.won) {
		z-index: 2;
	}

	/* ---- Portrait ----------------------------------------------------------------------
	   The one number, given a taller screen. Nearly the whole width on a long phone; on a squat one
	   (h/w about 1.3, where the stage is about 62vh) the height takes over. Whatever height the
	   stage has past that, the script spreads the stops over (`fill`). */
	:global(.game.portrait) .voyage {
		--voyage-w: min(90vw, 62vh);
	}
</style>
