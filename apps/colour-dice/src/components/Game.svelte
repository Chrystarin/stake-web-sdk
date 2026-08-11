<script lang="ts">
	import '../styles/global.scss';
	import '../styles/table.scss';

	import { onMount } from 'svelte';

	import { stateBet } from 'state-shared';
	import { stateUrlDerived } from 'state-shared';
	import { waitForTimeout } from 'utils-shared/wait';

	import { getContext } from '../game/context';
	import { stateGame, stateGameDerived } from '../game/stateGame.svelte';
	import { hasActiveRoundToResume, describeModeMismatch } from '../game/activeRound';
	import { playSound, preloadSounds } from '../game/sound';
	import type { Colour } from '../game/constants';

	import DiceBox from './DiceBox.svelte';
	import WheelBonus from './WheelBonus.svelte';
	import RoundResult from './RoundResult.svelte';
	import EnableGameActor from './EnableGameActor.svelte';
	import DevHarness from './DevHarness.svelte';

	const context = getContext();

	// When launched without an RGS session (dev / preview), play sample books locally.
	const online = $derived(Boolean(stateUrlDerived.rgsUrl()));

	// Odds panels are shown in the original ColourDice order.
	const DISPLAY_COLOURS: Colour[] = ['yellow', 'white', 'pink', 'blue', 'red', 'green'];

	// Chip tray comes from the RGS bet template (betLevels), so it always offers amounts this
	// operator/currency actually accepts. It arrives with /wallet/authenticate, hence the effect.
	const stakes = $derived(stateGameDerived.stakeOptions());
	$effect(() => {
		void stakes;
		stateGameDerived.ensureValidStake();
	});

	// Chips all render the same `chip_base.svg` art, tinted per stake with a CSS hue-rotate, so
	// the colour ramps smoothly: green (cheapest) -> blue -> purple -> pink -> red (dearest).
	// Keyed on the index in the FULL list, so a given amount keeps its colour wherever it sits
	// in the carousel window.
	//
	// chip_base.svg is drawn in gold (its palette centres on ~#EEBC43, hue ~42deg), so the
	// rotation applied is `target hue - 42`. Hues below are the ramp stops; red is written as
	// 362 rather than 2 so the interpolation sweeps forward through pink instead of racing
	// backwards round the wheel.
	const CHIP_BASE_HUE = 42;
	const CHIP_HUES = [133, 222, 264, 324, 362];

	/** Absolute hue (deg) for the stake at `index`, interpolated along CHIP_HUES. */
	const chipHue = (index: number) => {
		if (stakes.length <= 1) return CHIP_HUES[0];
		const position = (index / (stakes.length - 1)) * (CHIP_HUES.length - 1);
		const stop = Math.min(Math.floor(position), CHIP_HUES.length - 2);
		return CHIP_HUES[stop] + (CHIP_HUES[stop + 1] - CHIP_HUES[stop]) * (position - stop);
	};

	/** Hue-rotation (deg) to tint the base chip art for the stake at `index`. */
	const chipHueShift = (index: number) => Math.round(chipHue(index) - CHIP_BASE_HUE);

	/**
	 * Label colour: the chip's own hue at 30% less lightness, so the number reads as a darker
	 * shade of the disc it sits on rather than needing an outline to separate it.
	 */
	const chipTextColour = (index: number) =>
		`hsl(${Math.round(chipHue(index)) % 360}, 70%, ${Math.round(55 * 0.7)}%)`;

	// --- Chip carousel --------------------------------------------------------------------
	// Show at most five chips, with the selected one in the middle slot and the rest either
	// side. Tapping a neighbour selects it, which slides the window along.
	//
	// The window CLAMPS at both ends rather than wrapping: wrapping would keep the selection
	// perfectly centred, but it also parks the dearest chips right next to the cheapest, so a
	// single mis-tap could swing the stake from the minimum to the maximum. The cost is that
	// the selected chip sits off-centre for the first and last couple of options.
	const VISIBLE_CHIPS = 5;

	const carousel = $derived.by(() => {
		const total = stakes.length;
		if (!total) return [];
		// Never exceed the number of options, otherwise the window would show blank slots.
		const windowSize = Math.min(VISIBLE_CHIPS, total);
		const middle = Math.floor(windowSize / 2);
		const selected = Math.max(0, stakes.indexOf(stateGame.stake));
		const start = Math.min(Math.max(selected - middle, 0), total - windowSize);
		return Array.from({ length: windowSize }, (_, slot) => {
			const index = start + slot;
			// Depth drives the visual falloff and is measured from the SELECTED chip, so that
			// stays front even when clamping has pushed it off the middle slot. Capped at 2
			// because a clamped window can sit up to four slots from the selection.
			return {
				value: stakes[index],
				index,
				depth: Math.min(Math.abs(index - selected), 2),
				selected: index === selected,
			};
		});
	});

	// Tapping the already-selected chip opens the full grid — the carousel only ever shows five
	// at a time, so this is how you reach an amount several steps away without walking to it.
	let stakePanelOpen = $state(false);

	const onChipClick = (value: number, isSelected: boolean) => {
		if (isSelected) stakePanelOpen = !stakePanelOpen;
		else selectStake(value);
	};

	const pickStake = (value: number) => {
		selectStake(value);
		stakePanelOpen = false;
	};

	const backedCount = $derived(stateGameDerived.backedCount());
	const total = $derived(stateGameDerived.totalStake());
	const idle = $derived(context.stateXstateDerived.isIdle() && !stateGame.rolling);
	const canRoll = $derived(idle && backedCount > 0 && !stateGame.openRoundError);

	const selectStake = (value: number) => stateGameDerived.selectStake(value);

	// --- Chip flight ----------------------------------------------------------------------
	// Chips arriving and leaving are animated as loose copies laid over the table, so the board
	// itself only ever has to say which colours are backed.
	//
	//   'place'  — backing a colour throws a copy of the tray chip at it: the copy pops up in
	//              place, arcs across the panel, and shrinks back to size as it lands. The real
	//              placed chip is held back until then, so one bet never shows as two chips.
	//   'return' — taking that bet off (undo, or tapping the colour again) plays the very same
	//              flight backwards, so the chip goes home the way it came. Catch a placement
	//              still in the air and that chip turns around instead (see turnBack).
	//   'sweep'  — clearing drops each placed chip off the bottom of the table.
	//
	// Phase lengths are mirrored by the `chip-flight` keyframe stops (grow 20%, travel 60%,
	// settle 20%) — change one and change the other. Grow and settle are deliberately equal, so
	// a reversed flight hits its cues at the same two moments as a forward one.
	const GROW_MS = 130;
	const TRAVEL_MS = 390;
	const SETTLE_MS = 130;
	const FLIGHT_MS = GROW_MS + TRAVEL_MS + SETTLE_MS;

	// Clearing staggers the departures rather than dropping the lot together, so the board empties
	// as a scatter instead of a single blink. The last chip starts at the end of the window, so
	// window + fall is what the whole clear costs — kept to half a second, start to empty board.
	const SWEEP_WINDOW_MS = 260;
	const SWEEP_FALL_MS = 220;

	type ChipFlight = {
		id: number;
		kind: 'place' | 'return' | 'sweep';
		colour: Colour;
		label: string;
		/** Chip skin, captured at launch: the tray selection can move on mid-flight. */
		hue: number;
		text: string;
		/** Start and end CENTRES, in px relative to `.game`. */
		from: { x: number; y: number };
		to: { x: number; y: number };
		/** Sweep only: ms this chip waits its turn, and the tilt it falls away with. */
		delay: number;
		spin: number;
		/** A placement pulled back mid-air: still 'place', but now headed home. See turnBack. */
		turned: boolean;
	};

	let flights = $state<ChipFlight[]>([]);
	let flightId = 0;
	/** Colours with a chip still on its way over — their placed chip waits for it to land. */
	const arrivingColours = $derived(
		new Set(
			flights
				.filter((flight) => flight.kind === 'place' && !flight.turned)
				.map((flight) => flight.colour),
		),
	);

	// Measured at launch rather than tracked: nothing here moves between frames, and the tray
	// chip is the one element whose position depends on the carousel window.
	let gameEl: HTMLDivElement;
	let chipEls: Record<number, HTMLElement | undefined> = {};
	let oddsEls: Partial<Record<Colour, HTMLElement>> = {};
	// Flights in the air, so one can be caught and turned around mid-animation.
	let flightEls: Record<number, HTMLElement | undefined> = {};

	const centreIn = (host: DOMRect, rect: DOMRect) => ({
		x: rect.left - host.left + rect.width / 2,
		y: rect.top - host.top + rect.height / 2,
	});

	/** Chip skin and label for the stake currently in the tray — every placed chip carries it. */
	const currentChipFace = () => {
		const index = stakes.indexOf(stateGame.stake);
		return { label: fmtChip(stateGame.stake), hue: chipHueShift(index), text: chipTextColour(index) }; // prettier-ignore
	};

	const isLive = (id: number) => flights.some((flight) => flight.id === id);

	// Cues and teardown are timers rather than animation events, because a flight that turns
	// around mid-air has to re-time both. Tracked per flight so they can be called off.
	const flightTimers = new Map<number, ReturnType<typeof setTimeout>[]>();

	const schedule = (id: number, run: () => void, ms: number) => {
		flightTimers.set(id, [...(flightTimers.get(id) ?? []), setTimeout(run, ms)]);
	};

	const cancelCues = (id: number) => {
		for (const timer of flightTimers.get(id) ?? []) clearTimeout(timer);
		flightTimers.delete(id);
	};

	const dropFlight = (id: number) => {
		cancelCues(id);
		delete flightEls[id];
		flights = flights.filter((flight) => flight.id !== id);
	};

	/**
	 * Fly a chip between the tray and `colour` — out to the board to place a bet, back again to
	 * take one off. Both directions describe the SAME path; 'return' simply plays it backwards
	 * (see the `reverse` direction in CSS), so the chip lifts off the box, retraces the arc and
	 * settles into the tray. A no-op if either end cannot be measured.
	 */
	const flyChip = (colour: Colour, kind: 'place' | 'return') => {
		const tray = chipEls[stateGame.stake];
		const box = oddsEls[colour];
		// No geometry means no animation — the bet itself is already placed (or taken off) anyway.
		if (!gameEl || !tray || !box) return;

		const host = gameEl.getBoundingClientRect();
		const id = ++flightId;
		flights = [
			...flights,
			{
				id,
				kind,
				colour,
				...currentChipFace(),
				from: centreIn(host, tray.getBoundingClientRect()),
				to: centreIn(host, box.getBoundingClientRect()),
				delay: 0,
				spin: 0,
				turned: false,
			},
		];

		// Whoosh on movement start (the end of the grow), pop as the chip starts shrinking onto
		// wherever it is headed. Symmetric phases put both cues at the same moments in a reversed
		// flight.
		schedule(id, () => playSound('whoosh'), GROW_MS);
		schedule(id, () => playSound('pop'), GROW_MS + TRAVEL_MS);
		schedule(id, () => dropFlight(id), FLIGHT_MS);
	};

	/**
	 * Catch a chip that is still on its way to a colour and send it back where it came from.
	 *
	 * Reversing the running animation, rather than starting a fresh one, is what makes it the
	 * SAME chip: it turns round wherever it happens to be and retraces its own arc, and the trip
	 * home takes exactly as long as the trip out had been going.
	 */
	const turnBack = (flight: ChipFlight) => {
		const animation = flightEls[flight.id]?.getAnimations()[0];
		const elapsed = Number(animation?.currentTime ?? 0);
		// Caught before it had drawn a frame (a double-tap inside one frame, so the copy has not
		// even rendered yet): nothing has visibly moved, so there is nothing to play back. Take it
		// away rather than flying a chip home from a box it never reached.
		if (!animation || elapsed <= 0) {
			dropFlight(flight.id);
			return;
		}

		animation.reverse();
		flights = flights.map((other) =>
			other.id === flight.id ? { ...other, turned: true } : other,
		);

		cancelCues(flight.id);
		// Cues mirror the outward trip: a whoosh as it turns — skipped if it never got past the
		// grow and so never actually travelled — then a pop as it starts shrinking back into the
		// tray, and home again after as long as it had been out.
		if (elapsed > GROW_MS) playSound('whoosh');
		schedule(flight.id, () => playSound('pop'), Math.max(0, elapsed - GROW_MS));
		schedule(flight.id, () => dropFlight(flight.id), elapsed);
	};

	/** Take the chip off `colour`: turn it round if it is still on its way, else fly it home. */
	const recallChip = (colour: Colour) => {
		const arriving = flights.find(
			(flight) => flight.kind === 'place' && !flight.turned && flight.colour === colour,
		);
		if (arriving) turnBack(arriving);
		else flyChip(colour, 'return');
	};

	/** Fisher-Yates copy. The sweep order is deliberately not the board order. */
	const shuffled = (colours: Colour[]): Colour[] => {
		const order = [...colours];
		for (let i = order.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[order[i], order[j]] = [order[j], order[i]];
		}
		return order;
	};

	/** Tip every placed chip off the bottom of the table, each starting at its own moment. */
	const sweepChips = (colours: Colour[]) => {
		if (!gameEl || !colours.length) return;
		const host = gameEl.getBoundingClientRect();
		const face = currentChipFace();
		// Chips are 3.5vw square (table.scss), so this clears the bottom edge by a full chip.
		const floor = host.height + window.innerWidth * 0.035;
		// One slot each, in a shuffled order, with the start jittered inside its slot: the chips
		// leave at genuinely different moments rather than marching off in board order.
		const slot = SWEEP_WINDOW_MS / colours.length;

		for (const [position, colour] of shuffled(colours).entries()) {
			const target = oddsEls[colour];
			if (!target) continue;
			const from = centreIn(host, target.getBoundingClientRect());
			const delay = Math.round((position + Math.random()) * slot);
			const id = ++flightId;
			flights = [
				...flights,
				{
					id,
					kind: 'sweep',
					colour,
					...face,
					from,
					to: { x: from.x, y: floor },
					delay,
					// A parting tilt either way, so no two chips fall alike.
					spin: Math.round((Math.random() * 2 - 1) * 45),
					turned: false,
				},
			];
			schedule(id, () => playSound('whoosh'), delay);
			schedule(id, () => dropFlight(id), delay + SWEEP_FALL_MS);
		}
	};

	/** Clear, with the chips leaving down the bottom of the table rather than blinking out. */
	const clearBoard = () => {
		// Measured and spawned BEFORE the state clears, while the placed chips are still there;
		// the copies pick up exactly where they left off (see the `backwards` fill in CSS).
		sweepChips(stateGameDerived.backedColours());
		stateGameDerived.clearBets();
	};

	/** Everything the keyframes read, as custom properties; each kind uses the ones it needs. */
	const flightStyle = (flight: ChipFlight) =>
		[
			`--from-x:${flight.from.x}px`,
			`--from-y:${flight.from.y}px`,
			`--to-x:${flight.to.x}px`,
			`--to-y:${flight.to.y}px`,
			`--flight-ms:${FLIGHT_MS}ms`,
			`--sweep-ms:${SWEEP_FALL_MS}ms`,
			`--sweep-delay:${flight.delay}ms`,
			`--spin:${flight.spin}deg`,
			`--chip-hue:${flight.hue}deg`,
			`--chip-text:${flight.text}`,
		].join('; ');

	// A chip still on its way IN to a colour that has since been un-backed (a second tap, undo,
	// clear, or the board resetting after a result) has nothing left to land on, so drop it. Only
	// placements are tied to the board this way — returns and sweeps are animating a colour that
	// is un-backed by definition.
	const stranded = (flight: ChipFlight) =>
		flight.kind === 'place' && !flight.turned && !stateGame.backed[flight.colour];
	$effect(() => {
		if (flights.some(stranded)) flights = flights.filter((flight) => !stranded(flight));
	});

	onMount(() => {
		preloadSounds();
		// Stop in-flight timers from firing a sound into a torn-down game.
		return () => (flights = []);
	});

	const toggleColour = (colour: Colour) => {
		if (!idle) return;
		const wasBacked = stateGameDerived.isBacked(colour);
		if (!stateGameDerived.toggleColour(colour)) return;
		// Tapping a backed colour takes the bet off, so its chip goes back to the tray.
		if (wasBacked) recallChip(colour);
		else flyChip(colour, 'place');
	};

	/** Undo, sending the chip that comes off back to the tray. */
	const undoBet = () => {
		const last = stateGameDerived.backedColours().at(-1);
		stateGameDerived.undoBet();
		// `undoBet` is a no-op mid-roll, so only animate what actually came off.
		if (last && !stateGame.backed[last]) recallChip(last);
	};

	// Stake at the moment of commit — the board can reset while the roll plays out.
	let committedStake = $state(0);
	const roll = () => {
		if (!canRoll) return;
		stakePanelOpen = false;

		// An RGS round left open by a reload or dropped connection has to be finished first —
		// otherwise /wallet/play comes back ERR_VAL "player has active round". Replaying it
		// settles it, and the next tap places the new bet.
		if (online && hasActiveRoundToResume()) {
			betNotice = 'Finishing your previous round…';
			stateGame.rolling = true;
			context.eventEmitter.broadcast({ type: 'resumeBet' });
			return;
		}

		committedStake = total;
		if (!stateGameDerived.beginRoll()) return;

		// Catch a stale math publish before the RGS answers with a generic error.
		const mismatch = online ? describeModeMismatch(stateBet.activeBetModeKey) : null;
		if (mismatch) {
			console.error(`[colour-dice] ${mismatch}`);
			betNotice = mismatch;
			stateGame.rolling = false;
			return;
		}

		stateGame.rolling = true;
		context.eventEmitter.broadcast({ type: 'bet' });
	};

	// Surfaced in-game so bet problems are visible without opening the console.
	let betNotice = $state('');

	// The tray is disabled mid-roll, so never leave the panel hanging open over it.
	$effect(() => {
		if (stateGame.rolling) stakePanelOpen = false;
	});

	// Safety net against a permanently dead Play button. `rolling` is cleared by the settle
	// path, but a bet or resume that fails server-side (e.g. end-round 500) can return the
	// machine to idle without ever settling — leaving `rolling` stuck true and the board
	// locked. Whenever xstate says idle, the board is idle.
	$effect(() => {
		if (context.stateXstateDerived.isIdle() && stateGame.rolling) stateGame.rolling = false;
	});

	const sign = $derived(stateBet.currency === 'USD' ? '$' : `${stateBet.currency} `);
	const fmt = (value: number) =>
		value >= 1000 ? `${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)}k` : value.toFixed(2);
	const fmtChip = (value: number) => (value >= 1000 ? `${value / 1000}k` : `${value}`);

	// Round readout (RoundResult). Follows ColourDice2's `app-result`: the grouped dice go up as
	// soon as the round resolves — win or lose — and stay up until the next round starts, with
	// the win marquee layered on when it paid.
	let winCash = $state(0);

	// `resultReady` is cleared by beginRoll and by resetBoard, so this covers both starting the
	// next roll and touching the board.
	$effect(() => {
		if (!stateGame.resultReady) winCash = 0;
	});

	context.eventEmitter.subscribeOnMount({
		winShow: async (emitterEvent) => {
			// Book amounts are x100 in units of the per-colour stake, so cash scales by betAmount.
			winCash = (emitterEvent.amount / 100) * stateBet.betAmount;
			// Hold the book sequence so the amount registers before the round closes out; a big
			// win gets longer. The readout itself is not on a timer — it stays until the next round.
			const multiplier = committedStake > 0 ? winCash / committedStake : 0;
			await waitForTimeout(multiplier >= 20 ? 2600 : 1600);
		},
	});
