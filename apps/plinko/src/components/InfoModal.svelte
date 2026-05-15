<script lang="ts">
	import { stateBet } from 'state-shared';

	import config from '../game/config';
	import { stateGame, type InfoModalTab } from '../game/stateGame.svelte';

	type Props = {
		onClose?: () => void;
	};

	const props: Props = $props();

	function close() {
		stateGame.infoModalOpen = false;
		props.onClose?.();
	}

	function setTab(tab: InfoModalTab) {
		stateGame.infoModalTab = tab;
	}
</script>

{#if stateGame.infoModalOpen}
	<div class="info-modal-backdrop" onclick={close} role="presentation">
		<div class="info-modal-wrap" onclick={(e) => e.stopPropagation()} role="dialog">
			<button type="button" class="info-modal-close" onclick={close} aria-label="Close"></button>
			<div class="info-modal">
				<div class="info-modal-tabs">
					<button
						type="button"
						class="info-tab"
						class:info-tab--active={stateGame.infoModalTab === 'rules'}
						onclick={() => setTab('rules')}>Rules</button
					>
					<button
						type="button"
						class="info-tab"
						class:info-tab--active={stateGame.infoModalTab === 'fair'}
						onclick={() => setTab('fair')}>Fair settings</button
					>
					<button
						type="button"
						class="info-tab"
						class:info-tab--active={stateGame.infoModalTab === 'history'}
						onclick={() => setTab('history')}>History</button
					>
				</div>
				<div class="info-modal-body">
					{#if stateGame.infoModalTab === 'rules'}
						<p><strong>Bet limits</strong></p>
						<p>Min bet: {config.minBet} {stateBet.currency}</p>
						<p>Max bet: {config.maxBet} {stateBet.currency}</p>
						<p>Max win: 20 000 {stateBet.currency}</p>
						<p><strong>How to play?</strong></p>
						<ol>
							<li>Select bet and balls per drop. Press PLAY.</li>
							<li>Fill the SPIN gate for FREE SPIN.</li>
							<li>Hit bumpers to fill the bonus meter.</li>
							<li>Bonus starts when the meter is full or you land BONUS on the wheel.</li>
							<li>During bonus, hit bumpers for more free balls and level-ups.</li>
						</ol>
					{:else if stateGame.infoModalTab === 'fair'}
						<p><strong>Provably fair settings</strong></p>
						<p>This game uses Provably Fair technology.</p>
						<p><strong>Next client seed:</strong></p>
						<div class="info-seed-box">session-placeholder</div>
						<p><strong>Next server seed SHA256:</strong></p>
						<div class="info-seed-box">e814403c4e1eb875b3cb6c2944a69829ce5214a35697176</div>
					{:else}
						<table class="info-history-table">
							<thead>
								<tr><th>Result</th><th>Color</th></tr>
							</thead>
							<tbody>
								{#each stateGame.history as row}
									<tr>
										<td>{row.result}×</td>
										<td><span style:background={row.color} class="pill"></span></td>
									</tr>
								{/each}
							</tbody>
						</table>
					{/if}
				</div>
			</div>
		</div>
	</div>
{/if}

<style>
	.info-modal-backdrop {
		position: fixed;
		inset: 0;
		z-index: 18000;
		background: rgba(0, 0, 0, 0.6);
		display: grid;
		place-items: center;
	}
	.info-modal-wrap {
		position: relative;
		width: min(92vw, 640px);
		max-height: 80vh;
	}
	.info-modal-close {
		position: absolute;
		right: 8px;
		top: 8px;
		width: 32px;
		height: 32px;
		border: none;
		border-radius: 50%;
		background: rgba(255, 255, 255, 0.15);
		color: #fff;
		cursor: pointer;
		z-index: 1;
	}
	.info-modal {
		background: #0f1a28;
		border: 1px solid rgba(126, 200, 255, 0.25);
		border-radius: 12px;
		overflow: hidden;
		color: #d6e8f7;
	}
	.info-modal-tabs {
		display: flex;
		border-bottom: 1px solid rgba(255, 255, 255, 0.1);
	}
	.info-tab {
		flex: 1;
		padding: 12px;
		border: none;
		background: transparent;
		color: #9ab8d0;
		cursor: pointer;
	}
	.info-tab--active {
		color: #fff;
		background: rgba(58, 168, 232, 0.15);
	}
	.info-modal-body {
		padding: 20px;
		max-height: 50vh;
		overflow: auto;
		font-size: 14px;
		line-height: 1.5;
	}
	.info-seed-box {
		padding: 10px;
		background: rgba(0, 0, 0, 0.35);
		border-radius: 6px;
		word-break: break-all;
		margin-bottom: 12px;
	}
	.info-history-table {
		width: 100%;
		border-collapse: collapse;
	}
	.info-history-table th,
	.info-history-table td {
		padding: 8px;
		border-bottom: 1px solid rgba(255, 255, 255, 0.08);
	}
	.pill {
		display: inline-block;
		width: 24px;
		height: 12px;
		border-radius: 999px;
	}
</style>
