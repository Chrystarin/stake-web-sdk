<script lang="ts">
	/** Jackpot Wheel room: the generic wheel with 36 multiplier wedges, spun to the authored wedge. */
	import Wheel, { type WheelSegment, type WheelFrame } from '../Wheel.svelte';
	import type { BookEventWheelBonus } from '../../game/typesBookEvent';
	import { playSound } from '../../game/sound';
	import { staticUrl } from '../../lib/staticUrl';

	/**
	 * The gilded ring art (static/img/jackpot-wheel/frame.png, 1971x2109), gem pointer at 12 o'clock,
	 * carrying the same ship's-wheel hub as the main wheel's frame. `hole` is least-squares fitted to
	 * the ring's inner edge over the clean stretches of wood: centre (985.8, 1115.5) px, radius
	 * 752.0 px (residual ~1.2 px). The rope wraps, the side plates and the two gem pointers all reach
	 * further in than that — the deepest of them starts at 774 px — so the wedges overscan to 782 px
	 * (4%) and finish underneath the art instead of leaving a black crescent anywhere on the rim.
	 */
	const FRAME: WheelFrame = {
		src: staticUrl('img/jackpot-wheel/frame.png'),
		aspect: 1971 / 2109,
		hole: { cx: 985.8 / 1971, cy: 1115.5 / 2109, r: 752.0 / 1971 },
		overscan: 0.04,
	};
	// The hub art ends at r ~= 290 px, which is 70.5 of the disc's 190 units at this scale; the
	// multiplier runs stop their ink just clear of it. The wedges themselves run to the centre
	// (innerRadius 0) so the hub covers solid colour rather than a hole.
	const HUB_R = 71;

	type Props = { room: BookEventWheelBonus };
	let { room }: Props = $props();

	// Keyed by the wedge's base value (before the Top Slot) — one entry per value in WHEEL_TABLE.
	const PALETTE: Record<number, [string, string]> = {
		10: ['#3d7ab8', '#e6f3ff'],
		15: ['#c9a227', '#fff6d6'],
		20: ['#8b4fa6', '#f4e6ff'],
		25: ['#c75a2a', '#ffe9dd'],
		50: ['#2e9e8a', '#dffff8'],
		100: ['#d96aa0', '#ffe4f1'],
		150: ['#5da34a', '#e8ffe0'],
		500: ['#e23d3d', '#ffe3e3'],
	};
	const colourFor = (value: number): [string, string] => {
		const base = room.topSlotMultiplier > 1 ? value / room.topSlotMultiplier : value;
		return PALETTE[base] ?? ['#555', '#fff'];
	};

	const segments: WheelSegment[] = $derived(
		room.wedges.map((value) => {
			const [fill, text] = colourFor(value);
			return { label: `${value}x`, fill, text, kind: 'value' as const };
		}),
	);

	let wheel: Wheel | undefined = $state();
	let highlight = $state<number | null>(null);

	export const play = async (): Promise<number> => {
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
	}
</style>
