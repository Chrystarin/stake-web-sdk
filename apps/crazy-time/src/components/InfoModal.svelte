<script lang="ts">
	import config from '../game/config';
	import {
		BUY_MODES,
		BUY_MODE_NAMES,
		CHEST_VALUES,
		NUMBER_PAY,
		NUMBER_SPOTS,
		NUM_CHESTS,
		NUM_SEGMENTS,
		PICK_SECONDS,
		PLINKO_SLOTS,
		ROOM_SPOTS,
		SEGMENT_COUNT,
		SPOTS,
		SPOT_COLOUR,
		SPOT_LABEL,
		TILES_PER_DEPTH,
		TOP_SLOT_MULTS,
		VOYAGE_DEPTHS,
		WHEEL_LAYOUT,
		WHEEL_SLIVER_UNITS,
		WHEEL_WEDGE_UNITS,
		buyPrice,
		isRoomSpot,
		maxWinForMode,
		spotMaxWin,
		type RoomSpot,
	} from '../game/constants';
	import { stateGame, stateGameDerived, type InfoModalTab } from '../game/stateGame.svelte';
	import { staticUrl } from '../lib/staticUrl';
	import { formatMoney } from '../game/currency';

	/**
	 * Game Rules / My Bet History / How to Play?, opened from the top-right menu. The shell, the tabs,
	 * the tables and the history list are One-Eyed Willy's Plinko's (apps/plinko InfoModal.svelte). The
	 * copy is this game's, and every number in it is read off `game/constants.ts` so the published
	 * rules cannot drift from the tables the game plays.
	 *
	 * ⚠️ HOUSE STYLE FOR EVERY PLAYER-FACING STRING IN THIS FILE: no em dashes, no semicolons. Use a
	 * full stop, a comma, a colon or brackets instead. Number ranges are spelled "2 to 250". Applies to
	 * rendered copy only.
	 */
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

	/** Sub-tab within the Game Rules view: descriptive rules vs. the limits table. */
	let rulesTab = $state<'rules' | 'limits'>('rules');

	/** Newest entries are stored first (index 0 = top of table). */
	const historyRows = $derived(stateGame.history);

	/** The limits are sums like any other: exact, in the currency's own form (game/currency.ts). */
	const formatLimit = formatMoney;

	/** `8` → "8x", `13.5` → "13.5x", `50000` → "50,000x". */
	function formatTimes(value: number) {
		return `${Number(value.toFixed(2)).toLocaleString('en-US')}x`;
	}

	/** "A, B and C" for prose lists. House style bans the semicolon, so this is the only joiner used. */
	function joinWithAnd(items: string[]): string {
		if (items.length <= 1) return items[0] ?? '';
		return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
	}

	/** "Pirate Plinko" from the board's "PIRATE PLINKO": prose wants the name, not the sign. */
	function spotName(spot: (typeof SPOTS)[number]) {
		return SPOT_LABEL[spot]
			.toLowerCase()
			.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
	}

	/** The chip range the RGS offers, and the most one chip can win (the game's top mode cap). */
	const gameMaxWin = Math.max(...SPOTS.map(spotMaxWin));
	const chipLimits = $derived.by(() => {
		const options = stateGameDerived.stakeOptions();
		const min = options[0] ?? 0;
		const max = options.at(-1) ?? 0;
		return { min, max, maxBet: max * SPOTS.length, maxWin: max * gameMaxWin };
	});

	/** One row per spot on the wheel: how much of the rim it holds, what it pays, and its cap. */
	const spotRows = SPOTS.map((spot) => ({
		spot,
		name: spotName(spot),
		color: SPOT_COLOUR[spot].base,
		segments: SEGMENT_COUNT[spot],
		pays: isRoomSpot(spot) ? 'Opens the room' : `${NUMBER_PAY[spot]} to 1`,
		maxWin: spotMaxWin(spot),
	}));

	/** A room's own range, before any Top Slot multiplier. */
	const roomValues: Record<RoomSpot, readonly number[]> = {
		piratePlinko: PLINKO_SLOTS,
		bonusWheel: WHEEL_LAYOUT,
		chest: CHEST_VALUES,
		oceanVoyage: VOYAGE_DEPTHS,
	};
	const roomRows = ROOM_SPOTS.map((room) => ({
		room,
		name: spotName(room),
		color: SPOT_COLOUR[room].base,
		min: Math.min(...roomValues[room]),
		max: Math.max(...roomValues[room]),
		maxWin: spotMaxWin(room),
	}));

	/** Bonus Wheel wedges by value, so the rules can say how many of each the disc carries. */
	const wedgeRows = [...new Set(WHEEL_LAYOUT)]
		.sort((a, b) => a - b)
		.map((value) => ({ value, count: WHEEL_LAYOUT.filter((wedge) => wedge === value).length }));
	const wheelJackpot = Math.max(...WHEEL_LAYOUT);
	/** How much narrower the jackpot sliver is weighed than a full wedge (the disc draws them equal). */
	const sliverRatio = WHEEL_WEDGE_UNITS / WHEEL_SLIVER_UNITS;

	const voyageRows = VOYAGE_DEPTHS.map((value, index) => ({ stop: index + 1, value }));

	const buyRows = BUY_MODE_NAMES.map((mode) => ({
		mode,
		name:
			BUY_MODES[mode].rooms.length > 1
				? 'Random Bonus'
				: spotName(BUY_MODES[mode].rooms[0]),
		cost: buyPrice(mode),
		maxWin: maxWinForMode(mode),
	}));

	const topSlotList = joinWithAnd(TOP_SLOT_MULTS.map((value) => `${value}x`));
	const topSlotMax = Math.max(...TOP_SLOT_MULTS);
	const rtpPercent = `${(config.rtp * 100).toFixed(1)}%`;
	const numberNames = joinWithAnd(NUMBER_SPOTS.map(spotName));
	const roomNames = joinWithAnd(ROOM_SPOTS.map(spotName));
