<script lang="ts">
	/**
	 * Dragon Tower room: ten floors of four tiles. The climb plays out floor by floor along the
	 * authored path; the floor it ends on pays. A dragon on the next floor ends the climb early,
	 * reaching the top pays the top multiplier.
	 */
	import type { BookEventTowerBonus } from '../../game/typesBookEvent';
	import { playSound } from '../../game/sound';
	import { waitForTimeout } from 'utils-shared/wait';

	type Props = { room: BookEventTowerBonus };
	let { room }: Props = $props();

	const floors = $derived(room.floors.length);
	let reached = $state(0); // floors revealed so far
	let dragonShown = $state(false);

	export const play = async (): Promise<number> => {
		for (let f = 0; f < room.climbed; f++) {
			await waitForTimeout(f === 0 ? 500 : 380);
			reached = f + 1;
			playSound('pop', 1 + f * 0.04);
		}
		await waitForTimeout(500);
		if (room.dragonTile !== null) {
			dragonShown = true;
			playSound('doorClose');
		} else {
			playSound('win');
		}
		await waitForTimeout(900);
		return room.total;
	};

	const tileState = (floor: number, tile: number): 'safe' | 'dragon' | 'hidden' => {
		if (floor < reached && room.path[floor] === tile) return 'safe';
		if (dragonShown && floor === room.climbed && room.dragonTile === tile) return 'dragon';
		return 'hidden';
	};
</script>

<div class="tower" style="--floors:{floors}">
	{#each Array.from({ length: floors }, (_, i) => floors - 1 - i) as floor (floor)}
		<div class="floor" class:current={reached === floor + 1} class:reached={floor < reached}>
			<div class="mult">{room.floors[floor]}x</div>
			<div class="tiles">
				{#each Array.from({ length: room.tilesPerFloor }, (_, t) => t) as tile (tile)}
					{@const state = tileState(floor, tile)}
					<div class="tile {state}"></div>
				{/each}
			</div>
		</div>
	{/each}
	<div class="caption">
		{#if dragonShown}
			The dragon woke on floor {room.climbed + 1}. You keep floor {room.climbed}: <b>{room.total}x</b>
		{:else if reached >= floors}
			Top of the tower! <b>{room.total}x</b>
		{:else}
			Climbing…
		{/if}
	</div>
</div>

<style>
	.tower {
		display: flex;
		flex-direction: column;
		gap: 0.18vw;
		width: 22vw;
	}
	.floor {
		display: flex;
		align-items: center;
		gap: 0.5vw;
		padding: 0.12vw 0.4vw;
		border-radius: 0.3vw;
		background: rgba(60, 20, 20, 0.55);
		transition: background 250ms ease;
	}
	.floor.reached {
		background: rgba(120, 40, 30, 0.75);
	}
	.floor.current {
		background: rgba(200, 80, 40, 0.85);
		box-shadow: 0 0 0.6vw rgba(255, 180, 80, 0.7);
	}
	.mult {
		width: 3vw;
		font-family: 'Alexandria', sans-serif;
		font-weight: 700;
		font-size: 0.85vw;
		color: #ffd27a;
		text-align: right;
	}
	.tiles {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 0.25vw;
		flex: 1;
	}
	.tile {
		height: 1.55vw;
		border-radius: 0.25vw;
		background: linear-gradient(180deg, #6b3b2a, #3e2118);
		border: 0.06vw solid rgba(255, 200, 120, 0.35);
		transition: background 250ms ease, transform 250ms ease;
	}
	.tile.safe {
		background: radial-gradient(circle at 50% 40%, #fff7d6 0%, #f4c542 40%, #b8860b 100%);
		transform: scale(1.06);
	}
	.tile.dragon {
		background: radial-gradient(circle at 50% 45%, #ff9a5a 0%, #d43a1e 45%, #6b0d05 100%);
		animation: dragon-in 500ms cubic-bezier(0.3, 1.5, 0.5, 1) both;
	}
	@keyframes dragon-in {
		from {
			transform: scale(0.3);
		}
		to {
			transform: scale(1.1);
		}
	}
	.caption {
		margin-top: 0.4vw;
		text-align: center;
		font-family: 'Alexandria', sans-serif;
		font-size: 1vw;
		color: #ffe9b0;
	}
	.caption b {
		color: #ffe14d;
	}
</style>