</script>

{#if online}
	<EnableGameActor />
{:else}
	<DevHarness />
{/if}

<div class="game" bind:this={gameEl}>
	{#if stateGame.openRoundError || betNotice}
		<div class="bet-notice" onclick={() => (betNotice = '')} aria-hidden="true">
			{stateGame.openRoundError || betNotice}
		</div>
	{/if}

	<!-- Overlaid on the table rather than in a bar, so the felt runs the full height. -->
	<div class="hud">
		<div class="balance-hud">
			<div class="balance-chip" aria-hidden="true"></div>
			<div class="balance-text">
				<span class="hud-lbl">Balance</span>
				<span class="hud-val">{sign}{fmt(stateBet.balanceAmount)}</span>
			</div>
		</div>
		<div class="menu-btn" aria-hidden="true"></div>
	</div>

	<div class="player">
		<DiceBox />
	</div>

	<div class="bottom-panel">
		<div class="betting-panel-wrap">
			<div class="betting-panel">
				<div class="inner-panel">
					<!-- Play sits directly above the chip tray as a tab, matching the Angular
					     original's `.confirm-btn`. -->
					<div class="confirm-btn" class:disabled={!canRoll} onclick={roll} aria-hidden="true">
						<div class="confirm-lbl">{stateGame.rolling ? '…' : 'PLAY'}</div>
					</div>

					<div class="actions-wrap">
						<div
							class="clear-btn"
							class:disabled={!idle || backedCount === 0}
							onclick={clearBoard}
							title="Clear"
							aria-hidden="true"
						></div>
						<div class="chipandstate-wrap">
							{#if stakePanelOpen}
								<!-- Full grid of bet levels. Tapping the selected chip again toggles it. -->
								<div class="stake-panel">
									<div class="stake-panel-title">Bet amount</div>
									<div class="stake-panel-grid">
										{#each stakes as value, i (value)}
											<div class="stake-option" class:current={stateGame.stake === value}>
												<div
													class="chip"
													class:selected={stateGame.stake === value}
													style="--chip-hue:{chipHueShift(i)}deg; --chip-text:{chipTextColour(i)}"
													onclick={() => pickStake(value)}
													aria-hidden="true"
												>
													<span>{fmtChip(value)}</span>
												</div>
											</div>
										{/each}
									</div>
								</div>
							{/if}

							<div class="chips-wrap">
								{#each carousel as chip (chip.value)}
									<div class="chip-wrap" style="--depth:{chip.depth}">
										<div
											bind:this={chipEls[chip.value]}
											class="chip"
											class:selected={chip.selected}
											class:open={chip.selected && stakePanelOpen}
											style="--chip-hue:{chipHueShift(chip.index)}deg; --chip-text:{chipTextColour(chip.index)}"
											onclick={() => onChipClick(chip.value, chip.selected)}
											aria-hidden="true"
										>
											<span>{fmtChip(chip.value)}</span>
										</div>
									</div>
								{/each}
							</div>
						</div>
						<div
							class="undo-btn"
							class:disabled={!idle || backedCount === 0}
							onclick={undoBet}
							title="Undo"
							aria-hidden="true"
						></div>
					</div>

					<div class="outcomes">
						{#each DISPLAY_COLOURS as colour (colour)}
							{@const backed = stateGameDerived.isBacked(colour)}
							{@const win = stateGameDerived.winForColour(colour)}
							<div
								bind:this={oddsEls[colour]}
								class="odds {colour}"
								class:win={Boolean(win)}
								class:backed
								onclick={() => toggleColour(colour)}
								aria-hidden="true"
							>
								<div class="outcome-stat">
									<div class="total-amount-lbl">{colour.toUpperCase()}</div>
								</div>
								<!-- The big multiplier badge along the bottom is the only result readout. -->
								<div class="rate {stateGameDerived.winTypeForColour(colour)}"></div>
								{#if backed && !arrivingColours.has(colour)}
									<!-- The actual chip lands on the colour, rather than a text pill, so the
									     board reads like real chips on a felt. Held back until the thrown
									     copy has landed (see launchChip), so the bet shows as one chip. -->
									<div
										class="placed-chip chip"
										style="--chip-hue:{chipHueShift(stakes.indexOf(stateGame.stake))}deg; --chip-text:{chipTextColour(stakes.indexOf(stateGame.stake))}"
									>
										<span>{fmtChip(stateGame.stake)}</span>
									</div>
								{/if}
							</div>
						{/each}
					</div>

					<!-- Total wager, below the colour selection. -->
					<div class="total-bet">
						<span class="total-bet-lbl">Total Bet</span>
						<span class="total-bet-val">{sign}{fmt(total)}</span>
					</div>
				</div>
			</div>
		</div>
	</div>

	{#if stakePanelOpen}
		<!-- Click-anywhere-else dismissal. Sits under the panel but over everything else, so a
		     stray tap closes it instead of changing the board behind it. -->
		<div class="stake-panel-backdrop" onclick={() => (stakePanelOpen = false)} aria-hidden="true"></div>
	{/if}

	<!-- Chips on the move: thrown from the tray onto a colour, or swept off the table on clear.
	     Purely decorative — the bet is registered before the chip ever leaves the tray. -->
	{#each flights as flight (flight.id)}
		<div
			bind:this={flightEls[flight.id]}
			class="chip flying-chip {flight.kind}"
			style={flightStyle(flight)}
			aria-hidden="true"
		>
			<span>{flight.label}</span>
		</div>
	{/each}

	<WheelBonus />

	{#if stateGame.resultReady}
		<RoundResult amount={winCash} {sign} />
	{/if}
</div>

<style>
	/* Every chip uses the same `chip_base.svg` art, tinted per stake by `--chip-hue` (see
	   chipHueShift). The art lives on a ::before rather than on the element itself so the
	   hue-rotate cannot reach the label — filtering the element would shift the text colour
	   and its outline along with the disc. */
	.chip {
		position: relative;
		background-image: none;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.chip::before {
		content: '';
		position: absolute;
		inset: 0;
		background: url('/img/chip_base.svg') no-repeat center / contain;
		filter: hue-rotate(var(--chip-hue, 0deg));
		z-index: 0;
	}
	/* Label is a darker shade of the chip's own colour — no outline, the contrast carries it. */
	.chip span {
		position: relative;
		z-index: 1;
		font-size: 1.05vw;
		font-weight: 700;
		color: var(--chip-text, #1d5c28);
		-webkit-text-stroke: 0;
		line-height: 1;
	}
	.chip.selected {
		outline: 0.3vw solid #ffe14d;
		border-radius: 50%;
	}
	/* The selected chip doubles as the "show all amounts" toggle, so mark it while open. */
	.chip.open {
		outline-color: #ffffff;
	}

	/* A chip on the move over the table. Sized explicitly because table.scss only sizes chips
	   inside `.bottom-panel`, and pulled back by half its own size so `--from-*`/`--to-*` can be
	   plain centre coordinates measured off `.game`. Above the tray and the stake panel, so it
	   stays visible over whatever it crosses. */
	.flying-chip {
		position: absolute;
		top: 0;
		left: 0;
		width: 3.5vw;
		height: 3.5vw;
		margin: -1.75vw 0 0 -1.75vw;
		z-index: 45;
		pointer-events: none;
		filter: drop-shadow(0 0.2vw 0.35vw rgba(0, 0, 0, 0.55));
	}
	/* Thrown from the tray onto a colour. `both` rather than `forwards` because this one can be
	   played in reverse mid-flight (turnBack): a reversed animation finishes at the START of the
	   timeline, so it is the BACKWARDS fill that then holds the chip in the tray. */
	.flying-chip.place {
		animation: chip-flight var(--flight-ms) both;
	}
	/* Taken back off. Literally the placement run backwards: the chip lifts off the box, retraces
	   the arc, and shrinks into the tray. `forwards` therefore holds the 0% keyframe (the tray) —
	   the last frame of a reversed play. */
	.flying-chip.return {
		animation: chip-flight var(--flight-ms) reverse forwards;
	}
	/* Swept off the table on clear. `backwards` is what makes the stagger work: a chip waiting
	   its turn holds the 0% keyframe, so it sits exactly where the placed chip it replaced was
	   until its own moment comes. `ease-in` gives the drop some weight. */
	.flying-chip.sweep {
		animation: chip-sweep var(--sweep-ms) var(--sweep-delay) ease-in both;
	}
	/* Stops mirror the phase split in the script (grow 20%, travel 60%, settle 20%) — keep the
	   two in step. The chip is picked up with a slight overshoot, tossed along an arc (the 50%
	   stop lifts the midpoint, so it does not slide flat across the panel), then set down at its
	   normal size on the box. */
	@keyframes chip-flight {
		0% {
			translate: var(--from-x) var(--from-y);
			scale: 1;
			animation-timing-function: cubic-bezier(0.34, 1.56, 0.64, 1);
		}
		20% {
			translate: var(--from-x) var(--from-y);
			scale: 1.35;
			animation-timing-function: ease-in;
		}
		50% {
			translate: calc((var(--from-x) + var(--to-x)) / 2)
				calc((var(--from-y) + var(--to-y)) / 2 - 1.6vw);
			animation-timing-function: ease-out;
		}
		80% {
			translate: var(--to-x) var(--to-y);
			scale: 1.35;
			animation-timing-function: ease-out;
		}
		100% {
			translate: var(--to-x) var(--to-y);
			scale: 1;
		}
	}

	/* The clear sweep: straight down past the bottom edge, tipping over as it goes. `.game`
	   clips at that edge, so the chip is gone before the element is removed. */
	@keyframes chip-sweep {
		0% {
			translate: var(--from-x) var(--from-y);
			rotate: 0deg;
		}
		100% {
			translate: var(--to-x) var(--to-y);
			rotate: var(--spin);
		}
	}

	/* Full bet-level grid, opened by tapping the selected chip. Anchored to the tray and
	   opening upward — the tray sits low in the frame, so downward would run off-screen. */
	.chipandstate-wrap {
		position: relative;
	}
	.stake-panel {
		position: absolute;
		bottom: calc(100% + 0.8vw);
		left: 50%;
		transform: translateX(-50%);
		z-index: 40;
		/* Shrink-to-fit would otherwise inherit the narrow tray's width and wrap a 6-chip grid
		   as 5 + 1. `max-content` sizes to the row, capped so long RGS grids still wrap tidily. */
		width: max-content;
		max-width: 46vw;
		padding: 0.8vw 1vw 1vw;
		border-radius: 1vw;
		background: rgba(18, 20, 34, 0.96);
		border: 0.1vw solid #828a97;
		box-shadow: 0 0.4vw 1.2vw rgba(0, 0, 0, 0.55);
	}
	/* Little pointer down to the chip that opened it. */
	.stake-panel::after {
		content: '';
		position: absolute;
		top: 100%;
		left: 50%;
		transform: translateX(-50%);
		border: 0.6vw solid transparent;
		border-top-color: rgba(18, 20, 34, 0.96);
	}
	.stake-panel-title {
		font-family: 'Alexandria', sans-serif;
		font-size: 0.75vw;
		font-weight: 600;
		letter-spacing: 0.05vw;
		text-transform: uppercase;
		color: #9aa3b4;
		text-align: center;
		margin-bottom: 0.6vw;
	}
	.stake-panel-grid {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5vw;
		justify-content: center;
	}
	/* Neutralise the carousel's depth transform for panel chips — every option shows full size. */
	.stake-option {
		scale: 1;
		opacity: 1;
	}
	.stake-panel-backdrop {
		position: fixed;
		inset: 0;
		z-index: 35;
	}

	/* Bet notice / error banner — tap to dismiss. */
	.bet-notice {
		position: absolute;
		top: 4vw;
		left: 50%;
		transform: translateX(-50%);
		z-index: 60;
		max-width: 70vw;
		padding: 0.6vw 1vw;
		border-radius: 0.6vw;
		background: rgba(120, 20, 20, 0.95);
		border: 0.1vw solid #ff8a80;
		color: #fff;
		font-family: 'Alexandria', sans-serif;
		font-size: 0.8vw;
		line-height: 1.4;
		text-align: center;
		cursor: pointer;
	}

	/* Carousel depth: `--depth` is the slot's distance from the selected chip (0, 1 or 2), so
	   the selection sits front and full-size and the rest recede either side. Applied to the
	   wrapper so table.scss's own `.chip.selected` scale still layers on top. */
	.chip-wrap {
		scale: calc(1 - var(--depth, 0) * 0.11);
		opacity: calc(1 - var(--depth, 0) * 0.22);
		z-index: calc(3 - var(--depth, 0));
		transition:
			scale 0.18s ease,
			opacity 0.18s ease;
	}
	.odds {
		cursor: pointer;
		position: relative;
	}
	/* A colour that landed — every backed colour pays on its own match count, so more than
	   one of these can light up in the same round. */
	.odds.win {
		outline: 0.3vw solid #ffe14d;
		outline-offset: -0.3vw;
		filter: brightness(1.15);
	}
	/* Backed but not yet resolved. */
	.odds.backed {
		box-shadow:
			inset 0 0.1vw 0.1vw 0.05vw #ffeddb,
			inset 0 0.1vw 0.4vw 0.1vw #ffffff;
	}
	/* Colour name across the top of the box. table.scss lays `.outcome-stat` out flush left
	   with a side margin, so centre it and drop the horizontal inset. */
	.odds .outcome-stat {
		justify-content: center;
		margin-left: 0;
		margin-right: 0;
	}
	/* The chip riding on this colour — same art as the tray, dropped on the top-centre of the
	   box. Every backed colour carries the same amount, so they all show the same chip.

	   It has to keep the `.chip` class to pick up its skin from global.scss, which drags in
	   table.scss's `.bottom-panel .betting-panel-wrap .betting-panel .outcomes .chip` — a
	   five-class selector pinning it to `left: 29%` / `bottom: 1vw` with a negative top
	   margin. `!important` is the readable way to win that rather than restating the whole
	   ancestor chain here; it is scoped to this one element. */
	.odds .placed-chip {
		position: absolute;
		top: 50% !important;
		bottom: auto !important;
		left: 50% !important;
		transform: translate(-50%, -50%);
		z-index: 12;
		margin: 0 !important;
		pointer-events: none;
		filter: drop-shadow(0 0.15vw 0.25vw rgba(0, 0, 0, 0.5));
	}
	/* Undo control — reuses the round pill look of clear/repeat with an arrow glyph. */
	.undo-btn {
		width: 3vw;
		height: 3vw;
		margin: auto 1vw;
		cursor: pointer;
		border-radius: 50%;
		background: rgba(88, 88, 88, 0.7);
		border: 0.05vw solid #828a97;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.undo-btn::before {
		content: '↶';
		color: #fff;
		font-size: 1.8vw;
		line-height: 1;
	}
	/* table.scss lays the panel out from 25vw to the right edge — it used to share the row with
	   the live dealer's chat column. Nothing sits beside it now, so mirror that inset on the
	   left instead of dropping it: same 75vw width as before, just centred rather than shoved
	   against the right edge. */
	.bottom-panel {
		left: 12.5vw;
		right: 12.5vw;
		justify-content: center;
		/* table.scss lifts this 4vw to clear the old bottom bar. That bar is gone, so drop the
		   panel back down to a small margin off the bottom edge. */
		bottom: 1vw;
	}
	.undo-btn.disabled,
	.clear-btn.disabled {
		cursor: not-allowed;
		opacity: 0.5;
		filter: grayscale(1);
		pointer-events: none;
	}
	/* HUD overlaid on the table: balance top-left, menu top-right. Replaces the old bottom bar,
	   which is gone entirely. */
	.hud {
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		z-index: 20;
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		padding: 1vw 1.2vw;
		pointer-events: none;
	}
	.balance-hud {
		display: flex;
		align-items: center;
		gap: 0.5vw;
		font-family: 'Alexandria', sans-serif;
		text-shadow: 0 0.1vw 0.3vw rgba(0, 0, 0, 0.8);
	}
	.balance-chip {
		width: 2.2vw;
		height: 2.2vw;
		flex: none;
		background: url('/img/chip_yellow.svg') no-repeat center / contain;
		filter: drop-shadow(0 0.1vw 0.2vw rgba(0, 0, 0, 0.6));
	}
	.balance-text {
		display: flex;
		flex-direction: column;
	}
	.hud-lbl {
		font-size: 0.7vw;
		font-weight: 500;
		letter-spacing: 0.05vw;
		text-transform: uppercase;
		color: #d6c6b4;
	}
	.hud-val {
		font-size: 1.3vw;
		font-weight: 700;
		color: #ffe14d;
	}
	/* global.scss sizes .menu-btn at 10vw for the mobile layout, and the bottom bar that used
	   to override it is gone — so pin the size here. */
	.hud .menu-btn {
		width: 2.6vw;
		height: 2.6vw;
		margin: 0;
		cursor: pointer;
		pointer-events: auto;
	}

	/* Total wager, below the colour selection. */
	.total-bet {
		display: flex;
		align-items: baseline;
		justify-content: center;
		gap: 0.4vw;
		margin-top: 0.5vw;
		font-family: 'Alexandria', sans-serif;
		text-shadow: 0 0.1vw 0.3vw rgba(0, 0, 0, 0.8);
	}
	.total-bet-lbl {
		font-size: 0.7vw;
		font-weight: 500;
		letter-spacing: 0.05vw;
		text-transform: uppercase;
		color: #d6c6b4;
	}
	.total-bet-val {
		font-size: 1.1vw;
		font-weight: 700;
		color: #ffe14d;
	}

	/* Play — the green tab from the Angular original's `.confirm-btn`: rounded only at the
	   top, centred, and sitting directly on top of the chip tray. */
	.confirm-btn {
		position: relative;
		bottom: -0.9vw;
		margin: auto auto 1vw auto;
		width: 14vw;
		height: 2vw;
		padding-top: 1vw;
		background: linear-gradient(180deg, #68d253 0%, #61c741 100%);
		box-shadow: inset 0 0.2vw 0.5vw #0000003f;
		border-radius: 1.5vw 1.5vw 0 0;
		color: #195b25;
		font-family: 'Alexandria', sans-serif;
		font-weight: 600;
		font-size: 1.8vw;
		line-height: 1vw;
		text-align: center;
		cursor: pointer;
	}
	.confirm-btn.disabled {
		background: linear-gradient(180deg, #e7e6ff73 0%, #e7e6ff73 100%);
		box-shadow: inset 0 1vw 0.4vw #ffffff2b;
		color: #9d9cb8;
		cursor: not-allowed;
		pointer-events: none;
	}
</style>
