<script lang="ts">
	/**
	 * The Top Slot: two reels above the wheel. The left reel picks a spot, the right a multiplier
	 * (or a blank gap, the "miss"). Both land where the book says; nothing is decided here.
	 *
	 * Each reel is a strip repeated a few times so the stop can always be approached by scrolling
	 * DOWN through several copies, then the strip is silently reset to the equivalent position in
	 * the first copy once the transition has ended.
	 */
	import {
		isRoomSpot,
		NUMBER_PAY,
		SPOTS,
		SPOT_COLOUR,
		SPOT_LABEL,
		TOP_SLOT_MULTS,
		type Spot,
	} from '../game/constants';
	import { staticUrl } from '../lib/staticUrl';

	type Props = {
		/** Glow the pair: the wheel landed on the spot the Top Slot picked. */
		applied?: boolean;
	};
	let { applied = false }: Props = $props();

	const COPIES = 4;
	const SPIN_MS = 2300;

	// A number reads as its wheel badge alone; a bonus as the bonus crest plus its name, so a reel
	// says the same thing the wedge does.
	const spotItems = SPOTS.map((spot) => ({
		key: spot,
		label: isRoomSpot(spot) ? SPOT_LABEL[spot].split(' ')[0] : '',
		icon: isRoomSpot(spot)
			? staticUrl('img/wheel/bonus.png')
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
	export const multRect = (): DOMRect | undefined => multReelEl?.getBoundingClientRect();

	let spotIndex = $state(0);
	let multIndex = $state(1);
	let animating = $state(false);
	let spotOffset = $state(0); // in items, within the repeated strip
	let multOffset = $state(1);

	const strip = <T,>(items: T[]) => Array.from({ length: COPIES }, () => items).flat();
	const spotStrip = strip(spotItems);
	const multStrip = strip(multItems);

	const targetSpotIndex = (spot: Spot | null) => (spot ? SPOTS.indexOf(spot) : 0);
	const targetMultIndex = (m: number | null) => {
		if (m === null) return multItems.findIndex((item) => item.blank); // first blank
		return multItems.findIndex((item) => item.key === `m${m}`);
	};

	/** Spin both reels to the authored pair. Resolves when they have stopped. */
	export const spin = (spot: Spot | null, multiplier: number | null): Promise<void> => {
		const s = targetSpotIndex(spot);
		const m = targetMultIndex(multiplier);
		// From the current position in copy 0, travel through the copies to the target in the last.
		const sTarget = (COPIES - 1) * spotItems.length + s;
		const mTarget = (COPIES - 1) * multItems.length + m;
		return new Promise((resolve) => {
			animating = true;
			requestAnimationFrame(() => {
				requestAnimationFrame(() => {
					spotOffset = sTarget;
					multOffset = mTarget;
				});
			});
			setTimeout(() => {
				animating = false;
				// Snap back to the equivalent slot in copy 0 without a transition.
				spotOffset = s;
				multOffset = m;
				spotIndex = s;
				multIndex = m;
				resolve();
			}, SPIN_MS + 60);
		});
	};
</script>

<div class="topslot" class:applied class:animating>
	<div class="cabinet">
		<div class="reel spot-reel">
			<div class="strip" style="--offset:{spotOffset}; --ms:{SPIN_MS}ms">
				{#each spotStrip as item, i (i)}
					<div class="cell" style="--fill:{item.fill}; --text:{item.text}">
						<img class="badge" src={item.icon} alt="" draggable="false" />
						{#if item.label}<span class="spot-lbl">{item.label}</span>{/if}
					</div>
				{/each}
			</div>
		</div>
		<div class="reel mult-reel" bind:this={multReelEl}>
			<div class="strip" style="--offset:{multOffset}; --ms:{SPIN_MS}ms">
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
		<div class="window" aria-hidden="true"></div>
	</div>
</div>

<style>
	.topslot {
		/* The game sets these in portrait, where the cabinet has a whole viewport width to fill. */
		--cell: var(--ts-cell, 3.4vw);
		display: flex;
		flex-direction: column;
		align-items: center;
	}
	.cabinet {
		position: relative;
		display: flex;
		gap: 0.3vw;
		padding: 0.35vw;
		border-radius: 0.7vw;
		background: linear-gradient(180deg, #3b2412 0%, #1d1008 100%);
		border: 0.15vw solid #f0c65a;
		box-shadow: 0 0.4vw 1vw rgba(0, 0, 0, 0.6);
	}
	/* Both reels are the same width: the pair reads as one cabinet, and the left one has to hold a
	   crest and a name without crowding. */
	.reel {
		width: var(--ts-reel, 9vw);
		height: var(--cell);
		overflow: hidden;
		border-radius: 0.4vw;
		background: #0d0906;
	}
	.strip {
		display: flex;
		flex-direction: column;
		transform: translateY(calc(var(--offset) * var(--cell) * -1));
	}
	.animating .strip {
		/* Most of the travel happens early; the last stretch crawls into place. */
		transition: transform var(--ms) cubic-bezier(0.1, 0.62, 0.02, 1);
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
		align-items: center;
		justify-content: center;
		gap: 0.35vw;
		color: var(--text, #fff);
		background: var(--fill, #222);
		border-bottom: 0.05vw solid rgba(0, 0, 0, 0.4);
	}
	.badge {
		height: var(--ts-badge, 2.3vw);
		width: auto;
		filter: drop-shadow(0 0.1vw 0.2vw rgba(0, 0, 0, 0.5));
	}
	/* The bonus name in the bet board's own hand. */
	.spot-lbl {
		font-family: 'PiecesOfEight', 'Alexandria', sans-serif;
		font-weight: 400;
		font-size: var(--ts-label, 0.95vw);
		letter-spacing: 0.04vw;
		white-space: nowrap;
		paint-order: stroke;
		-webkit-text-stroke: 0.1vw rgba(0, 0, 0, 0.55);
	}
	/* The multiplier is set the way Plinko sets the win value on its congratulations screen: the
	   AustereBlackCapsSSK face, a golden-brown stroke layer carrying the outline, glow and shadows,
	   and a near-white fill laid over it. Offsets are in em so they scale with the reel. */
	.cell.mult {
		display: inline-grid;
		place-items: center;
		background: linear-gradient(180deg, #2a1a0c 0%, #140c06 100%);
		font-family: 'AustereBlackCapsSSK', 'Arial Black', sans-serif;
		font-size: var(--ts-mult, 1.9vw);
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
	.cell.mult.blank {
		background: #1a120b;
	}
	.window {
		position: absolute;
		inset: 0.35vw;
		border-radius: 0.4vw;
		box-shadow: inset 0 0 0.6vw rgba(0, 0, 0, 0.75);
		pointer-events: none;
	}
	.applied .cabinet {
		box-shadow:
			0 0 1.2vw #ffe14d,
			0 0.4vw 1vw rgba(0, 0, 0, 0.6);
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
