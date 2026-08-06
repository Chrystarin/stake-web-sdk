<script lang="ts">
	import { stateBet } from 'state-shared';

	import { buyBonusCost, plinkoBetLimits } from '../game/plinkoBet';
	import { BUY_BONUS_TIERS } from '../game/plinkoBetMode';
	import { stateGame, type InfoModalTab } from '../game/stateGame.svelte';
	import {
		BOARD_SLOT_MULTIPLIERS,
		ONE_BALL_BOARD_SLOT_MULTIPLIERS,
	} from '../game-logic/boardMultipliers';
	import {
		BALL_PER_DROP_TIERS,
		BONUS_LEVEL_LABELS,
		BONUS_LEVELUP_PEGS,
		BONUS_WHEEL_FREE_BALLS,
		FREE_SPIN_SEGMENTS,
		bonusInDropForBalls,
		bonusLevelBalls,
		bonusMeterTierFor,
		spinMeterTierFor,
	} from '../game-logic/constants';
	import { slotColorForRateIndex } from '../game-logic/slotColors';
	import {
		currencySign as currencySignFor,
		formatCoefficientLabel,
		formatWinAmount,
	} from '../lib/format';
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
		history: 'My Bet History',
		howToPlay: 'How to Play?',
	};

	const currencySign = $derived(currencySignFor(stateBet.currency));

	/** Currency-accurate bet/win limits (USD presets, RGS-scaled for other currencies). */
	const betLimits = $derived(plinkoBetLimits());

	/** Sub-tab within the Game Rules view: descriptive rules vs. the limits table. */
	let rulesTab = $state<'rules' | 'limits'>('rules');

	/** Newest entries are stored first (index 0 = top of table). */
	const historyRows = $derived(stateGame.history);

	function formatMoney(value: number) {
		return `${currencySign}${value.toFixed(2)}`;
	}

	/** Win amounts show up to 4 decimals so small wins on low bets aren't rounded to 0.00. */
	function formatWin(value: number) {
		return formatWinAmount(value, currencySign);
	}

	/**
	 * Feature-trigger thresholds, per balls-per-drop tier, read straight from the meter tables so the
	 * published rules can never drift from the numbers the meters actually use. Only the tiers that can
	 * fire a feature are listed — the 1-ball tier has neither meter, and is called out in prose instead.
	 * `hits` is what THIS drop must land: the free-spin meter seeds at a per-tier head start
	 * (`spinMeterTierFor().start`), so its remaining hits are max − start, not max.
	 */
	const meterRows = BALL_PER_DROP_TIERS.filter(bonusInDropForBalls).map((balls) => {
		const bonus = bonusMeterTierFor(balls);
		const spin = spinMeterTierFor(balls);
		return {
			balls,
			bonusHits: bonus.max - bonus.start,
			spinHits: spin.max - spin.start,
			spinStart: spin.start,
			spinMax: spin.max,
		};
	});

	/** Bonus re-trigger ladder: index i is the hits needed to LEAVE level i+1, i.e. to REACH level i+2. */
	const bonusLevelRows = BONUS_LEVELUP_PEGS.map((pegs, index) => ({
		level: index + 2,
		pegs,
		freeBalls: bonusLevelBalls(index + 2),
	}));

	/** Top of the level ladder (the bonus can't climb past it). */
	const maxBonusLevel = BONUS_LEVEL_LABELS.length;

	/** Entry-wheel free-ball award range, from the painted wheel values. */
	const wheelSegmentCount = BONUS_WHEEL_FREE_BALLS.length;
	const wheelMinBalls = Math.min(...BONUS_WHEEL_FREE_BALLS);
	const wheelMaxBalls = Math.max(...BONUS_WHEEL_FREE_BALLS);

	/** `100` / `1.5` / `0.2` — the same label the pocket is painted with on the board. */
	function formatMultiplier(value: number) {
		return `${formatCoefficientLabel(value)}×`;
	}

	/**
	 * Pocket paytable, read off the board tables themselves.
	 *
	 * Both boards are symmetric, so one row covers the mirrored PAIR at that distance from the center
	 * (2 pockets) and the last row is the lone center pocket. Rows run edge → center, i.e. highest
	 * multiplier first. The 1-ball column is a separate board, not a variant of the shared one: it pays
	 * its center (0.1×) and lifts the two pockets either side (0.2× → 0.3×) because that tier has no
	 * feature meters to feed — enumerating both is the only way a player can see that.
	 */
	const boardCenterIndex = Math.floor(BOARD_SLOT_MULTIPLIERS.length / 2);
	const paytableRows = BOARD_SLOT_MULTIPLIERS.slice(0, boardCenterIndex + 1).map(
		(shared, index) => ({
			index,
			shared,
			oneBall: ONE_BALL_BOARD_SLOT_MULTIPLIERS[index],
			isCenter: index === boardCenterIndex,
			color: slotColorForRateIndex([...BOARD_SLOT_MULTIPLIERS], index),
		}),
	);

	/**
	 * Free-spin wheel segments, sorted low → high with BONUS last (the stored order is the wheel's
	 * clockwise layout, which is meaningless in a paytable).
	 *
	 * Deliberately NO landing chances here. The wheel has two distributions — a spin from the base drop
	 * draws over all segments, while one fired inside a bonus round re-rolls a BONUS landing (math
	 * `simulate_bonus_round`: `while segment == "BONUS": re-pick`) so a bonus can't recurse into itself
	 * — and `FREE_SPIN_WEIGHTS` is only a display mirror of the math's table. Publishing a percentage
	 * off a mirror risks stating odds the server doesn't honor, so the rules list what each segment
	 * PAYS and leave the odds to the math. The BONUS-can't-land rule is still stated, in prose.
	 */
	const freeSpinRows = FREE_SPIN_SEGMENTS.map((label) => {
		const isBonus = label === 'BONUS';
		return {
			label,
			isBonus,
			// BONUS has no numeric value; Infinity parks it at the end of the sort.
			value: isBonus ? Infinity : parseFloat(label),
		};
	}).sort((a, b) => a.value - b.value);

	/** Grouped amount without forcing decimals on whole numbers (e.g. 0.01, 2,500, 50,000). */
	function formatLimit(value: number) {
		const formatted =
			value >= 1 ? value.toLocaleString('en-US', { maximumFractionDigits: 2 }) : value.toFixed(2);
		return `${currencySign}${formatted}`;
	}
