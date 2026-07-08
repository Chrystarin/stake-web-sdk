<script lang="ts">
	import '../styles/global.scss';
	import '../styles/table.scss';

	import { stateBet } from 'state-shared';
	import { stateUrlDerived } from 'state-shared';
	import { waitForTimeout } from 'utils-shared/wait';

	import { getContext } from '../game/context';
	import { stateGame, stateGameDerived } from '../game/stateGame.svelte';
	import type { Colour } from '../game/constants';

	import DiceBox from './DiceBox.svelte';
	import WheelBonus from './WheelBonus.svelte';
	import EnableGameActor from './EnableGameActor.svelte';
	import DevHarness from './DevHarness.svelte';

	const context = getContext();

	// When launched without an RGS session (dev / preview), play sample books locally.
	const online = $derived(Boolean(stateUrlDerived.rgsUrl()));

	// Odds panels are shown in the original ColourDice order.
	const DISPLAY_COLOURS: Colour[] = ['yellow', 'white', 'pink', 'blue', 'red', 'green'];
	const CHIPS = [5, 10, 50, 100, 1000, 10000];

	const canRoll = $derived(context.stateXstateDerived.isIdle() && !stateGame.rolling);

	const selectColour = (colour: Colour) => stateGameDerived.setSelectedColour(colour);
	const selectChip = (value: number) => {
		if (stateGame.rolling) return;
		stateBet.betAmount = value;
	};
	const roll = () => {
		if (!canRoll) return;
		context.eventEmitter.broadcast({ type: 'bet' });
	};

	const sign = $derived(stateBet.currency === 'USD' ? '$' : `${stateBet.currency} `);
	const fmt = (value: number) =>
		value >= 1000 ? `${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)}k` : value.toFixed(2);

	// Win overlay
	let winVisible = $state(false);
	let winMultiplier = $state(0);
	let winCash = $state(0);
	const winTitle = $derived(
		winMultiplier >= 100 ? 'JACKPOT!' : winMultiplier >= 20 ? 'BIG WIN!' : 'YOU WIN',
	);

	context.eventEmitter.subscribeOnMount({
		winShow: async (emitterEvent) => {
			winMultiplier = emitterEvent.amount / 100;
			winCash = winMultiplier * stateBet.betAmount;
			winVisible = true;
			await waitForTimeout(winMultiplier >= 20 ? 2600 : 1600);
		},
		winHide: () => {
			winVisible = false;
		},
	});
</script>

{#if online}
	<EnableGameActor />
{:else}
	<DevHarness />
{/if}

<div class="game">
	<div class="top-bar">
		<div class="total-users">
			<div class="users-count-lbl">COLOUR&nbsp;DICE</div>
		</div>
	</div>

	<div class="player">
		<DiceBox />
	</div>

	<div class="bottom-panel">
		<div class="betting-panel-wrap">
			<div class="betting-panel">
				<div class="inner-panel">
					<div class="actions-wrap">
						<div class="clear-btn" onclick={() => {}} aria-hidden="true"></div>
						<div class="chipandstate-wrap">
							<div class="chips-wrap">
								{#each CHIPS as chip, i (chip)}
									<div class="chip-wrap">
										<div
											class="chip ch{i}"
											class:selected={stateBet.betAmount === chip}
											onclick={() => selectChip(chip)}
											aria-hidden="true"
										>
											<span>{fmt(chip)}</span>
										</div>
									</div>
								{/each}
							</div>
						</div>
						<div class="repeat-btn roll-btn" class:disabled={!canRoll} onclick={roll} aria-hidden="true">
							<span>{stateGame.rolling ? '…' : 'ROLL'}</span>
						</div>
					</div>

					<div class="outcomes">
						{#each DISPLAY_COLOURS as colour (colour)}
							<div
								class="odds {colour}"
								class:selected={stateGame.selectedColour === colour}
								class:win={stateGameDerived.isWinColour(colour)}
								onclick={() => selectColour(colour)}
								aria-hidden="true"
							>
								<div class="outcome-stat">
									<div class="total-amount-lbl">{colour.toUpperCase()}</div>
								</div>
								<div class="rate {stateGameDerived.winTypeForColour(colour)}"></div>
								<span class="jackpot-value-lbl">2× · 3× · JACKPOT</span>
							</div>
						{/each}
					</div>
				</div>
			</div>
		</div>

		<div class="stat-wrap">
			<div class="history">
				{#each stateGame.history.slice().reverse() as entry (entry)}
					<div class="result-col">
						{#each entry.colours as itemColour (itemColour)}
							<div class="result-item {itemColour}"></div>
						{/each}
					</div>
				{/each}
			</div>
		</div>
	</div>

	<div class="bottom-bar">
		<div class="menu-btn" aria-hidden="true"></div>
		<div class="round-lbl">RTP 97%</div>
		<div class="info-wrap">
			<div class="balance-wrap">
				<div>Balance</div>
				<div class="balance-val">{sign}{fmt(stateBet.balanceAmount)}</div>
			</div>
			<div class="bets-wrap">
				<div class="bets-lbl">Bet</div>
				<div class="bets-val">{sign}{fmt(stateBet.betAmount)}</div>
			</div>
		</div>
	</div>

	<WheelBonus />

	{#if winVisible}
		<div class="win-overlay">
			<div class="win-card">
				<div class="win-title">{winTitle}</div>
				<div class="win-cash">{sign}{winCash.toFixed(2)}</div>
				<div class="win-mult">{winMultiplier.toFixed(2)}×</div>
			</div>
		</div>
	{/if}
</div>

<style>
	/* Selection highlight for colour panels + chips (kept minimal; base look comes from table.scss). */
	.odds.selected {
		outline: 0.4vw solid #ffe14d;
		outline-offset: -0.4vw;
		filter: brightness(1.08);
	}
	.chip.selected {
		outline: 0.3vw solid #ffe14d;
		border-radius: 50%;
	}
	.roll-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		background: linear-gradient(180deg, #ffd94a, #f5a524);
		border-radius: 1vw;
		color: #2a1500;
		font-family: 'Alexandria', sans-serif;
		font-weight: 700;
		cursor: pointer;
	}
	.roll-btn span {
		font-size: 1.6vw;
	}
	.roll-btn.disabled {
		filter: grayscale(0.6) brightness(0.8);
		pointer-events: none;
	}

	.win-overlay {
		position: fixed;
		inset: 0;
		z-index: 55;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(0, 0, 0, 0.55);
	}
	.win-card {
		min-width: 40vw;
		padding: 4vh 6vw;
		border-radius: 2vw;
		background: rgba(10, 42, 23, 0.95);
		border: 0.4vw solid #ffe14d;
		text-align: center;
		font-family: 'Alexandria', sans-serif;
	}
	.win-title {
		color: #ffe14d;
		font-weight: 700;
		font-size: 3.6vh;
	}
	.win-cash {
		color: #fff;
		font-weight: 800;
		font-size: 5vh;
		margin: 1vh 0;
	}
	.win-mult {
		color: #bfe9cf;
		font-weight: 700;
		font-size: 2.6vh;
	}
</style>
