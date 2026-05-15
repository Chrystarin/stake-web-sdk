<script lang="ts">
	import { stateGame } from '../game/stateGame.svelte';
</script>

{#if stateGame.toastMessage}
	<div class="toast" class:toast--error={stateGame.toastType === 'error'} role="status">
		{stateGame.toastMessage}
	</div>
{/if}

<style>
	.toast {
		position: fixed;
		top: 16px;
		left: 50%;
		transform: translateX(-50%);
		z-index: 19000;
		padding: 12px 24px;
		border-radius: 8px;
		background: rgba(20, 40, 60, 0.95);
		color: #e8f4ff;
		border: 1px solid rgba(126, 200, 255, 0.35);
		font-weight: 600;
	}
	.toast--error {
		border-color: rgba(255, 100, 100, 0.5);
		color: #ffd0d0;
	}
</style>
