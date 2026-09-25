<script lang="ts">
	/**
	 * The Top Slot: two reels above the wheel. The left reel picks a spot, the right a multiplier
	 * (or a blank gap, the "miss"). Both land where the book says; nothing is decided here.
	 *
	 * Each reel is a strip repeated a few times so the stop can always be approached by scrolling
	 * DOWN through several copies, then the strip is silently reset to the equivalent position in
	 * the first copy once the transition has ended.
	 */
	import { onDestroy } from 'svelte';

	import {
		ICON_MOTION_MS,
		isRoomSpot,
		motionOf,
		NUMBER_PAY,
		ROOM_ICON,
		SPOTS,
		SPOT_COLOUR,
		TOP_SLOT_MULTS,
		type Spot,
	} from '../game/constants';
	import { staticCssUrl, staticUrl } from '../lib/staticUrl';

	/**
	 * The cabinet art (static/img/top-slots/frame.png, 1774x887). Its two windows were read off the
	 * alpha channel — left x 145..838, right x 932..1624, both y 334..768 — and the percentages below
	 * are those bounds over the image box, so the reels sit exactly in the openings. The opening's
	 * height works out at 0.2452 of the frame's WIDTH, which is where `--cell` comes from.
	 */
	const FRAME_ART = staticUrl('img/top-slots/frame.png');
	/**
	 * The two ropes the cabinet hangs from, hooked onto the rope bindings drawn on its top rail
	 * (left one centred at x 435 of 1774, the right its mirror at 1339; the rail's top edge at y 187
	 * of 887). Each is the hook end (static/img/top-slots/rope.png from row 227 down, so its top is
	 * where the twist repeats) under a strand cut from the same rope, one repeat (294 px, three turns)
	 * tall and tiled on up past the top of the screen — so the rope still reaches the rigging when the
	 * cabinet comes down into the middle of the wheel.
	 */
	const ROPE_END = staticUrl('img/top-slots/rope_end.webp');
	const ROPE_STRAND = staticCssUrl('img/top-slots/rope_strand.webp');

	type Props = {
		/** Glow the pair: the wheel landed on the spot the Top Slot picked. */
		applied?: boolean;
		/** Fired whenever a cell passes a reel's window, on either reel — the wheel's peg tick. */
		onTick?: () => void;
		/** Fired as each reel comes to rest — twice a spin, a couple of seconds apart. */
		onReelStop?: () => void;
	};
	let { applied = false, onTick, onReelStop }: Props = $props();

	/** Copies of the strip to travel through. Enough that the right reel, which runs longest at the
	 *  shared rate, always finds a copy far enough away to land on. */
	const COPIES = 10;
	/** How long the left reel runs. The right one runs longer, so it lands after it. */
	const SPIN_MS = 2200;
	const MULT_EXTRA_MS = 2000;

	// A number reads as its wheel badge, a bonus as the room's own icon: no names, the icon alone,
	// set large and dead centre in the window, so a reel says the same thing the wedge does.
	const spotItems = SPOTS.map((spot) => ({
		key: spot,
		room: isRoomSpot(spot),
		icon: isRoomSpot(spot)
			? staticUrl(ROOM_ICON[spot].src)
			: staticUrl(`img/wheel/${NUMBER_PAY[spot]}.png`),
		fill: SPOT_COLOUR[spot].base,
		text: SPOT_COLOUR[spot].text,
	}));
	// Multipliers interleaved with blanks: landing on a blank is the miss.
	const multItems = TOP_SLOT_MULTS.flatMap((m) => [
		{ key: `m${m}`, label: `${m}x`, blank: false },
		{ key: `b${m}`, label: '', blank: true },
	]);

	/** The multiplier window, so the game can fly a copy of what landed onto the winning tile. */
	let multReelEl: HTMLElement | undefined = $state();
	let spotStripEl: HTMLElement | undefined = $state();
	let multStripEl: HTMLElement | undefined = $state();
	export const multRect = (): DOMRect | undefined => multReelEl?.getBoundingClientRect();
	/** And the size it is set at, so a copy can leave the reel at the size it is read at. */
	export const multFontPx = (): number => {
		const cell = multReelEl?.querySelector('.cell');
		return cell ? parseFloat(getComputedStyle(cell).fontSize) : 0;
	};

	/**
	 * What each reel stopped on, lit in its window until the next spin; and the left reel's icon
	 * playing its own motion (the one it plays on its bet tile and its wedge) as it lands. The
	 * motion goes on every copy of the spot in the strip, so the silent reset to the first copy
	 * lands on one already mid-motion, in step.
	 */
	let landedSpot = $state<Spot | null>(null);
	let spotMoving = $state(false);
	/** The multiplier reel's landed item (its index in one copy of the strip); null for a miss. */
	let multLanded = $state<number | null>(null);
	let motionTimer: ReturnType<typeof setTimeout> | undefined;

	let spotIndex = $state(0);
	let multIndex = $state(1);
	let animating = $state(false);
	let spotOffset = $state(0); // in items, within the repeated strip
	let multOffset = $state(1);
	/** Set per spin: the right reel travels further because it runs longer at the same rate. */
	/** The right reel's own run, set when a spin starts. Seeded at full length: nothing is moving
	 *  before the first spin, so the seed only has to be a sane number. */
	let multMs = $state(SPIN_MS + MULT_EXTRA_MS);

	onDestroy(() => {
		cancelAnimationFrame(raf);
		clearTimeout(motionTimer);
	});

	const strip = <T,>(items: T[]) => Array.from({ length: COPIES }, () => items).flat();
	const spotStrip = strip(spotItems);
	const multStrip = strip(multItems);

	const targetSpotIndex = (spot: Spot | null) => (spot ? SPOTS.indexOf(spot) : 0);
	const targetMultIndex = (m: number | null) => {
		if (m === null) return multItems.findIndex((item) => item.blank); // first blank
		return multItems.findIndex((item) => item.key === `m${m}`);
	};

	/**
	 * Spin both reels to the authored pair. Resolves when they have stopped.
	 *
	 * Both run at the same rate — cells per second, and the cells are the same height — so the one
	 * that runs a second longer has to cover a second's more ground. The left reel travels to its
	 * target in the last copy; the right one lands on the copy whose distance is nearest the rate it
	 * owes, which is what keeps the two moving together until the left one stops.
	 */
	/**
	 * Cells passing their window, read off the live transform rather than a timer, so the ticks follow
	 * the eased motion the way the wheel's do. Each reel is counted separately — they run at the same
	 * rate but stop a couple of seconds apart, so the right one keeps ticking after the left is still.
	 */
	let raf = 0;
	let lastCell = [0, 0];
	const cellIndex = (el: HTMLElement | undefined, cell: number) => {
		if (!el || !cell) return null;
		return Math.round(-new DOMMatrixReadOnly(getComputedStyle(el).transform).f / cell);
	};
	const track = () => {
		const cell = spotStripEl?.firstElementChild?.getBoundingClientRect().height ?? 0;
		for (const [i, el] of [spotStripEl, multStripEl].entries()) {
			const at = cellIndex(el, cell);
			if (at !== null && at !== lastCell[i]) {
				lastCell[i] = at;
				onTick?.();
			}
		}
		if (animating) raf = requestAnimationFrame(track);
	};

	export const spin = (spot: Spot | null, multiplier: number | null): Promise<void> => {
		const s = targetSpotIndex(spot);
		const m = targetMultIndex(multiplier);
		const sTarget = (COPIES - 1) * spotItems.length + s;

		const rate = (sTarget - spotOffset) / SPIN_MS; // cells per ms, shared by both reels
		multMs = SPIN_MS + MULT_EXTRA_MS;
		const wanted = rate * multMs;
		let mTarget = multItems.length + m;
		for (let copy = 1; copy < COPIES; copy++) {
			const candidate = copy * multItems.length + m;
			if (Math.abs(candidate - multOffset - wanted) < Math.abs(mTarget - multOffset - wanted)) {
				mTarget = candidate;
			}
		}

		const landing = spotItems[s].key;
		return new Promise((resolve) => {
			animating = true;
			landedSpot = null;
			spotMoving = false;
			multLanded = null;
			clearTimeout(motionTimer);
			lastCell = [spotOffset, multOffset];
			cancelAnimationFrame(raf);
			raf = requestAnimationFrame(track);
			// Each reel says so as it lands; the second one is still running when the first does.
			// The left one's icon lights and plays its motion the moment it stops.
			setTimeout(() => {
				onReelStop?.();
				landedSpot = landing;
				spotMoving = true;
				motionTimer = setTimeout(() => (spotMoving = false), ICON_MOTION_MS[motionOf(landing)]);
			}, SPIN_MS);
			setTimeout(() => {
				onReelStop?.();
				multLanded = multiplier !== null ? m : null;
			}, multMs);
			requestAnimationFrame(() => {
				requestAnimationFrame(() => {
					spotOffset = sTarget;
					multOffset = mTarget;
				});
			});
			setTimeout(() => {
				animating = false;
				cancelAnimationFrame(raf);
				// Snap back to the equivalent slot in copy 0 without a transition.
				spotOffset = s;
				multOffset = m;
				spotIndex = s;
				multIndex = m;
				resolve();
			}, multMs + 60);
		});
	};