</script>

{#if stateGame.infoModalOpen}
	<div class="info-modal-backdrop" onclick={close} role="presentation">
		<div class="info-modal-wrap" onclick={(e) => e.stopPropagation()} role="dialog">
			<button type="button" class="info-modal-close" onclick={close} aria-label="Close">
				<img src={staticUrl('img/close_btn.webp')} alt="" aria-hidden="true" />
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
									<strong>BET PER BALL</strong> – Base amount wagered on each single ball. Adjust with
									+ / − buttons.
								</li>
								<li>
									<strong>BALL PER DROP</strong> – Number of balls released per round. Adjust with +
									/ − buttons.
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
								The game clearly displays the WIN amount after each round and shows your current
								total bet near the controls.
							</p>

							<h3 class="info-section-title">Multipliers &amp; Payouts</h3>
							<p>
								The bottom of the board features a row of colored multiplier slots, running from low in
								the center to high on the edges.
							</p>
							<p>
								Every ball pays <strong>Bet per Ball × the multiplier of the pocket it lands in</strong
								>. The board has {BOARD_SLOT_MULTIPLIERS.length} pockets, mirrored around the center, so
								each row below is the matching PAIR of pockets at that distance from the middle:
							</p>
							<table class="info-rules-table info-paytable">
								<thead>
									<tr>
										<th>Pockets</th>
										<th>10 / 20 / 50 Ball per Drop</th>
										<th>1 Ball per Drop</th>
									</tr>
								</thead>
								<tbody>
									{#each paytableRows as row (row.index)}
										<tr>
											<td>
												<span
													class="info-paytable-swatch"
													style:background={row.color}
													aria-hidden="true"
												></span>
												{row.isCenter ? '1 (center)' : '2'}
											</td>
											<td>
												{formatMultiplier(row.shared)}
												{#if row.isCenter}
													<span class="info-rules-note">SPIN slot — pays nothing, fills the meter</span>
												{/if}
											</td>
											<td>{formatMultiplier(row.oneBall)}</td>
										</tr>
									{/each}
								</tbody>
							</table>
							<p>
								The two tiers play <strong>different boards</strong>. On 10 / 20 / 50 balls the center
								pocket is the SPIN slot: it pays {formatMultiplier(
									BOARD_SLOT_MULTIPLIERS[boardCenterIndex],
								)} and feeds the Free Spin meter instead. The 1 Ball per Drop tier has no meters to feed,
								so its center pays {formatMultiplier(
									ONE_BALL_BOARD_SLOT_MULTIPLIERS[boardCenterIndex],
								)} and the pocket either side of it pays {formatMultiplier(
									ONE_BALL_BOARD_SLOT_MULTIPLIERS[boardCenterIndex - 1],
								)} rather than {formatMultiplier(BOARD_SLOT_MULTIPLIERS[boardCenterIndex - 1])}. Every
								other pocket is identical on both boards.
							</p>
							<p>
								The board layout is fixed — you control your own risk through your Bet per Ball and
								Ball per Drop, not a difficulty or rows setting. Dropping more balls spreads them
								across more pockets and raises the top potential payout. A single ball can pay at most
								{formatMultiplier(Math.max(...BOARD_SLOT_MULTIPLIERS))}; the 1 Ball per Drop tier has no
								bonus features, so that is also its maximum payout, while from 10 balls up bonus rounds
								reach your tier's max payout of 250× to 400×.
							</p>

							<h3 class="info-section-title">Key Features &amp; Settings</h3>
							<p>
								<strong>RTP</strong> — Approximately 95.5%.
							</p>
							<p>
								<strong>Max Win</strong> — Up to x480.
							</p>
							<p>
								<strong>Volatility</strong> — High. Most balls settle near the center for small returns,
								so dry spells are possible, but rare edge landings and the bonus features can deliver
								big wins.
							</p>

							<h3 class="info-section-title">Bonus Features</h3>
							<p><strong>Free Spin</strong> — multiplier wheel</p>
							<p>
								The FREE SPIN meter (lower-right of the board) fills as balls land in the center
								SPIN (0×) slot. When it fills during a drop, a wheel adds a multiplier of your Bet
								per Ball, from 0.5× up to 20×, on top of your win.
							</p>
							<p>The wheel's {FREE_SPIN_SEGMENTS.length} segments are:</p>
							<table class="info-rules-table">
								<thead>
									<tr>
										<th>Segment</th>
										<th>Pays</th>
									</tr>
								</thead>
								<tbody>
									{#each freeSpinRows as row (row.label)}
										<tr>
											<td>{row.label}</td>
											<td>
												{#if row.isBonus}
													Chains straight into a Bonus round
												{:else}
													{row.value} × your Bet per Ball
												{/if}
											</td>
										</tr>
									{/each}
								</tbody>
							</table>
							<p>
								A free spin can also fire while a bonus round is already running. That wheel
								<strong>cannot land on BONUS</strong> — a bonus can't start another bonus inside itself
								— so it always pays one of the multipliers.
							</p>
							<p>The Free Spin feature is not available on the single-ball drop.</p>
							<p><strong>Bonus</strong> — free balls</p>
							<ul>
								<li>
									The Bonus meter (top-center of the board) fills as balls strike the 3 gold coin
									pegs.
								</li>
								<li>
									When it fills during a drop, a wheel awards a batch of free balls that drop
									automatically at no extra cost. The wheel has {wheelSegmentCount} segments paying
									from <strong>{wheelMinBalls} to {wheelMaxBalls} free balls</strong>.
								</li>
							</ul>

							<p>
								<strong>Trigger conditions</strong> — how many hits each meter needs to fill and fire
								the feature, for every Ball per Drop tier:
							</p>
							<table class="info-rules-table">
								<thead>
									<tr>
										<th>Ball per Drop</th>
										<th>Bonus meter</th>
										<th>Free Spin meter</th>
									</tr>
								</thead>
								<tbody>
									{#each meterRows as row (row.balls)}
										<tr>
											<td>{row.balls}</td>
											<td>{row.bonusHits} coin-peg hits</td>
											<td>
												{row.spinHits} SPIN-slot hits
												{#if row.spinStart > 0}
													<span class="info-rules-note"
														>(meter starts {row.spinStart} of {row.spinMax} filled)</span
													>
												{/if}
											</td>
										</tr>
									{/each}
								</tbody>
							</table>
							<p>
								Both meters are per-drop: they fill from the current drop's hits and reset each
								round, so they don't carry over between bets. The <strong>1 Ball per Drop</strong> tier
								has neither feature — its meters are display only and can never fire.
							</p>

							<p>
								<strong>Level up (re-trigger)</strong> — once a bonus round is running, coin-peg hits
								from the free balls fill the meter again. Each fill levels the round up and awards a
								further batch of free balls:
							</p>
							<table class="info-rules-table">
								<thead>
									<tr>
										<th>Level reached</th>
										<th>Coin-peg hits needed</th>
										<th>Free balls awarded</th>
									</tr>
								</thead>
								<tbody>
									{#each bonusLevelRows as row (row.level)}
										<tr>
											<td>{row.level}</td>
											<td>{row.pegs}</td>
											<td>+{row.freeBalls.toLocaleString('en-US')}</td>
										</tr>
									{/each}
								</tbody>
							</table>
							<p>
								Each level needs its own run of hits, counted from that level's balls — reaching
								level 3 takes {bonusLevelRows[1]?.pegs} hits after the {bonusLevelRows[0]?.pegs} that
								reached level 2, not {bonusLevelRows[1]?.pegs} in total. The ladder stops at
								<strong>level {maxBonusLevel}</strong>, the highest a bonus round can reach.
							</p>
							<ul>
								<li>
									Free balls are staked at your current Bet per Ball and drop on their own — you
									don't pay anything extra for them.
								</li>
							</ul>
							<p>
								Because both features resolve inside the same drop, one round can pay the base drop
								plus a Free Spin multiplier and a batch of bonus balls.
							</p>

							<h3 class="info-section-title">Buy Bonus</h3>
							<p>
								The <strong>Buy Bonus</strong> button lets you instantly trigger the Crimson Fury bonus
								without waiting for the Bonus meter to fill. Pick a tier and the bonus starts straight
								away with that tier's batch of free balls — there is no separate paid drop.
							</p>
							<ul>
								{#each BUY_BONUS_TIERS as tier}
									<li>
										<strong>{tier.name}</strong> — {tier.freeBalls} free balls, costs
										{buyBonusCost(tier.key)}× your Bet per Ball.
									</li>
								{/each}
							</ul>
							<p>
								The price is your <strong>Bet per Ball × the tier's multiplier</strong> (for example,
								at $1.00 per ball the Standard tier costs $80.00) and does not depend on your Ball per
								Drop.
							</p>
							<p>
								<strong>Bigger tiers, bigger batch</strong> — each higher tier drops a larger batch of
								free balls, so the bought balls are the reward. The round can still level up and chain
								into extra balls as coin pegs are hit during the bonus, on the same level ladder (and
								the same level {maxBonusLevel} cap) as a naturally triggered bonus.
							</p>
							<p>
								A bought bonus plays exactly like a naturally triggered one: the free balls drop at
								your current Bet per Ball, the round can level up for even more balls, and an
								in-bonus Free Spin multiplier can still land. The balls you bought and any balls won
								during the bonus are added together into your total.
							</p>
							<p>The Buy Bonus is not available on the single-ball drop.</p>
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
								<strong>Choose your Ball per Drop</strong> — Use the − / + steppers to release 1,
								10, 20, or 50 balls per drop. Your total <strong>Bet</strong> is calculated automatically
								as Bet per Ball × Ball per Drop. Dropping more balls fills the feature meters faster
								and raises the top potential payout.
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
							edges. The board layout is fixed — you tune your own risk through Bet per Ball and
							Ball per Drop rather than a difficulty or rows setting.
						</p>
						<p>
							Each row below is the mirrored pair of pockets at that distance from the middle:
						</p>
						<table class="info-rules-table info-paytable">
							<thead>
								<tr>
									<th>Pockets</th>
									<th>10 / 20 / 50 Ball per Drop</th>
									<th>1 Ball per Drop</th>
								</tr>
							</thead>
							<tbody>
								{#each paytableRows as row (row.index)}
									<tr>
										<td>
											<span
												class="info-paytable-swatch"
												style:background={row.color}
												aria-hidden="true"
											></span>
											{row.isCenter ? '1 (center)' : '2'}
										</td>
										<td>
											{formatMultiplier(row.shared)}
											{#if row.isCenter}
												<span class="info-rules-note">SPIN slot — fills the Free Spin meter</span>
											{/if}
										</td>
										<td>{formatMultiplier(row.oneBall)}</td>
									</tr>
								{/each}
							</tbody>
						</table>
						<ul>
							<li>
								<strong>Center pockets</strong> pay the least, so balls that drift to the middle return
								little or nothing — on 10 / 20 / 50 balls the center pocket pays nothing at all and
								feeds the Free Spin meter instead.
							</li>
							<li>
								<strong>Edge pockets</strong> pay the most — up to
								{formatMultiplier(Math.max(...BOARD_SLOT_MULTIPLIERS))} your Bet per Ball on a single ball.
							</li>
							<li>
								With the bonus features in play, a round can reach your tier's maximum payout — 250×
								at 10 balls per drop, up to 400× at 50. The 1 Ball per Drop tier has no bonus
								features, so its maximum payout is the board's top pocket,
								{formatMultiplier(Math.max(...ONE_BALL_BOARD_SLOT_MULTIPLIERS))}.
							</li>
						</ul>

						<h3 class="info-section-title">Bonus Features</h3>
						<ul>
							<li>
								<strong>Free Spin</strong> — Balls that land in the center pockets fill the Free
								Spin meter beside the board. It fills on
								{#each meterRows as row, index (row.balls)}{index > 0 ? ' / ' : ''}{row.spinHits}{/each}
								hits at
								{#each meterRows as row, index (row.balls)}{index > 0 ? ' / ' : ''}{row.balls}{/each}
								balls per drop; when it fills during a drop, a wheel spins and adds a multiplier of your
								Bet per Ball on top of your win. Its {FREE_SPIN_SEGMENTS.length} segments are
								{#each freeSpinRows as row, index (row.label)}{index > 0
										? ', '
										: ''}{row.isBonus ? 'BONUS' : formatMultiplier(row.value)}{/each}, and landing on
								<strong>BONUS</strong> chains straight into a bonus round. (Not available on the single-ball
								drop.)
							</li>
							<li>
								<strong>Bonus Round</strong> — Balls that strike the gold coin pegs fill the Bonus meter,
								which takes
								{#each meterRows as row, index (row.balls)}{index > 0 ? ' / ' : ''}{row.bonusHits}{/each}
								hits at
								{#each meterRows as row, index (row.balls)}{index > 0 ? ' / ' : ''}{row.balls}{/each}
								balls per drop. When it fills, a wheel awards {wheelMinBalls}–{wheelMaxBalls} free balls
								that drop automatically at no extra cost. More coin-peg hits during the bonus level the
								round up for even more balls, to a maximum of level {maxBonusLevel} — see the Game Rules
								for the full ladder. (Not available on the single-ball drop.)
							</li>
							<li>
								<strong>Buy Bonus</strong> — Skip the wait and trigger the bonus instantly. Tap the Buy
								Bonus button and pick a tier for a batch of free balls; higher tiers drop a larger batch
								for bigger chain potential. See the Game Rules for tier details. (Not available on the
								single-ball drop.)
							</li>
						</ul>

						<h3 class="info-section-title">Key Features</h3>
						<ul>
							<li><strong>RTP</strong> — Approximately 95.5%</li>
							<li><strong>Max Win</strong> — Up to x480.</li>
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
						<p>
							On mobile, tap the coins button to open the Bet per Ball and Ball per Drop settings.
						</p>
						<p class="howto-subhead">Menu</p>
						<p>Open the Menu button in the top corner to access:</p>
						<ul>
							<li><strong>Game Rules</strong> — Full rules plus the bet and payout limits.</li>
							<li><strong>My Bet History</strong> — A log of your recent rounds.</li>
							<li><strong>How to Play?</strong> — This guide.</li>
							<li><strong>Sound</strong> — Toggles game sound on or off.</li>
							<li><strong>Music</strong> — Toggles game music on or off.</li>
						</ul>

						<h3 class="info-section-title">Legal Notice</h3>
						<p>
							Malfunction voids all wins and plays. A consistent internet connection is required. In
							the event of a disconnection, reload the game to finish any uncompleted rounds. The
							expected return is calculated over many plays. The game display is not representative
							of any physical device and is for illustrative purposes only. Winnings are settled
							according to the amount received from the Remote Game Server and not from events
							within the web browser. TM and © 2026 Stake Engine.
						</p>
					{:else}
						<div class="info-history-pane">
							<div class="info-history-scroll">
								<table class="info-history-table">
									<thead>
										<tr>
											<th>Date</th>
											<th>Bet</th>
											<th>Bet/Ball</th>
											<th>Ball/Drop</th>
											<th>Mult.</th>
											<th>Win</th>
										</tr>
									</thead>
									<tbody>
										{#each historyRows as row, index (`${row.date}-${row.bet}-${index}`)}
											<tr>
												<td>
													{#each row.date.split(' ') as part}
														<span class="info-history-datepart">{part}</span>{' '}
													{/each}
												</td>
												<td>{formatMoney(row.bet)}</td>
												<td>{formatMoney(row.betPerBall)}</td>
												<td>{row.ballPerDrop}</td>
												<td>
													<div class="info-mult-chips">
														{#each row.chips as chip}
															<span class="info-mult-pill" style:background={chip.color}>
																{chip.label}
															</span>
														{/each}
													</div>
												</td>
												<td>{formatWin(row.win)}</td>
											</tr>
										{:else}
											<tr>
												<td colspan="6" class="info-history-empty">No bets yet</td>
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
	/* ⚠️ This modal is sized ENTIRELY in absolute px — nothing here tracks the viewport, so on Stake's
	   400×225 popout the panel kept its full-size 14px body copy, 20px padding and 36px close button
	   inside a frame a third the width, and the rules/how-to-play text overflowed instead of scaling.
	   Every length below is therefore stated in --ui-px (see routes/+layout.svelte): 1px at the 1024×576
	   reference — so the desktop rendering is byte-for-byte what it was — and 0.39px at 400×225, making
	   the whole panel a uniform downscale. Borders/hairlines are deliberately left at raw 1px so they
	   can't fall under a device pixel and vanish. */
	.info-modal-wrap {
		position: relative;
		width: min(92vw, calc(640 * var(--ui-px)));
		max-height: min(80vh, calc(720 * var(--ui-px)));
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
		border-radius: calc(12 * var(--ui-px));
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
		width: calc(36 * var(--ui-px));
		height: calc(36 * var(--ui-px));
		object-fit: contain;
	}
	.info-modal-header {
		display: flex;
		align-items: center;
		padding: calc(14 * var(--ui-px)) calc(20 * var(--ui-px));
		border-bottom: 1px solid rgba(255, 255, 255, 0.1);
	}
	.info-modal-title {
		margin: 0;
		color: #fff;
		font-size: calc(16 * var(--ui-px));
		font-weight: 700;
		line-height: 1.2;
	}
	.info-modal-body {
		padding: calc(20 * var(--ui-px));
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		font-size: calc(14 * var(--ui-px));
		line-height: 1.5;
	}
	.info-modal-body p {
		margin: 0 0 calc(8 * var(--ui-px));
	}
	.info-tabs {
		display: flex;
		justify-content: center;
		gap: calc(8 * var(--ui-px));
		margin: 0 0 calc(18 * var(--ui-px));
	}
	.info-tab {
		padding: calc(7 * var(--ui-px)) calc(22 * var(--ui-px));
		border: none;
		border-radius: calc(8 * var(--ui-px));
		background: transparent;
		color: #9ab8d0;
		font-size: calc(14 * var(--ui-px));
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
		gap: calc(14 * var(--ui-px));
	}
	.info-limits-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: calc(16 * var(--ui-px));
		padding-bottom: calc(10 * var(--ui-px));
		border-bottom: 1px solid rgba(255, 255, 255, 0.08);
	}
	.info-limits-row--head {
		color: #fff;
		font-weight: 700;
		font-size: calc(15 * var(--ui-px));
	}
	.info-limits-value {
		color: #7ec8ff;
		font-size: calc(14 * var(--ui-px));
		font-weight: 600;
	}
	/* Threshold tables inside the Rules copy (feature triggers, bonus level ladder). Sized in --ui-px
	 * like the rest of the modal so they downscale with the 400×225 popout instead of overflowing. */
	.info-rules-table {
		width: 100%;
		table-layout: fixed;
		border-collapse: collapse;
		margin: 0 0 calc(12 * var(--ui-px));
		font-size: calc(13 * var(--ui-px));
	}
	.info-rules-table th {
		text-align: left;
		padding: calc(6 * var(--ui-px)) calc(8 * var(--ui-px));
		color: #fff;
		font-weight: 700;
		border-bottom: 1px solid rgba(255, 255, 255, 0.14);
	}
	.info-rules-table td {
		padding: calc(6 * var(--ui-px)) calc(8 * var(--ui-px));
		color: #d6e8f7;
		vertical-align: top;
		border-bottom: 1px solid rgba(255, 255, 255, 0.06);
	}
	.info-rules-table td:first-child {
		color: #7ec8ff;
		font-weight: 700;
	}
	.info-rules-note {
		display: block;
		color: #9ab8d0;
		font-size: calc(12 * var(--ui-px));
	}
	/* Paytable rows carry the pocket's own board color, so the row can be matched to the slot on screen
	 * rather than to a name for it. Colors come from `slotColorForRateIndex`, the same function the
	 * board paints with. */
	.info-paytable-swatch {
		display: inline-block;
		width: calc(10 * var(--ui-px));
		height: calc(10 * var(--ui-px));
		margin-right: calc(6 * var(--ui-px));
		border-radius: calc(3 * var(--ui-px));
		vertical-align: baseline;
	}
	/* The payout columns are the point of this table, so they carry the accent instead of the leading
	 * pocket-count column that `.info-rules-table` would otherwise highlight. */
	.info-paytable td:first-child {
		color: #d6e8f7;
		font-weight: 600;
	}
	.info-paytable td:nth-child(2),
	.info-paytable td:nth-child(3) {
		color: #7ec8ff;
		font-weight: 700;
	}
	.info-section-title {
		margin: calc(18 * var(--ui-px)) 0 calc(8 * var(--ui-px));
		font-size: calc(15 * var(--ui-px));
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
		top: calc(-20 * var(--ui-px));
		z-index: 2;
		display: flex;
		justify-content: center;
		margin: calc(-20 * var(--ui-px)) calc(-20 * var(--ui-px)) calc(14 * var(--ui-px));
		padding: calc(20 * var(--ui-px)) calc(20 * var(--ui-px)) calc(12 * var(--ui-px));
		background: #0f1a28;
	}
	.howto-pill {
		padding: calc(9 * var(--ui-px)) calc(24 * var(--ui-px));
		border-radius: 999px;
		background: rgba(126, 200, 255, 0.1);
		border: 1px solid rgba(126, 200, 255, 0.3);
		color: #fff;
		font-size: calc(15 * var(--ui-px));
		font-weight: 700;
		line-height: 1.2;
		text-align: center;
	}
	.howto-subhead {
		margin: calc(14 * var(--ui-px)) 0 calc(8 * var(--ui-px));
		font-size: calc(14 * var(--ui-px));
		font-weight: 700;
		color: #fff;
	}
	.howto-steps li {
		margin-bottom: calc(10 * var(--ui-px));
	}
	.info-modal-body ul,
	.info-modal-body ol {
		margin: 0 0 calc(10 * var(--ui-px));
		padding-left: calc(20 * var(--ui-px));
	}
	.info-modal-body li {
		margin-bottom: calc(6 * var(--ui-px));
	}
	.info-modal-body strong {
		color: #fff;
	}
	.info-formula {
		padding: calc(10 * var(--ui-px)) calc(12 * var(--ui-px));
		margin: 0 0 calc(10 * var(--ui-px));
		background: rgba(0, 0, 0, 0.35);
		border-radius: calc(6 * var(--ui-px));
		font-size: calc(13 * var(--ui-px));
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
		padding: 0 calc(20 * var(--ui-px)) calc(20 * var(--ui-px));
		-webkit-overflow-scrolling: touch;
	}
	.info-history-table {
		width: 100%;
		table-layout: fixed;
		border-collapse: separate;
		/* Single table: header + body share one column grid, so centered titles line up
		 * exactly with the centered cell contents (no scrollbar / padding drift). */
		border-spacing: 0 calc(6 * var(--ui-px));
	}
	.info-history-table thead th {
		position: sticky;
		top: 0;
		z-index: 1;
		text-align: center;
		font-size: calc(12 * var(--ui-px));
		color: #e9eff9;
		padding: calc(8 * var(--ui-px)) calc(10 * var(--ui-px));
		margin: 0;
		font-weight: 600;
		background: #0f1a28;
		box-shadow: 0 1px 0 rgba(255, 255, 255, 0.08);
	}
	.info-history-table th:nth-child(1),
	.info-history-table td:nth-child(1) {
		width: 20%;
	}
	.info-history-table th:nth-child(2),
	.info-history-table td:nth-child(2) {
		width: 15%;
	}
	.info-history-table th:nth-child(3),
	.info-history-table td:nth-child(3) {
		width: 15%;
	}
	.info-history-table th:nth-child(4),
	.info-history-table td:nth-child(4) {
		width: 12%;
	}
	.info-history-table th:nth-child(5),
	.info-history-table td:nth-child(5) {
		width: 24%;
	}
	.info-history-table th:nth-child(6),
	.info-history-table td:nth-child(6) {
		width: 14%;
	}
	/* Keep the time and the date each on a single line; the cell wraps only at the
	 * space between them, so a tight column puts the date on its own line under the
	 * time instead of breaking mid-value. */
	.info-history-datepart {
		display: inline-block;
		white-space: nowrap;
	}
	.info-history-empty {
		text-align: center;
		color: #9ab8d0;
		font-weight: 500;
		background: transparent !important;
	}
	.info-history-table td {
		padding: calc(8 * var(--ui-px)) calc(10 * var(--ui-px));
		text-align: center;
		background: rgba(106, 124, 160, 0.45);
		color: #f2f7ff;
		font-size: calc(13 * var(--ui-px));
		font-weight: 600;
		vertical-align: middle;
	}
	.info-history-table tr td:first-child {
		border-top-left-radius: calc(8 * var(--ui-px));
		border-bottom-left-radius: calc(8 * var(--ui-px));
	}
	.info-history-table tr td:last-child {
		border-top-right-radius: calc(8 * var(--ui-px));
		border-bottom-right-radius: calc(8 * var(--ui-px));
	}
	/* Stack the round's multiplier chips (base game + optional Bonus / Free Spin) vertically. */
	.info-mult-chips {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: calc(4 * var(--ui-px));
	}
	.info-mult-pill {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: calc(48 * var(--ui-px));
		max-width: 100%;
		height: calc(26 * var(--ui-px));
		padding: 0 calc(8 * var(--ui-px));
		border-radius: calc(8 * var(--ui-px));
		color: #fff;
		font-size: calc(13 * var(--ui-px));
		font-weight: 700;
		line-height: 1;
		white-space: nowrap;
		text-shadow: 0 calc(1 * var(--ui-px)) calc(2 * var(--ui-px)) rgba(0, 0, 0, 0.45);
	}

	/* Narrow screens: the 6-column history table is too tight for 13px text +
	 * 10px cell padding, so figures bleed to the cell edges. Shrink fonts,
	 * padding and chip sizing so every value fits without truncation.
	 * ⚠️ PORTRAIT ONLY. This block exists because the table's px sizing did not track a narrow
	 * viewport — in landscape it now does (--ui-px), so a 400×225 popout already renders the table at
	 * the same proportions as 1024×576 and applying these overrides on top would shrink the columns
	 * twice and break parity. `max-aspect-ratio: 1/1` is height ≥ width, the complement of the
	 * landscape query --ui-px is defined under (routes/+layout.svelte). */
	@media (max-width: 480px) and (max-aspect-ratio: 1/1) {
		.info-history-scroll {
			padding: 0 10px 16px;
		}
		.info-history-table thead th {
			font-size: 10px;
			padding: 6px 3px;
		}
		.info-history-table td {
			font-size: 10px;
			padding: 6px 3px;
		}
		.info-history-table {
			border-spacing: 0 5px;
		}
		/* Rebalance columns for the narrow viewport: the "Ball/Drop" header needs
		 * more room than 12%, borrowed from the over-wide single-chip Mult. column. */
		.info-history-table th:nth-child(4),
		.info-history-table td:nth-child(4) {
			width: 16%;
		}
		.info-history-table th:nth-child(5),
		.info-history-table td:nth-child(5) {
			width: 20%;
		}
		/* Date wraps to two lines anyway, so trim it to give the Win column enough
		 * room for large grouped amounts (e.g. $5,250.00). */
		.info-history-table th:nth-child(1),
		.info-history-table td:nth-child(1) {
			width: 18%;
		}
		.info-history-table th:nth-child(6),
		.info-history-table td:nth-child(6) {
			width: 16%;
		}
		/* Longer labels ("Free Spin x0.5", "71 Bonus") are wider than "x10"; with
		 * nowrap they overflow the Mult. column, so let them wrap and grow in height
		 * to keep the full value visible inside the cell. */
		.info-mult-pill {
			min-width: 36px;
			max-width: 100%;
			min-height: 22px;
			height: auto;
			padding: 3px 6px;
			font-size: 11px;
			white-space: normal;
			line-height: 1.15;
			text-align: center;
			word-break: break-word;
		}
	}
</style>
