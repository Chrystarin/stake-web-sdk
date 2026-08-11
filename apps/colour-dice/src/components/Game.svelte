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

	// Chip tray comes from the RGS bet template (betLevels), so it always offers amounts this
	// operator/currency actually accepts. It arrives with /wallet/authenticate, hence the effect.
	const stakes = $derived(stateGameDerived.stakeOptions());
	$effect(() => {
		void stakes;
		stateGameDerived.ensureValidStake();
	});

	// Chips all render the same `chip_base.svg` art, tinted per stake with a CSS hue-rotate, so
	// the colour ramps smoothly: green (cheapest) -> blue -> purple -> pink -> red (dearest).
	// Keyed on the index in the FULL list, so a given amount keeps its colour wherever it sits
	// in the carousel window.
	//
	// chip_base.svg is drawn in gold (its palette centres on ~#EEBC43, hue ~42deg), so the
	// rotation applied is `target hue - 42`. Hues below are the ramp stops; red is written as
	// 362 rather than 2 so the interpolation sweeps forward through pink instead of racing
	// backwards round the wheel.
	const CHIP_BASE_HUE = 42;
	const CHIP_HUES = [133, 222, 264, 324, 362];

	/** Absolute hue (deg) for the stake at `index`, interpolated along CHIP_HUES. */
	const chipHue = (index: number) => {
		if (stakes.length <= 1) return CHIP_HUES[0];
		const position = (index / (stakes.length - 1)) * (CHIP_HUES.length - 1);
		const stop = Math.min(Math.floor(position), CHIP_HUES.length - 2);
		return CHIP_HUES[stop] + (CHIP_HUES[stop + 1] - CHIP_HUES[stop]) * (position - stop);
	};

	/** Hue-rotation (deg) to tint the base chip art for the stake at `index`. */
	const chipHueShift = (index: number) => Math.round(chipHue(index) - CHIP_BASE_HUE);

	/**
	 * Label colour: the chip's own hue at 30% less lightness, so the number reads as a darker
	 * shade of the disc it sits on rather than needing an outline to separate it.
	 */
	const chipTextColour = (index: number) =>
		`hsl(${Math.round(chipHue(index)) % 360}, 70%, ${Math.round(55 * 0.7)}%)`;

	// --- Chip carousel --------------------------------------------------------------------
	// Show at most five chips, with the selected one in the middle slot and the rest either
	// side. Tapping a neighbour selects it, which slides the window along.
	//
	// The window CLAMPS at both ends rather than wrapping: wrapping would keep the selection
	// perfectly centred, but it also parks the dearest chips right next to the cheapest, so a
	// single mis-tap could swing the stake from the minimum to the maximum. The cost is that
	// the selected chip sits off-centre for the first and last couple of options.
	const VISIBLE_CHIPS = 5;

	const carousel = $derived.by(() => {
		const total = stakes.length;
		if (!total) return [];
		// Never exceed the number of options, otherwise the window would show blank slots.
		const windowSize = Math.min(VISIBLE_CHIPS, total);
		const middle = Math.floor(windowSize / 2);
		const selected = Math.max(0, stakes.indexOf(stateGame.stake));
		const start = Math.min(Math.max(selected - middle, 0), total - windowSize);
		return Array.from({ length: windowSize }, (_, slot) => {
			const index = start + slot;
			// Depth drives the visual falloff and is measured from the SELECTED chip, so that
			// stays front even when clamping has pushed it off the middle slot. Capped at 2
			// because a clamped window can sit up to four slots from the selection.
			return {
				value: stakes[index],
				index,
				depth: Math.min(Math.abs(index - selected), 2),
				selected: index === selected,
			};
		});
	});

	// Tapping the already-selected chip opens the full grid — the carousel only ever shows five
	// at a time, so this is how you reach an amount several steps away without walking to it.
	let stakePanelOpen = $state(false);

	const onChipClick = (value: number, isSelected: boolean) => {
		if (isSelected) stakePanelOpen = !stakePanelOpen;
		else selectStake(value);
	};

	const pickStake = (value: number) => {
		selectStake(value);
		stakePanelOpen = false;
	};

	const backedCount = $derived(stateGameDerived.backedCount());
	const total = $derived(stateGameDerived.totalStake());
	const idle = $derived(context.stateXstateDerived.isIdle() && !stateGame.rolling);
	const canRoll = $derived(idle && backedCount > 0);

	const toggleColour = (colour: Colour) => {
		if (!idle) return;
		stateGameDerived.toggleColour(colour);
	};
	const selectStake = (value: number) => stateGameDerived.selectStake(value);

	// Stake at the moment of commit — the board can reset while the roll plays out.
	let committedStake = $state(0);
	const roll = () => {
		if (!canRoll) return;
		stakePanelOpen = false;
		committedStake = total;
		if (!stateGameDerived.beginRoll()) return;
		stateGame.rolling = true;
		context.eventEmitter.broadcast({ type: 'bet' });
	};

	// The tray is disabled mid-roll, so never leave the panel hanging open over it.
	$effect(() => {
		if (stateGame.rolling) stakePanelOpen = false;
	});

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
	<!-- Overlaid on the table rather than in a bar, so the felt runs the full height. -->
	<div class="hud">
		<div class="balance-hud">
			<div class="balance-chip" aria-hidden="true"></div>
			<div class="balance-text">
				<span class="hud-lbl">Balance</span>
				<span class="hud-val">{sign}{fmt(stateBet.balanceAmount)}</span>
			</div>
		</div>
		<div class="menu-btn" aria-hidden="true"></div>
	</div>

	<div class="player">
		<DiceBox />
	</div>

	<div class="bottom-panel">
		<div class="betting-panel-wrap">
			<div class="betting-panel">
				<div class="inner-panel">
					<!-- Play sits directly above the chip tray as a tab, matching the Angular
					     original's `.confirm-btn`. -->
					<div class="confirm-btn" class:disabled={!canRoll} onclick={roll} aria-hidden="true">
						<div class="confirm-lbl">{stateGame.rolling ? '…' : 'PLAY'}</div>
					</div>

					<div class="actions-wrap">
						<div
							class="clear-btn"
							class:disabled={!idle || backedCount === 0}
							onclick={() => stateGameDerived.clearBets()}
							title="Clear"
							aria-hidden="true"
						></div>
						<div class="chipandstate-wrap">
							{#if stakePanelOpen}
								<!-- Full grid of bet levels. Tapping the selected chip again toggles it. -->
								<div class="stake-panel">
									<div class="stake-panel-title">Bet amount</div>
									<div class="stake-panel-grid">
										{#each stakes as value, i (value)}
											<div class="stake-option" class:current={stateGame.stake === value}>
												<div
													class="chip"
													class:selected={stateGame.stake === value}
													style="--chip-hue:{chipHueShift(i)}deg; --chip-text:{chipTextColour(i)}"
													onclick={() => pickStake(value)}
													aria-hidden="true"
												>
													<span>{fmtChip(value)}</span>
												</div>
											</div>
										{/each}
									</div>
								</div>
							{/if}

							<div class="chips-wrap">
								{#each carousel as chip (chip.value)}
									<div class="chip-wrap" style="--depth:{chip.depth}">
										<div
											class="chip"
											class:selected={chip.selected}
											class:open={chip.selected && stakePanelOpen}
											style="--chip-hue:{chipHueShift(chip.index)}deg; --chip-text:{chipTextColour(chip.index)}"
											onclick={() => onChipClick(chip.value, chip.selected)}
											aria-hidden="true"
										>
											<span>{fmtChip(chip.value)}</span>
										</div>
									</div>
								{/each}
							</div>
						</div>
						<div
							class="undo-btn"
							class:disabled={!idle || backedCount === 0}
							onclick={() => stateGameDerived.undoBet()}
							title="Undo"
							aria-hidden="true"
						></div>
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
								<!-- The big multiplier badge along the bottom is the only result readout. -->
								<div class="rate {stateGameDerived.winTypeForColour(colour)}"></div>
								{#if backed}
									<!-- The actual chip lands on the colour, rather than a text pill, so the
									     board reads like real chips on a felt. -->
									<div
										class="placed-chip chip"
										style="--chip-hue:{chipHueShift(stakes.indexOf(stateGame.stake))}deg; --chip-text:{chipTextColour(stakes.indexOf(stateGame.stake))}"
									>
										<span>{fmtChip(stateGame.stake)}</span>
									</div>
								{/if}
							</div>
						{/each}
					</div>

					<!-- Total wager, below the colour selection. -->
					<div class="total-bet">
						<span class="total-bet-lbl">Total Bet</span>
						<span class="total-bet-val">{sign}{fmt(total)}</span>
					</div>
				</div>
			</div>
		</div>
	</div>

	{#if stakePanelOpen}
		<!-- Click-anywhere-else dismissal. Sits under the panel but over everything else, so a
		     stray tap closes it instead of changing the board behind it. -->
		<div class="stake-panel-backdrop" onclick={() => (stakePanelOpen = false)} aria-hidden="true"></div>
	{/if}

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
	/* Every chip uses the same `chip_base.svg` art, tinted per stake by `--chip-hue` (see
	   chipHueShift). The art lives on a ::before rather than on the element itself so the
	   hue-rotate cannot reach the label — filtering the element would shift the text colour
	   and its outline along with the disc. */
	.chip {
		position: relative;
		background-image: none;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.chip::before {
		content: '';
		position: absolute;
		inset: 0;
		background: url('/img/chip_base.svg') no-repeat center / contain;
		filter: hue-rotate(var(--chip-hue, 0deg));
		z-index: 0;
	}
	/* Label is a darker shade of the chip's own colour — no outline, the contrast carries it. */
	.chip span {
		position: relative;
		z-index: 1;
		font-size: 1.05vw;
		font-weight: 700;
		color: var(--chip-text, #1d5c28);
		-webkit-text-stroke: 0;
		line-height: 1;
	}
	.chip.selected {
		outline: 0.3vw solid #ffe14d;
		border-radius: 50%;
	}
	/* The selected chip doubles as the "show all amounts" toggle, so mark it while open. */
	.chip.open {
		outline-color: #ffffff;
	}

	/* Full bet-level grid, opened by tapping the selected chip. Anchored to the tray and
	   opening upward — the tray sits low in the frame, so downward would run off-screen. */
	.chipandstate-wrap {
		position: relative;
	}
	.stake-panel {
		position: absolute;
		bottom: calc(100% + 0.8vw);
		left: 50%;
		transform: translateX(-50%);
		z-index: 40;
		/* Shrink-to-fit would otherwise inherit the narrow tray's width and wrap a 6-chip grid
		   as 5 + 1. `max-content` sizes to the row, capped so long RGS grids still wrap tidily. */
		width: max-content;
		max-width: 46vw;
		padding: 0.8vw 1vw 1vw;
		border-radius: 1vw;
		background: rgba(18, 20, 34, 0.96);
		border: 0.1vw solid #828a97;
		box-shadow: 0 0.4vw 1.2vw rgba(0, 0, 0, 0.55);
	}
	/* Little pointer down to the chip that opened it. */
	.stake-panel::after {
		content: '';
		position: absolute;
		top: 100%;
		left: 50%;
		transform: translateX(-50%);
		border: 0.6vw solid transparent;
		border-top-color: rgba(18, 20, 34, 0.96);
	}
	.stake-panel-title {
		font-family: 'Alexandria', sans-serif;
		font-size: 0.75vw;
		font-weight: 600;
		letter-spacing: 0.05vw;
		text-transform: uppercase;
		color: #9aa3b4;
		text-align: center;
		margin-bottom: 0.6vw;
	}
	.stake-panel-grid {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5vw;
		justify-content: center;
	}
	/* Neutralise the carousel's depth transform for panel chips — every option shows full size. */
	.stake-option {
		scale: 1;
		opacity: 1;
	}
	.stake-panel-backdrop {
		position: fixed;
		inset: 0;
		z-index: 35;
	}

	/* Carousel depth: `--depth` is the slot's distance from the selected chip (0, 1 or 2), so
	   the selection sits front and full-size and the rest recede either side. Applied to the
	   wrapper so table.scss's own `.chip.selected` scale still layers on top. */
	.chip-wrap {
		scale: calc(1 - var(--depth, 0) * 0.11);
		opacity: calc(1 - var(--depth, 0) * 0.22);
		z-index: calc(3 - var(--depth, 0));
		transition:
			scale 0.18s ease,
			opacity 0.18s ease;
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
	/* Colour name across the top of the box. table.scss lays `.outcome-stat` out flush left
	   with a side margin, so centre it and drop the horizontal inset. */
	.odds .outcome-stat {
		justify-content: center;
		margin-left: 0;
		margin-right: 0;
	}
	/* The chip riding on this colour — same art as the tray, dropped on the top-centre of the
	   box. Every backed colour carries the same amount, so they all show the same chip.

	   It has to keep the `.chip` class to pick up its skin from global.scss, which drags in
	   table.scss's `.bottom-panel .betting-panel-wrap .betting-panel .outcomes .chip` — a
	   five-class selector pinning it to `left: 29%` / `bottom: 1vw` with a negative top
	   margin. `!important` is the readable way to win that rather than restating the whole
	   ancestor chain here; it is scoped to this one element. */
	.odds .placed-chip {
		position: absolute;
		top: 50% !important;
		bottom: auto !important;
		left: 50% !important;
		transform: translate(-50%, -50%);
		z-index: 12;
		margin: 0 !important;
		pointer-events: none;
		filter: drop-shadow(0 0.15vw 0.25vw rgba(0, 0, 0, 0.5));
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
	/* table.scss lays the panel out from 25vw to the right edge — it used to share the row with
	   the live dealer's chat column. Nothing sits beside it now, so mirror that inset on the
	   left instead of dropping it: same 75vw width as before, just centred rather than shoved
	   against the right edge. */
	.bottom-panel {
		left: 12.5vw;
		right: 12.5vw;
		justify-content: center;
		/* table.scss lifts this 4vw to clear the old bottom bar. That bar is gone, so drop the
		   panel back down to a small margin off the bottom edge. */
		bottom: 1vw;
	}
	.undo-btn.disabled,
	.clear-btn.disabled {
		cursor: not-allowed;
		opacity: 0.5;
		filter: grayscale(1);
		pointer-events: none;
	}
	/* HUD overlaid on the table: balance top-left, menu top-right. Replaces the old bottom bar,
	   which is gone entirely. */
	.hud {
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		z-index: 20;
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		padding: 1vw 1.2vw;
		pointer-events: none;
	}
	.balance-hud {
		display: flex;
		align-items: center;
		gap: 0.5vw;
		font-family: 'Alexandria', sans-serif;
		text-shadow: 0 0.1vw 0.3vw rgba(0, 0, 0, 0.8);
	}
	.balance-chip {
		width: 2.2vw;
		height: 2.2vw;
		flex: none;
		background: url('/img/chip_yellow.svg') no-repeat center / contain;
		filter: drop-shadow(0 0.1vw 0.2vw rgba(0, 0, 0, 0.6));
	}
	.balance-text {
		display: flex;
		flex-direction: column;
	}
	.hud-lbl {
		font-size: 0.7vw;
		font-weight: 500;
		letter-spacing: 0.05vw;
		text-transform: uppercase;
		color: #d6c6b4;
	}
	.hud-val {
		font-size: 1.3vw;
		font-weight: 700;
		color: #ffe14d;
	}
	/* global.scss sizes .menu-btn at 10vw for the mobile layout, and the bottom bar that used
	   to override it is gone — so pin the size here. */
	.hud .menu-btn {
		width: 2.6vw;
		height: 2.6vw;
		margin: 0;
		cursor: pointer;
		pointer-events: auto;
	}

	/* Total wager, below the colour selection. */
	.total-bet {
		display: flex;
		align-items: baseline;
		justify-content: center;
		gap: 0.4vw;
		margin-top: 0.5vw;
		font-family: 'Alexandria', sans-serif;
		text-shadow: 0 0.1vw 0.3vw rgba(0, 0, 0, 0.8);
	}
	.total-bet-lbl {
		font-size: 0.7vw;
		font-weight: 500;
		letter-spacing: 0.05vw;
		text-transform: uppercase;
		color: #d6c6b4;
	}
	.total-bet-val {
		font-size: 1.1vw;
		font-weight: 700;
		color: #ffe14d;
	}

	/* Play — the green tab from the Angular original's `.confirm-btn`: rounded only at the
	   top, centred, and sitting directly on top of the chip tray. */
	.confirm-btn {
		position: relative;
		bottom: -0.9vw;
		margin: auto auto 1vw auto;
		width: 14vw;
		height: 2vw;
		padding-top: 1vw;
		background: linear-gradient(180deg, #68d253 0%, #61c741 100%);
		box-shadow: inset 0 0.2vw 0.5vw #0000003f;
		border-radius: 1.5vw 1.5vw 0 0;
		color: #195b25;
		font-family: 'Alexandria', sans-serif;
		font-weight: 600;
		font-size: 1.8vw;
		line-height: 1vw;
		text-align: center;
		cursor: pointer;
	}
	.confirm-btn.disabled {
		background: linear-gradient(180deg, #e7e6ff73 0%, #e7e6ff73 100%);
		box-shadow: inset 0 1vw 0.4vw #ffffff2b;
		color: #9d9cb8;
		cursor: not-allowed;
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
