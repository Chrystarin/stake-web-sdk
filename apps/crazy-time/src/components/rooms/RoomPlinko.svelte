<script lang="ts">
	/**
	 * Plinko room, prototype grade: a pegged board drawn in CSS and a ball animated with the Web
	 * Animations API from the authored drop zone to the authored slot. The bounces are decoration;
	 * the slot is the book's.
	 */
	import { PLINKO_ROWS } from '../../game/constants';
	import type { BookEventPlinkoBonus } from '../../game/typesBookEvent';
	import { playSound } from '../../game/sound';

	type Props = { room: BookEventPlinkoBonus };
	let { room }: Props = $props();

	const cols = $derived(room.board.length); // 13
	let ballEl: HTMLDivElement | undefined = $state();
	let boardEl: HTMLDivElement | undefined = $state();
	let landed = $state<number | null>(null);
	let ballShown = $state(false);

	/** x centre of slot `c` and y of row `r`, as fractions of the board box. */
	const slotX = (c: number) => (c + 0.5) / cols;
	const rowY = (r: number) => 0.06 + (r / PLINKO_ROWS) * 0.8;

	export const play = async (): Promise<number> => {
		if (!ballEl || !boardEl) return room.total;
		const box = boardEl.getBoundingClientRect();
		const from = Math.max(0, Math.min(cols - 1, room.dropZone));
		const to = room.slot;
		// One waypoint per row: drift from the drop column to the slot with an alternating kick
		// that dies out towards the bottom, so it reads as pinballing rather than sliding.
		const frames = [];
		for (let r = 0; r <= PLINKO_ROWS; r++) {
			const t = r / PLINKO_ROWS;
			const drift = from + (to - from) * t;
			const kick = r === 0 || r === PLINKO_ROWS ? 0 : (r % 2 === 0 ? 0.42 : -0.42) * (1 - t * 0.6);
			frames.push({
				transform: `translate(${slotX(drift + kick) * box.width}px, ${rowY(r) * box.height}px)`,
				offset: t,
				easing: 'cubic-bezier(0.4, 0, 0.6, 1)',
			});
		}
		frames.push({
			transform: `translate(${slotX(to) * box.width}px, ${0.93 * box.height}px)`,
			offset: 1,
		});
		ballShown = true;
		const ms = 2200;
		const anim = ballEl.animate(frames, { duration: ms, fill: 'forwards' });
		// A peg tick per row, pitched a little differently each time.
		for (let r = 1; r < PLINKO_ROWS; r++) {
			setTimeout(() => playSound('peg', 0.9 + Math.random() * 0.2), (ms * r) / PLINKO_ROWS);
		}
		await anim.finished.catch(() => undefined);
		landed = to;
		playSound('merge');
		return room.total;
	};
</script>

<div class="plinko">
	<div class="board" bind:this={boardEl}>
		{#each Array.from({ length: PLINKO_ROWS }, (_, r) => r) as r (r)}
			<div class="row" style="--y:{rowY(r) * 100}%">
				{#each Array.from({ length: cols - 1 }, (_, c) => c) as c (c)}
					<div class="peg" style="--x:{((c + 1) / cols) * 100}%"></div>
				{/each}
			</div>
		{/each}
		<div class="ball" class:shown={ballShown} bind:this={ballEl}></div>
	</div>
	<div class="slots" style="--cols:{cols}">
		{#each room.board as value, i (i)}
			<div class="slot" class:lit={landed === i} class:big={value >= 100}>{value}x</div>
		{/each}
	</div>
</div>

<style>
	.plinko {
		display: flex;
		flex-direction: column;
		width: 34vw;
	}
	.board {
		position: relative;
		height: 20vw;
		background: radial-gradient(ellipse at top, #4a2a6e 0%, #1c1030 70%);
		border-radius: 0.8vw 0.8vw 0 0;
		border: 0.12vw solid #9b6cff;
		border-bottom: none;
		overflow: hidden;
	}
	.row {
		position: absolute;
		top: var(--y);
		left: 0;
		right: 0;
	}
	.peg {
		position: absolute;
		left: var(--x);
		width: 0.55vw;
		height: 0.55vw;
		margin-left: -0.275vw;
		border-radius: 50%;
		background: radial-gradient(circle at 35% 35%, #fff, #b9b9d6 60%, #6d6d8f);
	}
	.ball {
		position: absolute;
		top: 0;
		left: 0;
		width: 1vw;
		height: 1vw;
		margin: -0.5vw 0 0 -0.5vw;
		border-radius: 50%;
		background: radial-gradient(circle at 35% 35%, #fff6c8, #ffc42e 55%, #b57200);
		box-shadow: 0 0.1vw 0.4vw rgba(0, 0, 0, 0.7);
		opacity: 0;
	}
	.ball.shown {
		opacity: 1;
	}
	.slots {
		display: grid;
		grid-template-columns: repeat(var(--cols), 1fr);
		gap: 0.15vw;
		padding: 0.25vw;
		background: #12091f;
		border: 0.12vw solid #9b6cff;
		border-top: none;
		border-radius: 0 0 0.8vw 0.8vw;
	}
	.slot {
		height: 2.4vw;
		display: flex;
		align-items: center;
		justify-content: center;
		font-family: 'Alexandria', sans-serif;
		font-size: 0.85vw;
		font-weight: 700;
		color: #fff;
		background: linear-gradient(180deg, #6a3fb0, #3f2470);
		border-radius: 0.3vw;
		transition: transform 200ms ease, filter 200ms ease;
	}
	.slot.big {
		background: linear-gradient(180deg, #ffbe3c, #c46b00);
		color: #3a2000;
	}
	.slot.lit {
		transform: scale(1.12);
		filter: brightness(1.4);
		box-shadow: 0 0 0.8vw #ffe14d;
	}
</style>
