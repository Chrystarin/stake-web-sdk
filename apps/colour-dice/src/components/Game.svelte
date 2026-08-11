<script lang="ts">
	import '../styles/global.scss';
	import '../styles/table.scss';

	import { stateBet } from 'state-shared';
	import { stateUrlDerived } from 'state-shared';
	import { waitForTimeout } from 'utils-shared/wait';

	import { getContext } from '../game/context';
	import { stateGame, stateGameDerived } from '../game/stateGame.svelte';
	import { maxWinForCount, type Colour } from '../game/constants';

	import DiceBox from './DiceBox.svelte';
	import WheelBonus from './WheelBonus.svelte';
	import EnableGameActor from './EnableGameActor.svelte';
	import DevHarness from './DevHarness.svelte';

	const context = getContext();

	// When launched without an RGS session (dev / preview), play sample books locally.
	const online = $derived(Boolean(stateUrlDerived.rgsUrl()));

	// Odds panels are shown in the original ColourDice order.
	const DISPLAY_COLOURS: Colour[] = ['yellow', 'white', 'pink', 'blue', 'red', 'green'];
	const STAKES = stateGameDerived.STAKES;
	const MAX_COLOURS = stateGameDerived.MAX_COLOURS;

	const backedCount = $derived(stateGameDerived.backedCount());
	const total = $derived(stateGameDerived.totalStake());
	const idle = $derived(context.stateXstateDerived.isIdle() && !stateGame.rolling);
	const canRoll = $derived(idle && backedCount > 0);

	// Advertised ceiling for the current selection, against the total wager.
	const maxWin = $derived(backedCount > 0 ? maxWinForCount(backedCount) : 0);

	const toggleColour = (colour: Colour) => {
		if (!idle) return;
		stateGameDerived.toggleColour(colour);
	};
	const selectStake = (value: number) => stateGameDerived.selectStake(value);

	// Stake at the moment of commit — the board can reset while the roll plays out.
	let committedStake = $state(0);
	const roll = () => {
		if (!canRoll) return;
		committedStake = total;
		if (!stateGameDerived.beginRoll()) return;
		stateGame.rolling = true;
		context.eventEmitter.broadcast({ type: 'bet' });
	};

	const sign = $derived(stateBet.currency === 'USD' ? '$' : `${stateBet.currency} `);
	const fmt = (value: number) =>
		value >= 1000 ? `${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)}k` : value.toFixed(2);
	const fmtChip = (value: number) => (value >= 1000 ? `${value / 1000}k` : `${value}`);

	// Win overlay
	let winVisible = $state(false);
	let winCash = $state(0);
	let winMultiplier = $state(0);
	const winTitle = $derived(
		winMultiplier >= 100 ? 'JACKPOT!' : winMultiplier >= 20 ? 'BIG WIN!' : 'YOU WIN',
	);

	context.eventEmitter.subscribeOnMount({
		winShow: async (emitterEvent) => {
			// Book amounts are x100 in units of the per-colour stake, so cash scales by betAmount.
			winCash = (emitterEvent.amount / 100) * stateBet.betAmount;
			winMultiplier = committedStake > 0 ? winCash / committedStake : 0;
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
						<div
							class="clear-btn"
							class:disabled={!idle || backedCount === 0}
							onclick={() => stateGameDerived.clearBets()}
							title="Clear"
							aria-hidden="true"
						></div>
						<div
							class="undo-btn"
							class:disabled={!idle || backedCount === 0}
							onclick={() => stateGameDerived.undoBet()}
							title="Undo"
							aria-hidden="true"
						></div>
						<div class="chipandstate-wrap">
							<div class="chips-wrap">
								{#each STAKES as value, i (value)}
									<div class="chip-wrap">
										<div
											class="chip ch{i}"
											class:selected={stateGame.stake === value}
											onclick={() => selectStake(value)}
											aria-hidden="true"
										>
											<span>{fmtChip(value)}</span>
										</div>
									</div>
								{/each}
							</div>
						</div>
						<div
							class="repeat-btn"
							class:disabled={!idle || backedCount > 0 || !stateGameDerived.canRepeat()}
							onclick={() => stateGameDerived.repeatBets()}
							title="Repeat last bet"
							aria-hidden="true"
						></div>
						<div class="roll-btn" class:disabled={!canRoll} onclick={roll} aria-hidden="true">
							<span>{stateGame.rolling ? '…' : 'ROLL'}</span>
						</div>
					</div>

					<div class="outcomes">
						{#each DISPLAY_COLOURS as colour (colour)}
							{@const backed = stateGameDerived.isBacked(colour)}
							{@const win = stateGameDerived.winForColour(colour)}
							<div
								class="odds {colour}"
								class:win={Boolean(win)}
								class:backed
								onclick={() => toggleColour(colour)}
								aria-hidden="true"
							>
								<div class="outcome-stat">
									<div class="total-amount-lbl">{colour.toUpperCase()}</div>
								</div>
								<div class="rate {stateGameDerived.winTypeForColour(colour)}"></div>
								{#if win}
									<div class="hit-tag">
										{win.matches === 3 ? 'TRIPLE' : win.matches === 2 ? '3×' : '2×'}
									</div>
								{:else}
									<span class="jackpot-value-lbl">2× · 3× · WHEEL</span>
								{/if}
								{#if backed}
									<div class="stake-marker">{sign}{fmt(stateGame.stake)}</div>
								{/if}
							</div>
						{/each}
					</div>
				</div>
			</div>
		</div>

		<div class="stat-wrap">
			<div class="history">
				{#each stateGame.history.slice().reverse() as entry, index (index)}
					<div class="result-col">
						{#each entry.colours as itemColour, dieIndex (dieIndex)}
							<div class="result-item {itemColour}"></div>
						{/each}
					</div>
				{/each}
			</div>
		</div>
	</div>

	<div class="bottom-bar">
		<div class="menu-btn" aria-hidden="true"></div>
		<div class="round-lbl">
			{#if backedCount > 0}
				{backedCount}/{MAX_COLOURS} colours · max {maxWin.toFixed(2)}×
			{:else}
				RTP 96.49% · back up to {MAX_COLOURS} colours
			{/if}
		</div>
		<div class="info-wrap">
			<div class="balance-wrap">
				<div>Balance</div>
				<div class="balance-val">{sign}{fmt(stateBet.balanceAmount)}</div>
			</div>
			<div class="bets-wrap">
				<div class="bets-lbl">Total Bet</div>
				<div class="bets-val">{sign}{fmt(total)}</div>
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
				{#if stateGame.wins.length > 1}
					<div class="win-breakdown">
						{#each stateGame.wins as win (win.colour)}
							<span class="win-chip {win.colour}"
								>{win.colour} → {win.matches === 3 ? 'wheel' : `${win.matches === 2 ? 3 : 2}×`}</span
							>
						{/each}
					</div>
				{/if}
			</div>
		</div>
	{/if}
</div>

<style>
	/* Chip / control tweaks (base look comes from table.scss). */
	.chip.selected {
		outline: 0.3vw solid #ffe14d;
		border-radius: 50%;
	}
	.odds {
		cursor: pointer;
		position: relative;
	}
	/* A colour that landed — every backed colour pays on its own match count, so more than
	   one of these can light up in the same round. */
	.odds.win {
		outline: 0.3vw solid #ffe14d;
		outline-offset: -0.3vw;
		filter: brightness(1.15);
	}
	/* Backed but not yet resolved. */
	.odds.backed {
		box-shadow:
			inset 0 0.1vw 0.1vw 0.05vw #ffeddb,
			inset 0 0.1vw 0.4vw 0.1vw #ffffff;
	}
	.hit-tag {
		position: absolute;
		top: 0.25vw;
		right: 0.3vw;
		z-index: 12;
		font-family: 'Alexandria', sans-serif;
		font-size: 0.6vw;
		font-weight: 700;
		letter-spacing: 0.03vw;
		color: #2a1500;
		background: linear-gradient(180deg, #ffd94a, #f5a524);
		border-radius: 0.3vw;
		padding: 0.05vw 0.3vw;
		pointer-events: none;
	}
	/* The stake riding on this colour. Every backed colour carries the same amount. */
	.stake-marker {
		position: absolute;
		bottom: 0.5vw;
		left: 50%;
		transform: translateX(-50%);
		z-index: 12;
		min-width: 3vw;
		text-align: center;
		padding: 0.15vw 0.5vw;
		border-radius: 1vw;
		background: radial-gradient(circle at 35% 30%, #fff8dc, #f5a524 75%, #b56b00);
		border: 0.08vw solid #fff3c4;
		font-family: 'Alexandria', sans-serif;
		font-size: 0.7vw;
		font-weight: 700;
		color: #2a1500;
		pointer-events: none;
	}
	/* Undo control — reuses the round pill look of clear/repeat with an arrow glyph. */
	.undo-btn {
		width: 3vw;
		height: 3vw;
		margin: auto 1vw;
		cursor: pointer;
		border-radius: 50%;
		background: rgba(88, 88, 88, 0.7);
		border: 0.05vw solid #828a97;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.undo-btn::before {
		content: '↶';
		color: #fff;
		font-size: 1.8vw;
		line-height: 1;
	}
	.undo-btn.disabled,
	.clear-btn.disabled,
	.repeat-btn.disabled {
		cursor: not-allowed;
		opacity: 0.5;
		filter: grayscale(1);
		pointer-events: none;
	}
	.roll-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		min-width: 8vw;
		padding: 0 1.5vw;
		margin: auto 0 auto 1vw;
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
	.win-breakdown {
		display: flex;
		flex-wrap: wrap;
		gap: 0.6vw;
		justify-content: center;
		margin-top: 1.6vh;
	}
	.win-chip {
		font-size: 1.5vh;
		font-weight: 600;
		color: #0d2a18;
		background: #ffe14d;
		border-radius: 0.6vw;
		padding: 0.3vh 0.8vw;
		text-transform: capitalize;
	}
</style>