</script>

{#if stateGame.infoModalOpen}
	<div class="info-modal-backdrop" onclick={close} role="presentation">
		<div class="info-modal-wrap" onclick={(e) => e.stopPropagation()} role="dialog">
			<button type="button" class="info-modal-close" onclick={close} aria-label="Close">
				<img src={staticUrl('img/buy-bonus/close_btn.webp')} alt="" aria-hidden="true" />
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
									<span>Chip Limits</span>
									<span>Max payout</span>
								</div>
								<div class="info-limits-row">
									<span class="info-limits-value"
										>{formatLimit(chipLimits.min)}-{formatLimit(chipLimits.max)}</span
									>
									<span class="info-limits-value">{formatLimit(chipLimits.maxWin)}</span>
								</div>
								<div class="info-limits-row info-limits-row--head">
									<span>Max Total Bet</span>
								</div>
								<div class="info-limits-row">
									<span class="info-limits-value"
										>{formatLimit(chipLimits.maxBet)} (a chip on all {SPOTS.length} spots)</span
									>
								</div>
							</div>
						{:else}
							<h3 class="info-section-title">How the Game Works</h3>
							<ul>
								<li>
									<strong>Chip</strong> is the stake you put on each spot. Choose it from the chip tray.
								</li>
								<li>
									<strong>Spots.</strong> The board has {SPOTS.length} spots: {numberNames}, and the four
									bonus rooms {roomNames}. Tap a spot to put one chip on it, and tap it again to take
									the chip back. Every chip on the board has the same value.
								</li>
								<li><strong>Total Bet</strong> is worked out for you.</li>
							</ul>
							<div class="info-formula">
								Total Bet = Chip × Spots covered<br />
								{formatMoney(1)} × 3 spots = {formatMoney(3)}
							</div>
							<p>
								Press <strong>SPIN</strong> on the gem at the center of the wheel. The Top Slot spins
								first, then the wheel. The wheel has {NUM_SEGMENTS} segments and stops on one spot. If
								you have a chip on that spot, it pays. The chips on every other spot are lost.
							</p>
							<p>
								<strong
									>Every multiplier in this game applies to the chip on the winning spot, never to
									your Total Bet.</strong
								>
							</p>

							<h3 class="info-section-title">The Wheel</h3>
							<table class="info-rules-table info-paytable">
								<thead>
									<tr>
										<th>Spot</th>
										<th>Segments</th>
										<th>Pays</th>
										<th>Max win</th>
									</tr>
								</thead>
								<tbody>
									{#each spotRows as row (row.spot)}
										<tr>
											<td>
												<span
													class="info-paytable-swatch"
													style:background={row.color}
													aria-hidden="true"
												></span>
												{row.name}
											</td>
											<td>{row.segments} of {NUM_SEGMENTS}</td>
											<td>{row.pays}</td>
											<td>{formatTimes(row.maxWin)}</td>
										</tr>
									{/each}
								</tbody>
							</table>
							<p>
								A number pays its odds and returns your chip. A {formatMoney(1)} chip on
								<strong>{spotName('x5')}</strong> returns {formatMoney(1 + NUMBER_PAY.x5)}: {formatMoney(
									NUMBER_PAY.x5,
								)} won plus the chip. Max win is the most one chip on that spot can return, with the
								biggest Top Slot multiplier.
							</p>

							<h3 class="info-section-title">Top Slot</h3>
							<p>
								Before every spin the two reels above the wheel turn. One reel picks a spot and the
								other picks a multiplier: {topSlotList}. If the two line up, that spot carries the
								multiplier for this spin. If they miss, no spot is multiplied.
							</p>
							<p>
								The multiplier only counts if the wheel then stops on <strong>that same spot</strong>.
								On a number it multiplies the winnings, and your chip is still returned: {spotName(
									'x5',
								)} under a 10x Top Slot pays {NUMBER_PAY.x5 * 10} to 1. On a bonus room it multiplies
								every value inside the room.
							</p>

							<h3 class="info-section-title">Bonus Rooms</h3>
							<p>
								When the wheel stops on a bonus room you covered, the room opens and you play it. A room
								pays <strong>its result × your chip</strong>. That figure is the whole return, so the
								chip is not added on top.
							</p>
							<table class="info-rules-table">
								<thead>
									<tr>
										<th>Room</th>
										<th>Result</th>
										<th>Max win</th>
									</tr>
								</thead>
								<tbody>
									{#each roomRows as row (row.room)}
										<tr>
											<td>{row.name}</td>
											<td>{formatTimes(row.min)} to {formatTimes(row.max)}</td>
											<td>
												{formatTimes(row.maxWin)}
												<span class="info-rules-note">under a {topSlotMax}x Top Slot</span>
											</td>
										</tr>
									{/each}
								</tbody>
							</table>
							<p>
								<strong>Your choices never change what a room pays.</strong> Each room's result is decided
								before the room opens. Where you aim, which chest you open and which course you sail are
								yours to choose, and the room pays the same whichever you pick.
							</p>
							<p>
								Each choice has a <strong>{PICK_SECONDS} second</strong> timer. If it runs out, the choice
								is made for you and the room carries on.
							</p>
							<p>
								If the wheel stops on a room you did <strong>not</strong> cover, the room still plays
								itself out to show what it would have paid. It pays you nothing.
							</p>

							<p class="info-subhead">{spotName('piratePlinko')}</p>
							<p>
								Aim the cannon and fire a coin onto the board. It falls through the pegs into one of
								{PLINKO_SLOTS.length} pockets, paying least in the middle and most at the edges:
							</p>
							<div class="info-formula">{PLINKO_SLOTS.map((value) => `${value}x`).join('  ')}</div>
							<p>
								Some pegs are <strong>bombs</strong>. A coin that strikes one is blown across the board
								and keeps falling from there.
							</p>

							<p class="info-subhead">{spotName('bonusWheel')}</p>
							<p>
								Tap the wheel to spin it. It has {WHEEL_LAYOUT.length} wedges and pays the one it stops
								on:
							</p>
							<table class="info-rules-table">
								<thead>
									<tr>
										<th>Wedge</th>
										<th>On the wheel</th>
									</tr>
								</thead>
								<tbody>
									{#each wedgeRows as row (row.value)}
										<tr>
											<td>{formatTimes(row.value)}</td>
											<td>{row.count}</td>
										</tr>
									{/each}
								</tbody>
							</table>
							<p>
								The wheel is drawn with equal wedges so every value can be read. The
								<strong>{formatTimes(wheelJackpot)}</strong> wedge is the top prize and is
								{sliverRatio} times less likely to land than any other single wedge.
							</p>

							<p class="info-subhead">{spotName('chest')}</p>
							<p>
								There are {NUM_CHESTS} chests. Open {NUM_CHESTS - 1} of them, one at a time, and the
								<strong>last chest standing</strong> is your prize. A chest holds {joinWithAnd(
									CHEST_VALUES.map((value) => `${value}x`),
								)}.
							</p>

							<p class="info-subhead">{spotName('oceanVoyage')}</p>
							<p>
								Sail up to {VOYAGE_DEPTHS.length} stops. At each stop pick one of {TILES_PER_DEPTH} buoys
								and the ship sails to it. A safe buoy becomes an island showing that stop's multiplier:
							</p>
							<table class="info-rules-table">
								<thead>
									<tr>
										<th>Stop</th>
										<th>Pays</th>
									</tr>
								</thead>
								<tbody>
									{#each voyageRows as row (row.stop)}
										<tr>
											<td>{row.stop}</td>
											<td>{formatTimes(row.value)}</td>
										</tr>
									{/each}
								</tbody>
							</table>
							<p>
								The voyage ends when the <strong>kraken</strong> takes the ship, and it pays the
								<strong>last island you reached</strong>. The first stop is always safe, so a voyage
								never pays less than {formatTimes(VOYAGE_DEPTHS[0])}. Clear all {VOYAGE_DEPTHS.length}
								stops and you sail into port for {formatTimes(Math.max(...VOYAGE_DEPTHS))}.
							</p>

							<h3 class="info-section-title">Buy Bonus</h3>
							<p>
								The <strong>Buy Bonus</strong> badge in the top left corner skips the wheel and opens a
								bonus room straight away. The Top Slot still spins first, so a bought room can carry a
								multiplier exactly as it would from the wheel.
							</p>
							<table class="info-rules-table">
								<thead>
									<tr>
										<th>Buy</th>
										<th>Cost</th>
										<th>Max win</th>
									</tr>
								</thead>
								<tbody>
									{#each buyRows as row (row.mode)}
										<tr>
											<td>{row.name}</td>
											<td>{formatTimes(row.cost)} Chip</td>
											<td>{formatTimes(row.maxWin)}</td>
										</tr>
									{/each}
								</tbody>
							</table>
							<p>
								The price is your <strong>Chip × the cost</strong>, and the room pays its result × your
								Chip. <strong>Random Bonus</strong> opens one of the four rooms. You can change the Chip
								on the Buy Bonus screen, and every buy asks you to confirm before anything is spent.
							</p>

							<h3 class="info-section-title">Game Information</h3>
							<ul>
								<li>
									<strong>RTP.</strong> Approximately {rtpPercent} on every spot, every combination of
									spots and every Buy Bonus.
								</li>
								<li>
									<strong>Max win.</strong>
									{formatTimes(gameMaxWin)} your <strong>Chip</strong>: the {formatTimes(wheelJackpot)}
									wedge of the {spotName('bonusWheel')} under a {topSlotMax}x Top Slot. Every spot has its
									own cap (see The Wheel above). It is a cap per chip, not per Total Bet.
								</li>
								<li>
									<strong>Volatility.</strong> It depends on what you cover. {spotName('x1')} pays often
									and small. The bonus rooms land rarely and are where the big wins are. Covering more
									spots wins more often, and every chip that misses is lost.
								</li>
							</ul>

							<h3 class="info-section-title">Controls &amp; Buttons</h3>
							<p class="info-subhead">Table</p>
							<ul>
								<li><strong>Balance.</strong> Your available funds.</li>
								<li>
									<strong>Total Bet.</strong> Your total wager for the round (Chip × Spots covered). It
									updates automatically.
								</li>
								<li>
									<strong>Chip tray.</strong> Picks the Chip. Changing it puts the same spots back down
									at the new value if your balance covers them.
								</li>
								<li><strong>Spots.</strong> Tap to place a chip, tap again to take it back.</li>
								<li>
									<strong>MULTI / ALL / BONUS.</strong> Cover the four numbers, every spot, or the four
									bonus rooms in one tap. Tap again to lift them.
								</li>
								<li><strong>Undo.</strong> Takes back your last placement.</li>
								<li><strong>Clear.</strong> Takes every chip off the board.</li>
								<li>
									<strong>SPIN.</strong> The gem at the center of the wheel. Starts the round. After a
									round it reads PLAY AGAIN and clears the board for the next bet. The spacebar presses it
									too.
								</li>
								<li><strong>Buy Bonus.</strong> Opens the Buy Bonus screen.</li>
							</ul>
							<p class="info-subhead">Menu</p>
							<p>Open the Menu button in the top right corner to access:</p>
							<ul>
								<li><strong>Game Rules.</strong> These rules, plus the chip and payout limits.</li>
								<li><strong>My Bet History.</strong> A log of your rounds this session.</li>
								<li><strong>How to Play?</strong> A short guide to getting started.</li>
								<li><strong>Sound.</strong> Toggles game sound on or off.</li>
								<li><strong>Music.</strong> Toggles game music on or off.</li>
							</ul>
							<h3 class="info-section-title">Legal Notice</h3>
							<p>
								Malfunction voids all wins and plays. A consistent internet connection is required. In
								the event of a disconnection, reload the game to finish any uncompleted rounds. The
								expected return is calculated over many plays. The game display is not representative
								of any physical device and is for illustrative purposes only. Winnings are settled
								according to the amount received from the Remote Game Server and not from events
								within the web browser. TM and © 2026 Engine.
							</p>
						{/if}
					{:else if stateGame.infoModalTab === 'howToPlay'}
						<div class="howto-pill-bar">
							<span class="howto-pill">{config.gameName}</span>
						</div>

						<h3 class="info-section-title">How to Play</h3>
						<ol class="howto-steps">
							<li>
								<strong>Choose your Chip.</strong> Pick a value from the chip tray. Every multiplier in
								the game is applied to this amount.
							</li>
							<li>
								<strong>Cover your spots.</strong> Tap any of the {SPOTS.length} spots to put a chip on
								it: {numberNames}, or a bonus room. MULTI, ALL and BONUS cover a whole group in one tap.
								Your <strong>Total Bet</strong> is worked out for you.
							</li>
							<li>
								<strong>Press SPIN</strong> on the gem at the center of the wheel. The Top Slot spins,
								then the wheel.
							</li>
							<li>
								<strong>Collect.</strong> If the wheel stops on a spot you covered, that chip pays. The
								other chips are lost.
							</li>
						</ol>
						<div class="info-formula">Total Bet = Chip × Spots covered</div>
						<ul>
							<li>
								Numbers pay their odds, from {NUMBER_PAY.x1} to 1 on {spotName('x1')} up to
								{NUMBER_PAY.x10} to 1 on {spotName('x10')}, and return your chip.
							</li>
							<li>
								The smaller the number, the more of the wheel it holds. See <strong>Game Rules</strong>
								for the full table and every number quoted here.
							</li>
						</ul>

						<h3 class="info-section-title">Features</h3>
						<ul>
							<li>
								<strong>Top Slot.</strong> Before each spin it may put a multiplier of up to {topSlotMax}x
								on one spot. It counts only if the wheel stops on that same spot.
							</li>
							<li>
								<strong>Bonus rooms.</strong> Stop on a room you covered and it opens:
								{joinWithAnd(roomRows.map((row) => `${row.name} (up to ${formatTimes(row.max)})`))}. The
								room pays its result × your Chip.
							</li>
							<li>
								<strong>Your choices are for fun.</strong> A room's result is decided before it opens,
								so no aim, chest or course pays more than another. Each choice has a {PICK_SECONDS}
								second timer.
							</li>
							<li>
								<strong>Buy Bonus.</strong> The badge in the top left corner opens a room straight away.
								The price is your Chip × the room's cost.
							</li>
						</ul>
						<p>
							A room you did not cover still plays itself out when the wheel stops on it. It shows what
							it would have paid and pays nothing.
						</p>
						<p>
							For what every button and menu entry does, see
							<strong>Game Rules</strong>.
						</p>
					{:else}
						<div class="info-history-pane">
							<div class="info-history-scroll">
								<table class="info-history-table">
									<thead>
										<tr>
											<th>Date</th>
											<th>Bet</th>
											<th>Chip</th>
											<th>Spots</th>
											<th>Result</th>
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
												<td>{formatMoney(row.chip)}</td>
												<td>{row.spots}</td>
												<td>
													<div class="info-mult-chips">
														{#each row.chips as chip}
															<span class="info-mult-pill" style:background={chip.color}>
																{chip.label}
															</span>
														{/each}
													</div>
												</td>
												<td>{formatMoney(row.win)}</td>
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
		font-family: 'Noto Sans', system-ui, sans-serif;
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
		min-height: calc(26 * var(--ui-px));
		padding: calc(3 * var(--ui-px)) calc(8 * var(--ui-px));
		border-radius: calc(8 * var(--ui-px));
		color: #fff;
		font-size: calc(13 * var(--ui-px));
		font-weight: 700;
		line-height: 1.15;
		text-align: center;
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
