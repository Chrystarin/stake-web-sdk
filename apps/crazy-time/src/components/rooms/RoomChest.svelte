<script lang="ts">
	/**
	 * Treasure Chest room: twelve chests, the player opens one.
	 *
	 * The prize is AUTHORED: whichever chest the player taps reveals the book's awarded value, and
	 * the remaining eleven reveal the book's decoys. Every chest is equally likely to be tapped, so
	 * the pick has no effect on the expected value — the same as a shuffled live board. The rules
	 * page must say so. If the player does not pick in time, the book's own `opened` index is used.
	 */
	import { PICK_SECONDS } from '../../game/constants';
	import type { BookEventChestBonus } from '../../game/typesBookEvent';
	import { playSound } from '../../game/sound';
	import { waitForTimeout } from 'utils-shared/wait';

	type Props = { room: BookEventChestBonus; interactive: boolean };
	let { room, interactive }: Props = $props();

	let picked = $state<number | null>(null);
	let revealedAll = $state(false);
	let secondsLeft = $state(PICK_SECONDS);
	let resolvePick: ((index: number) => void) | null = null;

	/** Values as shown: the awarded value moves to the chest the player opened. */
	const shown = $derived.by(() => {
		const values = [...room.chests];
		if (picked !== null && picked !== room.opened) {
			[values[picked], values[room.opened]] = [values[room.opened], values[picked]];
		}
		return values;
	});

	const choose = (index: number) => {
		if (picked !== null || !resolvePick) return;
		resolvePick(index);
	};

	export const play = async (): Promise<number> => {
		let index: number;
		if (interactive) {
			index = await new Promise<number>((resolve) => {
				resolvePick = resolve;
				const timer = setInterval(() => {
					secondsLeft -= 1;
					if (secondsLeft <= 0) {
						clearInterval(timer);
						resolve(room.opened);
					}
				}, 1000);
			});
		} else {
			await waitForTimeout(900);
			index = room.opened;
		}
		resolvePick = null;
		picked = index;
		playSound('doorOpen');
		await waitForTimeout(900);
		revealedAll = true;
		playSound('merge');
		await waitForTimeout(600);
		return room.total;
	};
</script>

<div class="chests">
	<div class="prompt">
		{#if picked === null}
			{interactive ? `Pick a chest · ${secondsLeft}s` : 'Opening a chest…'}
		{:else}
			You found <b>{shown[picked]}x</b>
		{/if}
	</div>
	<div class="grid">
		{#each shown as value, i (i)}
			<button
				class="chest"
				class:open={picked === i || revealedAll}
				class:mine={picked === i}
				class:decoy={revealedAll && picked !== i}
				disabled={picked !== null || !interactive}
				onclick={() => choose(i)}
			>
				<div class="lid"></div>
				<div class="body"></div>
				<div class="value">{value}x</div>
			</button>
		{/each}
	</div>
</div>

<style>
	.chests {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.8vw;
	}
	.prompt {
		font-family: 'Alexandria', sans-serif;
		font-size: 1.1vw;
		color: #ffe9b0;
		text-shadow: 0 0.1vw 0.3vw rgba(0, 0, 0, 0.8);
	}
	.prompt b {
		color: #ffe14d;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(4, 6.2vw);
		gap: 0.6vw;
	}
	.chest {
		position: relative;
		height: 4.6vw;
		border: none;
		background: none;
		padding: 0;
		cursor: pointer;
	}
	.chest:disabled {
		cursor: default;
	}
	.body {
		position: absolute;
		left: 0.3vw;
		right: 0.3vw;
		bottom: 0;
		height: 2.6vw;
		border-radius: 0.3vw;
		background: linear-gradient(180deg, #8a5a2b, #5b371a);
		border: 0.1vw solid #f0c65a;
	}
	.lid {
		position: absolute;
		left: 0.15vw;
		right: 0.15vw;
		top: 0.8vw;
		height: 1.4vw;
		border-radius: 0.6vw 0.6vw 0.1vw 0.1vw;
		background: linear-gradient(180deg, #a86f37, #7a4b22);
		border: 0.1vw solid #f0c65a;
		transform-origin: bottom center;
		transition: transform 400ms cubic-bezier(0.3, 1.4, 0.5, 1);
	}
	.chest:not(:disabled):hover .lid {
		transform: translateY(-0.2vw);
	}
	.chest.open .lid {
		transform: rotateX(70deg) translateY(-0.6vw);
	}
	.value {
		position: absolute;
		left: 0;
		right: 0;
		top: 1.4vw;
		text-align: center;
		font-family: 'Alexandria', sans-serif;
		font-weight: 700;
		font-size: 1.1vw;
		color: #ffe14d;
		opacity: 0;
		transform: translateY(0.4vw);
		transition: opacity 300ms ease 250ms, transform 300ms ease 250ms;
	}
	.chest.open .value {
		opacity: 1;
		transform: translateY(0);
	}
	.chest.mine .body,
	.chest.mine .lid {
		box-shadow: 0 0 0.9vw #ffe14d;
	}
	.chest.decoy {
		opacity: 0.55;
	}
</style>
