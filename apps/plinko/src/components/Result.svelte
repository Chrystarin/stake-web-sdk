<script lang="ts">
	import { innerHeight, innerWidth } from 'svelte/reactivity/window';
	import { stateBet } from 'state-shared';

	import { stateGame } from '../game/stateGame.svelte';
	import { displayCurrency, formatResultAmount, isPortraitGameLayout } from '../lib/format';

	/**
	 * Match Game/Background: the win popup is a fixed overlay outside `.game-root`, so it
	 * can't inherit the mobile layout class. Track viewport size and switch to the portrait
	 * (vw-scaled) sizing in lockstep so the popup stays proportionate on narrow screens
	 * instead of staying pinned at its small desktop pixel size.
	 */
	const portrait = $derived.by(() => {
		innerWidth.current;
		innerHeight.current;
		return isPortraitGameLayout();
	});
</script>

{#if stateGame.resultVisible}
	<div class="result-overlay" class:result-overlay--portrait={portrait}>
		<div class="result-wrapper">
			<div class="rate-lbl">{stateGame.resultRate}×</div>
			<div class="sep"></div>
			<div class="amount-lbl">
				{formatResultAmount(stateGame.resultAmount)}
				<span class="suffix">{displayCurrency(stateBet.currency)}</span>
			</div>
		</div>
	</div>
{/if}

<style>
	.result-overlay {
		position: fixed;
		inset: 0;
		z-index: 15000;
		display: grid;
		place-items: center;
		pointer-events: none;
	}
	/* Landscape sizing. Every px below is stated in --ui-px so the whole card is a uniform scale of its
	   1024×576 reference self — the vw terms already track the viewport, but the clamp floors bind long
	   before Stake's 400×225 popout and would leave the type ~2.5× oversized against the board. */
	.result-wrapper {
		display: flex;
		align-items: center;
		gap: calc(16 * var(--ui-px));
		padding: calc(20 * var(--ui-px)) calc(32 * var(--ui-px));
		background: rgba(8, 16, 28, 0.88);
		border: calc(2 * var(--ui-px)) solid rgba(255, 214, 96, 0.5);
		border-radius: calc(16 * var(--ui-px));
		animation: fade-in 0.3s ease;
	}
	.rate-lbl {
		font-family: 'Poppins', system-ui, sans-serif;
		/* vw-driven so it tracks the viewport; px bounds keep it sane on very small/large screens. */
		font-size: clamp(calc(30 * var(--ui-px)), 3.1vw, calc(56 * var(--ui-px)));
		font-weight: 900;
		color: #fee663;
		/* em so the stroke scales with the font (≈2px at the 40px desktop size). */
		-webkit-text-stroke: 0.05em #fee663;
		paint-order: stroke fill;
	}
	.sep {
		width: calc(2 * var(--ui-px));
		height: calc(48 * var(--ui-px));
		background: rgba(255, 255, 255, 0.2);
	}
	.amount-lbl {
		font-family: 'Poppins', system-ui, sans-serif;
		/* vw-driven so it tracks the viewport; px bounds keep it sane on very small/large screens. */
		font-size: clamp(calc(22 * var(--ui-px)), 2.25vw, calc(40 * var(--ui-px)));
		font-weight: 900;
		color: #fff;
		/* em so the stroke scales with the font (≈1.4px at the ~29px desktop size). */
		-webkit-text-stroke: 0.05em #fff;
		paint-order: stroke fill;
	}
	.suffix {
		margin-left: calc(6 * var(--ui-px));
		font-size: calc(16 * var(--ui-px));
		opacity: 0.8;
	}

	/*
	 * Portrait / mobile: portrait viewports are far narrower, so they need a much larger vw
	 * coefficient than the landscape base (~13vw vs ~3vw) to stay proportionate. Same vw-driven
	 * px+clamp convention used across the mobile UI (e.g. the roulettes): px floors at the
	 * desktop size so it never gets smaller, px ceilings so it can't blow up on a portrait
	 * tablet. Keeps the multiplier↔amount ratio (~1.38) from the reference.
	 */
	.result-overlay--portrait .result-wrapper {
		gap: clamp(16px, 4vw, 28px);
		padding: clamp(18px, 5vw, 30px) clamp(26px, 7.5vw, 46px);
		border-radius: clamp(16px, 4vw, 22px);
	}
	.result-overlay--portrait .rate-lbl {
		font-size: clamp(40px, 13vw, 72px);
	}
	.result-overlay--portrait .amount-lbl {
		font-size: clamp(28px, 9.4vw, 52px);
	}
	.result-overlay--portrait .sep {
		width: clamp(2px, 0.6vw, 3px);
		height: clamp(40px, 13vw, 72px);
	}
	.result-overlay--portrait .suffix {
		font-size: clamp(14px, 3.4vw, 22px);
	}
	@keyframes fade-in {
		from {
			opacity: 0;
			transform: scale(0.9);
		}
		to {
			opacity: 1;
			transform: scale(1);
		}
	}
</style>
