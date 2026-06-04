<script lang="ts">
	import { stateBet } from 'state-shared';

	import config from '../game/config';
	import { stateGame, type InfoModalTab } from '../game/stateGame.svelte';
	import { formatHistoryMultiplier } from '../lib/format';
	import { staticUrl } from '../lib/staticUrl';

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

	const currencySign = $derived(
		stateBet.currency === 'USD' ? '$' : `${stateBet.currency} `,
	);

	/** Newest entries are stored first (index 0 = top of table). */
	const historyRows = $derived(stateGame.history);

	function formatMoney(value: number) {
		return `${currencySign}${value.toFixed(2)}`;
	}
</script>

{#if stateGame.infoModalOpen}
	<div class="info-modal-backdrop" onclick={close} role="presentation">
		<div class="info-modal-wrap" onclick={(e) => e.stopPropagation()} role="dialog">
			<button type="button" class="info-modal-close" onclick={close} aria-label="Close">
				<img src={staticUrl('img/close_btn.png')} alt="" aria-hidden="true" />
			</button>
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
				<div
					class="info-modal-body"
					class:info-modal-body--history={stateGame.infoModalTab === 'history'}
				>
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
						<div class="info-history-pane">
							<table class="info-history-table info-history-table--head">
								<thead>
									<tr>
										<th>Date</th>
										<th>Bet</th>
										<th>Mult.</th>
										<th>Win</th>
									</tr>
								</thead>
							</table>
							<div class="info-history-scroll">
								<table class="info-history-table info-history-table--body">
									<tbody>
										{#each historyRows as row, index (`${row.date}-${row.bet}-${row.multiplier}-${index}`)}
											<tr>
												<td>{row.date}</td>
												<td>{formatMoney(row.bet)}</td>
												<td>
													<span
														class="info-mult-pill"
														style:background={row.color}
													>
														{formatHistoryMultiplier(row.multiplier)}
													</span>
												</td>
												<td>{formatMoney(row.win)}</td>
											</tr>
										{:else}
											<tr>
												<td colspan="4" class="info-history-empty">No bets yet</td>
											</tr>
										{/each}
									</tbody>
								</table>
							</div>
						</div>
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
		max-height: min(80vh, 720px);
		display: flex;
		flex-direction: column;
	}
	.info-modal-close {
		position: absolute;
		top: 0;
		right: 0;
		z-index: 2;
		padding: 0;
		border: none;
		background: transparent;
		cursor: pointer;
		line-height: 0;
		transform: translate(42%, -42%);
	}
	.info-modal {
		background: #0f1a28;
		border: 1px solid rgba(126, 200, 255, 0.25);
		border-radius: 12px;
		overflow: hidden;
		color: #d6e8f7;
		display: flex;
		flex-direction: column;
		flex: 1;
		min-height: 0;
		max-height: inherit;
	}
	.info-modal-close img {
		display: block;
		width: 36px;
		height: 36px;
		object-fit: contain;
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
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		font-size: 14px;
		line-height: 1.5;
	}
	.info-modal-body--history {
		padding: 0;
		overflow: hidden;
		display: flex;
		flex-direction: column;
	}
	.info-history-pane {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}
	.info-history-scroll {
		flex: 1;
		min-height: 0;
		overflow-x: hidden;
		overflow-y: auto;
		padding: 0 20px 20px;
		-webkit-overflow-scrolling: touch;
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
		table-layout: fixed;
		border-collapse: separate;
		border-spacing: 0;
	}
	.info-history-table--head {
		flex-shrink: 0;
		border-spacing: 0;
	}
	.info-history-table--head th {
		text-align: left;
		font-size: 12px;
		color: #e9eff9;
		padding: 8px 10px;
		margin: 0;
		font-weight: 600;
		background: #0f1a28;
		box-shadow: 0 1px 0 rgba(255, 255, 255, 0.08);
	}
	.info-history-table--body {
		border-spacing: 0 6px;
	}
	.info-history-table--head th:nth-child(1),
	.info-history-table--body td:nth-child(1) {
		width: 32%;
	}
	.info-history-table--head th:nth-child(2),
	.info-history-table--body td:nth-child(2) {
		width: 22%;
	}
	.info-history-table--head th:nth-child(3),
	.info-history-table--body td:nth-child(3) {
		width: 22%;
	}
	.info-history-table--head th:nth-child(4),
	.info-history-table--body td:nth-child(4) {
		width: 24%;
	}
	.info-history-empty {
		text-align: center;
		color: #9ab8d0;
		font-weight: 500;
		background: transparent !important;
	}
	.info-history-table td {
		padding: 8px 10px;
		background: rgba(106, 124, 160, 0.45);
		color: #f2f7ff;
		font-size: 13px;
		font-weight: 600;
		vertical-align: middle;
	}
	.info-history-table tr td:first-child {
		border-top-left-radius: 8px;
		border-bottom-left-radius: 8px;
	}
	.info-history-table tr td:last-child {
		border-top-right-radius: 8px;
		border-bottom-right-radius: 8px;
	}
	.info-mult-pill {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 48px;
		height: 26px;
		padding: 0 8px;
		border-radius: 8px;
		color: #fff;
		font-size: 13px;
		font-weight: 700;
		line-height: 1;
		text-shadow: 0 1px 2px rgba(0, 0, 0, 0.45);
	}
</style>
