<script lang="ts">
	import { stateBet } from 'state-shared';

	import { plinkoBetLimits } from '../game/plinkoBet';
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
		history: 'My Bet History',
		howToPlay: 'How to Play?',
	};

	const currencySign = $derived(
		stateBet.currency === 'USD' ? '$' : `${stateBet.currency} `,
	);

	/** Currency-accurate bet/win limits (USD presets, RGS-scaled for other currencies). */
	const betLimits = $derived(plinkoBetLimits());

	/** Sub-tab within the Game Rules view: descriptive rules vs. the limits table. */
	let rulesTab = $state<'rules' | 'limits'>('rules');

	/** Newest entries are stored first (index 0 = top of table). */
	const historyRows = $derived(stateGame.history);

	function formatMoney(value: number) {
		return `${currencySign}${value.toFixed(2)}`;
	}

	/** Grouped amount without forcing decimals on whole numbers (e.g. 0.01, 2,500, 50,000). */
	function formatLimit(value: number) {
		const formatted =
			value >= 1
				? value.toLocaleString('en-US', { maximumFractionDigits: 2 })
				: value.toFixed(2);
		return `${currencySign}${formatted}`;
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
						<div class="info-tabs" role="tablist">
							<button
								type="button"
								role="tab"
								class="info-tab"
								class:info-tab--active={rulesTab === 'rules'}
								aria-selected={rulesTab === 'rules'}
								onclick={() => (rulesTab = 'rules')}
							>
								Rules
							</button>
							<button
								type="button"
								role="tab"
								class="info-tab"
								class:info-tab--active={rulesTab === 'limits'}
								aria-selected={rulesTab === 'limits'}
								onclick={() => (rulesTab = 'limits')}
							>
								Limits
							</button>
						</div>

						{#if rulesTab === 'limits'}
							<div class="info-limits">
								<div class="info-limits-row info-limits-row--head">
									<span>Bet Limits</span>
									<span>Max payout</span>
								</div>
								<div class="info-limits-row">
									<span class="info-limits-value"
										>{formatLimit(betLimits.min)}-{formatLimit(betLimits.max)}</span
									>
									<span class="info-limits-value">{formatLimit(betLimits.maxWin)}</span>
								</div>
							</div>
						{:else}
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
						{/if}
					{:else if stateGame.infoModalTab === 'howToPlay'}
						<div class="howto-pill-bar">
							<span class="howto-pill">One-eyed Willy Plinko</span>
						</div>

						<h3 class="info-section-title">How to Play</h3>
						<ol class="howto-steps">
							<li>
								<strong>Select a Difficulty &amp; Rows</strong> — Choose from Easy, Medium, or Hard
								difficulty settings, and configure the number of pin rows (Lines). Higher difficulty
								settings and more rows add more pockets with larger potential payouts at the extreme
								edges, but lower win chances in the center.
							</li>
							<li>
								<strong>Enter Your Bet</strong> — Set your wager amount. You can use the quick buttons
								to half (½) or double (2×) your bet, or select Max. You can also specify the Bet per
								Ball and the total Ball per Drop count.
							</li>
							<li>
								<strong>Hit “Play / Spin” to Drop</strong> — Press the Play button to release the balls
								from the top pirate hatch. The balls will deflect off the pegs randomly and drop down
								into the multiplier pockets below. You can click rapidly to drop multiple balls
								consecutively.
							</li>
							<li>
								<strong>See the Result</strong> — Your payout = Bet per Ball × Multiplier of the pocket
								where each ball lands.
							</li>
						</ol>

						<h3 class="info-section-title">Difficulty Levels &amp; Multipliers</h3>
						<p>
							Note: The exact multiplier layout shifts dynamically depending on the selected Rows
							(Lines) and Difficulty configuration chosen by the player.
						</p>
						<ul>
							<li>
								<strong>Easy</strong> — Low volatility. The center pockets return a safe portion of
								your bet, while the outer edge multipliers remain scaled for steady, small-scale
								returns.
							</li>
							<li>
								<strong>Medium</strong> — Balanced volatility. Payout ranges broaden, giving a mix of
								baseline retention and moderate spike multipliers.
							</li>
							<li>
								<strong>Hard</strong> — High volatility. Center pockets yield very low returns (0.2×),
								but the extreme outer pockets scale dramatically up to massive top-tier payouts.
							</li>
						</ul>

						<h3 class="info-section-title">Key Features</h3>
						<ul>
							<li><strong>RTP</strong> — ~95%–96% (varies slightly depending on settings).</li>
							<li>
								<strong>Auto Mode</strong> — Set a fixed number of automated ball drops, specify
								loss/profit thresholds, and automatically scale your wagers based on wins or losses.
							</li>
							<li>
								<strong>Fast-Paced</strong> — Supports continuous rapid ball drops simultaneously on
								the active peg canvas.
							</li>
						</ul>

						<h3 class="info-section-title">Controls &amp; Buttons</h3>
						<p class="howto-subhead">Main Bet Panel</p>
						<ul>
							<li><strong>Manual</strong> — Switches to manual play mode.</li>
							<li>
								<strong>Auto</strong> — Switches to autobet mode and opens the automated setting
								parameters.
							</li>
							<li><strong>Bet</strong> — Enter your wager amount for each individual ball.</li>
							<li><strong>½</strong> — Halves the current bet amount.</li>
							<li><strong>2×</strong> — Doubles the current bet amount.</li>
							<li><strong>Max</strong> — Sets the bet to the maximum allowed limit.</li>
							<li><strong>Difficulty</strong> — Selects between Easy, Medium, and Hard.</li>
							<li><strong>Rows / Lines</strong> — Adjusts the peg grid matrix layer depth.</li>
							<li>
								<strong>Play Button</strong> — Drops the designated number of balls down the peg array.
							</li>
						</ul>
						<p class="howto-subhead">Autobet Options (Auto Tab)</p>
						<ul>
							<li>
								<strong>Number of bets</strong> — Sets how many rounds run automatically (0 =
								unlimited).
							</li>
							<li>
								<strong>On Win / On Loss</strong> — Automatically resets or increases the next wager by
								a specific percentage (10% to 100%).
							</li>
							<li>
								<strong>Stop on Profit</strong> — Stops autobet once your cumulative session profit
								reaches this cap.
							</li>
							<li>
								<strong>Stop on Loss</strong> — Stops autobet once your cumulative session loss crosses
								this limit.
							</li>
						</ul>
						<p class="howto-subhead">Settings Menu (Gear Icon)</p>
						<ul>
							<li>
								<strong>Volume Icon / Slider</strong> — Mutes, unmutes, or adjusts background sound
								levels from 0 to 100.
							</li>
							<li><strong>My bet history</strong> — Opens a rolling ledger log of your recent drops.</li>
							<li>
								<strong>Game Info</strong> — Opens the technical structural boundaries and the Game
								Rules tab.
							</li>
						</ul>

						<h3 class="info-section-title">Legal Notice</h3>
						<p>
							Malfunction voids all wins and plays. A consistent internet connection is required. In
							the event of a disconnection, reload the game to finish any uncompleted rounds. The
							expected return is calculated over millions of plays.
						</p>
					{:else if stateGame.infoModalTab === 'fair'}
						<p><strong>Provably fair settings</strong></p>
						<p>This game uses Provably Fair technology.</p>
						<p><strong>Next client seed:</strong></p>
						<div class="info-seed-box">session-placeholder</div>
						<p><strong>Next server seed SHA256:</strong></p>
						<div class="info-seed-box">e814403c4e1eb875b3cb6c2944a69829ce5214a35697176</div>
					{:else}
						<div class="info-history-pane">
							<div class="info-history-scroll">
								<table class="info-history-table">
									<thead>
										<tr>
											<th>Date</th>
											<th>Bet</th>
											<th>Mult.</th>
											<th>Win</th>
										</tr>
									</thead>
									<tbody>
										{#each historyRows as row, index (`${row.date}-${row.bet}-${row.multiplier}-${index}`)}
											<tr>
												<td>{row.date}</td>
												<td>{row.betPlaceholder ? '- - -' : formatMoney(row.bet)}</td>
												<td>
													<span
														class="info-mult-pill"
														style:background={row.color}
													>
														{row.label ?? formatHistoryMultiplier(row.multiplier)}
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
	.info-tabs {
		display: flex;
		justify-content: center;
		gap: 8px;
		margin: 0 0 18px;
	}
	.info-tab {
		padding: 7px 22px;
		border: none;
		border-radius: 8px;
		background: transparent;
		color: #9ab8d0;
		font-size: 14px;
		font-weight: 600;
		cursor: pointer;
		transition:
			background 0.15s ease,
			color 0.15s ease;
	}
	.info-tab:hover {
		color: #d6e8f7;
	}
	.info-tab--active {
		background: rgba(126, 200, 255, 0.16);
		color: #fff;
	}
	.info-limits {
		display: flex;
		flex-direction: column;
		gap: 14px;
	}
	.info-limits-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 16px;
		padding-bottom: 10px;
		border-bottom: 1px solid rgba(255, 255, 255, 0.08);
	}
	.info-limits-row--head {
		color: #fff;
		font-weight: 700;
		font-size: 15px;
	}
	.info-limits-value {
		color: #7ec8ff;
		font-size: 14px;
		font-weight: 600;
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
	/* Sticky game-name pill that stays pinned while the How to Play content scrolls. */
	.howto-pill-bar {
		position: sticky;
		/* Pin to the body's padding-box top (top = -padding) so the bar's background
		 * covers the full strip — otherwise a gap the height of the padding shows
		 * scrolled content above the pill. */
		top: -20px;
		z-index: 2;
		display: flex;
		justify-content: center;
		margin: -20px -20px 14px;
		padding: 20px 20px 12px;
		background: #0f1a28;
	}
	.howto-pill {
		padding: 9px 24px;
		border-radius: 999px;
		background: rgba(126, 200, 255, 0.1);
		border: 1px solid rgba(126, 200, 255, 0.3);
		color: #fff;
		font-size: 15px;
		font-weight: 700;
		line-height: 1.2;
		text-align: center;
	}
	.howto-subhead {
		margin: 14px 0 8px;
		font-size: 14px;
		font-weight: 700;
		color: #fff;
	}
	.howto-steps li {
		margin-bottom: 10px;
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
		/* Single table: header + body share one column grid, so centered titles line up
		 * exactly with the centered cell contents (no scrollbar / padding drift). */
		border-spacing: 0 6px;
	}
	.info-history-table thead th {
		position: sticky;
		top: 0;
		z-index: 1;
		text-align: center;
		font-size: 12px;
		color: #e9eff9;
		padding: 8px 10px;
		margin: 0;
		font-weight: 600;
		background: #0f1a28;
		box-shadow: 0 1px 0 rgba(255, 255, 255, 0.08);
	}
	.info-history-table th:nth-child(1),
	.info-history-table td:nth-child(1) {
		width: 32%;
	}
	.info-history-table th:nth-child(2),
	.info-history-table td:nth-child(2) {
		width: 22%;
	}
	.info-history-table th:nth-child(3),
	.info-history-table td:nth-child(3) {
		width: 22%;
	}
	.info-history-table th:nth-child(4),
	.info-history-table td:nth-child(4) {
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
		text-align: center;
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
