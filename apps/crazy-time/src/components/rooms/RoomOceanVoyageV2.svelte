<script lang="ts">
	/**
	 * Ocean Voyage v2: the same voyage, steered with the ship's wheel. Played only when it is bought
	 * with the Buy Bonus screen's v2 button (see `voyageVersion`); the wheel's own landings and every
	 * replay play the original, RoomOceanVoyage.
	 *
	 * The skull cave sits at the top of the screen and grows as the voyage goes on, always whole from
	 * top to bottom, until its width fills the viewport. The sea runs out from its foot. Ten rows of
	 * three barrels come out of the bottom middle of the cave's mouth, fade in, and float towards the
	 * player, fanning out and growing as they come. There is no boat: the player is looking out over
	 * the bow, and the wheel pans the whole scene — the sea, the cave and the barrels — left and right.
	 * The barrel at the centre of the screen when a row reaches the tip of the deck is the one the
	 * player has chosen. It is taken (it flashes and is gone) and the multiplier of that stop pops up
	 * and floats away as if collected — or the kraken, which fills the screen over everything.
	 *
	 * The voyage is AUTHORED, exactly as the original's is: the book says how many rows are cleared
	 * (`dived`), and that is what pays. Every barrel in a row before that one is safe, and every barrel
	 * in that row has the kraken behind it, so nowhere the scene is panned to changes what the round
	 * pays — v2 changes how the round plays out, not what it pays, and shares the original's books and
	 * rules page. The wheel only chooses WHICH barrel is taken. A player who is not at the helm (a
	 * bonus they were not in) has the scene panned to the book's own `path` / `krakenTile`, the wheel
	 * turning by itself.
	 *
	 * BonusRound gives this room the whole screen rather than the stage, and no title frame. The ship's
	 * deck stands in front of the sea with the wheel set into its ring: all of it across a landscape
	 * screen, just its bottom middle (the rest cropped off) in portrait. There is no `.voyage .ship`
	 * for the wheel's own ship to dock on when it sails the player in, so Game.svelte docks it at a
	 * default spot and it fades away.
	 *
	 * The simulation is stepped from a clock as well as from animation frames: a background tab is
	 * given no frames, and a voyage that waited on them would never finish and so never pay.
	 */
	import { onDestroy } from 'svelte';
	import { TILES_PER_DEPTH } from '../../game/constants';
	import type { BookEventOceanVoyage } from '../../game/typesBookEvent';
	import { playSound } from '../../game/sound';
	import { staticPath } from '../../lib/staticUrl';
	import { waitForTimeout } from 'utils-shared/wait';

	type Props = { room: BookEventOceanVoyage; interactive?: boolean; portrait?: boolean };
	let { room, interactive = false, portrait = false }: Props = $props();

	const KRAKEN = staticPath('img/ocean-voyage/kraken.png');
	const BARREL = staticPath('img/ocean-voyage/barrel.webp');
	const CAVE = staticPath('img/ocean-voyage/skull_cave.webp');
	const SEA = staticPath('img/ocean-voyage/sea_tile.webp');
	const DECK = staticPath('img/ocean-voyage/ship_deck.webp');
	const WHEEL = staticPath('img/ocean-voyage/wheel.webp');

	/** The art's own shapes. The sea tile is a picture and its mirror, side by side, so it repeats
	    across the screen without a seam however far the scene is panned. */
	const CAVE_ASPECT = 2172 / 724;
	/** The barrel's picture, height over width. */
	const BARREL_ASPECT = 365 / 512;
	const SEA_PX = { w: 1536, h: 2304 };
	/** The deck's picture, and where the ring its wheel sits in is centred in it. */
	const DECK_PX = { w: 1928, ring: 710, ringY: 690, tip: 250 };
	/** How far a landscape deck is let down below the foot of the screen, as a share of the height. */
	const DECK_SINK = 0.1;
	/** How far the sea fades in down from its top edge, (picture pixels at 1024 wide). */
	const BLEND_PX = 150;

	/** Time on the water before the first gates come out of the cave. */
	const START_MS = 900;
	/** How long a collected multiplier floats up before it fades. */
	const POP_MS = 1500;
	/** The kraken's beat before the screen moves on. */
	const SINK_MS = 1300;
	const END_HOLD_MS = 900;

	/** Seconds between one row leaving the cave and the next, and from the cave to the player. */
	const ROW_SECONDS = 3.2;
	const TRAVEL_SECONDS = 6.2;
	/** How big the cave is when it first comes into view, as a share of its size near the top of the board. */
	const START_SIZE = 0.38;
	/** How big a gate is as it leaves the cave, as a share of its full size at the player. */
	const GATE_START = 0.06;
	/** How far down the way to the player a row has spread out to its full width, as a share of it. */
	const SPREAD = 1;
	/** How far apart a row's barrels start, as a share of the cave's width at the time (they open out to the lanes). */
	const SPAWN_GAP = 0.06;
	/** How far along its way a barrel has faded in fully, as a share of it. */
	const FADE_IN = 0.2;
	/** The first row comes out this long after the sea starts moving. */
	const LEAD_SECONDS = 0.2;
	/** How long the scene takes to settle to the middle once the last gate is open. */
	const SETTLE_SECONDS = 1.2;
	/** How quickly the scene pans to where the wheel points it. */
	const PAN_TAU = 0.3;
	/** How much of the pan the sea and the cave follow — the far things move less. */
	const SEA_PAN = 0.7;
	const CAVE_PAN = 0.35;
	/** The wheel's lock, each way, and how far an arrow key turns it a press. */
	const WHEEL_LOCK = 110;
	const KEY_NOTCH_DEG = 12;

	const depths = $derived(room.depths.length);
	const cols = TILES_PER_DEPTH;
	/** Lane of tile `t`: -1 left, 0 centre, 1 right on a three-wide row. */
	const laneOf = (t: number) => t - (cols - 1) / 2;

	/** The screen this room is given, in layout pixels (the game's CSS zoom cancels out of both). */
	let rootEl = $state<HTMLDivElement>();
	let W = $state(1280);
	let H = $state(720);
	$effect(() => {
		const el = rootEl;
		if (!el) return;
		const measure = () => {
			W = el.clientWidth || W;
			H = el.clientHeight || H;
		};
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(el);
		return () => observer.disconnect();
	});

	/** The lanes' width: how much of the screen the playing field takes up. */
	const PW = $derived(portrait ? W * 0.92 : Math.min(W * 0.56, H * 0.85));
	/** Seconds on the water. */
	let T = $state(0);
	const rowStart = (i: number) => LEAD_SECONDS + i * ROW_SECONDS;
	const caveTop = $derived(H * 0.015);
	/**
	 * The cave at `p` of its way from far off to near: it starts small at the top centre and grows
	 * until its width fills the viewport, which it does as the last row comes out of it. It is always
	 * whole from top to bottom — anchored at the top, so it grows down the screen — and the waterline,
	 * where the sea begins, is its foot. It is never allowed to run off the top; if it ever grew wider
	 * than the viewport it would be the sides that ran off.
	 */
	const caveAt = (p: number) => {
		const near = portrait ? W * 0.98 : Math.min(W * 0.52, H * 0.34 * CAVE_ASPECT);
		const w0 = near * START_SIZE;
		const w = w0 + (W - w0) * p;
		const h = w / CAVE_ASPECT;
		return { w, h, top: caveTop, waterY: caveTop + h, mouthY: caveTop + h * 0.78 };
	};
	const grow = $derived(Math.min(1, T / rowStart(depths - 1)));
	const cave = $derived(caveAt(grow));
	/** One picture of the sea tile is two screens wide, so the scale is set by that. */
	const seaScale = $derived((2 * W) / SEA_PX.w);
	const tileH = $derived(SEA_PX.h * seaScale);
	/** The sea starts at the waterline and fades in below it. */
	const tileTop = $derived(cave.waterY - 10);

	/**
	 * The deck. Landscape draws it the whole width of the screen, sunk a little so the sea has room;
	 * portrait takes just its bottom middle — the ring the wheel sits in and the rail round the bow —
	 * at a size that suits the wheel, and the screen crops the sides off. Either way the ring's
	 * middle is (about) the wheel's middle, which is the foot of the screen.
	 */
	/** The wheel's width: larger in portrait, where the screen is narrow and it is the thing to reach for. */
	const wheelW = $derived(PW * (portrait ? 0.95 : 0.6));
	const deckScale = $derived(portrait ? (wheelW * 1.25) / DECK_PX.ring : W / DECK_PX.w);
	const deckW = $derived(DECK_PX.w * deckScale);
	const deckTop = $derived(H - DECK_PX.ringY * deckScale + (portrait ? 0 : H * DECK_SINK));

	/** The gates are barrels floating on the water, standing on the row's line by their foot. */
	const gateW = $derived(PW * 0.28);
	const gateH = $derived(gateW * BARREL_ASPECT);
	const pitch = $derived(PW * 0.4);
	const cx = $derived(W / 2);
	/** A row is opened as its barrels' feet come right up to the tip of the deck's bow. */
	const hitY = $derived(deckTop + DECK_PX.tip * deckScale - 4);
	/** How fast the sea runs by. */
	const speed = $derived((hitY - caveAt(0).mouthY) / TRAVEL_SECONDS);

	/** The kraken takes up the whole height in landscape and the whole width in portrait. */
	const krakenSize = $derived(portrait ? W : H);
	const krakenY = $derived(portrait ? H * 0.45 : H / 2);
	/** Where it rises from: the barrel it was behind, relative to where it ends up. */
	const krakenFrom = $derived({ x: 0, y: hitY - gateH * 0.5 - krakenY });

	/** Rows opened so far. */
	let reached = $state(0);
	let kraken = $state<{ depth: number; tile: number } | null>(null);
	let ended = $state<'kraken' | 'port' | null>(null);
	/** The gate of the row just opened, for its flash. */
	let opened = $state<{ depth: number; tile: number } | null>(null);
	/** Multipliers just collected, each floating up off the gate it came from. */
	type Pop = { id: number; value: number; x: number; y: number; last: boolean };
	let pops = $state<Pop[]>([]);
	let popId = 0;
	/** True while the sea is moving. */
	let sailing = $state(false);
	/** The scene settling to the middle after the last gate, and how far along it is (0-1). */
	let settling = $state(false);

	/** How far the sea has run. */
	let scroll = $state(0);
	/** How far the player is looking to one side of the middle, in pixels: the scene pans the other way. */
	let offset = $state(0);
	/** The middle of the cave's mouth across the screen: the cave pans a little with the wheel, and the
	    barrels come out of wherever it is. */
	const mouthX = $derived(cx - offset * CAVE_PAN);
	let wheelDeg = $state(0);

	/** Where row `i` is, and how far it has come out of the cave (0 in the mouth, 1 in open water). */
	const rowAt = (i: number) => {
		const age = T - rowStart(i);
		// Out of the mouth as it was when the row left it: the cave has grown since. Every row takes the
		// same time to come down, however far that is, so a late row, from a lower mouth, is no hastier.
		const mouth = caveAt(Math.min(1, rowStart(i) / rowStart(depths - 1)));
		const from = mouth.mouthY;
		const prog = Math.max(0, age) / TRAVEL_SECONDS;
		const y = from + (hitY - from) * prog;
		// Barrels come out of the bottom middle of the mouth in a single heap, and fan out slowly: little at
		// first, and gently into their lanes as they arrive.
		const spread = Math.min(1, prog / SPREAD);
		const out = spread * spread * (3 - 2 * spread);
		// A barrel starts small, far off at the cave, and grows to its full size as it reaches the player.
		const size = GATE_START + (1 - GATE_START) * Math.min(1, prog);
		// How far apart the three come out, as they leave the mouth: the bigger the cave, the wider.
		const s0 = Math.min(pitch * 0.9, mouth.w * SPAWN_GAP);
		const fade = Math.min(1, prog / FADE_IN);
		return { y, out, size, s0, fade, live: age >= 0 && y < H + gateH };
	};

	let alive = true;
	let raf = 0;
	let clock: ReturnType<typeof setInterval> | undefined;
	onDestroy(() => {
		alive = false;
		stop();
	});

	const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

	/** The tile of a row whose lane is at the middle of the screen. */
	const nearest = () => {
		let best = 0;
		for (let t = 1; t < cols; t++)
			if (Math.abs(laneOf(t) * pitch - offset) < Math.abs(laneOf(best) * pitch - offset)) best = t;
		return best;
	};
	/** The gate at the middle right now: the one that is lit, and the one the next row will open. */
	const centred = $derived(nearest());

	let finish: () => void = () => undefined;
	const finished = new Promise<void>((resolve) => (finish = resolve));

	const open = (depth: number, tile: number) => {
		opened = { depth, tile };
		if (depth >= room.dived) {
			// The row the book ends the voyage at: whichever gate is at the middle, the kraken is behind it.
			kraken = { depth, tile };
			stop();
			playSound('doorClose');
			void waitForTimeout(SINK_MS).then(() => {
				ended = 'kraken';
				finish();
			});
			return;
		}
		const id = popId++;
		pops = [
			...pops,
			{ id, value: room.depths[depth], x: cx, y: hitY - gateH * 0.55, last: depth === depths - 1 },
		];
		// The last one stays up for the win line; the rest are gone once they have floated off.
		if (depth < depths - 1) void waitForTimeout(POP_MS + 100).then(() => (pops = pops.filter((q) => q.id !== id)));
		reached = depth + 1;
		playSound('pop', 1 + depth * 0.04);
		if (reached >= depths) {
			// The last gate: the voyage is made, and the scene comes to rest at the middle.
			settling = true;
			dock = 0;
			playSound('whoosh');
		}
	};

	let dock = 0;
	const step = (dt: number) => {
		if (!sailing) return;
		T += dt;
		scroll += speed * dt;

		if (settling) {
			dock = Math.min(1, dock + dt / SETTLE_SECONDS);
			offset += (0 - offset) * (1 - Math.exp(-dt / 0.25));
			wheelDeg += (0 - wheelDeg) * (1 - Math.exp(-dt / 0.2));
			if (dock >= 1) {
				stop();
				playSound('win');
				ended = 'port';
				finish();
			}
			return;
		}

		// Where the scene is being panned to: by the wheel, or by the book when no hands are on it.
		let target: number;
		if (!interactive) {
			const tile = (reached < room.dived ? room.path[reached] : (room.krakenTile ?? 0)) % cols;
			target = laneOf(tile) * pitch;
			const want = (laneOf(tile) / Math.max(1, (cols - 1) / 2)) * WHEEL_LOCK;
			wheelDeg += (want - wheelDeg) * (1 - Math.exp(-dt / 0.15));
		} else {
			target = (wheelDeg / WHEEL_LOCK) * ((cols - 1) / 2) * pitch;
		}
		offset += (target - offset) * (1 - Math.exp(-dt / PAN_TAU));

		while (sailing && reached < depths && rowAt(reached).y >= hitY) {
			open(reached, nearest());
		}
	};

	let last = 0;
	const advance = (now: number) => {
		if (!sailing) {
			last = now;
			return;
		}
		// Fixed steps, however long it has been since the last look (a hidden tab looks once a second).
		let owed = Math.min((now - last) / 1000, 2);
		last = now;
		while (owed > 0 && sailing) {
			const dt = Math.min(owed, 1 / 60);
			owed -= dt;
			step(dt);
		}
	};
	const frame = (now: number) => {
		if (!alive || !sailing) return;
		advance(now);
		raf = requestAnimationFrame(frame);
	};
	const stop = () => {
		sailing = false;
		cancelAnimationFrame(raf);
		clearInterval(clock);
	};

	export const play = async (): Promise<number> => {
		await waitForTimeout(START_MS);
		if (!alive) return room.total;
		sailing = true;
		last = performance.now();
		playSound('whoosh');
		raf = requestAnimationFrame(frame);
		clock = setInterval(() => advance(performance.now()), 250);
		await finished;
		await waitForTimeout(END_HOLD_MS);
		return room.total;
	};

	// ---- The wheel ---------------------------------------------------------------------------
	let helmEl = $state<HTMLDivElement>();
	let dragging = $state(false);
	let lastAngle = 0;
	const angleOf = (event: PointerEvent) => {
		const r = helmEl!.getBoundingClientRect();
		return (Math.atan2(event.clientY - (r.top + r.height / 2), event.clientX - (r.left + r.width / 2)) * 180) / Math.PI;
	};
	const hands = $derived(interactive && ended === null && !kraken && reached < depths);
	const grab = (event: PointerEvent) => {
		if (!hands || !helmEl || !event.isPrimary) return;
		dragging = true;
		helmEl.setPointerCapture(event.pointerId);
		lastAngle = angleOf(event);
	};
	const turn = (event: PointerEvent) => {
		if (!dragging || !hands) return;
		const a = angleOf(event);
		let d = a - lastAngle;
		if (d > 180) d -= 360;
		if (d < -180) d += 360;
		lastAngle = a;
		wheelDeg = clamp(wheelDeg + d, -WHEEL_LOCK, WHEEL_LOCK);
	};
	const release = () => (dragging = false);

	const keyOf = (event: KeyboardEvent) =>
		event.key === 'ArrowLeft' || event.key === 'a' || event.key === 'A'
			? -1
			: event.key === 'ArrowRight' || event.key === 'd' || event.key === 'D'
				? 1
				: 0;
	const keyDown = (event: KeyboardEvent) => {
		const d = keyOf(event);
		if (!d || !hands) return;
		// A press (and each repeat of a held key) turns the wheel a notch.
		wheelDeg = clamp(wheelDeg + d * KEY_NOTCH_DEG, -WHEEL_LOCK, WHEEL_LOCK);
		event.preventDefault();
	};

	const place = (x: number, y: number) => `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;

</script>

<svelte:window onkeydown={keyDown} />

<div class="voyage" bind:this={rootEl} style="--voyage-w:{PW}px; --gw:{gateW}px; --gh:{gateH}px; --wheel-w:{wheelW}px">
	<img
		class="cave"
		class:lit={ended === 'port'}
		src={CAVE}
		alt=""
		draggable="false"
		style="left:{cx - cave.w / 2 - offset * CAVE_PAN}px; top:{cave.top}px; width:{cave.w}px"
	/>

	<!-- The sea, over the cave's own water and out to both edges: a tile that scrolls down as the
	     gates come, and pans sideways as the wheel turns. -->
	<div
		class="sea"
		style="top:{tileTop}px; --blend:{BLEND_PX * (W / 1024)}px; background-image:url('{SEA}'); background-size:{2 * W}px auto; background-position:{(-offset * SEA_PAN).toFixed(1)}px {scroll % tileH}px"
	></div>

	{#each Array.from({ length: depths }, (_, d) => d) as depth (depth)}
		{@const row = rowAt(depth)}
		{#if row.live}
			{@const done = depth < reached || kraken?.depth === depth}
			{#each Array.from({ length: cols }, (_, t) => t) as tile (tile)}
				{@const wreck = kraken?.depth === depth && kraken.tile === tile}
				{@const chosen = opened?.depth === depth && opened.tile === tile}
				<div
					class="gate"
					class:wreck
					class:chosen
					class:near={!done && depth === reached && tile === centred && row.out > 0.6}
					class:gone={done && !wreck && !chosen}
					style="transform:{place(mouthX * (1 - row.out) + (cx - offset) * row.out + laneOf(tile) * (row.s0 + (pitch - row.s0) * row.out), row.y)} translate(-50%, -100%) scale({row.size.toFixed(3)}); opacity:{row.fade.toFixed(3)}"
				>
					<div class="float" style="--bob:{(depth * 3 + tile * 5) % 7}">
						<img class="barrel" src={BARREL} alt="" draggable="false" />
					</div>
				</div>
			{/each}
		{/if}
	{/each}

	<!-- The ship's deck, in front of the sea and the gates, with the wheel set into its ring. -->
	<img class="deck" src={DECK} alt="" draggable="false" style="left:{cx - deckW / 2}px; top:{deckTop}px; width:{deckW}px" />

	{#each pops as pop (pop.id)}
		<div class="pop mult-badge" class:last={pop.last} style="left:{pop.x}px; top:{pop.y}px; --rise:{H * 0.22}px; --pop-ms:{POP_MS}ms">
			<span class="mult-stroke" aria-hidden="true">{pop.value}x</span>
			<span class="mult-fill">{pop.value}x</span>
		</div>
	{/each}

	{#if kraken}
		<img
			class="kraken"
			src={KRAKEN}
			alt=""
			draggable="false"
			style="width:{krakenSize}px; height:{krakenSize}px; left:{cx}px; top:{krakenY}px; --from-x:{krakenFrom.x}px; --from-y:{krakenFrom.y}px"
		/>
	{/if}

	<!-- The helm. Dragged round by hand, or by the arrow keys; turned by itself when the voyage is
	     being sailed for the player. -->
	<div
		class="helm"
		class:hands
		class:dragging
		bind:this={helmEl}
		role="slider"
		tabindex={hands ? 0 : -1}
		aria-label="Ship's wheel"
		aria-valuemin={-WHEEL_LOCK}
		aria-valuemax={WHEEL_LOCK}
		aria-valuenow={Math.round(wheelDeg)}
		onpointerdown={grab}
		onpointermove={turn}
		onpointerup={release}
		onpointercancel={release}
	>
		<img class="wheel" src={WHEEL} alt="" draggable="false" style="transform: rotate({wheelDeg.toFixed(1)}deg)" />
	</div>

</div>

<style>
	.voyage {
		position: absolute;
		inset: 0;
		overflow: hidden;
	}
	.cave {
		position: absolute;
		height: auto;
		pointer-events: none;
		filter: drop-shadow(0 calc(var(--voyage-w) * 0.01) calc(var(--voyage-w) * 0.02) rgba(0, 0, 0, 0.55));
	}
	.cave.lit {
		filter: drop-shadow(0 0 calc(var(--voyage-w) * 0.04) rgba(255, 214, 90, 0.95))
			drop-shadow(0 0 calc(var(--voyage-w) * 0.08) rgba(255, 180, 50, 0.6));
	}
	.sea {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 0;
		background-repeat: repeat;
		pointer-events: none;
		mask-image: linear-gradient(180deg, transparent 0, #000 var(--blend));
		-webkit-mask-image: linear-gradient(180deg, transparent 0, #000 var(--blend));
	}

	/*
	 * A gate: a barrel floating on the water, bobbing up and down and rolling a little on the swell as
	 * it comes. Its foot is the point it is placed by, and its size is written on the element each
	 * frame as it comes out of the cave and grows. The one at the middle of the screen is the one the
	 * next row will open, and is lit; the others sit back. Opened, the barrel flashes and is gone
	 * (`.pop` collects its multiplier); the rest of the row sinks away.
	 */
	.gate {
		position: absolute;
		left: 0;
		top: 0;
		width: var(--gw);
		height: var(--gh);
		transform-origin: 50% 100%;
		pointer-events: none;
		z-index: 2;
		transition: opacity 220ms ease-out;
	}
	.float {
		position: absolute;
		inset: 0;
		transform-origin: 50% 80%;
		animation: bob 1700ms ease-in-out calc(var(--bob) * -240ms) infinite alternate;
	}
	.barrel {
		display: block;
		width: 100%;
		height: 100%;
		transition: filter 200ms ease-out;
		filter: brightness(0.85) drop-shadow(0 calc(var(--gw) * 0.03) calc(var(--gw) * 0.04) rgba(0, 20, 40, 0.5));
	}
	@keyframes bob {
		from {
			transform: translateY(-5%) rotate(-2.5deg);
		}
		to {
			transform: translateY(5%) rotate(2.5deg);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.float {
			animation: none;
		}
	}
	.gate.near {
		filter: drop-shadow(0 0 calc(var(--gw) * 0.07) rgba(255, 214, 90, 0.95));
	}
	.gate.near .barrel {
		filter: brightness(1.15);
	}
	.gate.gone {
		opacity: 0 !important;
	}
	/* The chosen barrel flashes and is gone, so the multiplier — or the kraken, which stays — is all
	   that is left where it stood. */
	.gate.chosen .float {
		animation: flash-out 420ms ease-out both;
	}
	@keyframes flash-out {
		0% {
			filter: brightness(1.2);
			opacity: 1;
			transform: scale(1);
		}
		35% {
			filter: brightness(2.6);
			opacity: 1;
			transform: scale(1.1);
		}
		100% {
			filter: brightness(2.6);
			opacity: 0;
			transform: scale(1.4);
		}
	}
	.gate.wreck {
		z-index: 3;
	}
	/*
	 * The kraken, when it comes: rises out of the barrel it was behind and grows to fill the screen —
	 * its whole height in landscape, its whole width in portrait — over the wheel and the deck and
	 * everything else on the water. It is a square picture, so the size is the one number.
	 */
	.kraken {
		position: absolute;
		z-index: 8;
		pointer-events: none;
		transform: translate(-50%, -50%);
		filter: drop-shadow(0 calc(var(--voyage-w) * 0.01) calc(var(--voyage-w) * 0.03) rgba(0, 0, 0, 0.6));
		animation: kraken-rise 800ms cubic-bezier(0.2, 1.2, 0.4, 1) both;
	}
	@keyframes kraken-rise {
		from {
			transform: translate(-50%, -50%) translate(var(--from-x), var(--from-y)) scale(0.08);
			opacity: 0;
		}
		30% {
			opacity: 1;
		}
		to {
			transform: translate(-50%, -50%);
		}
	}

	/* A multiplier collected: it pops up glowing where the gate opened and floats up and away, as if
	   gathered. It carries the game's own multiplier lettering (`.mult-badge`). The last one of a
	   voyage stays up, glowing, for the win line. */
	.pop {
		position: absolute;
		z-index: 6;
		font-size: calc(var(--voyage-w) * 0.1);
		white-space: nowrap;
		pointer-events: none;
		transform: translate(-50%, -50%);
		filter: drop-shadow(0 0 calc(var(--voyage-w) * 0.016) rgba(255, 220, 90, 1))
			drop-shadow(0 0 calc(var(--voyage-w) * 0.04) rgba(255, 180, 40, 0.85));
		animation: collect var(--pop-ms) cubic-bezier(0.2, 0.7, 0.3, 1) both;
	}
	.pop.last {
		animation: collect-last 700ms cubic-bezier(0.2, 0.7, 0.3, 1) both;
	}
	@keyframes collect {
		0% {
			transform: translate(-50%, -50%) scale(0.3);
			opacity: 0;
		}
		14% {
			transform: translate(-50%, -70%) scale(1.25);
			opacity: 1;
		}
		30% {
			transform: translate(-50%, calc(-50% - var(--rise) * 0.3)) scale(1);
			opacity: 1;
		}
		100% {
			transform: translate(-50%, calc(-50% - var(--rise))) scale(0.9);
			opacity: 0;
		}
	}
	@keyframes collect-last {
		0% {
			transform: translate(-50%, -50%) scale(0.3);
			opacity: 0;
		}
		100% {
			transform: translate(-50%, calc(-50% - var(--rise) * 0.4)) scale(1.3);
			opacity: 1;
		}
	}

	/* The deck, over the sea and the gates and under the wheel. */
	.deck {
		position: absolute;
		height: auto;
		pointer-events: none;
		z-index: 4;
	}

	/* The ship's wheel, bottom middle with its lower half off the screen: only the top of the wheel
	   shows. It is the control, so it is the one thing here that takes pointer events. */
	.helm {
		position: absolute;
		left: 50%;
		translate: -50% 0;
		bottom: calc(var(--wheel-w) * -0.5);
		width: var(--wheel-w);
		aspect-ratio: 1;
		touch-action: none;
		user-select: none;
		-webkit-user-select: none;
		-webkit-tap-highlight-color: transparent;
		outline: none;
		z-index: 5;
	}
	.helm.hands {
		cursor: grab;
	}
	.helm.hands.dragging {
		cursor: grabbing;
	}
	.wheel {
		display: block;
		width: 100%;
		height: 100%;
		pointer-events: none;
		filter: drop-shadow(0 calc(var(--voyage-w) * 0.012) calc(var(--voyage-w) * 0.02) rgba(0, 0, 0, 0.65));
		transition: transform 90ms linear;
	}
	.helm.dragging .wheel {
		transition: none;
	}
	/* Asked to be turned: a faint swell of light round it while it waits for a hand. */
	.helm.hands:not(.dragging) .wheel {
		animation: invite 1400ms ease-in-out infinite alternate;
	}
	@keyframes invite {
		from {
			filter: drop-shadow(0 calc(var(--voyage-w) * 0.012) calc(var(--voyage-w) * 0.02) rgba(0, 0, 0, 0.65));
		}
		to {
			filter: drop-shadow(0 0 calc(var(--voyage-w) * 0.03) rgba(255, 214, 90, 0.9));
		}
	}

</style>
