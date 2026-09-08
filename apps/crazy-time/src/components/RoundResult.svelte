<script lang="ts">
	/**
	 * Round readout: the win marquee, and nothing else.
	 *
	 * `win_bg.svg` carries the "YOU WIN" artwork; the amount is laid over it. A round that did
	 * not pay has nothing to say here, so it draws nothing at all — the board itself already
	 * shows what landed, on the dice in the tray and on the chips sitting on each colour.
	 *
	 * Non-interactive and laid over the table: the result is not a modal, and nothing has to be
	 * dismissed to keep playing.
	 */
	type Props = {
		/** Cash won this round, in currency units. 0 draws nothing. */
		amount: number;
		/** Currency prefix, e.g. `$`. */
		sign: string;
		/** The board is clearing: shrink away into the middle rather than vanishing. */
		closing?: boolean;
	};

	let { amount, sign, closing = false }: Props = $props();

	const fmt = (value: number) =>
		value >= 1000 ? `${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)}k` : value.toFixed(2);
</script>

{#if amount > 0}
	<div class="result-wrapper" class:closing>
		<div class="win-result">
			<div class="win-amount-lbl">{sign}{fmt(amount)}</div>
		</div>
	</div>
{/if}

<style>
	/* Sat just above the betting panel, so the win reads next to the board it was won on rather
	   than across the middle of the wheel.

	   `--panel-top` is the panel's own top edge, measured by Game.svelte in the frame's units and
	   updated whenever the panel changes height, and `--result-gap` is the breathing room left
	   above it. `pointer-events: none` keeps the board live underneath. */
	.result-wrapper {
		position: absolute;
		top: calc(var(--panel-top, 62%) - var(--result-gap, 1.2vw));
		left: 0;
		right: 0;
		z-index: 22;
		transform: translateY(-100%);
		pointer-events: none;
	}
	/* Dismissed when the board is cleared. It collapses into its own centre, which reads as the
	   readout being put away rather than sliding off somewhere. Duration mirrors RESULT_CLOSE_MS
	   in Game.svelte, which is what actually unmounts this. */
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

	/* The marquee. `contain` fits the artwork to this height and centres it, so the height is what
	   sets its size — and the label below is measured against it, so the two scale together. The
	   frame sets `--result-size`: the portrait frame is narrower, so it asks for more vw. */
	.win-result {
		height: var(--result-size, 8vw);
		background: url('img/win_bg.svg') no-repeat center / contain;
	}
	/* Gold gradient clipped to the glyphs, dropped onto the marquee's pill. The offset sits it in
	   that pill, so it goes with `.win-result`'s height rather than standing on its own. */
	.win-amount-lbl {
		position: relative;
		top: calc(var(--result-size, 8vw) * 0.581);
		color: #f7de70;
		font-family: 'DDIN', sans-serif;
		font-size: calc(var(--result-size, 8vw) * 0.25);
		font-weight: 600;
		text-align: center;
		background: linear-gradient(#faab0a, #f3f353);
		-webkit-background-clip: text;
		background-clip: text;
		-webkit-text-fill-color: transparent;
	}
</style>
