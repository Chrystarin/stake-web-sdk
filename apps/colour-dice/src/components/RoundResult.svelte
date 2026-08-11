<script lang="ts">
	/**
	 * Round readout, ported from ColourDice2's `app-result` (result.component.html/.scss).
	 *
	 * Two stacked pieces, both non-interactive and laid over the table:
	 *   1. the win amount on the `win_bg.svg` marquee, only when the round paid;
	 *   2. the three dice grouped by colour into pills, each carrying the pay-rate badge
	 *      for how many dice landed on that colour (1 -> 2x, 2 -> 3x, 3 -> wheel).
	 *
	 * The win row keeps its height even on a losing round so the pills do not jump.
	 */
	import { stateGame } from '../game/stateGame.svelte';
	import type { Colour } from '../game/constants';

	type Props = {
		/** Cash won this round, in currency units. 0 hides the marquee. */
		amount: number;
		/** Currency prefix, e.g. `$`. */
		sign: string;
		/** The board is clearing: shrink away into the middle rather than vanishing. */
		closing?: boolean;
	};

	let { amount, sign, closing = false }: Props = $props();

	/**
	 * The three dice grouped by colour, in first-appearance order — the same grouping
	 * result.component.ts builds out of its `"y-y-b"` result string.
	 */
	const groups = $derived.by(() => {
		const byColour = new Map<Colour, Colour[]>();
		for (const colour of stateGame.dice) {
			if (!colour) continue;
			const group = byColour.get(colour);
			if (group) group.push(colour);
			else byColour.set(colour, [colour]);
		}
		return [...byColour.values()];
	});

	/** Pay-rate badge for a group, keyed on how many dice landed on that colour. */
	const winType = (matches: number) =>
		matches === 1 ? 'rate_2x' : matches === 2 ? 'rate_3x' : matches === 3 ? 'rate_jp' : '';

	// Unlike the live original — where every player has a different board — this game shows one
	// player's round, so a rate badge under a colour they never backed would read as a payout
	// they did not earn. The group still renders (the draw is the draw), just dimmed.
	const backed = (colour: Colour) => stateGame.backedOrder.includes(colour);

	const fmt = (value: number) =>
		value >= 1000 ? `${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)}k` : value.toFixed(2);
</script>

<div class="result-wrapper" class:closing>
	<div class="win-wrap">
		{#if amount > 0}
			<div class="win-result">
				<div class="win-amount-lbl">{sign}{fmt(amount)}</div>
			</div>
		{/if}
	</div>

	<div class="result">
		<div class="d-iflex">
			{#each groups as group, index (index)}
				<div class="r-group-wrap" class:miss={!backed(group[0])}>
					<div class="r-group">
						{#each group as colour, die (die)}
							<!-- Same colour repeated, so the index is the only stable key. -->
							<div class="result-ico r_{colour}"></div>
						{/each}
					</div>
					<div class="rate {winType(group.length)}"></div>
				</div>
			{/each}
		</div>
	</div>
</div>

<style>
	/* Laid over the table, clear of the betting panel below (the readout runs to ~26vw; the
	   panel starts around 35vw). `pointer-events: none` so the board stays live underneath
	   regardless — the result is not a modal, and nothing has to be dismissed to keep playing. */
	.result-wrapper {
		position: absolute;
		top: 8vw;
		left: 0;
		right: 0;
		z-index: 22;
		pointer-events: none;
	}
	/* Dismissed when the board is cleared. It collapses into its own centre — the readout is
	   already centred on the table, so shrinking from there reads as it being put away rather
	   than sliding off somewhere. Duration mirrors RESULT_CLOSE_MS in Game.svelte, which is
	   what actually unmounts this. */
	.result-wrapper.closing {
		transform-origin: center center;
		animation: result-dismiss 340ms cubic-bezier(0.5, 0, 0.75, 0.3) both;
	}
	@keyframes result-dismiss {
		0% {
			opacity: 1;
			scale: 1;
		}
		100% {
			opacity: 0;
			scale: 0.5;
		}
	}

	/* Reserved height, so a losing round leaves the pills exactly where a winning one puts them. */
	.win-wrap {
		height: 7vw;
		margin: 2vw 0;
	}
	.win-result {
		position: relative;
		top: 0;
		height: 8vw;
		margin: 1vw 0;
		background: url('/img/win_bg.svg') no-repeat center / contain;
	}
	/* Gold gradient clipped to the glyphs, dropped onto the marquee's pill. */
	.win-amount-lbl {
		position: relative;
		top: 4.65vw;
		color: #f7de70;
		font-family: 'DDIN', sans-serif;
		font-size: 2vw;
		font-weight: 600;
		text-align: center;
		background: linear-gradient(#faab0a, #f3f353);
		-webkit-background-clip: text;
		background-clip: text;
		-webkit-text-fill-color: transparent;
	}

	.result {
		display: flex;
		width: 100%;
		margin: 0 auto;
		overflow: hidden;
	}
	.d-iflex {
		display: inline-flex;
		margin: 0 auto;
	}

	/* The group pill. Colours traced from the original SVG: a blue gradient under a 50% black
	   overlay, lit from inside by four blue inner shadows. */
	.r-group-wrap {
		margin: 0.2vw 0.5vw;
		border-radius: 2vw;
		background:
			linear-gradient(0deg, rgba(0, 0, 0, 0.5) 0%, rgba(0, 0, 0, 0.5) 100%),
			linear-gradient(138deg, rgba(122, 158, 255, 0.63) 0%, rgba(10, 39, 255, 0.6) 100%);
		box-shadow:
			inset 0.58vw 0.78vw 0.78vw 0 rgba(0, 89, 255, 0.36),
			inset 0.11vw 0.11vw 0.11vw 0 rgba(0, 89, 255, 0.56),
			inset -0.39vw -0.58vw 0.78vw 0 rgba(0, 89, 255, 0.37),
			inset -0.11vw -0.11vw 0.11vw 0 rgba(0, 89, 255, 1);
		outline: 0.05vw solid #ffffff;
		justify-content: center;
		align-items: flex-start;
		gap: 1vw;
	}
	/* A colour the player did not back — shown, but not claiming a payout. */
	.r-group-wrap.miss {
		opacity: 0.45;
	}
	.r-group {
		display: inline-flex;
	}

	/* Overrides the 12vw default the shared `.r_*` classes carry (they are sized for the phone
	   layout); the artwork itself still comes from those global rules. */
	.result-ico {
		width: 5vw;
		height: 5vw;
		margin: 0.5vw 0.5vw 0;
	}

	/* Rate badge, tucked up under the dice it belongs to. The artwork comes from the shared
	   `.rate_2x` / `.rate_3x` / `.rate_jp` classes, which also default to the 12vw phone
	   height — overridden here for the same reason as `.result-ico` above. */
	.rate {
		position: relative;
		top: -1vw;
		height: 3vw;
	}
</style>
