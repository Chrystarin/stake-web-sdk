<script lang="ts">
	import { innerHeight, innerWidth } from 'svelte/reactivity/window';
	import { stateBet } from 'state-shared';

	import { stateGame } from '../game/stateGame.svelte';
	import { isPortraitGameLayout } from '../lib/format';

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
				{stateGame.resultAmount.toFixed(2)}
				<span class="suffix">{stateBet.currency}</span>
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
	.result-wrapper {
		display: flex;
		align-items: center;
		gap: 16px;
		padding: 20px 32px;
		background: rgba(8, 16, 28, 0.88);
		border: 2px solid rgba(255, 214, 96, 0.5);
		border-radius: 16px;
		animation: fade-in 0.3s ease;
	}
	.rate-lbl {
		font-family: 'Poppins', system-ui, sans-serif;
		font-size: 2.5rem;
		font-weight: 900;
		color: #fee663;
		/* em so the stroke scales with the font (≈1.2px at the 40px desktop size). */
		-webkit-text-stroke: 0.03em #fee663;
		paint-order: stroke fill;
	}
	.sep {
		width: 2px;
		height: 48px;
		background: rgba(255, 255, 255, 0.2);
	}
	.amount-lbl {
		font-family: 'Poppins', system-ui, sans-serif;
		font-size: 1.8rem;
		font-weight: 900;
		color: #fff;
		/* em so the stroke scales with the font (≈0.9px at the ~29px desktop size). */
		-webkit-text-stroke: 0.031em #fff;
		paint-order: stroke fill;
	}
	.suffix {
		margin-left: 6px;
		font-size: 1rem;
		opacity: 0.8;
	}

	/*
	 * Portrait / mobile: the root font-size floors at 8px on narrow screens, so the rem-based
	 * desktop sizes collapse to ~half (20px multiplier) and look tiny. Re-scale with the
	 * viewport using px+vw clamps — the convention used across the mobile UI (e.g. the
	 * roulettes) — with px floors at the desktop size so it never gets smaller, and px
	 * ceilings so it can't blow up on a portrait tablet. Keeps the multiplier↔amount ratio
	 * (~1.38) from the reference.
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
