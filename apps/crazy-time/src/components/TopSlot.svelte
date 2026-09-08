<script lang="ts">
	/**
	 * The Top Slot: two reels above the wheel. The left reel picks a spot, the right a multiplier
	 * (or a blank gap, the "miss"). Both land where the book says; nothing is decided here.
	 *
	 * Each reel is a strip repeated a few times so the stop can always be approached by scrolling
	 * DOWN through several copies, then the strip is silently reset to the equivalent position in
	 * the first copy once the transition has ended.
	 */
	import { SPOTS, SPOT_COLOUR, SPOT_LABEL, TOP_SLOT_MULTS, type Spot } from '../game/constants';

	type Props = {
		/** Glow the pair: the wheel landed on the spot the Top Slot picked. */
		applied?: boolean;
	};
	let { applied = false }: Props = $props();

	const COPIES = 4;
	const SPIN_MS = 1700;

	const spotItems = SPOTS.map((spot) => ({
		key: spot,
		label: SPOT_LABEL[spot].split(' ')[0],
		fill: SPOT_COLOUR[spot].base,
		text: SPOT_COLOUR[spot].text,
	}));
	// Multipliers interleaved with blanks: landing on a blank is the miss.
	const multItems = TOP_SLOT_MULTS.flatMap((m) => [
		{ key: `m${m}`, label: `${m}x`, blank: false },
		{ key: `b${m}`, label: '', blank: true },
	]);

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

	const current = $derived({
		spot: spotItems[spotIndex],
		mult: multItems[multIndex],
	});
</script>

<div class="topslot" class:applied class:animating>
	<div class="cabinet">
		<div class="reel spot-reel">
			<div class="strip" style="--offset:{spotOffset}; --ms:{SPIN_MS}ms">
				{#each spotStrip as item, i (i)}
					<div class="cell" style="--fill:{item.fill}; --text:{item.text}">{item.label}</div>
				{/each}
			</div>
		</div>
		<div class="reel mult-reel">
			<div class="strip" style="--offset:{multOffset}; --ms:{SPIN_MS}ms">
				{#each multStrip as item, i (i)}
					<div class="cell mult" class:blank={item.blank}>{item.label}</div>
				{/each}
			</div>
		</div>
		<div class="window" aria-hidden="true"></div>
	</div>
	<div class="caption">
		{#if applied}
			TOP SLOT HIT · {current.spot.label} {current.mult.label}
		{:else}
			TOP SLOT
		{/if}
	</div>
</div>

<style>
	.topslot {
		--cell: 2.6vw;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.25vw;
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
	.reel {
		width: 7vw;
		height: var(--cell);
		overflow: hidden;
		border-radius: 0.4vw;
		background: #0d0906;
	}
	.mult-reel {
		width: 4.6vw;
	}
	.strip {
		display: flex;
		flex-direction: column;
		transform: translateY(calc(var(--offset) * var(--cell) * -1));
	}
	.animating .strip {
		transition: transform var(--ms) cubic-bezier(0.15, 0.75, 0.12, 1);
	}
	.cell {
		height: var(--cell);
		display: flex;
		align-items: center;
		justify-content: center;
		font-family: 'Alexandria', sans-serif;
		font-weight: 700;
		font-size: 1.05vw;
		letter-spacing: 0.04vw;
		color: var(--text, #fff);
		background: var(--fill, #222);
		border-bottom: 0.05vw solid rgba(0, 0, 0, 0.4);
	}
	.cell.mult {
		background: linear-gradient(180deg, #ffe89a 0%, #f0b429 100%);
		color: #4a2c00;
		font-size: 1.25vw;
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
	.caption {
		font-family: 'Alexandria', sans-serif;
		font-size: 0.7vw;
		font-weight: 600;
		letter-spacing: 0.12vw;
		color: #d6c6b4;
		text-shadow: 0 0.1vw 0.3vw rgba(0, 0, 0, 0.8);
	}
	.applied .caption {
		color: #ffe14d;
	}
</style>
