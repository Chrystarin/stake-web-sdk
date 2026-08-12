<script lang="ts">
	import '../styles/global.scss';
	import '../styles/table.scss';

	import { onMount, untrack } from 'svelte';

	import { stateBet } from 'state-shared';
	import { stateUrlDerived } from 'state-shared';
	import { waitForTimeout } from 'utils-shared/wait';

	import { getContext } from '../game/context';
	import { stateGame, stateGameDerived } from '../game/stateGame.svelte';
	import { hasActiveRoundToResume, describeModeMismatch } from '../game/activeRound';
	import { playSound, preloadSounds, startMusic, stopMusic, syncMusicVolume } from '../game/sound';
	import { COLOUR_HEX, WHEEL_VALUES, type Colour } from '../game/constants';
	import { JackpotPlinko, type JackpotPlinkoApi } from '../plinko';

	import DiceBox from './DiceBox.svelte';
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
	// Every stake is rendered, as one long rail; the tray only shows the five slots it is wide
	// and clips the rest (see .chips-viewport). Moving the window is then a transition on the
	// rail's offset, so the chips travel to their new slots instead of being swapped in place.
	//
	// The window CLAMPS at both ends rather than wrapping: wrapping would keep the selection
	// perfectly centred, but it also parks the dearest chips right next to the cheapest, so a
	// single mis-tap could swing the stake from the minimum to the maximum. The cost is that
	// the selected chip sits off-centre for the first and last couple of options.
	const VISIBLE_CHIPS = 5;

	const carousel = $derived.by(() => {
		const total = stakes.length;
		// Never exceed the number of options, otherwise the tray would show blank slots.
		const windowSize = Math.min(VISIBLE_CHIPS, total);
		const middle = Math.floor(windowSize / 2);
		const selected = Math.max(0, stakes.indexOf(stateGame.stake));
		const start = Math.min(Math.max(selected - middle, 0), total - windowSize);
		return {
			windowSize,
			// Slots the rail is scrolled by — the index of the first chip in the window.
			start: Math.max(start, 0),
			chips: stakes.map((value, index) => ({
				value,
				index,
				// Depth drives the visual falloff and is measured from the SELECTED chip, so that
				// stays front even when clamping has pushed it off the middle slot. Capped at 2
				// because a clamped window can sit up to four slots from the selection.
				depth: Math.min(Math.abs(index - selected), 2),
				selected: index === selected,
				// Clipped chips are still in the DOM, so they must not take taps.
				shown: index >= start && index < start + windowSize,
			})),
		};
	});

	// Tapping the already-selected chip opens the full grid — the carousel only ever shows five
	// at a time, so this is how you reach an amount several steps away without walking to it.
	let stakePanelOpen = $state(false);

	const onChipClick = (value: number, isSelected: boolean) => {
		// A resolved round has to be cleared before anything else moves — every chip on the felt
		// is part of a payout that has not been taken yet.
		if (settled || clearing) return;
		if (isSelected) stakePanelOpen = !stakePanelOpen;
		else selectStake(value);
	};

	const pickStake = (value: number) => {
		if (settled || clearing) return;
		selectStake(value);
		stakePanelOpen = false;
	};

	const backedCount = $derived(stateGameDerived.backedCount());
	const total = $derived(stateGameDerived.totalStake());
	const idle = $derived(context.stateXstateDerived.isIdle() && !stateGame.rolling);
	// A round that has resolved and not yet been cleared. The board is frozen in this state: the
	// chips showing are the payout, so the only thing left to do with it is collect (see
	// `finishRound`), which is what Play turns into.
	const settled = $derived(stateGame.resultReady);
	/** True from the moment Clear is pressed until the board is open for betting again. */
	let clearing = $state(false);
	/**
	 * True from the moment a round resolves until the last won chip has landed on its colour.
	 * Driven by the payout waves further down, and read here to hold the buttons.
	 */
	let payingOut = $state(false);
	/**
	 * True for the whole plinko round, screen slide included.
	 *
	 * The jackpot lands in the middle of a book, and the board underneath it is briefly in view as
	 * the screen comes down and again as it lifts — long enough for the betting controls to flash
	 * back if the only thing holding them off were the roll. Set by the handler that awaits the
	 * round (further down), so it spans exactly as long as the screen is up.
	 */
	let jackpotUp = $state(false);
	/** Drives the readout's shrink-away; it is unmounted by the reset that follows. */
	let resultClosing = $state(false);
	/**
	 * The board is open for betting: nothing in flight, nothing resolved and waiting to be taken.
	 *
	 * This is the one condition the betting controls answer to — the chip tray, clear and undo can
	 * only ever do something while it holds, so they are only ever on the table while it holds. It
	 * is deliberately made of every signal that a round is under way rather than just `rolling`:
	 * the machine being busy covers a book still playing after the dice have settled, and
	 * `jackpotUp` covers the plinko round, whose screen slides in and out over the board and would
	 * otherwise let the controls flash back either side of it.
	 */
	const bettingOpen = $derived(idle && !settled && !clearing && !jackpotUp);
	const controlsHidden = $derived(!bettingOpen);
	const canRoll = $derived(bettingOpen && backedCount > 0 && !stateGame.openRoundError);
	// Both button faces read these, and so do their handlers — a press that is greyed out has to
	// stay silent, so the click sound only ever answers a press that did something.
	//
	// A settled board is held until `payingOut` clears: both buttons collect, so leaving either one
	// live would let the winnings be swept off while they were still being dealt onto the colours.
	const confirmDisabled = $derived(settled ? clearing || payingOut : !canRoll);
	const clearDisabled = $derived(
		clearing || payingOut || (!settled && (!idle || backedCount === 0)),
	);
	/**
	 * The Play tab folds away only while a round is actually running.
	 *
	 * It stays on the table whenever the board is open for betting — greyed out on an empty one,
	 * because that is still a board you are about to bet on and the tab is where that ends up. What
	 * it will not do is sit there through the dice, the jackpot and the payout offering nothing: it
	 * goes down with the controls and comes back up as Play Again the moment the last chip lands,
	 * which is the first moment it can be pressed again.
	 */
	const confirmTucked = $derived(!bettingOpen && !(settled && !confirmDisabled));

	/**
	 * Change the tray denomination. Any bets already on the board are cleared — swept off the
	 * same way the clear button does it, so the board visibly empties rather than the chips
	 * quietly changing value under the player.
	 *
	 * Measured before the switch (the placed chips are still on the board) but spawned after,
	 * carrying the OLD chip face — these are the chips that were on the felt, not the new one.
	 */
	const selectStake = (value: number) => {
		const placed = stateGameDerived.backedColours();
		const face = currentChipFace();
		if (!stateGameDerived.selectStake(value)) return;
		sweepChips(placed, face);
	};

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
	//   'collect'— a chip that PAID does not get swept: it flies up to the balance chip in the
	//              HUD and merges into it, and the balance reads out its new figure as it lands.
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

	// Collecting a win. Travel and merge are ONE animation (`chip-collect`) split at
	// COLLECT_TRAVEL_MS, because the merge is the tail of the same arc — the chip reaches the
	// balance and keeps going, shrinking into it. The keyframe's 74% stop is that split, so the
	// two numbers below have to stay in proportion with it.
	const COLLECT_TRAVEL_MS = 560;
	const COLLECT_MERGE_MS = 200;
	const COLLECT_MS = COLLECT_TRAVEL_MS + COLLECT_MERGE_MS;
	// Chips go in one at a time rather than as a shower, so each one lands on its own beat — until
	// there are too many for that, when the whole collect is fitted into `COLLECT_WINDOW_MS` and
	// the beats it sounds and kicks the balance on are thinned to `COLLECT_BEATS`.
	const COLLECT_STAGGER_MS = 90;
	const COLLECT_WINDOW_MS = 1800;
	const COLLECT_BEATS = 12;
	/** The amount floating away under the balance once the chips are in. */
	const WIN_FLOAT_MS = 1100;

	// --- Paying out ------------------------------------------------------------------------
	// A colour that landed grows its chip into the stack it won — 2x is two chips, 3x is three —
	// and the two waves are sequenced rather than played together, so the board reads as being
	// paid out colour by colour instead of everything changing at once.
	const PAYOUT_LEAD_MS = 420;
	const PAYOUT_WAVE_MS = 560;
	const PAYOUT_POP_MS = 300;
	const PAYOUT_POP_STAGGER_MS = 110;
	/** How far up the pile each chip above the first sits, in vw. Mirrored by `--tier` in CSS. */
	const TIER_RISE_VW = 0.5;

	/** How long the round readout takes to shrink away — mirrored by RoundResult's `.closing`. */
	const RESULT_CLOSE_MS = 340;

	type ChipFlight = {
		id: number;
		kind: 'place' | 'return' | 'sweep' | 'collect';
		colour: Colour;
		label: string;
		/** Chip skin, captured at launch: the tray selection can move on mid-flight. */
		hue: number;
		text: string;
		/** Start and end CENTRES, in px relative to `.game`. */
		from: { x: number; y: number };
		to: { x: number; y: number };
		/** Sweep/collect only: ms this chip waits its turn, and the tilt it falls away with. */
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
	// Where collected chips are headed. Re-bound whenever the HUD replays its take (see
	// `balancePulse`), so it is measured at the start of a collect rather than kept.
	let balanceChipEl: HTMLElement | undefined = $state();
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

	/**
	 * Tip every placed chip off the bottom of the table, each starting at its own moment.
	 *
	 * `face` is a parameter because the tray can already have moved on by the time the sweep is
	 * launched (changing the chip value clears the board): the chips falling away must wear the
	 * denomination they were placed with, not the one replacing it.
	 */
	const sweepChips = (colours: Colour[], face = currentChipFace()) => {
		if (!gameEl || !colours.length) return;
		const host = gameEl.getBoundingClientRect();
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

	// --- Paying out -------------------------------------------------------------------------
	// 0 = nothing paid out yet, 1 = the 2x colours have stacked, 2 = the 3x ones have too.
	let payoutStage = $state(0);

	/**
	 * How many chips are showing on `colour` right now.
	 *
	 * A colour that landed grows into the stack it won — one match pays 2x so it becomes two
	 * chips, two matches pay 3x so three — but only once its wave has played, which is what
	 * `payoutStage` gates. A triple is drawn as three as well; the rest of that prize is the
	 * wheel's, and is presented there.
	 */
	const chipsOnColour = (colour: Colour): number => {
		const win = stateGameDerived.winForColour(colour);
		if (!win) return 1;
		if (win.matches === 1) return payoutStage >= 1 ? 2 : 1;
		if (win.matches >= 2) return payoutStage >= 2 ? 3 : 1;
		return 1;
	};

	// --- The jackpot pile ---------------------------------------------------------------------
	// A jackpot is paid out on the felt in CHIPS, one per multiple won: x200 is two hundred of
	// them. They are dealt into stacks of fifty, up to four stacks side by side — which is exactly
	// the top award — and once a third stack is needed the whole pile is drawn at half size,
	// because four full-size stacks are wider than the box they stand on.
	const JACKPOT_STACK_MAX = 50;
	const JACKPOT_STACKS_MAX = 4;
	/** Stacks from which the pile is drawn small. */
	const JACKPOT_SHRINK_FROM = 3;
	/** Step between chips in a jackpot stack, in vw — fifty have to fit inside the box. */
	const JACKPOT_RISE_VW = 0.085;
	/** A chip's footprint at full size, matching table.scss's `.chip`. */
	const CHIP_SIZE_VW = 3.5;
	/** The whole pile drops in within this window, however deep it is. */
	const PILE_POP_WINDOW_MS = 900;

	/** The chips standing on a colour: how many, in how many stacks, and at what size. */
	type Pile = {
		/** Chips per stack, left to right. */
		stacks: number[];
		/** Chip footprint multiplier — halved once the pile needs a third stack. */
		scale: number;
		/** Vertical step between chips in a stack, in vw. */
		rise: number;
		/**
		 * How far the whole pile is dropped, in vw.
		 *
		 * Chips are anchored to the middle of the box and stack UPWARDS, which is right for the two
		 * or three a normal payout leaves but climbs straight out of the top once fifty are dealt.
		 * Half the pile's own height puts a deep one back inside the box, sitting on its centre
		 * rather than growing off it.
		 */
		shift: number;
		total: number;
	};

	const pileForColour = (colour: Colour): Pile => {
		const jackpot = stateGame.jackpot?.colour === colour ? stateGame.jackpot.multiplier : 0;
		// Gated on the same payout wave as a 3x stack, so the jackpot pile builds on its own beat
		// rather than being there the moment the board resolves.
		if (jackpot > 0 && payoutStage >= 2) {
			const total = Math.min(jackpot, JACKPOT_STACK_MAX * JACKPOT_STACKS_MAX);
			const count = Math.ceil(total / JACKPOT_STACK_MAX);
			const stacks = Array.from({ length: count }, (_, index) =>
				Math.min(JACKPOT_STACK_MAX, total - index * JACKPOT_STACK_MAX),
			);
			const scale = count >= JACKPOT_SHRINK_FROM ? 0.5 : 1;
			const rise = JACKPOT_RISE_VW * scale;
			return { stacks, scale, rise, shift: ((Math.max(...stacks) - 1) * rise) / 2, total };
		}
		const tiers = chipsOnColour(colour);
		return { stacks: [tiers], scale: 1, rise: TIER_RISE_VW, shift: 0, total: tiers };
	};

	/** Where a stack sits across the box, in vw from its centre line. */
	const stackOffsetVw = (pile: Pile, stack: number) =>
		(stack - (pile.stacks.length - 1) / 2) * CHIP_SIZE_VW * pile.scale;

	/** Landing beat for one chip. Two hundred at the full stagger would take half a minute. */
	const chipPopDelay = (pile: Pile, index: number) =>
		Math.min(PAYOUT_POP_STAGGER_MS, PILE_POP_WINDOW_MS / Math.max(1, pile.total - 1)) * index;

	/**
	 * How long the last chip has left to land, measured from the final payout wave starting.
	 *
	 * The piles are dealt on a stagger and a jackpot's runs to two hundred chips, so "the result is
	 * in" and "the chips have stopped moving" are not the same moment. Read against the deepest
	 * pile on the board, because that is the one still landing when the others have finished.
	 */
	const lastChipLandsInMs = (): number => {
		let longest = 0;
		for (const win of stateGame.wins) {
			const pile = pileForColour(win.colour);
			if (pile.total < 2) continue;
			longest = Math.max(longest, chipPopDelay(pile, pile.total - 2));
		}
		return longest + PAYOUT_POP_MS;
	};

	// Run the payout waves as the result lands: every 2x colour stacks, then every 3x one. Waves
	// with nothing in them cost no time, so a round that only paid 3x does not sit through the
	// 2x beat first.
	// `payingOut` (declared with the other button states) is held true across both waves and the
	// stagger that follows them. The chips ARE the payout, so letting the board be swept while they
	// are still being dealt would take the winnings away before they had finished arriving — and on
	// a jackpot, that is most of what the player is there to watch.
	$effect(() => {
		if (!stateGame.resultReady) {
			payoutStage = 0;
			payingOut = false;
			return;
		}
		const doubles = stateGame.wins.some((win) => win.matches === 1);
		const triples = stateGame.wins.some((win) => win.matches >= 2);
		// Nothing paid, so nothing to wait for — the board is free the moment it resolves.
		if (!doubles && !triples) {
			payingOut = false;
			return;
		}

		let cancelled = false;
		payingOut = true;
		void (async () => {
			await waitForTimeout(PAYOUT_LEAD_MS);
			if (cancelled) return;
			payoutStage = 1;
			if (doubles) {
				playSound('pop');
				await waitForTimeout(PAYOUT_WAVE_MS);
				if (cancelled) return;
			}
			payoutStage = 2;
			if (triples) playSound('pop');
			// Measured only now: the piles are not dealt out to full depth until this wave.
			await waitForTimeout(lastChipLandsInMs());
			if (cancelled) return;
			payingOut = false;
		})();
		return () => (cancelled = true);
	});

	// --- Collecting -------------------------------------------------------------------------
	// The balance is NOT computed here. The RGS credits it as the round settles, which is while
	// the payout is still on the felt — so the HUD holds the figure it was showing until the
	// chips have actually gone in, then simply stops holding and reads out whatever the server
	// settled. Nothing client-side ever writes `stateBet.balanceAmount`.
	let balanceHold = $state<number | null>(null);
	const shownBalance = $derived(balanceHold ?? stateBet.balanceAmount);

	$effect(() => {
		if (!stateGame.resultReady || !stateGame.wins.length) return;
		untrack(() => {
			if (balanceHold === null) balanceHold = stateBet.balanceAmount;
		});
	});

	/** Bumped per chip that goes in; re-keys the HUD so it replays its take for each one. */
	let balancePulse = $state(0);
	/** The amount drifting away under the balance after a collect. */
	let winFloat = $state<{ id: number; amount: number; x: number; y: number } | null>(null);

	const showWinFloat = (amount: number) => {
		if (!gameEl || !balanceChipEl) return;
		const host = gameEl.getBoundingClientRect();
		const at = centreIn(host, balanceChipEl.getBoundingClientRect());
		const id = ++flightId;
		winFloat = { id, amount, x: at.x, y: at.y };
		// Guarded on the id so a later collect's float is not cut short by this one's timer.
		setTimeout(() => {
			if (winFloat?.id === id) winFloat = null;
		}, WIN_FLOAT_MS);
	};

	/**
	 * Take the chips off every colour that paid, up to the balance, and merge them in.
	 *
	 * Resolves when the LAST one has landed rather than when the animation is fully over, so the
	 * caller can put the new balance up on the merge instead of after the chips have faded.
	 */
	const collectChips = async (winners: Colour[], face = currentChipFace()) => {
		if (!gameEl || !balanceChipEl || !winners.length) return;
		const host = gameEl.getBoundingClientRect();
		const to = centreIn(host, balanceChipEl.getBoundingClientRect());
		const vw = window.innerWidth / 100;

		// EVERY chip on every colour that paid, taken in TIER order: the top of each stack goes
		// first, then the next layer down, so a spread of stacks comes off in sheets rather than one
		// pile being emptied while the others stand there full.
		//
		// Each leaves from exactly where it was standing — `pile.rise` up the stack and
		// `stackOffsetVw` across — or the pile would snap flat and to the middle as it lifted.
		const picks: { colour: Colour; x: number; y: number }[] = [];
		for (const colour of winners) {
			const box = oddsEls[colour];
			if (!box) continue;
			const centre = centreIn(host, box.getBoundingClientRect());
			const pile = pileForColour(colour);
			const deepest = Math.max(0, ...pile.stacks);
			for (let tier = deepest - 1; tier >= 0; tier--) {
				for (let stack = 0; stack < pile.stacks.length; stack++) {
					if (tier >= pile.stacks[stack]) continue;
					picks.push({
						colour,
						x: centre.x + stackOffsetVw(pile, stack) * vw,
						y: centre.y - (tier * pile.rise - pile.shift) * vw,
					});
				}
			}
		}
		if (!picks.length) return;

		// A jackpot pile is two hundred chips, which at the full stagger is the best part of a
		// minute — so the whole collect is fitted into one window instead. What it SOUNDS on is
		// thinned to match: two hundred merges is a noise, and two hundred kicks of the balance is
		// a flicker. The last chip always beats, so the readout ends on one.
		const stagger = Math.min(
			COLLECT_STAGGER_MS,
			COLLECT_WINDOW_MS / Math.max(1, picks.length - 1),
		);
		const beatEvery = Math.max(1, Math.ceil(picks.length / COLLECT_BEATS));
		const beats = (index: number) => index % beatEvery === 0 || index === picks.length - 1;

		// Added in one go: two hundred separate pushes would be two hundred renders of the list.
		const launched = picks.map((pick, index) => ({
			id: ++flightId,
			kind: 'collect' as const,
			colour: pick.colour,
			...face,
			from: { x: pick.x, y: pick.y },
			to,
			delay: index * stagger,
			spin: 0,
			turned: false,
		}));
		flights = [...flights, ...launched];

		launched.forEach(({ id, delay }, index) => {
			if (beats(index)) schedule(id, () => playSound('whoosh'), delay);
			// The merge: the chip goes into the balance, and the balance takes the hit.
			schedule(
				id,
				() => {
					if (!beats(index)) return;
					playSound('merge');
					balancePulse += 1;
				},
				delay + COLLECT_TRAVEL_MS,
			);
			schedule(id, () => dropFlight(id), delay + COLLECT_MS);
		});

		await waitForTimeout((picks.length - 1) * stagger + COLLECT_TRAVEL_MS);
	};

	/**
	 * Close out a resolved round.
	 *
	 * Losing chips are swept off the bottom as usual; winning ones are collected into the
	 * balance instead. The dice leave the table and the readout shrinks away alongside, and the
	 * board reopens on its own clock — well before the chips have finished going in, so the
	 * player is not kept waiting on the payout to place the next bet.
	 *
	 * As with the sweep, everything is measured and spawned BEFORE the state clears: the flying
	 * copies carry the chips off, and the board's own chips are hidden the moment this starts.
	 */
	const finishRound = async () => {
		if (clearing || !stateGame.resultReady) return;
		clearing = true;
		stakePanelOpen = false;

		const face = currentChipFace();
		const placed = stateGameDerived.backedColours();
		const winners = placed.filter((colour) => stateGameDerived.isWinColour(colour));
		const losers = placed.filter((colour) => !stateGameDerived.isWinColour(colour));
		// `winCash` is zeroed by the board reset below, which lands while the chips are still on
		// their way up — so the figure the float reads out is taken now.
		const collected = winCash;

		context.eventEmitter.broadcast({ type: 'diceClear' });
		resultClosing = true;
		sweepChips(losers, face);
		const collecting = collectChips(winners, face);

		void waitForTimeout(RESULT_CLOSE_MS).then(() => {
			stateGameDerived.clearBets();
			resultClosing = false;
			clearing = false;
		});

		await collecting;
		// Only now is the win the player's: stop holding the old figure, so the HUD reads out
		// what the RGS settled, and float the amount away under it.
		balanceHold = null;
		if (collected > 0) showWinFloat(collected);
	};

	/** The Play / Play Again tab: rolling the bets, or collecting the round they won. */
	const onConfirmClick = () => {
		if (confirmDisabled) return;
		playSound('click');
		if (settled) void finishRound();
		else roll();
	};

	/** Clear button: collecting a resolved round, or sweeping bets that have not been played. */
	const onClearClick = () => {
		if (clearDisabled) return;
		playSound('click');
		if (settled) void finishRound();
		else clearBoard();
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
			`--collect-ms:${COLLECT_MS}ms`,
			`--collect-delay:${flight.delay}ms`,
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
		// The table track, running for as long as the game is up. Autoplay is usually refused this
		// early, in which case it starts itself on the player's first touch of the page.
		startMusic();
		// Stop in-flight timers from firing into a torn-down game — a collect's cues do more than
		// play a sound, so they have to be called off rather than just left to miss.
		return () => {
			for (const id of [...flightTimers.keys()]) cancelCues(id);
			flights = [];
			stopMusic();
		};
	});

	// Reading the music volume in here is what subscribes this to the slider, so moving it takes
	// effect on the track that is already playing.
	$effect(() => {
		syncMusicVolume();
	});

	const toggleColour = (colour: Colour) => {
		// A resolved round is frozen until it has been collected — the chips showing are a payout,
		// not a bet that can be moved.
		if (!idle || settled || clearing) return;
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
		// Nothing left to hold back — a new round starts from whatever the wallet says now.
		balanceHold = null;

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

	// The tray goes away for the whole round, so never leave the panel hanging open over it.
	$effect(() => {
		if (controlsHidden) stakePanelOpen = false;
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

	/**
	 * The balance, in full: grouped and to the cent, in the player's own language.
	 *
	 * Everything else on the table abbreviates past a thousand (see `fmt`), which is fine for a
	 * wager the player just set — but the balance is their money, and `$12.3k` hides up to fifty
	 * of it. Held on a derived formatter rather than built per read, so a HUD that re-renders on
	 * every chip going in is not constructing one each time.
	 */
	const balanceFormat = $derived(
		new Intl.NumberFormat(stateUrlDerived.lang(), {
			minimumFractionDigits: 2,
			maximumFractionDigits: 2,
		}),
	);

	// Round readout (RoundResult). Follows ColourDice2's `app-result`: the grouped dice go up as
	// soon as the round resolves — win or lose — and stay up until the next round starts, with
	// the win marquee layered on when it paid.
	let winCash = $state(0);

	// `resultReady` is cleared by beginRoll and by resetBoard, so this covers both starting the
	// next roll and touching the board.
	$effect(() => {
		if (!stateGame.resultReady) winCash = 0;
	});

	// --- Jackpot ------------------------------------------------------------------------------
	// A backed colour taking all three dice pays on the plinko screen (see src/plinko), which comes
	// down over the table and does not resolve until the player has dropped the ball. Everything it
	// needs is passed in — the module knows nothing about this game — so pulling the feature is a
	// matter of deleting the folder and this handler.
	let jackpot = $state<JackpotPlinkoApi>();

	context.eventEmitter.subscribeOnMount({
		jackpotRound: async (emitterEvent) => {
			jackpotUp = true;
			try {
				await jackpot?.play(emitterEvent.multiplier, { accent: COLOUR_HEX[emitterEvent.colour] });
			} finally {
				// `finally`, so a round that throws mid-way cannot leave the board locked out of
				// betting for good.
				jackpotUp = false;
			}
		},

		winShow: async (emitterEvent) => {
			// Book amounts are x100 in units of the per-colour stake, so cash scales by betAmount.
			winCash = (emitterEvent.amount / 100) * stateBet.betAmount;
			// Sounded here rather than by RoundResult: this is the line that puts the marquee up,
			// so the two cannot drift apart. Only ever reached on a round that paid — `winShow` is
			// broadcast off `finalWin` and only when there is an amount.
			playSound('win');
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
		<!-- Re-keyed on every chip that goes in, which is what restarts the take animation: a CSS
		     animation cannot be replayed on the same element without tearing it down. -->
		{#key balancePulse}
			<div class="balance-hud" class:collected={balancePulse > 0}>
				<div bind:this={balanceChipEl} class="balance-chip" aria-hidden="true"></div>
				<div class="balance-text">
					<span class="hud-lbl">Balance</span>
					<span class="hud-val">{sign}{balanceFormat.format(shownBalance)}</span>
				</div>
			</div>
		{/key}
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
					     original's `.confirm-btn`. Once a round resolves it becomes Play Again —
					     collecting is the only move left on a settled board, and it is also what
					     opens the table for the next bet, so the label names where it leads. -->
					<div
						class="confirm-btn"
						class:clear-mode={settled}
						class:disabled={confirmDisabled}
						class:tucked={confirmTucked}
						onclick={onConfirmClick}
						aria-hidden="true"
					>
						<div class="confirm-lbl">
							{stateGame.rolling ? '…' : settled ? 'PLAY AGAIN' : 'PLAY'}
						</div>
					</div>

					<!-- Clear, the chip tray and undo. Nothing else lives in this row, so hiding it is
					     exactly the three controls going away — and it keeps its space, so the Play tab
					     and the wager below it do not jump as the round starts. -->
					<div class="actions-wrap" class:hidden={controlsHidden}>
						<div
							class="clear-btn"
							class:disabled={clearDisabled}
							onclick={onClearClick}
							title="Clear"
							aria-hidden="true"
						></div>
						<div class="chipandstate-wrap" class:locked={settled || clearing}>
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
								<!-- Window onto the rail: five slots wide, everything either side clipped. -->
								<div class="chips-viewport" style="--slots:{carousel.windowSize}">
									<div class="chips-rail" style="--offset:{carousel.start}">
										{#each carousel.chips as chip (chip.value)}
											<div class="chip-wrap" class:shown={chip.shown} style="--depth:{chip.depth}">
												<div
													bind:this={chipEls[chip.value]}
													class="chip"
													class:selected={chip.selected}
													class:open={chip.selected && stakePanelOpen}
													style="--chip-hue:{chipHueShift(
														chip.index,
													)}deg; --chip-text:{chipTextColour(chip.index)}"
													onclick={() => onChipClick(chip.value, chip.selected)}
													aria-hidden="true"
												>
													<span>{fmtChip(chip.value)}</span>
												</div>
											</div>
										{/each}
									</div>
								</div>
							</div>
						</div>
						<div
							class="undo-btn"
							class:disabled={!idle || settled || clearing || backedCount === 0}
							onclick={undoBet}
							title="Undo"
							aria-hidden="true"
						></div>
					</div>

					<div class="outcomes">
						{#each DISPLAY_COLOURS as colour (colour)}
							{@const backed = stateGameDerived.isBacked(colour)}
							{@const win = stateGameDerived.winForColour(colour)}
							{@const landed = stateGameDerived.isLandedColour(colour)}
							{@const pile = pileForColour(colour)}
							<div
								bind:this={oddsEls[colour]}
								class="odds {colour}"
								class:win={Boolean(win)}
								class:landed={landed && !win}
								class:dimmed={stateGame.rolling || (settled && !landed)}
								class:backed
								onclick={() => toggleColour(colour)}
								aria-hidden="true"
							>
								<div class="outcome-stat">
									<div class="total-amount-lbl">{colour.toUpperCase()}</div>
								</div>
								<!-- The big multiplier badge along the bottom is the only result readout. It is
								     driven by the DICE, not by the payout, so a colour that landed shows what it
								     was worth even when nobody backed it — the near-miss is the point. -->
								<div class="rate {stateGameDerived.rateTypeForColour(colour)}"></div>
								<!-- What the jackpot actually paid, on the colour that took it. The JP badge below
								     says a jackpot landed; this says how much it was worth. -->
								{#if stateGame.jackpot?.colour === colour}
									<div class="jp-award">x{stateGame.jackpot.multiplier}</div>
								{/if}
								{#if backed && !arrivingColours.has(colour) && !clearing}
									<!-- The actual chip lands on the colour, rather than a text pill, so the
									     board reads like real chips on a felt. Held back until the thrown
									     copy has landed (see launchChip), so the bet shows as one chip.
									     Hidden outright while clearing — the flying copies are carrying
									     these off, and two of each would show otherwise.

									     A colour that paid grows into a pile: the bet is the bottom chip
									     and the winnings drop on top of it (see pileForColour). A jackpot
									     is paid in full — one chip per multiple won — so the pile deals
									     itself out sideways into stacks rather than climbing off the box. -->
									{#each pile.stacks as count, stack (stack)}
										{#each Array.from({ length: count }, (_, tier) => tier) as tier (tier)}
											<div
												class="placed-chip chip"
												class:won={stack > 0 || tier > 0}
												style="--tier:{tier}; --rise:{pile.rise}vw; --pile-shift:{pile.shift}vw; --stack-x:{stackOffsetVw(
													pile,
													stack,
												)}vw; width:{CHIP_SIZE_VW * pile.scale}vw; height:{CHIP_SIZE_VW *
													pile.scale}vw; font-size:{3.5 * pile.scale}vw; --pop-ms:{PAYOUT_POP_MS}ms; --pop-delay:{chipPopDelay(
													pile,
													stack * JACKPOT_STACK_MAX + tier - 1,
												)}ms; --chip-hue:{chipHueShift(
													stakes.indexOf(stateGame.stake),
												)}deg; --chip-text:{chipTextColour(stakes.indexOf(stateGame.stake))}"
											>
												<span>{fmtChip(stateGame.stake)}</span>
											</div>
										{/each}
									{/each}
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

	<!-- What the collected chips were worth, drifting away under the balance they went into. -->
	{#if winFloat}
		<div
			class="win-float"
			style="--float-x:{winFloat.x}px; --float-y:{winFloat.y}px; --float-ms:{WIN_FLOAT_MS}ms"
			aria-hidden="true"
		>
			+{sign}{fmt(winFloat.amount)}
		</div>
	{/if}

	<!-- Nothing at all between rounds: the screen is only on the DOM while a jackpot is playing. -->
	<JackpotPlinko
		bind:this={jackpot}
		awards={WHEEL_VALUES}
		balance="{sign}{balanceFormat.format(shownBalance)}"
		sounds={{
			drop: () => playSound('whoosh'),
			// A drop strikes twenty-one pegs in under two seconds, so each one is pitched a little
			// off the last — identical repeats at that rate read as a rattle rather than as hits.
			peg: () => playSound('peg', 0.92 + Math.random() * 0.16),
			land: () => playSound('merge'),
			// The screen is a door: it thuds shut over the table and creaks back open off it.
			screenIn: () => playSound('doorClose'),
			screenOut: () => playSound('doorOpen'),
		}}
	/>

	{#if stateGame.resultReady}
		<RoundResult amount={winCash} {sign} closing={resultClosing} />
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
	/* Collected into the balance. Travel and merge are one run rather than two animations: the
	   chip arcs up to the HUD and simply keeps going, shrinking away into the balance chip. The
	   split is the 74% stop below, which is COLLECT_TRAVEL_MS of COLLECT_MS. `backwards` holds
	   each chip on its colour through its stagger, so the pile leaves one chip at a time. Above
	   the HUD, so it is still visible as it goes in. */
	.flying-chip.collect {
		animation: chip-collect var(--collect-ms) var(--collect-delay) both;
		z-index: 46;
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

	/* Picked up off the colour, arced up to the balance, then folded into it. The arc is lifted
	   harder than a placement's (2.4vw against 1.6vw) because this one crosses most of the table
	   — a flatter curve would read as a slide. */
	@keyframes chip-collect {
		0% {
			translate: var(--from-x) var(--from-y);
			scale: 1;
			opacity: 1;
			animation-timing-function: cubic-bezier(0.34, 1.56, 0.64, 1);
		}
		14% {
			translate: var(--from-x) var(--from-y);
			scale: 1.3;
			animation-timing-function: ease-in-out;
		}
		48% {
			translate: calc((var(--from-x) + var(--to-x)) / 2)
				calc((var(--from-y) + var(--to-y)) / 2 - 2.4vw);
			scale: 1.15;
			animation-timing-function: ease-in;
		}
		74% {
			translate: var(--to-x) var(--to-y);
			scale: 0.95;
			opacity: 1;
			animation-timing-function: ease-in;
		}
		100% {
			translate: var(--to-x) var(--to-y);
			scale: 0.18;
			opacity: 0;
		}
	}

	/* The amount that just went in, sliding down out from under the balance. Positioned off the
	   balance chip's measured centre, so it stays under the HUD at any viewport. */
	.win-float {
		position: absolute;
		top: 0;
		left: 0;
		z-index: 46;
		pointer-events: none;
		font-family: 'Alexandria', sans-serif;
		font-size: 1.15vw;
		font-weight: 700;
		color: #ffe14d;
		text-shadow: 0 0.1vw 0.3vw rgba(0, 0, 0, 0.85);
		animation: win-float var(--float-ms) ease-out both;
	}
	@keyframes win-float {
		0% {
			translate: var(--float-x) calc(var(--float-y) + 0.6vw);
			opacity: 0;
			scale: 0.75;
		}
		20% {
			translate: var(--float-x) calc(var(--float-y) + 1.5vw);
			opacity: 1;
			scale: 1;
		}
		100% {
			translate: var(--float-x) calc(var(--float-y) + 4.4vw);
			opacity: 0;
			scale: 1;
		}
	}

	/* Full bet-level grid, opened by tapping the selected chip. Anchored to the tray and
	   opening upward — the tray sits low in the frame, so downward would run off-screen. */
	.chipandstate-wrap {
		position: relative;
	}
	/* The denomination cannot change while a payout is on the felt — the chips showing were
	   placed at the old amount, and re-pricing them would re-price the win with them. */
	.chipandstate-wrap.locked {
		opacity: 0.55;
		pointer-events: none;
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

	/* The tray is a window onto a rail carrying EVERY stake, so moving the selection can be a
	   slide rather than a swap. The window is exactly as wide as the slots it shows; the chips
	   queued either side are clipped, not hidden, so they travel in and out of view.

	   Clipped with overflow rather than a mask because the pill tray behind it is opaque —
	   there is nothing to fade into. The vertical padding (cancelled by the matching negative
	   margin, so the tray keeps its height) holds the clip off the selected chip, which lifts
	   out of its slot and wears an outline that would otherwise be cropped. */
	.chips-viewport {
		/* One slot = table.scss's tray chip: a 3.5vw disc with 0.4vw either side. */
		--chip-pitch: 4.3vw;
		width: calc(var(--slots, 5) * var(--chip-pitch));
		overflow: hidden;
		padding: 1vw 0.5vw 0.5vw;
		margin: -1vw -0.5vw -0.5vw;
	}
	.chips-rail {
		display: flex;
		width: max-content;
		/* `--offset` is the first visible slot, so the rail is pulled that many slots left. */
		transform: translateX(calc(var(--offset, 0) * var(--chip-pitch) * -1));
		transition: transform 0.26s cubic-bezier(0.22, 0.61, 0.36, 1);
	}
	/* Carousel depth: `--depth` is the slot's distance from the selected chip (0, 1 or 2), so
	   the selection sits front and full-size and the rest recede either side. Applied to the
	   wrapper so table.scss's own `.chip.selected` scale still layers on top.

	   Fixed to one slot each so the rail's offset stays a plain multiple of the pitch — the
	   chip's own margins fill the slot exactly. */
	.chip-wrap {
		flex: 0 0 var(--chip-pitch);
		display: flex;
		justify-content: center;
		scale: calc(1 - var(--depth, 0) * 0.11);
		opacity: calc(1 - var(--depth, 0) * 0.22);
		z-index: calc(3 - var(--depth, 0));
		transition:
			scale 0.26s ease,
			opacity 0.26s ease;
	}
	/* Out of the window: clipped from view, so keep it out of reach of taps too. */
	.chip-wrap:not(.shown) {
		pointer-events: none;
	}
	/* `isolation` is what keeps the box's layering INSIDE the box. `position: relative` alone
	   leaves `z-index: auto`, which is not a stacking context — so the badges below, sat high
	   enough to clear a two-hundred-chip pile, were being hoisted into the root context and painted
	   straight over the jackpot screen while it was down. Nothing in here can now outrank anything
	   outside it, whatever number it carries. */
	.odds {
		cursor: pointer;
		position: relative;
		isolation: isolate;
	}
	/* A colour that landed AND was backed — it paid. Every backed colour pays on its own match
	   count, so more than one of these can light up in the same round. */
	.odds.win {
		outline: 0.3vw solid #ffe14d;
		outline-offset: -0.3vw;
		filter: brightness(1.15);
	}
	/* A colour the dice landed on with no bet riding on it. It carries the same multiplier badge
	   — the odds do not depend on who backed them — but a white outline rather than the gold one,
	   and no brightness lift, so a payout still reads apart from a near miss at a glance. */
	.odds.landed {
		outline: 0.2vw solid rgba(255, 255, 255, 0.6);
		outline-offset: -0.2vw;
	}
	/* Same badge art, held back a little so the colours that actually paid stay dominant. */
	.odds.landed .rate {
		opacity: 0.7;
	}
	/* Boxes with nothing to say. Every one of them while the dice are in the air — the board is
	   settled, nothing on it can be acted on, and the throw is the only thing worth watching — and
	   then, once it resolves, the colours the dice missed: a dark pane over the whole box, chips
	   and all, so the result reads at a glance as the two or three that came up rather than as six
	   of equal weight.

	   It has to be a layer rather than the inset shadow the disabled state dims with: an inset
	   shadow paints under the box's own children, which would leave a losing bet's chip sitting
	   bright on top of the dimming meant to cover it. Sat above the chips but below the odds badges
	   — a missed colour carries neither, and a figure the player is meant to read should not be
	   greyed out on the off chance it ever does. */
	.odds.dimmed::after {
		content: '';
		position: absolute;
		inset: 0;
		z-index: 400;
		border-radius: 0.3vw;
		background: rgba(0, 0, 0, 0.62);
		pointer-events: none;
		animation: odds-dim 300ms ease-out both;
	}
	@keyframes odds-dim {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}
	/* Backed but not yet resolved. */
	.odds.backed {
		box-shadow:
			inset 0 0.1vw 0.1vw 0.05vw #ffeddb,
			inset 0 0.1vw 0.4vw 0.1vw #ffffff;
	}
	/* The jackpot award, pinned to the box's top corner. Everything else on the box is already
	   spoken for — the colour name runs across the top, the chip pile sits dead centre, and the JP
	   badge fills the bottom strip — so the corner is the one place a figure can go without
	   landing on top of something. */
	/* The odds a colour paid — the 2x / 3x / JP badge along the bottom, and the jackpot award in the
	   corner — read OVER the chips standing on the box. table.scss puts the badge on `z-index: 9`,
	   under the chips at `12 + tier`, which was fine when a pile was three chips and is not once a
	   jackpot deals two hundred onto it. Both sit above anything the pile can climb to. */
	/* `!important` because table.scss reaches the badge through a five-class chain that outweighs
	   anything scoped here — the same reason `.placed-chip` needs it below. */
	.odds .rate {
		z-index: 500 !important;
	}
	.odds .jp-award {
		position: absolute;
		top: 0.25vw;
		right: 0.3vw;
		z-index: 501;
		padding: 0.1vw 0.45vw;
		border-radius: 0.9vw;
		background: linear-gradient(180deg, #fff3b0 0%, #ffc93c 55%, #e59a09 100%);
		border: 0.08vw solid #fff6cf;
		box-shadow: 0 0.1vw 0.3vw rgba(0, 0, 0, 0.55);
		color: #4a2c00;
		font-family: 'Alexandria', sans-serif;
		font-weight: 700;
		font-size: 1.05vw;
		line-height: 1.35;
		white-space: nowrap;
		pointer-events: none;
		animation: jp-award-in 420ms cubic-bezier(0.22, 1.4, 0.36, 1) both;
	}
	@keyframes jp-award-in {
		0% {
			opacity: 0;
			transform: scale(0.4);
		}
		100% {
			opacity: 1;
			transform: scale(1);
		}
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
		/* `--tier` is the chip's height in its stack and `--stack-x` the stack's place across the
		   box; both are published by pileForColour, which is also what the collect flights read, so
		   the copies leave from exactly where the chips were standing. */
		transform: translate(
			calc(-50% + var(--stack-x, 0vw)),
			calc(-50% - var(--tier, 0) * var(--rise, 0.5vw) + var(--pile-shift, 0vw))
		);
		z-index: calc(12 + var(--tier, 0));
		margin: 0 !important;
		pointer-events: none;
		filter: drop-shadow(0 0.15vw 0.25vw rgba(0, 0, 0, 0.5));
	}
	/* Chips won on top of the bet, dropped onto the pile as the colour is paid out. They fall in
	   from above with a little squash on landing, so the stack is seen being built rather than
	   just appearing taller. */
	.odds .placed-chip.won {
		animation: chip-stack var(--pop-ms) var(--pop-delay) cubic-bezier(0.22, 1.3, 0.5, 1) both;
	}
	@keyframes chip-stack {
		0% {
			opacity: 0;
			transform: translate(
					calc(-50% + var(--stack-x, 0vw)),
					calc(-50% - var(--tier) * var(--rise, 0.5vw) + var(--pile-shift, 0vw) - 2.4vw)
				)
				scale(1.35);
		}
		65% {
			opacity: 1;
			transform: translate(
					calc(-50% + var(--stack-x, 0vw)),
					calc(-50% - var(--tier) * var(--rise, 0.5vw) + var(--pile-shift, 0vw) + 0.2vw)
				)
				scale(0.94);
		}
		100% {
			opacity: 1;
			transform: translate(
				calc(-50% + var(--stack-x, 0vw)),
				calc(-50% - var(--tier) * var(--rise, 0.5vw) + var(--pile-shift, 0vw))
			);
		}
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
	   against the right edge.

	   The inset is published on `.game` rather than written in here because the dice tray lines
	   its own width up with this panel (see DiceBox's `.dice-tray`), and it can only do that for
	   good if there is one number to read. */
	.game {
		--panel-inset: 12.5vw;
	}
	.bottom-panel {
		left: var(--panel-inset);
		right: var(--panel-inset);
		justify-content: center;
		/* table.scss lifts this 4vw to clear the old bottom bar. That bar is gone, so drop the
		   panel back down to a small margin off the bottom edge. */
		bottom: 1vw;
	}
	/* Off the table for the round, and the row COLLAPSES as it goes.
	   The panel is anchored to the bottom of the frame and the colour boxes sit below this row, so
	   losing its height pulls the Play tab down onto them rather than pushing anything else about —
	   which is the whole point: with nothing to bet with, Play belongs next to what it plays.

	   The height is stated rather than left to the content because there is no animating from
	   `auto`. Everything inside is sized in vw, so it holds at any viewport. Overflow is left
	   visible on purpose — the stake panel opens upward out of this row, and clipping it would cut
	   the grid off at the tray. */
	.actions-wrap {
		height: 4.4vw;
		transition:
			height 260ms cubic-bezier(0.4, 0, 0.2, 1),
			margin-top 260ms cubic-bezier(0.4, 0, 0.2, 1),
			margin-bottom 260ms cubic-bezier(0.4, 0, 0.2, 1),
			opacity 180ms ease,
			visibility 260ms;
	}
	.actions-wrap.hidden {
		height: 0;
		margin-top: 0;
		margin-bottom: 0;
		opacity: 0;
		visibility: hidden;
		pointer-events: none;
	}
	.undo-btn.disabled,
	.clear-btn.disabled {
		cursor: not-allowed;
		opacity: 0.5;
		filter: grayscale(1);
		pointer-events: none;
	}
	/* HUD overlaid on the table: balance top-left, menu top-right. Replaces the old bottom bar,
	   which is gone entirely.

	   The balance chip and the menu button are the two round marks in the strip, one at each end,
	   so they are sized off a single number rather than each carrying their own — matched by
	   accident is matched until somebody changes one. */
	.hud {
		--hud-mark: 3.2vw;
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
		gap: 0.7vw;
		font-family: 'Alexandria', sans-serif;
		text-shadow: 0 0.1vw 0.3vw rgba(0, 0, 0, 0.8);
	}
	/* One kick per chip that goes in. Scaled from the left so the readout swells in place rather
	   than sliding out from under the frame edge. */
	.balance-hud.collected {
		transform-origin: left center;
		animation: balance-take 300ms ease-out;
	}
	@keyframes balance-take {
		0% {
			scale: 1;
		}
		35% {
			scale: 1.12;
			filter: brightness(1.45);
		}
		100% {
			scale: 1;
		}
	}
	.balance-chip {
		width: var(--hud-mark);
		height: var(--hud-mark);
		flex: none;
		background: url('/img/chip_yellow.svg') no-repeat center / contain;
		filter: drop-shadow(0 0.1vw 0.2vw rgba(0, 0, 0, 0.6));
	}
	.balance-text {
		display: flex;
		flex-direction: column;
	}
	.hud-lbl {
		font-size: 0.95vw;
		font-weight: 500;
		letter-spacing: 0.05vw;
		text-transform: uppercase;
		color: #d6c6b4;
	}
	/* The figure is now written out in full, so it has to hold one line whatever the balance is,
	   and the digits are fixed-width — otherwise the readout shuffles sideways as it counts up
	   through a collect. */
	.hud-val {
		font-size: 1.9vw;
		font-weight: 700;
		color: #ffe14d;
		white-space: nowrap;
		font-variant-numeric: tabular-nums;
	}
	/* global.scss sizes .menu-btn at 10vw for the mobile layout, and the bottom bar that used
	   to override it is gone — so pin the size here, to the same mark as the balance chip. */
	.hud .menu-btn {
		width: var(--hud-mark);
		height: var(--hud-mark);
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
	/* Same tab, paying out instead of taking a bet — blue rather than green, so a settled board
	   never looks like one that is ready to play. The label is the tab's own blue taken much
	   darker, mirroring how Play sets its green label against its green face.

	   table.scss paints the green from a four-class selector
	   (`.bottom-panel .betting-panel-wrap .betting-panel .confirm-btn`), which outweighs anything
	   scoped here; `!important` is the readable way to win that rather than restating the whole
	   ancestor chain, as with `.placed-chip` above. Held off `.disabled` so the greyed-out look
	   during the clear still comes through. */
	.confirm-btn.clear-mode:not(.disabled) {
		background: linear-gradient(180deg, #58a0f0 0%, #2a6bd8 100%) !important;
		color: #0a2a66 !important;
	}
	.confirm-btn.disabled {
		background: linear-gradient(180deg, #e7e6ff73 0%, #e7e6ff73 100%);
		box-shadow: inset 0 1vw 0.4vw #ffffff2b;
		color: #9d9cb8;
		cursor: not-allowed;
		pointer-events: none;
	}
	/* The tab goes down with the controls and comes back up the moment it can be pressed again —
	   so it is only ever on the table when it is offering something. Collapsing its own height is
	   what moves it: the panel is anchored to the bottom of the frame, so the tab folds away onto
	   the colour boxes and unfolds back up off them.

	   `!important` because table.scss states this button's box through a four-class chain that
	   outweighs anything scoped here — the same reason its `clear-mode` face above needs it. */
	.confirm-btn {
		overflow: hidden;
		transition:
			height 260ms cubic-bezier(0.4, 0, 0.2, 1),
			padding-top 260ms cubic-bezier(0.4, 0, 0.2, 1),
			margin-bottom 260ms cubic-bezier(0.4, 0, 0.2, 1),
			opacity 180ms ease,
			visibility 260ms;
	}
	.confirm-btn.tucked {
		height: 0 !important;
		padding-top: 0 !important;
		margin-bottom: 0 !important;
		opacity: 0;
		visibility: hidden;
		pointer-events: none;
	}
</style>