</script>

<div class="topslot" class:applied class:animating>
	<div class="cabinet">
		<!-- Behind the frame: the hook goes down behind the binding, so it reads as hooked on. -->
		{#each ['left', 'right'] as side (side)}
			<div class="rope {side}" style="--strand:{ROPE_STRAND}" aria-hidden="true">
				<div class="rope-up"></div>
				<img class="rope-end" src={ROPE_END} alt="" draggable="false" />
			</div>
		{/each}
		<img class="frame-art" src={FRAME_ART} alt="" draggable="false" />
		<!-- Each window is shaded at its edges, like a drum turning away into the cabinet, and lit in
		     the middle where the result stands (`::before` the light, `::after` the shade). -->
		<div class="reel spot-reel" class:lit={landedSpot !== null}>
			<div class="strip" bind:this={spotStripEl} style="--offset:{spotOffset}; --ms:{SPIN_MS}ms">
				{#each spotStrip as item, i (i)}
					{@const landed = landedSpot === item.key}
					<div class="cell" class:landed style="--fill:{item.fill}; --text:{item.text}">
						<img
							class="badge {landed && spotMoving ? `motion-${motionOf(item.key)}` : ''}"
							class:crest={item.room}
							src={item.icon}
							alt=""
							draggable="false"
						/>
					</div>
				{/each}
			</div>
		</div>
		<div class="reel mult-reel" class:lit={multLanded !== null} bind:this={multReelEl}>
			<div class="strip" bind:this={multStripEl} style="--offset:{multOffset}; --ms:{multMs}ms">
				{#each multStrip as item, i (i)}
					<div class="cell mult" class:blank={item.blank} class:landed={i % multItems.length === multLanded}>
						{#if !item.blank}
							<span class="mult-stroke" aria-hidden="true">{item.label}</span>
							<span class="mult-fill">{item.label}</span>
						{/if}
					</div>
				{/each}
			</div>
		</div>
	</div>
</div>

<style>
	/* The cabinet's width is the only knob — the game widens it in portrait. Everything else follows
	   from the art: the openings are a fixed share of it, and a reel window is exactly one cell tall,
	   which is also the step the strip translates by. */
	.topslot {
		--frame-w: var(--ts-width, 22.8vw);
		--cell: calc(var(--frame-w) * 0.2452);
		display: flex;
		flex-direction: column;
		align-items: center;
	}
	.cabinet {
		position: relative;
		width: var(--frame-w);
		aspect-ratio: 1774 / 887;
	}
	/*
	 * A rope, in the cabinet's own units. The drawing is 887 px wide with the rope dead centre, and is
	 * drawn at 0.45 of its size against the 1774 px frame: 22.5% of the cabinet's width, which makes
	 * the ring about as wide as the binding it hooks. The hook's tip (row 1541 of the 1547-row end
	 * piece) sits at 28.5% of the cabinet's height, 60 frame px down behind the binding, so the ring
	 * hangs just above the rail. Everything above the end piece is strand, as tall as it needs to be.
	 */
	.rope {
		--rope-w: calc(var(--frame-w) * 0.225);
		position: absolute;
		z-index: 1;
		bottom: 71.5%;
		width: var(--rope-w);
		display: flex;
		flex-direction: column;
		pointer-events: none;
	}
	.rope.left {
		left: calc(24.5% - var(--rope-w) / 2);
	}
	.rope.right {
		left: calc(75.5% - var(--rope-w) / 2);
	}
	/* The strand, tiled up from the end piece's top edge — the tile starts on the row the end piece
	   does, so the twist runs on through the join. Tall enough to clear the top of the screen from
	   anywhere the cabinet goes (it comes down to the wheel's middle, grown, for its spin). */
	.rope-up {
		height: calc(var(--frame-w) * 3);
		background: var(--strand) center bottom / 100% auto repeat-y;
	}
	.rope-end {
		display: block;
		width: 100%;
		height: auto;
		aspect-ratio: 887 / 1547;
		/* A pixel of overlap, so rounding never opens a hairline at the join. */
		margin-top: -1px;
		user-select: none;
	}
	.frame-art {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		z-index: 2;
		pointer-events: none;
		user-select: none;
		filter: drop-shadow(0 0.3vw 0.8vw rgba(0, 0, 0, 0.6));
	}
	/* Placed on the art's own window bounds; height is the cell itself so the strip steps true. */
	.reel {
		position: absolute;
		top: 37.66%;
		height: var(--cell);
		overflow: hidden;
		background: #0d0906;
	}
	.spot-reel {
		left: 8.17%;
		width: 39.12%;
	}
	.mult-reel {
		left: 52.54%;
		width: 39.06%;
	}
	.strip {
		display: flex;
		flex-direction: column;
		transform: translateY(calc(var(--offset) * var(--cell) * -1));
	}
	.animating .strip {
		/* Quick off the mark and a short settle — it decelerates into place rather than crawling. */
		transition: transform var(--ms) cubic-bezier(0.16, 0.78, 0.28, 1);
	}
	/* The step the strip translates by IS `--cell`, so the cell's border box has to be exactly that:
	   border-box (the 0.05vw rule rounds up to a whole pixel and would otherwise be added on top) and
	   a fixed flex basis (a flex item will not shrink below its content without one). Without both,
	   every cell ran a pixel tall and the landing sat low in the window. */
	.cell {
		box-sizing: border-box;
		flex: 0 0 var(--cell);
		height: var(--cell);
		overflow: hidden;
		display: flex;
		/* Same arrangement as a bet tile: the crest over the room's whole name. */
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: calc(var(--cell) * 0.03);
		color: var(--text, #fff);
		background: var(--fill, #222);
		border-bottom: 0.05vw solid rgba(0, 0, 0, 0.4);
	}
	.badge {
		height: calc(var(--cell) * 0.73);
		flex: none;
		width: auto;
		filter: drop-shadow(0 0.1vw 0.2vw rgba(0, 0, 0, 0.5));
		transition: filter 250ms ease;
	}
	/* A bonus has the window to itself too, with no name under it: the room's icon, set big and
	   dead centre. Its drawing is round-ish and fills its file, so it is set a little larger than
	   a number badge (a tall, narrow plate) to read at the same weight. */
	.crest {
		height: calc(var(--cell) * 0.84);
	}
	/* The one that landed, lit from behind with the window's own light. */
	.cell.landed .badge {
		filter: drop-shadow(0 0 calc(var(--cell) * 0.06) rgba(255, 236, 160, 0.95))
			drop-shadow(0 0 calc(var(--cell) * 0.16) rgba(255, 196, 70, 0.7));
	}
	/* The landed icon's own motion (the global `motion-*` classes), kept inside the window: the
	   tile's cannonball hops a third of its height, which a window one cell tall would cut the top
	   off, so on the reel it hops a lower hop in the same rhythm. */
	.badge:global(.motion-bounce) {
		animation-name: ts-bounce;
	}
	@keyframes ts-bounce {
		0%,
		100% {
			transform: none;
		}
		10% {
			transform: scale(1.1, 0.88);
			animation-timing-function: cubic-bezier(0.2, 0.7, 0.4, 1);
		}
		36% {
			transform: translateY(-9%) scale(0.95, 1.05);
			animation-timing-function: cubic-bezier(0.6, 0, 0.8, 0.4);
		}
		58% {
			transform: scale(1.08, 0.9);
			animation-timing-function: cubic-bezier(0.2, 0.7, 0.4, 1);
		}
		74% {
			transform: translateY(-3%);
			animation-timing-function: cubic-bezier(0.6, 0, 0.8, 0.4);
		}
		88% {
			transform: scale(1.03, 0.97);
		}
	}
	/* The window's light: a warm pool in the middle, where the result stands, screened over the
	   strip so it brightens what is under it rather than covering it. Brighter once the reel has
	   stopped on something. */
	.reel::before,
	.reel::after {
		content: '';
		position: absolute;
		inset: 0;
		z-index: 1;
		pointer-events: none;
	}
	.reel::before {
		background: radial-gradient(
			ellipse 46% 62% at 50% 50%,
			rgba(255, 236, 170, 0.34) 0%,
			rgba(255, 214, 120, 0.16) 45%,
			rgba(255, 200, 100, 0) 100%
		);
		mix-blend-mode: screen;
		opacity: 0.7;
		transition: opacity 300ms ease;
	}
	.reel.lit::before {
		opacity: 1;
	}
	/* And its shade: the edges fall away into soft shadow, top and bottom most (the drum turning
	   away), the sides a little, so the middle reads as the one place the light is. */
	.reel::after {
		background:
			linear-gradient(
				180deg,
				rgba(0, 0, 0, 0.62) 0%,
				rgba(0, 0, 0, 0.18) 20%,
				rgba(0, 0, 0, 0) 34%,
				rgba(0, 0, 0, 0) 66%,
				rgba(0, 0, 0, 0.18) 80%,
				rgba(0, 0, 0, 0.62) 100%
			),
			linear-gradient(
				90deg,
				rgba(0, 0, 0, 0.4) 0%,
				rgba(0, 0, 0, 0) 16%,
				rgba(0, 0, 0, 0) 84%,
				rgba(0, 0, 0, 0.4) 100%
			);
		box-shadow: inset 0 0 calc(var(--cell) * 0.14) rgba(0, 0, 0, 0.65);
	}
	/* The multiplier is set the way Pirate Plinko sets the win value on its congratulations screen: the
	   AustereBlackCapsSSK face, a golden-brown stroke layer carrying the outline, glow and shadows,
	   and a near-white fill laid over it. Offsets are in em so they scale with the reel. */
	.cell.mult {
		display: inline-grid;
		place-items: center;
		background: linear-gradient(180deg, #c9a173 0%, #9a6f42 100%);
		font-family: 'AustereBlackCapsSSK', 'Arial Black', sans-serif;
		font-size: calc(var(--cell) * 0.54);
		line-height: 1.1;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		filter: drop-shadow(0.034em 0.068em 0 #000);
	}
	.mult-stroke,
	.mult-fill {
		grid-area: 1 / 1;
		/* trailing letter-spacing pushes the glyphs left of centre — pad the start to re-centre. */
		padding-left: 0.06em;
	}
	.mult-stroke {
		color: transparent;
		-webkit-text-stroke: 0.09em #6d460f;
		paint-order: stroke fill;
		text-shadow:
			0 0.05em 0 #6d460f,
			0.015em 0.09em 0.04em rgba(0, 0, 0, 0.6),
			0 0 0.42em rgba(255, 196, 62, 0.75),
			0 0 0.95em rgba(255, 178, 44, 0.45);
	}
	.mult-fill {
		color: #e9e4e4;
	}
	/* The multiplier it stopped on glows like the icon beside it. */
	.cell.mult.landed {
		filter: drop-shadow(0.034em 0.068em 0 #000) drop-shadow(0 0 0.14em rgba(255, 226, 120, 0.9));
	}
	/* A miss is a plate of its own — the same brown, with nothing on it — rather than a gap between
	   two others, so the reel always shows one whole slot in the window. */
	.cell.mult.blank {
		background: linear-gradient(180deg, #c9a173 0%, #9a6f42 100%);
	}
	.applied .frame-art {
		filter: drop-shadow(0 0 1vw #ffe14d) drop-shadow(0 0.3vw 0.8vw rgba(0, 0, 0, 0.6));
		animation: ts-pulse 900ms ease-in-out infinite alternate;
	}
	@keyframes ts-pulse {
		from {
			filter: brightness(1);
		}
		to {
			filter: brightness(1.35);
		}
	}
</style>
