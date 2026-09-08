<script lang="ts">
	/** Lucky Wheel room: the generic wheel with 36 multiplier wedges, spun to the authored wedge. */
	import Wheel, { type WheelSegment } from '../Wheel.svelte';
	import type { BookEventWheelBonus } from '../../game/typesBookEvent';
	import { playSound } from '../../game/sound';

	type Props = { room: BookEventWheelBonus };
	let { room }: Props = $props();

	const PALETTE: Record<number, [string, string]> = {
		2: ['#3d7ab8', '#e6f3ff'],
		3: ['#c9a227', '#fff6d6'],
		5: ['#8b4fa6', '#f4e6ff'],
		10: ['#c75a2a', '#ffe9dd'],
		20: ['#2e9e8a', '#dffff8'],
		50: ['#d96aa0', '#ffe4f1'],
		100: ['#5da34a', '#e8ffe0'],
		200: ['#e23d3d', '#ffe3e3'],
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

<div class="lucky">
	<Wheel bind:this={wheel} {segments} {highlight} hub="LUCKY" onTick={() => playSound('peg', 1.6)} />
</div>

<style>
	.lucky {
		width: 26vw;
	}
</style>
