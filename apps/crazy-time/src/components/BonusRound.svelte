<script lang="ts">
	/**
	 * The bonus screen. Comes down over the table when the wheel lands on a room, plays the room
	 * out, shows what it paid, and lifts. The book's awaited `bonusRound` broadcast resolves when
	 * this is done, so the round waits for the room.
	 *
	 * A room the player was NOT in still plays (the tease is the point), with a banner saying so
	 * and no win line.
	 */
	import { tick } from 'svelte';
	import { waitForTimeout } from 'utils-shared/wait';

	import { getContext } from '../game/context';
	import { SPOT_LABEL, SPOT_COLOUR, type Spot } from '../game/constants';
	import type { BookEventRoom } from '../game/typesBookEvent';
	import { playSound } from '../game/sound';

	import RoomPlinko from './rooms/RoomPlinko.svelte';
	import RoomWheel from './rooms/RoomWheel.svelte';
	import RoomChest from './rooms/RoomChest.svelte';
	import RoomTower from './rooms/RoomTower.svelte';

	type Props = {
		/** Cash value of one chip, for the win line. */
		chip: number;
		sign: string;
		/** True for the whole time the screen is up. */
		onOpenChange?: (open: boolean) => void;
	};
	let { chip, sign, onOpenChange }: Props = $props();

	const context = getContext();

	let current = $state<{ room: BookEventRoom; covered: boolean } | null>(null);
	let closing = $state(false);
	let result = $state<number | null>(null);
	let roomApi = $state<{ play: () => Promise<number> } | undefined>();

	const spotFor = (room: BookEventRoom): Spot =>
		room.type === 'plinkoBonus'
			? 'plinko'
			: room.type === 'wheelBonus'
				? 'wheel'
				: room.type === 'chestBonus'
					? 'chest'
					: 'tower';

	const fmt = (value: number) =>
		value >= 1000 ? `${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)}k` : value.toFixed(2);

	context.eventEmitter.subscribeOnMount({
		bonusRound: async (event) => {
			onOpenChange?.(true);
			result = null;
			closing = false;
			current = { room: event.room, covered: event.covered };
			playSound('doorClose');
			await tick();
			await waitForTimeout(700); // screen slide-in
			try {
				result = (await roomApi?.play()) ?? event.room.total;
				await waitForTimeout(event.covered ? 2200 : 1400);
			} finally {
				closing = true;
				playSound('doorOpen');
				await waitForTimeout(450);
				current = null;
				closing = false;
				onOpenChange?.(false);
			}
		},
	});
</script>

{#if current}
	{@const spot = spotFor(current.room)}
	{@const colour = SPOT_COLOUR[spot]}
	<div class="screen" class:closing style="--room-base:{colour.base}; --room-deep:{colour.deep}">
		<div class="header">
			<div class="title">{SPOT_LABEL[spot]}</div>
			{#if current.room.topSlotMultiplier > 1}
				<div class="ts">TOP SLOT x{current.room.topSlotMultiplier} · all values multiplied</div>
			{/if}
			{#if !current.covered}
				<div class="not-in">You were not in this bonus</div>
			{/if}
		</div>

		<div class="stage">
			{#if current.room.type === 'plinkoBonus'}
				<RoomPlinko bind:this={roomApi} room={current.room} />
			{:else if current.room.type === 'wheelBonus'}
				<RoomWheel bind:this={roomApi} room={current.room} />
			{:else if current.room.type === 'chestBonus'}
				<RoomChest bind:this={roomApi} room={current.room} interactive={current.covered} />
			{:else}
				<RoomTower bind:this={roomApi} room={current.room} />
			{/if}
		</div>

		<div class="footer" class:shown={result !== null}>
			{#if result !== null}
				<div class="mult">x{result}</div>
				{#if current.covered}
					<div class="cash">WIN {sign}{fmt(result * chip)}</div>
				{:else}
					<div class="cash muted">would have paid {sign}{fmt(result * chip)} per chip</div>
				{/if}
			{/if}
		</div>
	</div>
{/if}

<style>
	.screen {
		position: absolute;
		inset: 0;
		z-index: 30;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: space-between;
		padding: 1.2vw 2vw 1.4vw;
		background:
			radial-gradient(ellipse at 50% 30%, color-mix(in srgb, var(--room-base) 55%, transparent) 0%, transparent 60%),
			linear-gradient(180deg, #120a18 0%, #05030a 100%);
		animation: screen-in 650ms cubic-bezier(0.2, 0.9, 0.2, 1) both;
	}
	.screen.closing {
		animation: screen-out 450ms ease-in both;
	}
	@keyframes screen-in {
		from {
			transform: translateY(-100%);
		}
		to {
			transform: translateY(0);
		}
	}
	@keyframes screen-out {
		from {
			transform: translateY(0);
			opacity: 1;
		}
		to {
			transform: translateY(-100%);
			opacity: 0.6;
		}
	}
	.header {
		text-align: center;
		font-family: 'Alexandria', sans-serif;
	}
	.title {
		font-size: 2.2vw;
		font-weight: 700;
		letter-spacing: 0.15vw;
		color: #ffe14d;
		text-shadow: 0 0.2vw 0.6vw rgba(0, 0, 0, 0.8);
	}
	.ts {
		margin-top: 0.2vw;
		font-size: 0.9vw;
		color: #fff;
		background: linear-gradient(180deg, #ffe89a, #f0b429);
		color: #4a2c00;
		display: inline-block;
		padding: 0.15vw 0.8vw;
		border-radius: 1vw;
		font-weight: 700;
	}
	.not-in {
		margin-top: 0.3vw;
		font-size: 0.9vw;
		color: #d6c6b4;
	}
	.stage {
		display: flex;
		align-items: center;
		justify-content: center;
		flex: 1;
		min-height: 0;
	}
	.footer {
		height: 4.6vw;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		font-family: 'Alexandria', sans-serif;
		opacity: 0;
		transition: opacity 300ms ease;
	}
	.footer.shown {
		opacity: 1;
	}
	.mult {
		font-size: 2.6vw;
		font-weight: 700;
		color: #ffe14d;
		line-height: 1;
		text-shadow: 0 0.2vw 0.6vw rgba(0, 0, 0, 0.8);
	}
	.cash {
		font-size: 1.1vw;
		font-weight: 600;
		color: #fff;
	}
	.cash.muted {
		color: #9aa3b4;
		font-weight: 400;
	}
</style>
