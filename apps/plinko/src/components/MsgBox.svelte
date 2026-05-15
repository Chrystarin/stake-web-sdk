<script lang="ts">
	import { stateGame } from '../game/stateGame.svelte';
	import { hideMsgBox } from '../game/gameOrchestrator';

	function confirm() {
		stateGame.msgBox?.onConfirm?.();
		hideMsgBox();
	}

	function cancel() {
		stateGame.msgBox?.onCancel?.();
		hideMsgBox();
	}
</script>

{#if stateGame.msgBox}
	<div class="msg-wrapper" role="dialog" aria-modal="true">
		<div class="msg-box">
			<div class="msg-text">{stateGame.msgBox.text}</div>
			<div class="msg-btns">
				<button type="button" class="btn confirm-btn" onclick={confirm}>
					{stateGame.msgBox.confirmText ?? 'OK'}
				</button>
				{#if stateGame.msgBox.onCancel || stateGame.msgBox.cancelText}
					<button type="button" class="btn cancel-btn" onclick={cancel}>
						{stateGame.msgBox.cancelText ?? 'Cancel'}
					</button>
				{/if}
			</div>
		</div>
	</div>
{/if}

<style>
	.msg-wrapper {
		position: fixed;
		inset: 0;
		z-index: 20000;
		display: grid;
		place-items: center;
		background: rgba(0, 0, 0, 0.55);
	}
	.msg-box {
		min-width: 280px;
		max-width: 90vw;
		padding: 24px;
		background: linear-gradient(180deg, #1a2a3d, #0d1520);
		border: 1px solid rgba(126, 200, 255, 0.35);
		border-radius: 12px;
		color: #e8f4ff;
	}
	.msg-text {
		margin-bottom: 20px;
		text-align: center;
	}
	.msg-btns {
		display: flex;
		gap: 12px;
		justify-content: center;
	}
	.btn {
		border: none;
		border-radius: 999px;
		padding: 10px 24px;
		cursor: pointer;
		font-weight: 700;
	}
	.confirm-btn {
		background: linear-gradient(180deg, #3aa8e8, #1d6fad);
		color: #fff;
	}
	.cancel-btn {
		background: rgba(255, 255, 255, 0.1);
		color: #fff;
	}
</style>
