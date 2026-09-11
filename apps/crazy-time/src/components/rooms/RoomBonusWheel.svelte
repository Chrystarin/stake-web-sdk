<script lang="ts">
	/**
	 * Bonus Wheel room: the generic wheel with 36 multiplier wedges, spun to the authored wedge.
	 *
	 * The player starts it. Nothing about the outcome is theirs — the wedge is the book's, and the
	 * countdown spins it for them if they sit on their hands — but a wheel that goes off on its own
	 * is a wheel that happened TO them, and the whole point of the room is the pull of the handle.
	 */
	import Wheel, { type WheelSegment, type WheelFrame } from '../Wheel.svelte';
	import { PICK_SECONDS } from '../../game/constants';
	import type { BookEventBonusWheel } from '../../game/typesBookEvent';
	import { playSound } from '../../game/sound';
	import { staticUrl } from '../../lib/staticUrl';
	import { finePointer } from '../../lib/pointer.svelte';
	import { waitForTimeout } from 'utils-shared/wait';
	import RoomHint from './RoomHint.svelte';

	/**
	 * The gilded ring art (static/img/bonus-wheel/frame.png, 1971x2109), gem pointer at 12 o'clock,
	 * carrying the same ship's-wheel hub as the main wheel's frame. `hole` is least-squares fitted to
	 * the ring's inner edge over the clean stretches of wood: centre (985.8, 1115.5) px, radius
	 * 752.0 px (residual ~1.2 px). The rope wraps, the side plates and the two gem pointers all reach
	 * further in than that — the deepest of them starts at 774 px — so the wedges overscan to 782 px
	 * (4%) and finish underneath the art instead of leaving a black crescent anywhere on the rim.
	 */
	const FRAME: WheelFrame = {
		src: staticUrl('img/bonus-wheel/frame.png'),
		aspect: 1971 / 2109,
		hole: { cx: 985.8 / 1971, cy: 1115.5 / 2109, r: 752.0 / 1971 },
		overscan: 0.04,
		// A good deal of this frame hangs over the disc: at 733 px the art still covers 270° of the
		// circle — 27 wedges of 36 — because of the rope wraps and the side plates, and the two gem
		// pointers carry on past those. The top one, the marker a spin is read against, bottoms out
		// at 681.5 px, so a multiplier that starts inside that is clear of everything but the tip of
		// the bottom gem, which only ever covers the wedge nobody is reading.
		overhang: 681.5 / 1971,
	};
	// The hub art ends at r ~= 290 px, which is 70.5 of the disc's 190 units at this scale; the
	// multiplier runs stop their ink just clear of it. The wedges themselves run to the centre
	// (innerRadius 0) so the hub covers solid colour rather than a hole.
	const HUB_R = 71;
	/** The hub art's own width, as a fraction of the frame box: what the glow is drawn around. */
	const HUB_WIDTH = (2 * 290) / 1971;

	type Props = {
		room: BookEventBonusWheel;
		/** False when the player was not in this bonus: it is a tease, so it plays itself. */
		interactive?: boolean;
	};
	let { room, interactive = true }: Props = $props();

	// Keyed by the wedge's base value (before the Top Slot) — one entry per value in WHEEL_TABLE.
	const PALETTE: Record<number, [string, string]> = {
		10: ['#3d7ab8', '#e6f3ff'],
		15: ['#c9a227', '#fff6d6'],
		20: ['#8b4fa6', '#f4e6ff'],
		25: ['#c75a2a', '#ffe9dd'],
		50: ['#2e9e8a', '#dffff8'],
		100: ['#d96aa0', '#ffe4f1'],
		1000: ['#e23d3d', '#ffe3e3'],
	};
	const colourFor = (value: number): [string, string] => {
		const base = room.topSlotMultiplier > 1 ? value / room.topSlotMultiplier : value;
		return PALETTE[base] ?? ['#555', '#fff'];
	};

	const segments: WheelSegment[] = $derived(
		room.wedges.map((value) => {
			const [fill, text] = colourFor(value);
			// Written the way the table writes every other multiplier — `x50`, not `50x`.
			return { label: `x${value}`, fill, text, kind: 'value' as const };
		}),
	);

	let wheel: Wheel | undefined = $state();
	let highlight = $state<number | null>(null);

	/**
	 * The clock the player is spinning against, as one span rather than as a count of ticks.
	 *
	 * It used to be a `setInterval` printing the seconds under the hub. The instruction now IS the
	 * clock — `RoomHint` drains the words over exactly this long, the way Pirate Plinko's shot clock runs
	 * across its aiming hint — so nothing needs the number, and a single timeout cannot drift away
	 * from the drain the way a run of ticks could.
	 */
	const SPIN_MS = PICK_SECONDS * 1000;

	/**
	 * What to tell the player, which is not the same instruction on the two kinds of device — the
	 * same split Pirate Plinko makes, asked of pointer capability rather than of screen width. Broken into
	 * lines here because each line drains on a clock of its own.
	 */
	const HINT_FINE = ['Click the wheel', 'to spin it'];
	const HINT_COARSE = ['Tap the wheel', 'to spin it'];
	const hintLines = $derived(finePointer() ? HINT_FINE : HINT_COARSE);

	let waiting = $state(false);
	let clock: ReturnType<typeof setTimeout> | undefined;
	let release: (() => void) | null = null;

	/**
	 * Let go of the wheel — from the player's press, or from the clock running out on them. Guarded
	 * on `release` rather than on `waiting`, so the pointer and the keyboard both landing on the
	 * same press start one spin.
	 */
	const start = () => {
		if (!release) return;
		clearTimeout(clock);
		waiting = false;
		const go = release;
		release = null;
		go();
	};

	export const play = async (): Promise<number> => {
		if (interactive) {
			waiting = true;
			await new Promise<void>((resolve) => {
				release = resolve;
				clock = setTimeout(start, SPIN_MS);
			});
		} else {
			await waitForTimeout(900);
		}
		await wheel?.spinTo(room.wedge, { turns: 4, ms: 3800 });
		highlight = room.wedge;
		playSound('merge');
		return room.total;
	};
