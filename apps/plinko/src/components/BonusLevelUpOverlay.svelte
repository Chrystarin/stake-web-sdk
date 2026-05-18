<script lang="ts">
	import { stateGame } from '../game/stateGame.svelte';
	import { staticUrl } from '../lib/staticUrl';
</script>

{#if stateGame.bonusLevelUpOverlayOpen}
	<div
		class="bonus-level-up-overlay"
		class:bonus-level-up-overlay--visible={stateGame.bonusLevelUpOverlayVisible}
	>
		<div class="bonus-level-up-card" style:background-image="url({staticUrl('img/bonus-level-up-base.png')})">
			<div class="bonus-level-up-title">LEVEL {stateGame.bonusLevelUpLevel}</div>
			<div class="bonus-level-up-reward">
				<span class="bonus-level-up-reward-value">+{stateGame.bonusLevelUpAddedBalls}</span>
				<span class="bonus-level-up-reward-label">FREE BALLS</span>
			</div>
		</div>
	</div>
{/if}

<style>
	.bonus-level-up-overlay {
		position: fixed;
		inset: 0;
		z-index: 14000;
		display: grid;
		place-items: center;
		pointer-events: none;
		opacity: 0;
		transition: opacity 0.28s ease;
	}
	.bonus-level-up-overlay--visible {
		opacity: 1;
	}
	.bonus-level-up-card {
		min-width: 280px;
		padding: 32px 48px;
		text-align: center;
		background-size: 100% 100%;
		color: #fee663;
	}
	.bonus-level-up-title {
		font-size: 1.5rem;
		font-weight: 800;
		margin-bottom: 16px;
	}
	.bonus-level-up-reward-value {
		display: block;
		font-size: 3rem;
		font-weight: 800;
	}
	.bonus-level-up-reward-label {
		font-size: 1rem;
		letter-spacing: 0.12em;
	}
</style>
