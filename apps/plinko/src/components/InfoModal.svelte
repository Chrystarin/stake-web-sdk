<script lang="ts">
	import { onMount } from 'svelte';

	import { stateBet, stateUrlDerived } from 'state-shared';

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

	// ── Provably fair ────────────────────────────────────────────────────────
	// The Stake RGS does not surface fairness seeds to the game frame (none are
	// present in the authenticate/play responses), so the client seed shown here
	// is the live launch session id and the server-seed commitment is a real
	// SHA-256 over a per-session server seed generated client-side.
	const bytesToHex = (bytes: Uint8Array) =>
		Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

	async function sha256Hex(input: string): Promise<string> {
		const data = new TextEncoder().encode(input);
		const digest = await crypto.subtle.digest('SHA-256', data);
		return bytesToHex(new Uint8Array(digest));
	}

	function randomSeed(): string {
		const bytes = new Uint8Array(32);
		crypto.getRandomValues(bytes);
		return bytesToHex(bytes);
	}

	/** Live session id doubles as the client seed; falls back to a label in local dev. */
	const clientSeed = $derived(stateUrlDerived.sessionID() || 'local-dev-session');

	/** SHA-256 commitment of the per-session server seed (computed once, client-side). */
	let serverSeedHash = $state('');

	onMount(async () => {
		try {
			serverSeedHash = await sha256Hex(randomSeed());
		} catch {
			serverSeedHash = '';
		}
	});
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
								(up to 100x per ball, with bonus rounds reaching your tier's max payout — from 200x
									on a single ball up to 400x with more balls per drop).
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
							<strong>RTP</strong> — Approximately 95.7% (varies slightly with play).
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
								<strong>Set your Bet per Ball</strong> — Choose the amount staked on each ball using
								the − / + steppers, or tap the value to pick from the presets. This is the base wager
								that every pocket multiplier is applied to.
							</li>
							<li>
								<strong>Choose your Ball per Drop</strong> — Use the − / + steppers to release 1, 10,
								20, or 50 balls per drop. Your total <strong>Bet</strong> is calculated automatically as
								Bet per Ball × Ball per Drop. Dropping more balls fills the feature meters faster and
								raises the top potential payout.
							</li>
							<li>
								<strong>Press Play to drop</strong> — Hit the Play button (or press the Space bar) to
								release your balls from the top of the board. Each ball bounces off the pegs and settles
								into one of the multiplier pockets along the bottom.
							</li>
							<li>
								<strong>Collect your win</strong> — Each ball pays Bet per Ball × the multiplier of the
								pocket it lands in. Your total Win for the round is the sum of every ball, plus anything
								awarded by the bonus features.
							</li>
						</ol>
						<div class="info-formula">Total Bet = Bet per Ball × Ball per Drop</div>

						<h3 class="info-section-title">Multipliers &amp; Payouts</h3>
						<p>
							The pockets along the bottom of the board run from low in the center to high at the
							edges. The board layout is fixed — you tune your own risk through Bet per Ball and Ball
							per Drop rather than a difficulty or rows setting.
						</p>
						<ul>
							<li>
								<strong>Center pockets</strong> pay the least (down to 0×), so balls that drift to the
								middle return little or nothing.
							</li>
							<li>
								<strong>Edge pockets</strong> pay the most — up to 100× your Bet per Ball on a single
								ball.
							</li>
							<li>
								With the bonus features in play, a round can reach your tier's maximum payout — from
								200× on a single-ball drop up to 400× when dropping more balls.
							</li>
						</ul>

						<h3 class="info-section-title">Bonus Features</h3>
						<ul>
							<li>
								<strong>Free Spin</strong> — Balls that land in the center pockets fill the Free Spin
								meter beside the board. When it fills during a drop, a wheel spins and adds a multiplier
								(from 0.5× up to 20×) of your Bet per Ball on top of your win; landing on
								<strong>BONUS</strong> chains straight into a bonus round. (Not available on the
								single-ball drop.)
							</li>
							<li>
								<strong>Bonus Round</strong> — Balls that strike the gold coin pegs fill the Bonus
								meter. When it fills, a wheel awards a batch of free balls that drop automatically at no
								extra cost. Strong bonus rounds can level up and award even more balls.
							</li>
						</ul>

						<h3 class="info-section-title">Key Features</h3>
						<ul>
							<li><strong>RTP</strong> — Approximately 95.7% (varies slightly with play).</li>
							<li>
								<strong>Auto</strong> — Pick a number of rounds and the game drops automatically for
								you. Press Auto again to stop and return to manual play.
							</li>
							<li>
								<strong>Fast game</strong> — Speeds up the ball animation for quicker rounds.
							</li>
						</ul>

						<h3 class="info-section-title">Controls &amp; Buttons</h3>
						<p class="howto-subhead">Main Bet Panel</p>
						<ul>
							<li><strong>Balance</strong> — Your available funds.</li>
							<li>
								<strong>Bet</strong> — Your total wager for the round (Bet per Ball × Ball per Drop);
								updates automatically.
							</li>
							<li><strong>Win</strong> — The amount won on your last round.</li>
							<li>
								<strong>Bet per Ball</strong> — The stake on each ball; adjust with − / + or tap the
								value to choose a preset.
							</li>
							<li>
								<strong>Ball per Drop</strong> — Number of balls released per drop (1 / 10 / 20 / 50);
								adjust with − / +.
							</li>
							<li><strong>Play</strong> — Drops your balls. The Space bar does the same.</li>
							<li>
								<strong>Auto</strong> — Opens the autobet round-count list; choose a count to run that
								many rounds automatically, or press again to stop.
							</li>
							<li><strong>Fast game</strong> — Toggles faster ball drops on or off.</li>
						</ul>
						<p>On mobile, tap the coins button to open the Bet per Ball and Ball per Drop settings.</p>
						<p class="howto-subhead">Menu</p>
						<p>Open the Menu button in the top corner to access:</p>
						<ul>
							<li><strong>Game Rules</strong> — Full rules plus the bet and payout limits.</li>
							<li><strong>My Bet History</strong> — A log of your recent rounds.</li>
							<li><strong>How to Play?</strong> — This guide.</li>
							<li><strong>Sound</strong> — Toggles game audio on or off.</li>
						</ul>

						<h3 class="info-section-title">Legal Notice</h3>
						<p>
							Malfunction voids all wins and plays. A consistent internet connection is required. In the event of a disconnection, reload the game to finish any uncompleted rounds. The expected return is calculated over many plays. The game display is not representative of any physical device and is for illustrative purposes only. Winnings are settled according to the amount received from the Remote Game Server and not from events within the web browser. TM and © 2026 Stake Engine.
						</p>
					{:else if stateGame.infoModalTab === 'fair'}
						<p><strong>Provably fair settings</strong></p>
						<p>This game uses Provably Fair technology.</p>
						<p><strong>Next client seed:</strong></p>
						<div class="info-seed-box">{clientSeed}</div>
						<p><strong>Next server seed SHA256:</strong></p>
						<div class="info-seed-box">{serverSeedHash || 'Generating…'}</div>
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