</script>

<div class="jackpot">
	<Wheel
		bind:this={wheel}
		{segments}
		frame={FRAME}
		innerRadius={0}
		hubRadius={HUB_R}
		{highlight}
		onTick={() => playSound('peg', 1.6)}
	/>
	{#if waiting}
		<!-- The whole wheel is the button, not the hub: this is a thumb on a phone, and a target the
		     size of the ship's wheel is a target that gets missed. The glow is drawn on the hub all
		     the same, since that is where a wheel is grabbed. `pointerdown` so a touch fires on
		     contact rather than on release; `click` is what Enter and Space arrive as. -->
		<button class="start" onpointerdown={start} onclick={start} aria-label="Spin the Bonus Wheel">
			<span
				class="hub-glow"
				style="left:{FRAME.hole.cx * 100}%; top:{FRAME.hole.cy * 100}%; width:{HUB_WIDTH * 100}%"
			></span>
			<!-- The instruction and the clock, in the game's one voice — see `RoomHint`. The words drain
			     over `SPIN_MS`, so the wheel going off on its own is something the player watched
			     coming rather than something that happened to them. Sized off the wheel's own width,
			     which is what carries it up to a phone: the wheel is 44.5vw across in landscape and the
			     whole viewport in portrait, and this rides that without a second rule. -->
			<span class="cta" style="left:{FRAME.hole.cx * 100}%; top:{FRAME.hole.cy * 100}%">
				<RoomHint
					lines={hintLines}
					durationMs={SPIN_MS}
					size="calc(var(--wheel-w, 44.5vw) * 0.058)"
				/>
			</span>
		</button>
	{/if}
</div>

<style>
	.jackpot {
		/*
		 * The same width the base game's wheel is fitted to (`--wheel-w`, set on `.game`), so the
		 * bonus wheel arrives at the size the one it came from just left — anything smaller reads
		 * as a lesser wheel. This art is taller than the main frame for the same width, so the box
		 * runs past the stage at both ends; the sign draws over the top of it, and the footer's
		 * multiplier sits on the bottom of the ring rather than under it.
		 */
		width: var(--wheel-w, 44.5vw);
		/*
		 * Centring the BOX leaves the wheel looking low, because the hole is not in the middle of
		 * the art: its centre sits at 0.529 of the height, the bottom pointer being the heavier of
		 * the two. Half of this margin is what the flex row takes off the top, so the DISC ends up
		 * centred instead — which also lifts the frame's bottom gem clear of the screen's edge on a
		 * short viewport, where the box is taller than the stage between the sign and the footer.
		 */
		margin-bottom: calc(var(--wheel-w, 44.5vw) * 0.062);
		position: relative;
	}
	.start {
		position: absolute;
		inset: 0;
		border: none;
		background: none;
		padding: 0;
		cursor: pointer;
	}
	/* Around the hub art, not on it: the skull is the nicest thing on the frame and a halo behind it
	   says "press" without putting anything over it. */
	.hub-glow {
		position: absolute;
		translate: -50% -50%;
		aspect-ratio: 1;
		border-radius: 50%;
		animation: hub-pulse 1.7s ease-in-out infinite;
	}
	@keyframes hub-pulse {
		0%,
		100% {
			box-shadow: 0 0 0.6vw 0.1vw rgba(255, 225, 77, 0.35);
		}
		50% {
			box-shadow: 0 0 1.4vw 0.35vw rgba(255, 225, 77, 0.7);
		}
	}
	.start:hover .hub-glow {
		animation: none;
		box-shadow: 0 0 1.6vw 0.45vw rgba(255, 225, 77, 0.75);
	}
	.start:active .hub-glow {
		scale: 0.96;
	}
	/* Under the hub rather than across it, on the band of colour the multipliers stop short of.
	   Only a place now: the writing itself is `RoomHint`'s, which is what put this room in the same
	   voice as the other three. */
	.cta {
		position: absolute;
		translate: -50% 0;
		margin-top: calc(var(--wheel-w, 44.5vw) * 0.085);
		display: block;
		white-space: nowrap;
	}
</style>
