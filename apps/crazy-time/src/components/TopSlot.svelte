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
		isRoomSpot,
		NUMBER_PAY,
		ROOM_ICON,
		SPOTS,
		SPOT_COLOUR,
		SPOT_LABEL,
		TOP_SLOT_MULTS,
		type Spot,
	} from '../game/constants';
	import { staticUrl } from '../lib/staticUrl';

	/**
	 * The cabinet art (static/img/top-slots/frame.png, 1774x887). Its two windows were read off the
	 * alpha channel — left x 145..838, right x 932..1624, both y 334..768 — and the percentages below
	 * are those bounds over the image box, so the reels sit exactly in the openings. The opening's
	 * height works out at 0.2452 of the frame's WIDTH, which is where `--cell` comes from.
	 */
	const FRAME_ART = staticUrl('img/top-slots/frame.png');

	type Props = {
		/** Glow the pair: the wheel landed on the spot the Top Slot picked. */
		applied?: boolean;
		/** Fired whenever a cell passes a reel's window, on either reel — the wheel's peg tick. */
		onTick?: () => void;
		/** Fired as each reel comes to rest — twice a spin, a couple of seconds apart. */
		onReelStop?: () => void;
		/** Run the reels at a fraction of their length — see `isForcedRound`. */
		hurry?: boolean;
	};
	let { applied = false, onTick, onReelStop, hurry = false }: Props = $props();

	/** Copies of the strip to travel through. Enough that the right reel, which runs longest at the
	 *  shared rate, always finds a copy far enough away to land on. */
	const COPIES = 10;
	/** How long the left reel runs. The right one runs longer, so it lands after it. */
	const SPIN_MS = 2200;
	const MULT_EXTRA_MS = 2000;
	/** Both cut right down for a forced round — see `isForcedRound`. */
	const spinMs = $derived(hurry ? 460 : SPIN_MS);
	const multExtraMs = $derived(hurry ? 300 : MULT_EXTRA_MS);

	// A number reads as its wheel badge alone; a bonus as the room's own icon plus its name, so a
	// reel says the same thing the wedge does.
	const spotItems = SPOTS.map((spot) => ({
		key: spot,
		label: isRoomSpot(spot) ? SPOT_LABEL[spot] : '',
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

	let spotIndex = $state(0);
	let multIndex = $state(1);
	let animating = $state(false);
	let spotOffset = $state(0); // in items, within the repeated strip
	let multOffset = $state(1);
	/** Set per spin: the right reel travels further because it runs longer at the same rate. */
	/** The right reel's own run, set when a spin starts. Seeded at full length: nothing is moving
	 *  before the first spin, so the seed only has to be a sane number. */
	let multMs = $state(SPIN_MS + MULT_EXTRA_MS);

	onDestroy(() => cancelAnimationFrame(raf));

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

		const rate = (sTarget - spotOffset) / spinMs; // cells per ms, shared by both reels
		multMs = spinMs + multExtraMs;
		const wanted = rate * multMs;
		let mTarget = multItems.length + m;
		for (let copy = 1; copy < COPIES; copy++) {
			const candidate = copy * multItems.length + m;
			if (Math.abs(candidate - multOffset - wanted) < Math.abs(mTarget - multOffset - wanted)) {
				mTarget = candidate;
			}
		}

		return new Promise((resolve) => {
			animating = true;
			lastCell = [spotOffset, multOffset];
			cancelAnimationFrame(raf);
			raf = requestAnimationFrame(track);
			// Each reel says so as it lands; the second one is still running when the first does.
			setTimeout(() => onReelStop?.(), spinMs);
			setTimeout(() => onReelStop?.(), multMs);
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
		<img class="frame-art" src={FRAME_ART} alt="" draggable="false" />
		<div class="reel spot-reel">
			<div class="strip" bind:this={spotStripEl} style="--offset:{spotOffset}; --ms:{spinMs}ms">
				{#each spotStrip as item, i (i)}
					<div class="cell" style="--fill:{item.fill}; --text:{item.text}">
						<img
							class="badge"
							class:crest={Boolean(item.label)}
							src={item.icon}
							alt=""
							draggable="false"
						/>
						{#if item.label}<span class="spot-lbl">{item.label}</span>{/if}
					</div>
				{/each}
			</div>
		</div>
		<div class="reel mult-reel" bind:this={multReelEl}>
			<div class="strip" bind:this={multStripEl} style="--offset:{multOffset}; --ms:{multMs}ms">
				{#each multStrip as item, i (i)}
					<div class="cell mult" class:blank={item.blank}>
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
	}
	/* A number badge has the window to itself; a bonus shares it with its name, so the crest is set
	   smaller and the pair is sized to clear the frame's opening rather than run under the wood. */
	.crest {
		height: calc(var(--cell) * 0.42);
	}
	/* The bonus name in the bet board's own hand. */
	.spot-lbl {
		font-family: 'PiecesOfEight', 'Alexandria', sans-serif;
		font-weight: 400;
		font-size: calc(var(--cell) * 0.145);
		letter-spacing: calc(var(--cell) * 0.008);
		line-height: 1.05;
		text-align: center;
		/* The window is narrower than a tile, so a two-word name wraps rather than shrinking to fit. */
		white-space: normal;
		paint-order: stroke;
		-webkit-text-stroke: 0.1vw rgba(0, 0, 0, 0.55);
	}
	/* The multiplier is set the way Plinko sets the win value on its congratulations screen: the
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
