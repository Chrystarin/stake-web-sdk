<script lang="ts">
	/**
	 * Ocean Voyage room: ten depths of four tiles. The dive plays out depth by depth along the
	 * authored path; the depth it ends on pays. A kraken at the next depth ends the dive early,
	 * clearing every depth pays the top multiplier.
	 */
	import type { BookEventOceanVoyage } from '../../game/typesBookEvent';
	import { playSound } from '../../game/sound';
	import { waitForTimeout } from 'utils-shared/wait';
	import RoomHint from './RoomHint.svelte';

	type Props = { room: BookEventOceanVoyage };
	let { room }: Props = $props();

	/**
	 * The caption, cut as a share of the dive column's own width — the same knob everything else in
	 * the room is drawn off (see `--voyage-w`), so it grows with the column on a tall screen instead
	 * of needing a portrait rule of its own.
	 */
	const HINT_SIZE = 'calc(var(--voyage-w) * 0.0727)';

	const depths = $derived(room.depths.length);
	let reached = $state(0); // depths revealed so far
	let krakenShown = $state(false);

	export const play = async (): Promise<number> => {
		for (let d = 0; d < room.dived; d++) {
			await waitForTimeout(d === 0 ? 500 : 380);
			reached = d + 1;
			playSound('pop', 1 + d * 0.04);
		}
		await waitForTimeout(500);
		if (room.krakenTile !== null) {
			krakenShown = true;
			playSound('doorClose');
		} else {
			playSound('win');
		}
		await waitForTimeout(900);
		return room.total;
	};

	const tileState = (depth: number, tile: number): 'safe' | 'kraken' | 'hidden' => {
		if (depth < reached && room.path[depth] === tile) return 'safe';
		if (krakenShown && depth === room.dived && room.krakenTile === tile) return 'kraken';
		return 'hidden';
	};
</script>

<div class="voyage" style="--depths:{depths}">
	{#each Array.from({ length: depths }, (_, i) => depths - 1 - i) as depth (depth)}
		<div class="depth" class:current={reached === depth + 1} class:reached={depth < reached}>
			<div class="mult">{room.depths[depth]}x</div>
			<div class="tiles">
				{#each Array.from({ length: room.tilesPerDepth }, (_, t) => t) as tile (tile)}
					{@const state = tileState(depth, tile)}
					<div class="tile {state}"></div>
				{/each}
			</div>
		</div>
	{/each}
	<!-- What the dive is doing, in the same voice the other three rooms speak in — see `RoomHint`.
	     No drain on any of these: the voyage is the one room with nothing to decide, so there is no
	     clock running against the player to draw. Cut smaller than Pirate Plinko's because the dive
	     is a narrow column and these lines are sentences rather than two-word orders. -->
	<div class="caption">
		{#if krakenShown}
			<RoomHint size={HINT_SIZE}>
				Kraken at depth {room.dived + 1}<br />You keep <b>{room.total}x</b>
			</RoomHint>
		{:else if reached >= depths}
			<RoomHint size={HINT_SIZE}>Reached the surface <b>{room.total}x</b></RoomHint>
		{:else}
			<RoomHint lines={['Diving']} size={HINT_SIZE} />
		{/if}
	</div>
</div>

<style>
	/*
	 * Everything about the dive column is a share of its own width, and the width is the one number
	 * that changes between a wide screen and a tall one. It was ten sets of vw before, which meant a
	 * portrait pass would have been ten more of them, each free to drift out of proportion with the
	 * rest; now there is a single knob and the drawing follows it.
	 *
	 * The shares are the old landscape numbers over the old landscape width of 22vw, so a wide
	 * screen still gets exactly the column it had.
	 */
	.voyage {
		--voyage-w: 22vw;
		display: flex;
		flex-direction: column;
		gap: calc(var(--voyage-w) * 0.0082);
		width: var(--voyage-w);
	}
	.depth {
		display: flex;
		align-items: center;
		gap: calc(var(--voyage-w) * 0.0227);
		padding: calc(var(--voyage-w) * 0.0055) calc(var(--voyage-w) * 0.0182);
		border-radius: calc(var(--voyage-w) * 0.0136);
		background: rgba(60, 20, 20, 0.55);
		transition: background 250ms ease;
	}
	.depth.reached {
		background: rgba(120, 40, 30, 0.75);
	}
	.depth.current {
		background: rgba(200, 80, 40, 0.85);
		box-shadow: 0 0 calc(var(--voyage-w) * 0.0273) rgba(255, 180, 80, 0.7);
	}
	.mult {
		width: calc(var(--voyage-w) * 0.136);
		font-family: 'Alexandria', sans-serif;
		font-weight: 700;
		font-size: calc(var(--voyage-w) * 0.0386);
		color: #ffd27a;
		text-align: right;
	}
	.tiles {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: calc(var(--voyage-w) * 0.0114);
		flex: 1;
	}
	.tile {
		height: calc(var(--voyage-w) * 0.0705);
		border-radius: calc(var(--voyage-w) * 0.0114);
		background: linear-gradient(180deg, #6b3b2a, #3e2118);
		border: calc(var(--voyage-w) * 0.0027) solid rgba(255, 200, 120, 0.35);
		transition:
			background 250ms ease,
			transform 250ms ease;
	}
	.tile.safe {
		background: radial-gradient(circle at 50% 40%, #fff7d6 0%, #f4c542 40%, #b8860b 100%);
		transform: scale(1.06);
	}
	.tile.kraken {
		background: radial-gradient(circle at 50% 45%, #ff9a5a 0%, #d43a1e 45%, #6b0d05 100%);
		animation: kraken-in 500ms cubic-bezier(0.3, 1.5, 0.5, 1) both;
	}
	@keyframes kraken-in {
		from {
			transform: scale(0.3);
		}
		to {
			transform: scale(1.1);
		}
	}
	/* Only a place: what the line looks like is `RoomHint`'s. */
	.caption {
		margin-top: calc(var(--voyage-w) * 0.0182);
	}

	/* ---- Portrait ----------------------------------------------------------------------
	   The one number, given a taller screen.

	   Bound by HEIGHT as much as by width, which is what makes this room different from the other
	   three: ten depths stacked make the column very nearly square — it comes out at 0.97 of its own
	   width tall — and a phone's bonus screen has about 60 to 77 vh of stage between the sign and
	   the win line, depending on how long the handset is. `min()` takes whichever runs out first:
	   the width on a long phone, the height on a squat one. The vh share is measured against the
	   shortest of them (h/w = 1.3, where the stage is about 62vh) with a little air left over. */
	:global(.game.portrait) .voyage {
		--voyage-w: min(86vw, 58vh);
	}
</style>
