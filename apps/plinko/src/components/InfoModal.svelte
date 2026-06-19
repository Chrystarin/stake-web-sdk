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

	const sectionTitles: Record<InfoModalTab, string> = {
		rules: 'Game Rules',
		fair: 'Provably fair settings',
		history: 'My bet History',
		howToPlay: 'How to Play?',
	};

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
				<header class="info-modal-header">
					<h2 class="info-modal-title">{sectionTitles[stateGame.infoModalTab]}</h2>
				</header>
				<div
					class="info-modal-body"
					class:info-modal-body--history={stateGame.infoModalTab === 'history'}
				>
					{#if stateGame.infoModalTab === 'rules'}
						<h3 class="info-section-title">Bet limits</h3>
						<p>Min bet: {config.minBet} {stateBet.currency}</p>
						<p>Max bet: {config.maxBet} {stateBet.currency}</p>
						<p>Max win: 20 000 {stateBet.currency}</p>

						<h3 class="info-section-title">Main Betting Components</h3>
						<p>The betting interface is straightforward and matches the on-screen controls:</p>
						<ul>
							<li>
								<strong>BET</strong> – Shows your total wager for the current round (automatically
								calculated).
							</li>
							<li>
								<strong>BET PER BALL</strong> – Base amount wagered on each single cannonball. Adjust
								with + / − buttons.
							</li>
							<li>
								<strong>BALL PER DROP</strong> – Number of cannonballs released per round. Adjust with
								+ / − buttons.
							</li>
						</ul>
						<p>Total Bet is calculated as:</p>
						<div class="info-formula">Total Bet = Bet Per Ball × Ball Per Drop</div>
						<p><strong>Example:</strong></p>
						<div class="info-formula">
							Bet Per Ball = $0.10<br />
							Ball Per Drop = 10<br />
							Total Bet = $1.00
						</div>
						<p>
							The game clearly displays the WIN amount after each round and shows your current total
							bet near the controls.
						</p>

						<h3 class="info-section-title">Multipliers &amp; Payouts</h3>
						<p>
							The bottom of the board features a row of colored multiplier slots (from low in the
							center to high on the edges).
						</p>
						<ul>
							<li>
								<strong>Low-value slots</strong> (center, often green/blue) = smaller returns
								(sometimes below 1x).
							</li>
							<li>
								<strong>High-value slots</strong> (outer edges, often red/purple) = huge multipliers
								(can reach 100x, 500x or even 1000x+ depending on settings).
							</li>
						</ul>
						<p>
							A “SPIN” label appears in the center of the multiplier bar. Multiplier values are
							clearly shown and can vary based on your chosen volatility/risk settings. The more balls
							and higher risk you select, the bigger the potential payouts.
						</p>

						<h3 class="info-section-title">Key Features &amp; Settings</h3>
						<p>
							<strong>Theme</strong> — Immersive pirate adventure under a blood-red crimson sky: a
							giant pirate skull captain wearing a tricorn hat sits atop the ship deck board, with
							flying Jolly Roger flags, stormy seas, distant ghost ships, flaming torches, and
							dramatic moonlit atmosphere.
						</p>
						<p>
							<strong>RTP</strong> — Approximately 95%–96% (varies slightly depending on settings and
							casino).
						</p>
						<p>
							<strong>Volatility</strong> — Tunable through your bet and ball choices — longer dry
							spells possible, but big multiplier landings deliver massive wins.
						</p>

						<h3 class="info-section-title">Bonus Feature</h3>
						<p><strong>Free Spin / Crimson Fury Bonus</strong></p>
						<p>
							The game features a FREE SPIN progress bar (visible on the right side of the multiplier
							bar). Every time you play and plinko balls hit “SPIN” spots, the Multiplier Roulette
							meter fills up with crimson energy.
						</p>
						<p>
							Every time you play and plinko balls hit the 3 gold pegs at the middle, the Bonus
							feature meter at the top fills up and will trigger the Free Balls Bonus Feature.
						</p>
						<p>When the meter at the top reaches full capacity, the FREE SPIN bonus automatically triggers:</p>
						<ul>
							<li>You receive a batch of free ball drops (no additional cost).</li>
							<li>
								Additional hits or good landings during the free spins can further fill the meter and
								award even more free drops.
							</li>
						</ul>
						<p>
							When the meter at the left reaches full capacity, the Multiplier Roulette Spin bonus
							automatically triggers:
						</p>
						<ul>
							<li>
								The Current Bet amount will have a chance to get a multiplier from the Multiplier
								Roulette Spin.
							</li>
							<li>
								This Multiplier Roulette also has a chance to trigger a bonus free balls feature (one
								segment shows a Free Bonus within the set of multipliers).
							</li>
						</ul>
						<p>
							This creates exciting chain reactions where one triggered bonus can snowball into many
							extra drops and bigger hauls.
						</p>
					{:else if stateGame.infoModalTab === 'howToPlay'}
						<p><strong>How to Play (Step-by-Step)</strong></p>
						<ol>
							<li>
								<strong>Set your bet</strong> – Adjust the total BET or use the individual controls
								below.
							</li>
							<li>
								<strong>Choose Bet Per Ball</strong> – This is the stake for each individual cannonball
								(typically starts as low as $0.01 and can go up to $200+ depending on the casino).
							</li>
							<li>
								<strong>Choose Ball Per Drop</strong> – Select how many cannonballs you want to release
								in one round (common options include 10, 20, or 50).
							</li>
							<li>
								Press SPIN (or the play button) to drop the balls and watch them bounce down the
								board.
							</li>
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
	.info-modal-header {
		display: flex;
		align-items: center;
		padding: 14px 20px;
		border-bottom: 1px solid rgba(255, 255, 255, 0.1);
	}
	.info-modal-title {
		margin: 0;
		color: #fff;
		font-size: 16px;
		font-weight: 700;
		line-height: 1.2;
	}
	.info-modal-body {
		padding: 20px;
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		font-size: 14px;
		line-height: 1.5;
	}
	.info-modal-body p {
		margin: 0 0 8px;
	}
	.info-section-title {
		margin: 18px 0 8px;
		font-size: 15px;
		font-weight: 700;
		color: #fff;
	}
	.info-section-title:first-child {
		margin-top: 0;
	}
	.info-modal-body ul,
	.info-modal-body ol {
		margin: 0 0 10px;
		padding-left: 20px;
	}
	.info-modal-body li {
		margin-bottom: 6px;
	}
	.info-modal-body strong {
		color: #fff;
	}
	.info-formula {
		padding: 10px 12px;
		margin: 0 0 10px;
		background: rgba(0, 0, 0, 0.35);
		border-radius: 6px;
		font-size: 13px;
		line-height: 1.6;
		color: #eaf3fb;
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
