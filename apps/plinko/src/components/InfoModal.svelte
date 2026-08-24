<script lang="ts">
	import { stateBet } from 'state-shared';

	import config from '../game/config';
	import { buyBonusCost, plinkoBetLimits } from '../game/plinkoBet';
	import {
		BUY_BONUS_TIERS,
		PLINKO_BET_MODE_BY_BALLS,
		buyBonusModeName,
	} from '../game/plinkoBetMode';
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
		BUY_BONUS_BALLS_PER_DROP_REF,
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

	/**
	 * ⚠️ HOUSE STYLE FOR EVERY PLAYER-FACING STRING IN THIS FILE: no em dashes, no semicolons.
	 *
	 * Both read as machine-written to players, and this modal is the game's most-read prose. Where one
	 * would go, use a full stop, a comma, a colon, or brackets instead. A label followed by its gloss
	 * takes a full stop ("Balance. Your available funds."), not a dash. Number ranges are spelled "20 to
	 * 100", not "20–100".
	 *
	 * Applies to rendered copy only. Code comments (this one included) are free to use whatever punctuation
	 * is clearest.
	 */
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
	 * ⚠️ NO PER-TIER AVERAGE ENTRY AWARD IS PUBLISHED, deliberately.
	 *
	 * The bonus wheel's nine painted values are the same on every tier and only the landing odds shift
	 * (`BONUS_WHEEL_WEIGHTS`), so the natural way to show the award scaling with Ball per Drop is a mean
	 * — 22.8 / 43.8 / 76.0 balls at 10 / 20 / 50. That was drafted as a table here and cut: it is a
	 * number computed off a DISPLAY MIRROR of the math's weights, and a rules document should not state
	 * odds the server has not itself declared. The rules make the scaling claim in prose instead, which
	 * stays true under any re-weighting that keeps the skew.
	 *
	 * If it is ever wanted back, derive it from `BONUS_WHEEL_WEIGHTS` at render time rather than typing
	 * the numbers in — the comment above that table had itself gone stale once already.
	 */

	/**
	 * ONE ROW PER BALL-PER-DROP TIER — the single comparison table the rules publish, read straight from
	 * the meter tables, the board tables and `config.betModes` so the published numbers can never drift
	 * from the ones the game actually plays.
	 *
	 * `bonusHits` / `spinHits` are what THIS drop must land, not the bar's max: the free-spin meter seeds
	 * at a per-tier head start (`spinMeterTierFor().start`), so its remaining hits are max − start. The
	 * 1-ball tier is listed too (rather than described in prose) — it is the tier a player is most likely
	 * to be surprised by, and a row reading "—" across the feature columns says that faster than a
	 * paragraph does.
	 */
	const tierRows = BALL_PER_DROP_TIERS.map((balls) => {
		const bonus = bonusMeterTierFor(balls);
		const spin = spinMeterTierFor(balls);
		const hasFeatures = bonusInDropForBalls(balls);
		const modeConfig = config.betModes[
			PLINKO_BET_MODE_BY_BALLS[balls] as keyof typeof config.betModes
		];
		return {
			balls,
			hasFeatures,
			bonusMax: bonus.max,
			bonusHits: bonus.max - bonus.start,
			spinMax: spin.max,
			spinStart: spin.start,
			spinHits: spin.max - spin.start,
			maxWinPerBall: modeConfig?.max_win ?? 0,
		};
	});

	/** Tiers that actually have the features (10 / 20 / 50) — used wherever the prose speaks about them. */
	const featureTiers = tierRows.filter((row) => row.hasFeatures);

	/** Buy-bonus tiers with their price and cap alongside the entry batch, so one table carries the lot. */
	const buyRows = BUY_BONUS_TIERS.map((tier) => ({
		key: tier.key,
		name: tier.name,
		freeBalls: tier.freeBalls,
		cost: buyBonusCost(tier.key),
		maxWinPerBall:
			config.betModes[buyBonusModeName(tier.key) as keyof typeof config.betModes]?.max_win ?? 0,
	}));

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
	 * multiplier first. The 1-ball column is a separate board, not a variant of the shared one: it lifts
	 * its 1.5× pockets to 2× to make up for the bonus features that tier does not have — enumerating both
	 * is the only way a player can see that.
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
	 * Which pockets the 1-ball board actually changes, derived rather than named in the prose. The
	 * paragraph below used to spell out "its center pays X and the pocket either side pays Y", which
	 * silently became false the moment the board was re-cut somewhere else. Deriving it means the rules
	 * follow the table instead of having to be remembered alongside it.
	 */
	const boardDiffs = paytableRows.filter((row) => row.oneBall !== row.shared);

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

	/**
	 * Declared RTP + max win PER BET MODE, read from `config.betModes` — the same table published to the
	 * RGS, so the rules state exactly what the math declares.
	 *
	 * `max_win` is a multiple of BET PER BALL, not of the total bet (math `wincap_for_balls`: "per
	 * stake_per_ball"; the client agrees — see `bookEventHandlerMap`'s note that the payout multiplier is
	 * "normalized to the PER-BALL stake, NOT win ÷ total-bet"). A bare "500×" therefore reads as 500× the
	 * total bet and overstates every mode whose cost is above 1, which is why the rules always name the
	 * per-ball framing and convert it explicitly where a total-bet number is wanted (see the max-win
	 * bullet under Game Information).
	 */
	function betModeFacts(mode: string, label: string) {
		const modeConfig = config.betModes[mode as keyof typeof config.betModes];
		return {
			label,
			rtpPercent: (modeConfig?.rtp ?? 0) * 100,
			maxWinPerBall: modeConfig?.max_win ?? 0,
		};
	}

	const baseModeRows = BALL_PER_DROP_TIERS.map((balls) =>
		betModeFacts(PLINKO_BET_MODE_BY_BALLS[balls], `${balls} Ball per Drop`),
	);
	const buyModeRows = BUY_BONUS_TIERS.map((tier) =>
		betModeFacts(buyBonusModeName(tier.key), `Buy Bonus — ${tier.name}`),
	);
	const allModeRows = [...baseModeRows, ...buyModeRows];

	/**
	 * Game-wide declared RTP, and the modes that differ from it once rounded to the precision the rules
	 * actually print. Comparing raw values instead would disclose the feature-free 1-ball tier (95.745%
	 * against a 95.7% headline) by printing "returns 95.7%" — the same figure, so the sentence would
	 * carry no information. A mode only earns a callout when its published number READS differently.
	 */
	const gameRtpPercent = config.rtp * 100;
	const offRtpModes = allModeRows.filter(
		(row) => formatRtp(row.rtpPercent) !== formatRtp(gameRtpPercent),
	);

	/**
	 * The RANGE of the per-mode cap, not one headline number.
	 *
	 * A single "up to N×" is the one thing about max win that cannot be said honestly here: the cap is a
	 * multiple of BET PER BALL, so the biggest per-ball cap (500×, buysuperfury) and the biggest cap
	 * against the TOTAL bet (100×, the 1-ball tier) belong to different modes. Pairing them in one
	 * sentence — as the rules used to — reads as a single mode paying both, which no mode does. The
	 * range plus one worked example off `topBaseTier` says it without overstating any mode.
	 */
	const maxWinPerBallCap = Math.max(...allModeRows.map((row) => row.maxWinPerBall));
	const minWinPerBallCap = Math.min(...allModeRows.map((row) => row.maxWinPerBall));

	/** Biggest base tier — the worked example for "the cap is per BALL, not per round". */
	const topBaseTier = tierRows[tierRows.length - 1];

	/** `95.7` → "95.7%"; whole percentages keep their trailing `.0` so the column reads evenly. */
	function formatRtp(percent: number) {
		return `${percent.toFixed(1)}%`;
	}

	/** `8` → "8×", `3.25` → "3.25×", `1.92` → "1.92×" — no forced decimals on whole multiples. */
	function formatTimes(value: number) {
		return `${Number(value.toFixed(2))}×`;
	}

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
							<h3 class="info-section-title">How the Game Works</h3>
							<ul>
								<li>
									<strong>Bet per Ball</strong> is the stake on each single ball. Adjust it with − / +.
								</li>
								<li>
									<strong>Ball per Drop</strong> is how many balls a drop releases: {BALL_PER_DROP_TIERS.join(
										' / ',
									)}. Adjust it with − / +.
								</li>
								<li><strong>Bet</strong> is your total wager, calculated for you.</li>
							</ul>
							<div class="info-formula">
								Total Bet = Bet per Ball × Ball per Drop<br />
								{formatMoney(0.1)} × 10 balls = {formatMoney(1)}
							</div>
							<p>
								Press <strong>Play</strong> (or the Space bar) and the balls fall through the pegs into
								the pockets along the bottom. Each ball pays <strong>Bet per Ball × its pocket</strong>,
								and your Win for the round is every ball added together, plus anything the features
								award.
							</p>
							<p>
								<strong
									>Every multiplier in this game applies to your Bet per Ball, never to your total bet.
									That covers the pockets, both wheels, and the max-win caps.</strong
								>
							</p>

							<h3 class="info-section-title">Pocket Payouts</h3>
							<p>
								The board is the same on every drop: {BOARD_SLOT_MULTIPLIERS.length} pockets, mirrored around
								the center, paying least in the middle and most at the edges. Each row below is the matching
								PAIR of pockets at that distance from the middle.
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
													<span class="info-rules-note">SPIN slot, pays nothing and fills the meter</span>
												{/if}
											</td>
											<td>{formatMultiplier(row.oneBall)}</td>
										</tr>
									{/each}
								</tbody>
							</table>
							<p>
								The center pocket pays {formatMultiplier(BOARD_SLOT_MULTIPLIERS[boardCenterIndex])} on every
								tier. On 10 / 20 / 50 balls it is the <strong>SPIN slot</strong>: it feeds the Free Spin
								meter instead of paying.
								{#if boardDiffs.length}
									<strong>1 Ball per Drop</strong> plays its own board. It has no meters to feed, so its
									{#each boardDiffs as diff, index (diff.index)}{index > 0
											? index === boardDiffs.length - 1
												? ' and '
												: ', '
											: ''}{formatMultiplier(diff.shared)}{/each} pockets pay
									{#each boardDiffs as diff, index (diff.index)}{index > 0
											? ' and '
											: ''}{formatMultiplier(diff.oneBall)}{/each} instead. Every other pocket is identical.
								{/if}
							</p>

							<h3 class="info-section-title">What Each Ball per Drop Gets</h3>
							<p>
								Ball per Drop is the only risk setting in the game. It decides which features are live,
								how many hits each meter needs to fire, and your payout cap:
							</p>
							<table class="info-rules-table">
								<thead>
									<tr>
										<th>Ball per Drop</th>
										<th>Bonus meter</th>
										<th>Free Spin meter</th>
										<th>Max win</th>
									</tr>
								</thead>
								<tbody>
									{#each tierRows as row (row.balls)}
										<tr>
											<td>{row.balls}</td>
											<td>
												{#if row.hasFeatures}
													{row.bonusHits} coin-peg hits
												{:else}
													<span class="info-rules-note">no Bonus</span>
												{/if}
											</td>
											<td>
												{#if row.hasFeatures}
													{row.spinHits} SPIN-slot hits
													{#if row.spinStart > 0}
														<span class="info-rules-note"
															>(bar of {row.spinMax}, starting {row.spinStart} filled)</span
														>
													{/if}
												{:else}
													<span class="info-rules-note">no Free Spin</span>
												{/if}
											</td>
											<td>{formatTimes(row.maxWinPerBall)}</td>
										</tr>
									{/each}
								</tbody>
							</table>
							<p>
								Both meters are <strong>per drop</strong>: they fill from the current drop's hits only
								and reset every round, so nothing carries over between bets. The
								<strong>1 Ball per Drop</strong> tier has no Free Spin and no Bonus, and both meters stay
								hidden while you play it.
							</p>

							<h3 class="info-section-title">Free Spin</h3>
							<p>
								Balls that land in the center SPIN slot fill the <strong>Free Spin meter</strong> in the
								betting panel. Fill it during a drop and a wheel spins, adding a multiplier of your Bet
								per Ball on top of your win.
							</p>
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
													Starts a Bonus round
												{:else}
													{row.value} × your Bet per Ball
												{/if}
											</td>
										</tr>
									{/each}
								</tbody>
							</table>
							<p>
								A Free Spin can also fire while a Bonus round is running, as often as its meter refills.
								That wheel <strong>cannot land on BONUS</strong>, because a bonus can't start another
								bonus inside itself, so it always pays a multiplier.
							</p>

							<h3 class="info-section-title">Bonus Round</h3>
							<p>
								Balls that strike the <strong>3 gold coin pegs</strong> fill the Bonus meter above the
								board. Fill it during a drop and a wheel awards a batch of free balls. They drop at your
								current Bet per Ball and cost you nothing.
							</p>
							<p>
								The wheel's {wheelSegmentCount} awards are the same on every tier, from {wheelMinBalls} to {wheelMaxBalls}
								free balls. What changes is the odds:
								<strong>the more balls you drop, the more they favour the bigger awards</strong>.
							</p>
							<p>
								<strong>Dropping your free balls.</strong> Press Play once for each free ball, or hold
								Play (or the Space bar) to release them as a continuous stream. Autobet stops when a
								Bonus round starts, so the round is always yours to play out.
							</p>
							<p>
								<strong>Levelling up.</strong> Coin-peg hits from the free balls refill the meter. Each
								refill raises the round a level and awards more free balls, which join the ones still
								falling:
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
								Each level needs its own run of hits, counted from that level's balls. Level 3 takes
								{bonusLevelRows[1]?.pegs} hits after the {bonusLevelRows[0]?.pegs} that reached level 2, not
								{bonusLevelRows[1]?.pegs} in total. The ladder stops at
								<strong>level {maxBonusLevel}</strong>, and the deeper levels are very rare.
							</p>

							<h3 class="info-section-title">Buy Bonus</h3>
							<p>
								The <strong>Buy Bonus</strong> badge starts a Bonus round straight away with that tier's
								batch of free balls. There is no paid drop first, because the free balls are what you
								bought.
							</p>
							<table class="info-rules-table">
								<thead>
									<tr>
										<th>Tier</th>
										<th>Cost</th>
										<th>Free balls</th>
										<th>Max win</th>
									</tr>
								</thead>
								<tbody>
									{#each buyRows as row (row.key)}
										<tr>
											<td>{row.name}</td>
											<td>{formatTimes(row.cost)} Bet per Ball</td>
											<td>{row.freeBalls}</td>
											<td>{formatTimes(row.maxWinPerBall)}</td>
										</tr>
									{/each}
								</tbody>
							</table>
							<p>
								The price is your <strong>Bet per Ball × the tier's cost</strong> and does not depend on
								your Ball per Drop. You can buy from any Ball per Drop, the 1-ball tier included. A
								bought round always plays the {BUY_BONUS_BALLS_PER_DROP_REF}-ball board, so its Free Spin
								and level-up meters are live even there.
							</p>
							<p>
								A bought bonus then plays exactly like a triggered one: it can level up for more balls on
								the same ladder, and an in-bonus Free Spin can still land.
							</p>

							<h3 class="info-section-title">Game Information</h3>
							<ul>
								<li>
									<strong>RTP.</strong> Approximately {formatRtp(gameRtpPercent)}{#if offRtpModes.length}, except the
										{offRtpModes.map((row) => row.label).join(' and ')}
										{offRtpModes.length === 1 ? 'tier' : 'tiers'} at
										{offRtpModes.map((row) => formatRtp(row.rtpPercent)).join(' and ')}{/if}.
								</li>
								<li>
									<strong>Max win.</strong> Every bet mode has its own cap, from {formatTimes(
										minWinPerBallCap,
									)} to {formatTimes(maxWinPerBallCap)} your <strong>Bet per Ball</strong> (see the tables
									above). It is a cap per BALL, not per round: {formatTimes(topBaseTier.maxWinPerBall)} at
									{topBaseTier.balls} balls per drop works out at {formatTimes(
										topBaseTier.maxWinPerBall / topBaseTier.balls,
									)} your total bet.
								</li>
								<li>
									<strong>Volatility.</strong> High. Most balls settle near the center for small returns,
									so dry spells happen. The edge pockets and the features are where the big wins are.
								</li>
								<li>
									<strong>Auto</strong> runs a set number of rounds for you.
									<strong>Fast game</strong> speeds the balls up.
								</li>
							</ul>

							<h3 class="info-section-title">Controls &amp; Buttons</h3>
							<p class="info-subhead">Main Bet Panel</p>
							<ul>
								<li><strong>Balance.</strong> Your available funds.</li>
								<li>
									<strong>Bet.</strong> Your total wager for the round (Bet per Ball × Ball per Drop). It
									updates automatically.
								</li>
								<li><strong>Win.</strong> The amount won on your last round.</li>
								<li>
									<strong>Bet per Ball.</strong> The stake on each ball. Adjust it with − / +, or tap the
									value to choose a preset.
								</li>
								<li>
									<strong>Ball per Drop.</strong> Number of balls released per drop ({BALL_PER_DROP_TIERS.join(
										' / ',
									)}). Adjust it with − / +.
								</li>
								<li><strong>Play.</strong> Drops your balls. The Space bar does the same.</li>
								<li>
									<strong>Auto.</strong> Opens the autobet round-count list. Choose a count to run that
									many rounds automatically, or press it again to stop.
								</li>
								<li><strong>Fast game.</strong> Toggles faster ball drops on or off.</li>
							</ul>
							<p>
								On mobile, tap the coins button to open the Bet per Ball and Ball per Drop settings.
							</p>
							<p class="info-subhead">Menu</p>
							<p>Open the Menu button in the top corner to access:</p>
							<ul>
								<li><strong>Game Rules.</strong> These rules, plus the bet and payout limits.</li>
								<li><strong>My Bet History.</strong> A log of your recent rounds.</li>
								<li><strong>How to Play?</strong> A short guide to getting started.</li>
								<li><strong>Sound.</strong> Toggles game sound on or off.</li>
								<li><strong>Music.</strong> Toggles game music on or off.</li>
							</ul>
						{/if}
					{:else if stateGame.infoModalTab === 'howToPlay'}
						<div class="howto-pill-bar">
							<span class="howto-pill">One-eyed Willy Plinko</span>
						</div>

						<h3 class="info-section-title">How to Play</h3>
						<ol class="howto-steps">
							<li>
								<strong>Set your Bet per Ball.</strong> This is the stake on each single ball, set with
								the − / + steppers or by tapping the value to pick a preset. Every multiplier in the game
								is applied to this amount.
							</li>
							<li>
								<strong>Choose your Ball per Drop.</strong> Release {BALL_PER_DROP_TIERS.join(' / ')} balls
								per drop, set with the − / + steppers. Your total <strong>Bet</strong> is worked out for
								you.
							</li>
							<li>
								<strong>Press Play</strong> (or the Space bar). The balls fall through the pegs and
								settle into the pockets along the bottom.
							</li>
							<li>
								<strong>Collect.</strong> Each ball pays Bet per Ball × its pocket, and your Win is all of
								them added together, plus anything the features award.
							</li>
						</ol>
						<div class="info-formula">Total Bet = Bet per Ball × Ball per Drop</div>
						<ul>
							<li>
								Pockets pay least in the middle and most at the edges, up to
								{formatMultiplier(Math.max(...BOARD_SLOT_MULTIPLIERS))} on a single ball. The center pocket
								pays nothing.
							</li>
							<li>
								Dropping more balls fills the feature meters faster and raises your payout cap. See
								<strong>Game Rules</strong> for the full paytable and every number quoted here.
							</li>
						</ul>

						<h3 class="info-section-title">Features</h3>
						<ul>
							<li>
								<strong>Free Spin.</strong> Balls landing in the center SPIN slot fill the Free Spin
								meter in the betting panel ({#each featureTiers as row, index (row.balls)}{index > 0
										? ' / '
										: ''}{row.spinHits}{/each} hits at
								{#each featureTiers as row, index (row.balls)}{index > 0
										? ' / '
										: ''}{row.balls}{/each} balls). Fill it and a wheel adds a multiplier of your Bet per
								Ball, up to {formatMultiplier(
									Math.max(...freeSpinRows.filter((row) => !row.isBonus).map((row) => row.value)),
								)}, or lands on BONUS and starts a Bonus round.
							</li>
							<li>
								<strong>Bonus Round.</strong> Balls striking the 3 gold coin pegs fill the Bonus meter
								above the board ({#each featureTiers as row, index (row.balls)}{index > 0
										? ' / '
										: ''}{row.bonusHits}{/each} hits at
								{#each featureTiers as row, index (row.balls)}{index > 0
										? ' / '
										: ''}{row.balls}{/each} balls). Fill it and a wheel awards
								{wheelMinBalls} to {wheelMaxBalls} free balls, which cost you nothing. More coin-peg hits
								during the round level it up for more balls, to a maximum of level {maxBonusLevel}.
							</li>
							<li>
								<strong>Dropping free balls.</strong> Press Play once per free ball, or hold Play (or
								Space) to release them as a stream. Autobet stops when a Bonus round starts.
							</li>
							<li>
								<strong>Buy Bonus.</strong> The badge in the top corner starts a Bonus round straight
								away. Pick a tier for a bigger batch of free balls. The price is your Bet per Ball × the
								tier's cost.
							</li>
						</ul>
						<p>
							Free Spin and Bonus are live from <strong>{featureTiers[0]?.balls} balls per drop</strong>
							up. The 1 Ball per Drop tier has neither (its meters stay hidden) and pays more in the
							pockets to make up for it, but you can still Buy Bonus from it.
						</p>
						<!-- The per-control reference lives in Game Rules ("Controls & Buttons"), not here — one
						     copy, not two. This line is the signpost so a player looking for it in the guide is
						     pointed rather than stranded. -->
						<p>
							For what every button and menu entry does, see
							<strong>Game Rules</strong>.
						</p>

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
	/* Sub-heading inside a section (Controls & Buttons splits into Main Bet Panel / Menu). Named
	   `howto-subhead` while that section lived in How to Play; renamed when it moved to Game Rules. */
	.info-subhead {
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
