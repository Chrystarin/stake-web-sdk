<script lang="ts">
	import { stateBet } from 'state-shared';

	import { stateGame } from '../game/stateGame.svelte';
</script>

{#if stateGame.resultVisible}
	<div class="result-overlay">
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
		font-size: 2.5rem;
		font-weight: 800;
		color: #fee663;
	}
	.sep {
		width: 2px;
		height: 48px;
		background: rgba(255, 255, 255, 0.2);
	}
	.amount-lbl {
		font-size: 1.8rem;
		font-weight: 700;
		color: #fff;
	}
	.suffix {
		margin-left: 6px;
		font-size: 1rem;
		opacity: 0.8;
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
