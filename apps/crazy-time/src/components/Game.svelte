<script lang="ts">
	import '../styles/global.scss';
	import '../styles/table.scss';

	import { onMount, tick, untrack } from 'svelte';

	import { stateBet } from 'state-shared';
	import { stateUrlDerived } from 'state-shared';
	import { waitForTimeout } from 'utils-shared/wait';

	import { getContext } from '../game/context';
	import { stateGame, stateGameDerived } from '../game/stateGame.svelte';
	import { hasActiveRoundToResume, describeModeMismatch } from '../game/activeRound';
	import { forcedRoomKind, isForcedRound } from '../game/devLocalBet';
	import { playSound, preloadSounds, startMusic, stopMusic, syncMusicVolume } from '../game/sound';
	import {
		NUMBER_PAY,
		NUMBER_SPOTS,
		ROOM_ICON,
		ROOM_SPOTS,
		SEGMENT_LAYOUT,
		SPOT_COLOUR,
		SPOT_LABEL,
		SPOTS,
		isRoomSpot,
		BUY_MODES,
		buyPrice,
		type RoomSpot,
		type Spot,
	} from '../game/constants';

	import Wheel, { type WheelSegment, type WheelFrame } from './Wheel.svelte';
	import { staticUrl } from '../lib/staticUrl';
	import TopSlot from './TopSlot.svelte';
	import Background from './Background.svelte';
	import BonusRound from './BonusRound.svelte';
	import RoundResult from './RoundResult.svelte';
	import EnableGameActor from './EnableGameActor.svelte';
	import DevHarness from './DevHarness.svelte';
	import BuyBonusModal from './BuyBonusModal.svelte';
	import ConfirmPromptModal from './ConfirmPromptModal.svelte';
	import { requestConfirmPrompt } from '../game/confirmPrompt.svelte';

	const context = getContext();

	// When launched without an RGS session (dev / preview), play sample books locally.
	const online = $derived(Boolean(stateUrlDerived.rgsUrl()));

	// Bet board order follows the LuckyWheel reference: X1 X2 bonus bonus / X5 X10 bonus bonus.
	/**
	 * The layout is authored in vw, in two arrangements: landscape puts the wheel beside a wide board,
	 * portrait stacks a viewport-wide wheel over a viewport-wide board. Either way the game fills the
	 * viewport — stage pinned to the top, panel to the bottom — and the whole thing scales down when
	 * the viewport is shorter than the arrangement needs. The design heights below are how much room
	 * each arrangement wants, measured in vw (the unit everything inside is authored in).
	 *
	 * `zoom`, not `transform: scale()`: zoom scales in layout — vw still resolves against the
	 * viewport and is then multiplied — so the box's rendered size stays honest to the flow, and
	 * iOS keeps the first paint (a transform-scaled box loses it inside the Stake Engine iframe).
	 */
	/**
	 * Landscape splits the viewport's height between the cabinet and the wheel — a fifth and the rest
	 * — so both grow and shrink with the window and the wheel still ends a hair above the bottom. The
	 * fit only has to cover the parts that stay put — the cabinet above it and the panel below — so
	 * it scales down only once the viewport is too short even for those. Portrait is the other way
	 * round: the wheel is the viewport's width, and the fit works against the stack's own height.
	 */
	const LANDSCAPE_MIN_VW = 34; // cabinet + panel + a wheel worth having
	const PORTRAIT_DESIGN_VW = 164;
	/** Landscape splits the height between the two: a fifth for the cabinet, the rest for the wheel. */
	const CABINET_SHARE = 0.2;
	const WHEEL_SHARE = 0.8;
	/** The cabinet art is twice as wide as it is tall, and it is sized by width. */
	const CABINET_ASPECT = 2;
	/** The wheel's frame art is a hair taller than it is wide (1911x1925), and it too is sized by
	 *  width — so its share of the height has to be divided by that before it becomes a width. */
	const WHEEL_ASPECT = 1925 / 1911;
	const PORTRAIT_CABINET_VW = 67;
	/**
	 * How far the wheel laps over the cabinet, as a share of the cabinet's HEIGHT — so the overlap
	 * grows and shrinks with it. It can run well past the rail (13.4% of that height) because the
	 * wheel's own art is only opaque at the pin and the ring's crown, both on the centre line, which
	 * is the divider BETWEEN the two windows rather than either reel.
	 */
	const WHEEL_LAP_SHARE = 0.2;
	let fitScale = $state(1);
	let portrait = $state(false);
	let wheelVw = $state(45);
	let cabinetVw = $state(22.5);
	let lapVw = $state(1.29);
	const updateFit = () => {
		const w = window.innerWidth;
		const h = window.innerHeight;
		if (!w || !h) return;
		portrait = h > w;
		const availableVw = (h / w) * 100;
		fitScale = Math.min(1, availableVw / (portrait ? PORTRAIT_DESIGN_VW : LANDSCAPE_MIN_VW));
		// In the frame's own units, which is what both widths are expressed in.
		const localVw = availableVw / fitScale;
		wheelVw = portrait ? 100 : (localVw * WHEEL_SHARE) / WHEEL_ASPECT;
		cabinetVw = portrait ? PORTRAIT_CABINET_VW : localVw * CABINET_SHARE * CABINET_ASPECT;
		lapVw = (cabinetVw / CABINET_ASPECT) * WHEEL_LAP_SHARE;
	};
	$effect(() => {
		updateFit();
		window.addEventListener('resize', updateFit);
		window.addEventListener('orientationchange', updateFit);
		return () => {
			window.removeEventListener('resize', updateFit);
			window.removeEventListener('orientationchange', updateFit);
		};
	});

	/**
	 * Where the betting panel's top edge sits, in the frame's own units, so the round's readout can
	 * be parked just above it. The panel's height is not a constant — it loses the chip tray while a
	 * round runs — so it is watched rather than assumed.
	 */
	let panelEl: HTMLElement | undefined = $state();
	let panelTop = $state(0);
	const measurePanel = () => {
		if (!gameEl || !panelEl) return;
		panelTop =
			(panelEl.getBoundingClientRect().top - gameEl.getBoundingClientRect().top) / fitScale;
	};
	$effect(() => {
		// Read the fit so a resize re-measures too: the panel moves with it.
		void fitScale;
		void portrait;
		if (!panelEl) return;
		measurePanel();
		const observer = new ResizeObserver(measurePanel);
		observer.observe(panelEl);
		return () => observer.disconnect();
	});

	/**
	 * How tall the balance/wager rail is, in the frame's own units. The rail is drawn over the bonus
	 * screen as well as over the board, so the room's own read-out has to know how much of the bottom
	 * edge is already spoken for. Measured rather than restated, because the two are written in
	 * different places and a rail that grew would silently start covering the room's footer.
	 */
	let hudEl: HTMLElement | undefined = $state();
	let railH = $state(0);
	const measureRail = () => {
		if (!hudEl) return;
		railH = hudEl.getBoundingClientRect().height / fitScale;
	};
	$effect(() => {
		void fitScale;
		void portrait;
		if (!hudEl) return;
		measureRail();
		const observer = new ResizeObserver(measureRail);
		observer.observe(hudEl);
		return () => observer.disconnect();
	});

	const BOARD: Spot[] = ['x1', 'x2', 'piratePlinko', 'bonusWheel', 'x5', 'x10', 'chest', 'oceanVoyage'];

	/**
	 * One-tap group bets, sat on the seams of the board rather than in a row of their own: the board
	 * reads as multipliers then bonuses in both arrangements, so each seam already names a group.
	 * Landscape splits the tiles into columns (x1/x5 | x2/x10 | plinko/chest | wheel/voyage), so the
	 * three vertical gaps are "inside the multipliers", "between the halves" and "inside the
	 * bonuses"; portrait stacks the same halves in rows, and the three horizontal gaps say the same
	 * thing. `seam` is which gap the button sits on, counting from the board's leading edge.
	 *
	 * `face` is the order the colours are painted in, clockwise from the top-left quadrant. It holds
	 * the same spots as `spots` but is set by eye rather than by the board's order, so a pair that
	 * sits badly next to its neighbour can be swapped without touching what the button bets.
	 */
	const BUNDLES: {
		key: string;
		label: string;
		seam: number;
		spots: readonly Spot[];
		face: readonly Spot[];
		halved?: boolean;
	}[] = [
		{ key: 'multi', label: 'MULTI', seam: 1, spots: NUMBER_SPOTS, face: ['x1', 'x2', 'x10', 'x5'] },
		{ key: 'all', label: 'ALL', seam: 2, spots: SPOTS, face: SPOTS, halved: true },
		{
			key: 'bonus',
			label: 'BONUS',
			seam: 3,
			spots: ROOM_SPOTS,
			face: ['piratePlinko', 'bonusWheel', 'oceanVoyage', 'chest'],
		},
	];

	/**
	 * A button wears the colours of what it buys: an equal-sector pie of the tile fills, running
	 * clockwise from `fromDeg`. Four spots make the 2x2 the multiplier and bonus buttons want; all
	 * eight make the wheel the ALL button wants.
	 */
	const bundleFace = (face: readonly Spot[], fromDeg = -90) => {
		const step = 100 / face.length;
		const sectors = face
			.map((spot, i) => `${SPOT_COLOUR[spot].base} ${i * step}% ${(i + 1) * step}%`)
			.join(', ');
		return `conic-gradient(from ${fromDeg}deg, ${sectors})`;
	};

	/**
	 * ALL wears both halves of the board, so its pie has to split the way the board does: the four
	 * multipliers on one side of the cut, the four bonuses on the other. `face` runs multipliers
	 * first, so where the first sector starts decides which side they take. A conic gradient's angle
	 * is measured from 12 o'clock, clockwise: -90deg starts the run at 9 o'clock, so the first half
	 * sweeps 9 -> 12 -> 3 and the multipliers fill the TOP half; 180deg starts it at 6 o'clock, so
	 * the first half sweeps 6 -> 9 -> 12 and they fill the LEFT half. Portrait stacks the board's
	 * halves in rows, landscape sets them in columns; the button follows.
	 */
	const bundleFaceFrom = (bundle: { halved?: boolean }) => (bundle.halved && !portrait ? 180 : -90);

	// The wooden ring art (static/img/wheel/frame.png, 1911x1925) with its pin at 12 o'clock and
	// its own ship's-wheel hub. `hole` is the transparent circle, least-squares fitted to the ring's
	// inner edge: centre (955.7, 972.8) px, radius 758.1 px (residual under 2 px). The wedges run to
	// the centre point so the hub art covers solid colour. The ring's inner edge is feathered — the
	// art only goes fully opaque at r ~= 796 px — so the wedges overscan to ~803 px (6%) and finish
	// underneath the wood instead of stopping short of it in the soft band.
	const WHEEL_FRAME: WheelFrame = {
		src: staticUrl('img/wheel/frame.png'),
		aspect: 1911 / 1925,
		hole: { cx: 955.7 / 1911, cy: 972.8 / 1925, r: 758.1 / 1911 },
		overscan: 0.06,
	};

	// Every wedge wears badge art on the label ring: number wedges their value (img/wheel/N.png,
	// 30x48), room wedges its own icon (ROOM_ICON) with the name lettered down the wedge below it
	// by the Wheel itself.
	const BADGE_ASPECT = 30 / 48;
	/**
	 * The play button's diameter as a fraction of the frame box: the gem at the middle of the hub,
	 * not the whole ship's wheel. The gem and its red ring run to about r=60px in the 1911px frame
	 * art (sampled: strongly red to r≈55, wood from r≈60), so 72 leaves a small margin around it.
	 */
	const HUB_HIT = (2 * 72) / 1911;

	const WHEEL_SEGMENTS: WheelSegment[] = SEGMENT_LAYOUT.map((spot) => ({
		label: isRoomSpot(spot) ? SPOT_LABEL[spot] : String(NUMBER_PAY[spot]),
		fill: SPOT_COLOUR[spot].base,
		text: SPOT_COLOUR[spot].text,
		kind: isRoomSpot(spot) ? 'room' : 'number',
		image: isRoomSpot(spot)
			? { src: staticUrl(ROOM_ICON[spot].src), aspect: ROOM_ICON[spot].aspect }
			: { src: staticUrl(`img/wheel/${NUMBER_PAY[spot]}.png`), aspect: BADGE_ASPECT },
	}));

	/**
	 * The buy disc. A bought round can only end in a room, and the book says which, so while a buy
	 * is in flight the wheel shows just those and spins to the one authored. ANY BONUS gets the four
	 * rooms on quarter wedges; a single-room buy is ONE segment, the whole disc, which turns once and
	 * stops with its crest and name under the flapper. The ink is sized as if the wedges were
	 * BUY_WHEEL_INK_STEP wide so the crests and names keep the main wheel's scale.
	 */
	const buyWheelSegments = (mode: string): WheelSegment[] => {
		const rooms = BUY_MODES[mode]?.rooms ?? ROOM_SPOTS;
		return rooms.map((spot) => ({
			...WHEEL_SEGMENTS[SEGMENT_LAYOUT.indexOf(spot)],
			// Across the wedge in two big lines, not down it: a broad wedge has the room for it.
			kind: 'wide' as const,
		}));
	};
	const BUY_WHEEL_INK_STEP = 30;

	/**
	 * Which disc the wheel is showing. It does not follow `stateGame.buying` directly: the swap is
	 * staged (chips first, then the disc, then the reels) and hidden behind a white flash.
	 */
	let wheelDisc = $state<'main' | 'buy'>('main');
	/** The buy the disc was dressed for, kept past the buy itself so the flash back covers it. */
	let wheelDiscMode = $state<string | null>(null);
	const buyDisc = $derived(wheelDiscMode ? buyWheelSegments(wheelDiscMode) : null);
	let wheelFlash = $state(false);
	let discSwapping = false;
	const FLASH_IN_MS = 180;
	const FLASH_OUT_MS = 420;
	/** Wash the disc white, change its segments under the white, and let it fade off them. */
	const swapDisc = async (to: 'main' | 'buy', mode: string | null = null) => {
		if ((wheelDisc === to && (to === 'main' || wheelDiscMode === mode)) || discSwapping) return;
		discSwapping = true;
		wheelFlash = true;
		await waitForTimeout(FLASH_IN_MS + 60);
		wheelHighlight = null;
		wheelDisc = to;
		if (to === 'buy') {
			wheelDiscMode = mode;
			// Square the buy disc up under the white: the main wheel rests at a 54th of a turn, which
			// would leave the buy wedges askew — and a single room's one turn must start at the top.
			wheel?.resetRotation();
		}
		await waitForTimeout(60);
		wheelFlash = false;
		await waitForTimeout(FLASH_OUT_MS);
		discSwapping = false;
	};
	// Back to the full wheel once a buy is cleared from the board.
	$effect(() => {
		if (!stateGame.buying && wheelDisc === 'buy') void swapDisc('main');
	});

	// Chip tray comes from the RGS bet template (betLevels). It arrives with authenticate.
	const stakes = $derived(stateGameDerived.stakeOptions());
	$effect(() => {
		void stakes;
		stateGameDerived.ensureValidStake();
	});

	// Chips all render the same `chip_base.svg` art, tinted per stake with a CSS hue-rotate.
	const CHIP_BASE_HUE = 42;
	const CHIP_HUES = [133, 222, 264, 324, 362];
	const chipHue = (index: number) => {
		if (stakes.length <= 1) return CHIP_HUES[0];
		const position = (index / (stakes.length - 1)) * (CHIP_HUES.length - 1);
		const stop = Math.min(Math.floor(position), CHIP_HUES.length - 2);
		return CHIP_HUES[stop] + (CHIP_HUES[stop + 1] - CHIP_HUES[stop]) * (position - stop);
	};
	const chipHueShift = (index: number) => Math.round(chipHue(index) - CHIP_BASE_HUE);
	const chipTextColour = (index: number) =>
		`hsl(${Math.round(chipHue(index)) % 360}, 70%, ${Math.round(55 * 0.7)}%)`;

	// --- Chip carousel (the whole tray is visible; it still windows if more levels arrive) -------
	const VISIBLE_CHIPS = 7;
	const carousel = $derived.by(() => {
		const total = stakes.length;
		const windowSize = Math.min(VISIBLE_CHIPS, total);
		const middle = Math.floor(windowSize / 2);
		const selected = Math.max(0, stakes.indexOf(stateGame.stake));
		const start = Math.min(Math.max(selected - middle, 0), total - windowSize);
		return {
			windowSize,
			start: Math.max(start, 0),
			chips: stakes.map((value, index) => ({
				value,
				index,
				depth: Math.min(Math.abs(index - selected), 2),
				selected: index === selected,
				shown: index >= start && index < start + windowSize,
			})),
		};
	});

	let stakePanelOpen = $state(false);

	const onChipClick = (value: number, isSelected: boolean) => {
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
	const total = $derived(
		stateGame.buying ? stateGameDerived.buyTotal(stateGame.buying) : stateGameDerived.totalStake(),
	);
	const currentBet = $derived(stateGameDerived.currentBet());
	const idle = $derived(context.stateXstateDerived.isIdle() && !stateGame.rolling);
	const settled = $derived(stateGame.resultReady);
	let clearing = $state(false);
	let payingOut = $state(false);
	/** True while the bonus screen is down over the table. */
	let bonusUp = $state(false);
	let resultClosing = $state(false);

	const bettingOpen = $derived(idle && !settled && !clearing && !bonusUp);
	const controlsHidden = $derived(!bettingOpen);
	const canSpin = $derived(bettingOpen && currentBet !== null && !stateGame.openRoundError);
	const confirmDisabled = $derived(settled ? clearing || payingOut : !canSpin);
	const clearDisabled = $derived(
		clearing || payingOut || (!settled && (!idle || backedCount === 0)),
	);

	/** Tiles to hold in shadow once the wheel has stopped: everything but the landed spot. */
	let landedSpot = $state<Spot | null>(null);
	const shadowed = (spot: Spot): boolean => landedSpot !== null && landedSpot !== spot;

	const selectStake = (value: number) => {
		const placed = stateGameDerived.backedSpots();
		const face = currentChipFace();
		const replaced = stateGameDerived.selectStake(value);
		if (!replaced) return;
		sweepChips(placed, face);
		// The new denomination goes back down on the same spots, taking off while the old chips are
		// still falling, as a quick run at a faster pace than a hand-placed chip.
		const after = placed.length ? SWEEP_FALL_MS : 0;
		replaced.forEach((spot, i) =>
			flyChip(spot, 'place', after + i * RESTAKE_STEP_MS, undefined, RESTAKE_PACE),
		);
	};
	/** Gap between re-placed chips on a denomination switch. */
	const RESTAKE_STEP_MS = 35;
	/** Flight time of a re-placed chip, as a fraction of a hand-placed one. */
	const RESTAKE_PACE = 0.6;

	// --- Chip flight (copied from colour-dice: place / return / sweep / collect) -----------------
	const GROW_MS = 130;
	const TRAVEL_MS = 390;
	const SETTLE_MS = 130;
	const FLIGHT_MS = GROW_MS + TRAVEL_MS + SETTLE_MS;
	const SWEEP_WINDOW_MS = 260;
	const SWEEP_FALL_MS = 220;
	const COLLECT_TRAVEL_MS = 560;
	const COLLECT_MERGE_MS = 200;
	const COLLECT_MS = COLLECT_TRAVEL_MS + COLLECT_MERGE_MS;
	const COLLECT_STAGGER_MS = 90;
	const WIN_FLOAT_MS = 1100;
	const PAYOUT_LEAD_MS = 420;
	const PAYOUT_POP_MS = 300;
	const TIER_RISE_VW = 0.5;
	const RESULT_CLOSE_MS = 340;

	type ChipFlight = {
		id: number;
		kind: 'place' | 'return' | 'sweep' | 'collect';
		spot: Spot;
		label: string;
		hue: number;
		text: string;
		from: { x: number; y: number };
		to: { x: number; y: number };
		delay: number;
		spin: number;
		turned: boolean;
		/** A place/return flight's duration, when it is not the standard FLIGHT_MS. */
		ms?: number;
	};

	let flights = $state<ChipFlight[]>([]);
	let flightId = 0;
	const arrivingSpots = $derived(
		new Set(flights.filter((f) => f.kind === 'place' && !f.turned).map((f) => f.spot)),
	);

	let gameEl: HTMLDivElement;
	let chipEls = $state<Record<number, HTMLElement | undefined>>({});
	let tileEls = $state<Partial<Record<Spot, HTMLElement>>>({});
	let balanceChipEl: HTMLElement | undefined = $state();
	let flightEls = $state<Record<number, HTMLElement | undefined>>({});

	/**
	 * Centre of `rect` in the frame's own coordinates. Client rects are in viewport pixels — already
	 * multiplied by the frame's `zoom` — while a chip in flight is positioned inside the frame, where
	 * its pixels are multiplied again on paint. Dividing by the fit undoes the first multiplication,
	 * so a chip spawns on its tray and lands on its tile at every viewport size.
	 */
	type Point = { x: number; y: number };

	const centreIn = (host: DOMRect, rect: DOMRect): Point => ({
		x: (rect.left - host.left + rect.width / 2) / fitScale,
		y: (rect.top - host.top + rect.height / 2) / fitScale,
	});

	/** Any viewport point in the frame's own coordinates — see `centreIn` for why the fit divides. */
	const pointIn = (host: DOMRect, x: number, y: number): Point => ({
		x: (x - host.left) / fitScale,
		y: (y - host.top) / fitScale,
	});

	const currentChipFace = () => {
		const index = stakes.indexOf(stateGame.stake);
		return { label: fmtChip(stateGame.stake), hue: chipHueShift(index), text: chipTextColour(index) }; // prettier-ignore
	};

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

	const flyChip = (
		spot: Spot,
		kind: 'place' | 'return',
		delay = 0,
		face = currentChipFace(),
		pace = 1,
	) => {
		const tray = chipEls[stateGame.stake];
		const box = tileEls[spot];
		if (!gameEl || !tray || !box) return;
		const host = gameEl.getBoundingClientRect();
		const id = ++flightId;
		const ms = Math.round(FLIGHT_MS * pace);
		const grow = Math.round(GROW_MS * pace);
		const travel = Math.round(TRAVEL_MS * pace);
		flights = [
			...flights,
			{
				id,
				kind,
				spot,
				...face,
				from: centreIn(host, tray.getBoundingClientRect()),
				to: centreIn(host, box.getBoundingClientRect()),
				delay,
				spin: 0,
				turned: false,
				ms,
			},
		];
		schedule(id, () => playSound('whoosh'), delay + grow);
		schedule(id, () => playSound('pop'), delay + grow + travel);
		schedule(id, () => dropFlight(id), delay + ms);
	};

	const turnBack = (flight: ChipFlight) => {
		const animation = flightEls[flight.id]?.getAnimations()[0];
		const elapsed = Number(animation?.currentTime ?? 0);
		if (!animation || elapsed <= 0) {
			dropFlight(flight.id);
			return;
		}
		animation.reverse();
		flights = flights.map((other) => (other.id === flight.id ? { ...other, turned: true } : other));
		cancelCues(flight.id);
		const grow = (GROW_MS * (flight.ms ?? FLIGHT_MS)) / FLIGHT_MS;
		if (elapsed > grow) playSound('whoosh');
		schedule(flight.id, () => playSound('pop'), Math.max(0, elapsed - grow));
		schedule(flight.id, () => dropFlight(flight.id), elapsed);
	};

	const recallChip = (spot: Spot, delay = 0) => {
		const arriving = flights.find((f) => f.kind === 'place' && !f.turned && f.spot === spot);
		if (arriving) turnBack(arriving);
		else flyChip(spot, 'return', delay);
	};

	const shuffled = (spots: Spot[]): Spot[] => {
		const order = [...spots];
		for (let i = order.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[order[i], order[j]] = [order[j], order[i]];
		}
		return order;
	};

	const sweepChips = (spots: Spot[], face = currentChipFace()) => {
		if (!gameEl || !spots.length) return;
		const host = gameEl.getBoundingClientRect();
		const floor = host.height / fitScale + window.innerWidth * 0.035;
		const slot = SWEEP_WINDOW_MS / spots.length;
		for (const [position, spot] of shuffled(spots).entries()) {
			const target = tileEls[spot];
			if (!target) continue;
			const from = centreIn(host, target.getBoundingClientRect());
			const delay = Math.round((position + Math.random()) * slot);
			const id = ++flightId;
			flights = [
				...flights,
				{
					id,
					kind: 'sweep',
					spot,
					...face,
					from,
					to: { x: from.x, y: floor },
					delay,
					spin: Math.round((Math.random() * 2 - 1) * 45),
					turned: false,
				},
			];
			schedule(id, () => playSound('whoosh'), delay);
			schedule(id, () => dropFlight(id), delay + SWEEP_FALL_MS);
		}
	};

	const clearBoard = () => {
		sweepChips(stateGameDerived.backedSpots());
		stateGameDerived.clearBets();
	};

	// --- Paying out -----------------------------------------------------------------------------
	// The winning tile grows its chip into a two-chip pile once the round settles; the payout
	// itself is written on the tile as a multiplier badge. Everything else stays one chip.
	let payoutStage = $state(0);
	const chipsOnSpot = (spot: Spot): number =>
		stateGameDerived.isWinSpot(spot) && payoutStage >= 1 ? 2 : 1;

	$effect(() => {
		if (!stateGame.resultReady) {
			payoutStage = 0;
			payingOut = false;
			return;
		}
		const won = (stateGame.result?.payout ?? 0) > 0 && Boolean(stateGame.result?.covered);
		if (!won) {
			payingOut = false;
			return;
		}
		let cancelled = false;
		payingOut = true;
		void (async () => {
			await waitForTimeout(PAYOUT_LEAD_MS);
			if (cancelled) return;
			payoutStage = 1;
			playSound('pop');
			await waitForTimeout(PAYOUT_POP_MS + 200);
			if (cancelled) return;
			payingOut = false;
		})();
		return () => (cancelled = true);
	});

	// --- Collecting -----------------------------------------------------------------------------
	let balanceHold = $state<number | null>(null);
	const shownBalance = $derived(balanceHold ?? stateBet.balanceAmount);

	$effect(() => {
		if (!stateGame.resultReady || !(stateGame.result?.payout ?? 0)) return;
		untrack(() => {
			if (balanceHold === null) balanceHold = stateBet.balanceAmount;
		});
	});

	let balancePulse = $state(0);
	let winFloat = $state<{ id: number; amount: number; x: number; y: number } | null>(null);

	const showWinFloat = (amount: number) => {
		if (!gameEl || !balanceChipEl) return;
		const host = gameEl.getBoundingClientRect();
		const at = centreIn(host, balanceChipEl.getBoundingClientRect());
		const id = ++flightId;
		winFloat = { id, amount, x: at.x, y: at.y };
		setTimeout(() => {
			if (winFloat?.id === id) winFloat = null;
		}, WIN_FLOAT_MS);
	};

	const collectChips = async (winners: Spot[], face = currentChipFace()) => {
		if (!gameEl || !balanceChipEl || !winners.length) return;
		const host = gameEl.getBoundingClientRect();
		const to = centreIn(host, balanceChipEl.getBoundingClientRect());
		const vw = window.innerWidth / 100;
		const picks: { spot: Spot; x: number; y: number }[] = [];
		for (const spot of winners) {
			const box = tileEls[spot];
			if (!box) continue;
			const centre = centreIn(host, box.getBoundingClientRect());
			const tiers = chipsOnSpot(spot);
			for (let tier = tiers - 1; tier >= 0; tier--) {
				picks.push({ spot, x: centre.x, y: centre.y - tier * TIER_RISE_VW * vw });
			}
		}
		if (!picks.length) return;
		const launched = picks.map((pick, index) => ({
			id: ++flightId,
			kind: 'collect' as const,
			spot: pick.spot,
			...face,
			from: { x: pick.x, y: pick.y },
			to,
			delay: index * COLLECT_STAGGER_MS,
			spin: 0,
			turned: false,
		}));
		flights = [...flights, ...launched.slice().reverse()];
		launched.forEach(({ id, delay }) => {
			schedule(id, () => playSound('whoosh'), delay);
			schedule(
				id,
				() => {
					playSound('merge');
					balancePulse += 1;
				},
				delay + COLLECT_TRAVEL_MS,
			);
			schedule(id, () => dropFlight(id), delay + COLLECT_MS);
		});
		await waitForTimeout((picks.length - 1) * COLLECT_STAGGER_MS + COLLECT_TRAVEL_MS);
	};

	const finishRound = async () => {
		if (clearing || !stateGame.resultReady) return;
		clearing = true;
		stakePanelOpen = false;
		const face = currentChipFace();
		const placed = stateGameDerived.backedSpots();
		const winners = placed.filter((spot) => stateGameDerived.isWinSpot(spot));
		const losers = placed.filter((spot) => !stateGameDerived.isWinSpot(spot));
		const collected = winCash;

		context.eventEmitter.broadcast({ type: 'boardClear' });
		resultClosing = true;
		sweepChips(losers, face);
		const collecting = collectChips(winners, face);

		void waitForTimeout(RESULT_CLOSE_MS).then(() => {
			stateGameDerived.clearBets();
			resultClosing = false;
			clearing = false;
			landedSpot = null;
			wheelHighlight = null;
			topSlotApplied = false;
			tileMult = null;
			multHidden = false;
			panelDimmed = false;
		});

		await collecting;
		balanceHold = null;
		if (collected > 0) showWinFloat(collected);
	};

	const onConfirmClick = () => {
		if (confirmDisabled) return;
		playSound('click');
		if (settled) void finishRound();
		else spin();
	};

	const onClearClick = () => {
		if (clearDisabled) return;
		playSound('click');
		if (settled) void finishRound();
		else clearBoard();
	};

	const flightStyle = (flight: ChipFlight) =>
		[
			`--place-delay:${flight.delay}ms`,
			`--from-x:${flight.from.x}px`,
			`--from-y:${flight.from.y}px`,
			`--to-x:${flight.to.x}px`,
			`--to-y:${flight.to.y}px`,
			`--flight-ms:${flight.ms ?? FLIGHT_MS}ms`,
			`--sweep-ms:${SWEEP_FALL_MS}ms`,
			`--sweep-delay:${flight.delay}ms`,
			`--collect-ms:${COLLECT_MS}ms`,
			`--collect-delay:${flight.delay}ms`,
			`--spin:${flight.spin}deg`,
			`--chip-hue:${flight.hue}deg`,
			`--chip-text:${flight.text}`,
		].join('; ');

	const stranded = (flight: ChipFlight) =>
		flight.kind === 'place' && !flight.turned && !stateGame.backed[flight.spot];
	$effect(() => {
		if (flights.some(stranded)) flights = flights.filter((flight) => !stranded(flight));
	});

	onMount(() => {
		preloadSounds();
		startMusic();
		return () => {
			for (const id of [...flightTimers.keys()]) cancelCues(id);
			flights = [];
			stopMusic();
		};
	});

	$effect(() => {
		syncMusicVolume();
	});

	const toggleSpot = (spot: Spot) => {
		if (!idle || settled || clearing) return;
		const wasBacked = stateGameDerived.isBacked(spot);
		if (!stateGameDerived.toggleSpot(spot)) return;
		if (wasBacked) recallChip(spot);
		else flyChip(spot, 'place');
	};

	/** Gap between a bundle's chips, so a group lands as a run rather than a single thud. */
	const BUNDLE_STEP_MS = 90;

	/** True once every spot a bundle covers is already backed — the button is showing, not offering. */
	const bundleOn = (spots: readonly Spot[]) =>
		spots.every((spot) => stateGameDerived.isBacked(spot));

	/**
	 * One tap covers the whole group; a second tap on a group that is already fully covered lifts it
	 * back off. Bets are added to what is on the board rather than replacing it, so MULTI then BONUS
	 * comes out the same as ALL. Anything the balance will not stretch to is simply not placed.
	 */
	const toggleBundle = (spots: readonly Spot[]) => {
		if (!bettingOpen) return;
		const lifting = bundleOn(spots);
		const wanted = lifting ? [...spots] : spots.filter((spot) => !stateGameDerived.isBacked(spot));
		let moved = 0;
		for (const spot of wanted) {
			if (!stateGameDerived.toggleSpot(spot)) continue;
			if (lifting) recallChip(spot, moved * BUNDLE_STEP_MS);
			else flyChip(spot, 'place', moved * BUNDLE_STEP_MS);
			moved++;
		}
		if (moved) playSound('click');
	};

	/**
	 * `?force=<room>` offline: put the round on by itself.
	 *
	 * The parameter exists to look at a bonus room, and reaching one by hand costs a bet and a spin
	 * every time. So the whole board goes down — which both makes a published ticket out of any
	 * room and covers whichever one the book holds, so it plays its real interactive version rather
	 * than the “you were not in this bonus” preview — and the wheel is sent off.
	 *
	 * Once per load. Afterwards the board belongs to whoever is sitting at it, so a second round is
	 * bet and spun by hand like any other.
	 */
	let autoStarted = false;
	$effect(() => {
		if (autoStarted || online || !forcedRoomKind()) return;
		// Everything has to be ready: the machine idle, a chip value in from the bet template, and
		// enough balance to cover a board. Otherwise wait for the next run of this effect.
		if (!bettingOpen || !stakes.length || !stateGame.stake) return;
		if (!stateGameDerived.canBackAnother()) return;
		autoStarted = true;
		toggleBundle(SPOTS);
		// A tick, so the board's new state has reached `canSpin` before the spin asks it.
		void tick().then(spin);
	});

	const undoBet = () => {
		const last = stateGameDerived.backedSpots().at(-1);
		stateGameDerived.undoBet();
		if (last && !stateGame.backed[last]) recallChip(last);
	};

	let committedStake = $state(0);
	const spin = () => {
		if (!canSpin) return;
		stakePanelOpen = false;
		balanceHold = null;

		if (online && hasActiveRoundToResume()) {
			betNotice = 'Finishing your previous round…';
			stateGame.rolling = true;
			context.eventEmitter.broadcast({ type: 'resumeBet' });
			return;
		}

		committedStake = total;
		if (!stateGameDerived.beginSpin()) return;

		const mismatch = online ? describeModeMismatch(stateBet.activeBetModeKey) : null;
		if (mismatch) {
			console.error(`[crazy-time] ${mismatch}`);
			betNotice = mismatch;
			stateGame.rolling = false;
			return;
		}

		landedSpot = null;
		wheelHighlight = null;
		topSlotApplied = false;
		multFlight = null;
		tileMult = null;
		multHidden = false;
		panelDimmed = false;
		stateGame.rolling = true;
		context.eventEmitter.broadcast({ type: 'bet' });
	};

	let betNotice = $state('');

	// --- Buy bonus ----------------------------------------------------------------------------
	// The Buy Bonus screen (ported from the Plinko): pick a room, or any bonus, at the current chip.
	// Activate raises the Yes/No prompt; Yes commits the buy mode as the round's mode.
	let buyBonusOpen = $state(false);
	const buyDisabled = $derived(!bettingOpen || Boolean(stateGame.openRoundError));

	const openBuyBonus = () => {
		if (buyDisabled) return;
		playSound('click');
		stakePanelOpen = false;
		buyBonusOpen = true;
	};

	const handleBuyActivate = (mode: string) => {
		requestConfirmPrompt('buyBonus', () => startBuy(mode));
	};

	const startBuy = async (mode: string) => {
		buyBonusOpen = false;
		// Re-checked here: the prompt was open for a while and the round may have moved on.
		if (buyDisabled) {
			betNotice = 'Finishing the current round…';
			return;
		}
		balanceHold = null;
		if (online && hasActiveRoundToResume()) {
			betNotice = 'Finishing your previous round…';
			stateGame.rolling = true;
			context.eventEmitter.broadcast({ type: 'resumeBet' });
			return;
		}
		// Any chips on the board go back to the tray: a buy is its own round.
		const placed = stateGameDerived.backedSpots();
		const face = currentChipFace();
		committedStake = stateGameDerived.buyTotal(mode);
		if (!stateGameDerived.beginBuy(mode)) {
			betNotice = 'Not enough balance for this buy.';
			return;
		}
		sweepChips(placed, face);
		// The equivalent chips go down on the rooms the buy can open: the price split across them,
		// flown from the tray one after another. The reels wait for the last one to land.
		const idx = stakes.indexOf(stateGame.stake);
		const buyFace = {
			label: fmtBuyChip(buyChipValue(mode)),
			hue: chipHueShift(idx),
			text: chipTextColour(idx),
		};
		const rooms = BUY_MODES[mode].rooms;
		rooms.forEach((room, i) => flyChip(room, 'place', i * 90, buyFace));
		await waitForTimeout(FLIGHT_MS + (rooms.length - 1) * 90 + 150);
		// Then the wheel flashes white and comes back as the four-wedge disc for this buy.
		await swapDisc('buy', mode);
		const mismatch = online ? describeModeMismatch(stateBet.activeBetModeKey) : null;
		if (mismatch) {
			console.error(`[crazy-time] ${mismatch}`);
			betNotice = mismatch;
			stateGame.rolling = false;
			stateGame.buying = null;
			return;
		}
		landedSpot = null;
		wheelHighlight = null;
		topSlotApplied = false;
		multFlight = null;
		tileMult = null;
		multHidden = false;
		panelDimmed = false;
		stateGame.rolling = true;
		context.eventEmitter.broadcast({ type: 'bet' });
	};

	$effect(() => {
		if (controlsHidden) stakePanelOpen = false;
	});

	$effect(() => {
		if (context.stateXstateDerived.isIdle() && stateGame.rolling) stateGame.rolling = false;
	});

	const sign = $derived(stateBet.currency === 'USD' ? '$' : `${stateBet.currency} `);
	const fmt = (value: number) =>
		value >= 1000 ? `${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)}k` : value.toFixed(2);
	const fmtChip = (value: number) => (value >= 1000 ? `${value / 1000}k` : `${value}`);
	/** A buy's chips are the price split across its rooms, which need not be whole. */
	const fmtBuyChip = (value: number) =>
		value >= 1000 ? `${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)}k` : Number.isInteger(value) ? `${value}` : value.toFixed(2);
	const buyChipValue = (mode: string) => (buyPrice(mode) * stateGame.stake) / BUY_MODES[mode].rooms.length;
	/** What a chip on a tile reads: the chip, or during a buy the tile's share of the price. */
	const placedChipLabel = () =>
		stateGame.buying ? fmtBuyChip(buyChipValue(stateGame.buying)) : fmtChip(stateGame.stake);

	const balanceFormat = $derived(
		new Intl.NumberFormat(stateUrlDerived.lang(), {
			minimumFractionDigits: 2,
			maximumFractionDigits: 2,
		}),
	);

	let winCash = $state(0);
	$effect(() => {
		if (!stateGame.resultReady) winCash = 0;
	});

	// --- Top Slot multiplier: flown from the reel onto the spot it applies to -------------------
	const MULT_FLIGHT_MS = 750;
	/** How long the Top Slot's pair sits still before the multiplier is carried to the board. */
	const TOP_SLOT_HOLD_MS = 1000;
	/** And how long it sits on the tile before the wheel takes over. */
	const MULT_SETTLE_MS = 1000;
	/**
	 * A forced round skips most of its own wind-up. Everything still happens, in the same order
	 * and visibly — the reels turn, the wheel turns, the multiplier flies — just at a fraction of
	 * the length, because a debug reload is not a moment being built for anybody.
	 */
	const hurried = $derived(!online && isForcedRound());
	/** The board keeps full strength through the Top Slot; it only steps back for the wheel. */
	let panelDimmed = $state(false);
	/** In flight, from the Top Slot's multiplier window to the tile's top-right corner. */
	let multFlight = $state<{
		id: number;
		label: string;
		from: Point;
		to: Point;
		/** The reel's own type size, in the frame's units, and the size it has to end at. */
		size: number;
		land: number;
	} | null>(null);
	/** Parked on that tile once it lands, until the board clears. */
	let tileMult = $state<{ spot: Spot; label: string } | null>(null);
	/** The parked badge, held invisible while the flying copy is on its way to it. */
	let tileMultEl: HTMLElement | undefined = $state();
	let multHidden = $state(false);
	let multFlightId = 0;

	const flyMultiplier = async (spot: Spot, multiplier: number) => {
		const box = tileEls[spot];
		const reel = topSlot?.multRect();
		const label = `${multiplier}x`;
		if (!gameEl || !box || !reel) {
			multHidden = false;
			tileMult = { spot, label };
			return;
		}
		// The badge is parked first but held invisible, so the flight can be aimed at the box it
		// will actually occupy. Aiming at the tile's corner instead put it half a badge off, which
		// is what jumped at the hand-off: the parked one hangs off that corner, it isn't centred on
		// it.
		multHidden = true;
		tileMult = { spot, label };
		await tick();
		if (multHidden !== true || tileMult?.spot !== spot) return;
		const host = gameEl.getBoundingClientRect();
		const landing = tileMultEl?.getBoundingClientRect();
		const id = ++multFlightId;
		// It leaves at the size it is read at on the reel and arrives at the size the parked badge
		// is set in, so nothing jumps at either end. Both are measured through the frame's `zoom`,
		// so both are divided back into the frame's own units.
		const land =
			(parseFloat(tileMultEl ? getComputedStyle(tileMultEl).fontSize : '') || 0) / fitScale ||
			((parseFloat(getComputedStyle(gameEl).getPropertyValue('--mult-land')) || 1.45) *
				window.innerWidth) /
				100;
		const size = (topSlot?.multFontPx() ?? 0) / fitScale || land;
		multFlight = {
			id,
			label,
			from: centreIn(host, reel),
			to: landing
				? centreIn(host, landing)
				: pointIn(host, box.getBoundingClientRect().right, box.getBoundingClientRect().top),
			size,
			land,
		};
		playSound('whoosh');
		await waitForTimeout(MULT_FLIGHT_MS);
		if (multFlight?.id !== id) return;
		multFlight = null;
		multHidden = false;
		playSound('pop');
	};

	// --- The stage: Top Slot + wheel ------------------------------------------------------------
	let wheel: Wheel | undefined = $state();
	let topSlot: TopSlot | undefined = $state();
	let wheelHighlight = $state<number | null>(null);
	let topSlotApplied = $state(false);

	context.eventEmitter.subscribeOnMount({
		topSlotSpin: async (event) => {
			await topSlot?.spin(event.spot, event.multiplier);
			// Let the pair be read before anything moves again.
			await waitForTimeout(hurried ? 200 : TOP_SLOT_HOLD_MS);
			// A blank is the miss: nothing to carry over to the board.
			if (event.spot && event.multiplier && event.multiplier > 1) {
				await flyMultiplier(event.spot, event.multiplier);
				await waitForTimeout(hurried ? 200 : MULT_SETTLE_MS);
			}
			// Only now does the board give the floor to the wheel.
			panelDimmed = true;
		},
		wheelSpin: async (event) => {
			// A bought round spins the buy disc, so the book's 54-segment index maps to the room. A
			// single-room buy is one segment: it turns once, fast, and stops with the room under the
			// flapper — `turns: 0` from a disc squared up at the top is exactly one full turn.
			if (stateGame.buying) await swapDisc('buy', stateGame.buying);
			const single = wheelDisc === 'buy' && buyDisc?.length === 1;
			const target =
				wheelDisc !== 'buy' ? event.segment : single ? 0 : ROOM_SPOTS.indexOf(event.spot as RoomSpot);
			await wheel?.spinTo(
				target,
				single
					? { turns: 0, ms: hurried ? 700 : 1400 }
					: hurried
						? { turns: 1, ms: 800 }
						: { turns: 5, ms: 4600 },
			);
			wheelHighlight = target;
			landedSpot = event.spot;
			topSlotApplied = event.multiplier > 1;
			// The wheel is done; the board comes back to full strength to show what it paid.
			panelDimmed = false;
			playSound(event.covered ? 'merge' : 'pop');
			await waitForTimeout(hurried ? 250 : isRoomSpot(event.spot) ? 900 : 700);
		},
		winShow: async (emitterEvent) => {
			// Book amounts are x100 in units of the chip, so cash scales by betAmount.
			winCash = (emitterEvent.amount / 100) * stateBet.betAmount;
			playSound('win');
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

<div class="viewport-fit" style="--fit:{fitScale}">
	<Background />
	<div
		class="game"
		class:portrait
		style="--wheel-w:{wheelVw}vw; --ts-width:{cabinetVw}vw; --wheel-lap:{lapVw}vw; --panel-top:{panelTop}px; --rail-h:{railH}px"
		bind:this={gameEl}
	>
		{#if stateGame.openRoundError || betNotice}
			<div class="bet-notice" onclick={() => (betNotice = '')} aria-hidden="true">
				{stateGame.openRoundError || betNotice}
			</div>
		{/if}

		<!-- The wager reads off the same rail as the balance, opposite it. -->
		{#snippet totalBet()}
			<div class="total-bet">
				<span class="total-bet-lbl">Total Bet</span>
				<span class="total-bet-val">{sign}{fmt(total)}</span>
			</div>
		{/snippet}

		<button
			type="button"
			class="buy-bonus-trigger"
			disabled={buyDisabled}
			onclick={openBuyBonus}
			aria-label="Buy bonus"
		>
			<img src={staticUrl('img/buy-bonus/buy-bonus-btn.webp')} alt="" aria-hidden="true" />
		</button>

		<div class="hud" bind:this={hudEl}>
			{#key balancePulse}
				<div class="balance-hud" class:collected={balancePulse > 0}>
					<div bind:this={balanceChipEl} class="balance-chip" aria-hidden="true"></div>
					<div class="balance-text">
						<span class="hud-lbl">Balance</span>
						<span class="hud-val">{sign}{balanceFormat.format(shownBalance)}</span>
					</div>
				</div>
			{/key}
			{@render totalBet()}
		</div>

		<!-- The show: Top Slot over the wheel. -->
		<div class="stage">
			<div class="topslot-wrap">
				<TopSlot
					bind:this={topSlot}
					applied={topSlotApplied}
					hurry={hurried}
					onTick={() => playSound('peg', 1.9, 0.5)}
					onReelStop={() => playSound('notify')}
				/>
			</div>
			<div class="wheel-wrap">
				<Wheel
					bind:this={wheel}
					segments={wheelDisc === 'buy' && buyDisc ? buyDisc : WHEEL_SEGMENTS}
					sizeStep={wheelDisc === 'buy' ? BUY_WHEEL_INK_STEP : undefined}
					flash={wheelFlash}
					frame={WHEEL_FRAME}
					innerRadius={0}
					highlight={wheelHighlight}
					onTick={() => playSound('peg', 1.4, 0.5)}
				/>
				<!-- The gem at the middle of the hub is the play button: it spins, or plays again once a
			     round has settled. It carries the prompt the old tab used to, and pulses while it can
			     be pressed, since a gem is not self-evidently a button. -->
				<div
					class="hub-spin"
					class:disabled={confirmDisabled}
					style="left:{WHEEL_FRAME.hole.cx * 100}%; top:{WHEEL_FRAME.hole.cy *
						100}%; width:{HUB_HIT * 100}%"
					onclick={onConfirmClick}
					aria-hidden="true"
				>
					<span class="hub-cta">{stateGame.rolling ? '…' : settled ? 'PLAY AGAIN' : 'SPIN'}</span>
				</div>
			</div>
		</div>

		<div class="bottom-panel" class:dimmed={panelDimmed} bind:this={panelEl}>
			<div class="betting-panel-wrap">
				<div class="betting-panel">
					<div class="inner-panel">
						<!-- Bet board: LuckyWheel's 4x2 tile grid. -->
						<div class="board">
							<div class="tiles">
								{#each BOARD as spot (spot)}
									{@const backed = stateGameDerived.isBacked(spot)}
									{@const win = stateGameDerived.isWinSpot(spot)}
									{@const landed = stateGameDerived.isLandedSpot(spot)}
									{@const colour = SPOT_COLOUR[spot]}
									<div
										bind:this={tileEls[spot]}
										class="tile"
										class:win
										class:landed={landed && !win}
										class:dimmed={shadowed(spot)}
										class:room={isRoomSpot(spot)}
										class:locked={bettingOpen && !backed && !stateGameDerived.canBackAnother()}
										class:backed
										style="--tile:{colour.base}; --tile-deep:{colour.deep}; --tile-text:{colour.text}"
										onclick={() => toggleSpot(spot)}
										aria-hidden="true"
									>
										<!-- A tile says what its wedge says: a number wears its badge alone, a room its
										     own icon over its name. -->
										{#if isRoomSpot(spot)}
											<img
												class="tile-crest"
												src={staticUrl(ROOM_ICON[spot].src)}
												alt=""
												draggable="false"
											/>
											<span class="tile-lbl">{SPOT_LABEL[spot]}</span>
										{:else}
											<img
												class="tile-badge"
												src={staticUrl(`img/wheel/${NUMBER_PAY[spot]}.png`)}
												alt=""
												draggable="false"
											/>
										{/if}

										{#if tileMult?.spot === spot}
											<div
												class="tile-mult mult-badge"
												class:waiting={multHidden}
												bind:this={tileMultEl}
											>
												<span class="mult-stroke" aria-hidden="true">{tileMult.label}</span>
												<span class="mult-fill">{tileMult.label}</span>
											</div>
										{/if}

										{#if backed && !arrivingSpots.has(spot) && !clearing}
											{#each Array.from({ length: chipsOnSpot(spot) }, (_, tier) => tier) as tier (tier)}
												<div
													class="placed-chip chip"
													class:won={tier > 0}
													style="--tier:{tier}; --rise:{TIER_RISE_VW}vw; --pop-ms:{PAYOUT_POP_MS}ms; --chip-hue:{chipHueShift(
														stakes.indexOf(stateGame.stake),
													)}deg; --chip-text:{chipTextColour(stakes.indexOf(stateGame.stake))}"
												>
													<span>{placedChipLabel()}</span>
												</div>
											{/each}
										{/if}
									</div>
								{/each}
							</div>

							<!-- Group bets, parked on the seams between the halves of the board. -->
							{#each BUNDLES as bundle (bundle.key)}
								<div
									class="bundle-btn"
									class:on={bundleOn(bundle.spots)}
									class:hidden={controlsHidden}
									style="--seam:{bundle.seam}; --face:{bundleFace(
										bundle.face,
										bundleFaceFrom(bundle),
									)}"
									onclick={() => toggleBundle(bundle.spots)}
									title={bundle.label}
									aria-hidden="true"
								>
									<span class="bundle-lbl">{bundle.label}</span>
								</div>
							{/each}
						</div>

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
									<div class="stake-panel">
										<div class="stake-panel-title">Chip value</div>
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
									<div class="chips-viewport" style="--slots:{carousel.windowSize}">
										<div class="chips-rail" style="--offset:{carousel.start}">
											{#each carousel.chips as chip (chip.value)}
												<div
													class="chip-wrap"
													class:shown={chip.shown}
													style="--depth:{chip.depth}"
												>
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
					</div>
				</div>
			</div>
		</div>

		{#if stakePanelOpen}
			<div
				class="stake-panel-backdrop"
				onclick={() => (stakePanelOpen = false)}
				aria-hidden="true"
			></div>
		{/if}

		{#if multFlight}
			<div
				class="mult-flight"
				style="--from-x:{multFlight.from.x}px; --from-y:{multFlight.from.y}px; --to-x:{multFlight.to
					.x}px; --to-y:{multFlight.to
					.y}px; --ms:{MULT_FLIGHT_MS}ms; --size:{multFlight.size}px; --land-scale:{multFlight.land /
					multFlight.size}"
				aria-hidden="true"
			>
				<div class="mult-badge">
					<span class="mult-stroke" aria-hidden="true">{multFlight.label}</span>
					<span class="mult-fill">{multFlight.label}</span>
				</div>
			</div>
		{/if}

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

		{#if winFloat}
			<div
				class="win-float"
				style="--float-x:{winFloat.x}px; --float-y:{winFloat.y}px; --float-ms:{WIN_FLOAT_MS}ms"
				aria-hidden="true"
			>
				+{sign}{fmt(winFloat.amount)}
			</div>
		{/if}

		<BonusRound
			chip={stateBet.betAmount}
			{sign}
			{portrait}
			onOpenChange={(open) => (bonusUp = open)}
		/>

		{#if stateGame.resultReady}
			<RoundResult amount={winCash} {sign} closing={resultClosing} />
		{/if}
	</div>
</div>

<BuyBonusModal
	open={buyBonusOpen}
	disabled={buyDisabled}
	onClose={() => (buyBonusOpen = false)}
	onActivate={handleBuyActivate}
/>
<ConfirmPromptModal />

<style>
	/* ---- Chips (same skin as colour-dice: chip_base.svg tinted by --chip-hue) ---- */
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
		background: url('img/chip_base.svg') no-repeat center / contain;
		filter: hue-rotate(var(--chip-hue, 0deg));
		z-index: 0;
	}
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
	.chip.open {
		outline-color: #ffffff;
	}

	.flying-chip {
		position: absolute;
		top: 0;
		left: 0;
		width: 2.9vw;
		height: 2.9vw;
		margin: -1.45vw 0 0 -1.45vw;
		z-index: 45;
		pointer-events: none;
		filter: drop-shadow(0 0.2vw 0.35vw rgba(0, 0, 0, 0.55));
	}
	/* A group bet lays its chips down as a run, so `place` carries a delay the single bets leave at 0. */
	.flying-chip.place {
		animation: chip-flight var(--flight-ms) var(--place-delay, 0ms) both;
	}
	.flying-chip.return {
		animation: chip-flight var(--flight-ms) var(--place-delay, 0ms) reverse both;
	}
	.flying-chip.sweep {
		animation: chip-sweep var(--sweep-ms) var(--sweep-delay) ease-in both;
	}
	.flying-chip.collect {
		animation: chip-collect var(--collect-ms) var(--collect-delay) both;
		z-index: 46;
	}
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

	/* ---- Stake panel / tray (from colour-dice) ---- */
	.chipandstate-wrap {
		position: relative;
	}
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
		width: max-content;
		max-width: 46vw;
		padding: 0.8vw 1vw 1vw;
		border-radius: 1vw;
		background: rgba(18, 20, 34, 0.96);
		border: 0.1vw solid #828a97;
		box-shadow: 0 0.4vw 1.2vw rgba(0, 0, 0, 0.55);
	}
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
	.stake-option {
		scale: 1;
		opacity: 1;
	}
	.stake-panel-backdrop {
		position: fixed;
		inset: 0;
		z-index: 35;
	}
	/* Buy Bonus badge (art from the Plinko), top-left of the table. */
	.buy-bonus-trigger {
		position: absolute;
		top: 1.2vw;
		left: 1.2vw;
		z-index: 25;
		width: 6.25vw;
		height: 6.25vw;
		padding: 0;
		border: none;
		background: none;
		cursor: pointer;
		transition:
			transform 0.12s ease,
			filter 0.12s ease;
	}
	.buy-bonus-trigger img {
		width: 100%;
		height: 100%;
		object-fit: contain;
		pointer-events: none;
		filter: drop-shadow(0 0.15vw 0.45vw rgba(0, 0, 0, 0.5));
	}
	.buy-bonus-trigger:hover:not(:disabled) {
		transform: scale(1.06);
	}
	.buy-bonus-trigger:disabled {
		cursor: not-allowed;
		filter: grayscale(0.7) brightness(0.55);
	}

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
	.chips-viewport {
		--chip-pitch: 3.6vw;
		width: calc(var(--slots, 5) * var(--chip-pitch));
		overflow: hidden;
		padding: 1vw 0.5vw 0.5vw;
		margin: -1vw -0.5vw -0.5vw;
	}
	/* The shared table.scss sizes chips and the round buttons; the tighter panel needs them smaller. */
	.chips-rail .chip {
		width: 2.9vw;
		height: 2.9vw;
		margin: auto 0.35vw;
	}
	.actions-wrap .clear-btn {
		width: 2.5vw;
		height: 2.5vw;
		margin: auto 0.7vw;
	}
	/* The shared table.scss floats the tray on a pale pill; black suits this table. */
	.chips-wrap {
		background: rgba(0, 0, 0, 0.45);
	}
	.chips-rail {
		display: flex;
		width: max-content;
		transform: translateX(calc(var(--offset, 0) * var(--chip-pitch) * -1));
		transition: transform 0.26s cubic-bezier(0.22, 0.61, 0.36, 1);
	}
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
	.chip-wrap:not(.shown) {
		pointer-events: none;
	}
	.undo-btn {
		width: 2.5vw;
		height: 2.5vw;
		margin: auto 0.7vw;
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
		font-size: 1.5vw;
		line-height: 1;
	}
	.undo-btn.disabled,
	.clear-btn.disabled {
		cursor: not-allowed;
		opacity: 0.5;
		filter: grayscale(1);
		pointer-events: none;
	}

	/* ---- Frame ---- */
	/* Centres the frame in the viewport. <Background> is a sibling of the frame, not a child, so the
	   scene covers the whole viewport at full size while the frame scales inside it — the letterbox
	   bands show the backdrop rather than a flat colour. The colour here is only the pre-paint floor. */
	.viewport-fit {
		position: fixed;
		inset: 0;
		overflow: hidden;
		background-color: #160b26;
	}
	/* Width in vw (not the shared sheet's 100%) so `zoom` scales the box along with its vw interior:
	   a percentage resolves against the unzoomed parent and would leave the frame full size. The
	   frame itself is transparent — the backdrop behind it is the whole picture. */
	/* The frame fills the viewport: `zoom` scales the vw-authored interior, so BOTH of the box's own
	   dimensions have to be divided by the same factor to come back out at exactly the viewport's.
	   (Width included — `100vw` alone renders as `100vw * fit` and leaves a band down one side.)
	   The stage sits at the top edge and the panel at the bottom; any slack falls between them. */
	.game {
		--panel-inset: 12.5vw;
		/* The size the Top Slot's multiplier settles at on a tile — the flight reads it too. */
		--mult-land: 1.45vw;
		/* The round's readout: how tall the marquee is, and how far above the panel it sits. */
		--result-size: 8vw;
		--result-gap: 0.3vw;
		position: relative;
		width: calc(100vw / var(--fit, 1));
		height: calc(100vh / var(--fit, 1));
		zoom: var(--fit, 1);
		background: none;
	}
	/* The show sits behind the betting panel (z-index 2): the wheel now runs most of the frame's
	   height, and its lower arc passes under the board rather than stopping above it. */
	.stage {
		position: absolute;
		top: 0.4vw;
		left: 0;
		right: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		z-index: 1;
		pointer-events: none;
	}
	/* The Top Slot cabinet crowns the wheel, in flow above it and centred by the stage. Its own
	   stacking context, so the frame art's z-index stays inside it and the wheel — which laps over
	   the cabinet's lower edge — still paints in front. */
	.topslot-wrap {
		position: relative;
		z-index: 0;
		isolation: isolate;
	}
	/* Sized to land the wheel's bottom just short of the frame: 0.4 top + the Top Slot cabinet
	   + 0.4 gap + the wheel has to stay inside the frame's 56.25vw. */
	/* Lapped over the cabinet's lower edge. The offset is a margin and the stage has no gap: an iOS
	   first paint inside the Stake Engine iframe drops a box that spends a flex gap on a negative
	   margin, so the two are never combined. */
	.wheel-wrap {
		position: relative;
		z-index: 1;
		width: var(--wheel-w, 44.5vw);
		/* Only as far as the cabinet's lower rail — see WHEEL_LAP_SHARE, which keeps the lap a share of
		   the cabinet's height so it tracks the viewport with everything else. */
		margin-top: calc(var(--wheel-lap, 1.29vw) * -1);
	}
	/* The stage is click-through; this is the one piece of it that answers. */
	.hub-spin {
		position: absolute;
		translate: -50% -50%;
		aspect-ratio: 1;
		border-radius: 50%;
		cursor: pointer;
		pointer-events: auto;
		animation: hub-pulse 1.7s ease-in-out infinite;
		transition: scale 120ms ease;
	}
	@keyframes hub-pulse {
		0%,
		100% {
			box-shadow: 0 0 0.6vw 0.1vw rgba(255, 225, 77, 0.35);
		}
		50% {
			box-shadow: 0 0 1.4vw 0.35vw rgba(255, 225, 77, 0.7);
		}
	}
	.hub-spin:hover {
		animation: none;
		box-shadow: 0 0 1.6vw 0.45vw rgba(255, 225, 77, 0.75);
	}
	.hub-spin:active {
		scale: 0.96;
	}
	.hub-spin.disabled {
		cursor: default;
		pointer-events: none;
		animation: none;
		box-shadow: none;
	}
	/* The prompt the play tab used to carry, centred on the gem. Click-through: the button is the gem
	   itself, so a long word's ends do not extend the target. */
	.hub-cta {
		position: absolute;
		top: 50%;
		left: 50%;
		translate: -50% -50%;
		pointer-events: none;
		font-family: 'PotatoSans', 'Alexandria', sans-serif;
		font-size: 1.4vw;
		letter-spacing: 0.08vw;
		white-space: nowrap;
		color: #fff;
		paint-order: stroke;
		-webkit-text-stroke: 0.1vw rgba(0, 0, 0, 0.55);
		text-shadow: 0 0 0.5vw rgba(0, 0, 0, 0.85);
	}
	.hub-spin.disabled .hub-cta {
		opacity: 0;
	}

	.bottom-panel {
		left: var(--panel-inset);
		right: var(--panel-inset);
		justify-content: center;
		bottom: 0.6vw;
		z-index: 2;
		transition: opacity 300ms ease;
	}
	/* The wheel has the floor while it spins; the board steps back until it stops. */
	.bottom-panel.dimmed {
		opacity: 0.45;
	}
	.actions-wrap {
		height: 3.6vw;
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

	/* ---- Portrait ------------------------------------------------------------------------------
	   A viewport-wide wheel stacked over a viewport-wide board, with the outcomes turned from four
	   columns of two into two of four. Everything here is a re-scale of the landscape rules: the
	   frame is 1.78x narrower than in landscape, so type and controls need roughly that much more
	   vw to come out the same physical size. */
	.game.portrait {
		--mult-land: 3.7vw;
		--result-size: 20vw;
		--result-gap: 3vw;
		/* The board is held well clear of the viewport's edges: the tiles are sized off this, so the
		   margin is set here once rather than tuned into the grid. The chip tray is trimmed to
		   match, since its row would otherwise be the widest thing in the panel. */
		--panel-inset: 6.5vw;
	}
	.game.portrait .stage {
		gap: 1vw;
	}
	.game.portrait .hub-cta {
		font-size: 3.4vw;
	}
	/* Two columns of four: the multipliers take the first two rows and the bonuses the last two,
	   rather than the board's own alternating order. */
	.game.portrait .tile.room {
		order: 1;
	}
	.game.portrait .board {
		--tile-w: calc((100vw / var(--fit, 1) - 2 * var(--panel-inset) - 1vw) / 2);
		--tile-h: 12vw;
		--tile-gap-x: 1vw;
		--tile-gap-y: 0.9vw;
	}
	.game.portrait .tiles {
		grid-template-columns: repeat(2, var(--tile-w));
	}
	/* Two columns of four turns the board's seams from vertical into horizontal: the group buttons
	   ride the row gaps instead, on the one column seam, and grow with the rest of the portrait UI. */
	.game.portrait .bundle-btn {
		top: calc(var(--seam) * var(--tile-h) + (var(--seam) - 0.5) * var(--tile-gap-y));
		left: 50%;
		width: 10.4vw;
		height: 10.4vw;
		border-width: 0.3vw;
		box-shadow: 0 0.4vw 0.9vw rgba(0, 0, 0, 0.55);
	}
	.game.portrait .bundle-btn.on {
		outline-width: 0.5vw;
		outline-offset: 0.15vw;
	}
	.game.portrait .bundle-lbl {
		font-size: 2vw;
		letter-spacing: 0.04vw;
		-webkit-text-stroke: 0.4vw rgba(0, 0, 0, 0.75);
	}
	.game.portrait .tile {
		border-width: 0.3vw;
		border-radius: 1vw;
	}
	.game.portrait .tile.backed {
		outline-width: 0.28vw;
		outline-offset: 0.06vw;
	}
	.game.portrait .tile-lbl {
		font-size: 3.5vw;
		letter-spacing: 0.12vw;
		-webkit-text-stroke: 0.32vw rgba(0, 0, 0, 0.55);
	}
	.game.portrait .tile-badge {
		height: 8.5vw;
	}
	.game.portrait .tile-crest {
		height: 4.4vw;
	}
	.game.portrait .board {
		margin-top: 1.2vw;
	}
	.game.portrait .actions-wrap {
		height: 10vw;
	}
	.game.portrait .chips-viewport {
		--chip-pitch: 9vw;
	}
	.game.portrait .chips-rail .chip {
		width: 7.2vw;
		height: 7.2vw;
		margin: auto 0.9vw;
	}
	.game.portrait .actions-wrap .clear-btn,
	.game.portrait .undo-btn {
		width: 6.4vw;
		height: 6.4vw;
		margin: auto 1.2vw;
	}
	.game.portrait .undo-btn::before {
		font-size: 4.2vw;
	}
	.game.portrait .tile .placed-chip,
	.game.portrait .flying-chip {
		width: 8vw;
		height: 8vw;
	}
	.game.portrait .flying-chip {
		margin: -4vw 0 0 -4vw;
	}
	.game.portrait .tile-mult {
		top: -0.9vw;
		right: -0.8vw;
	}
	.game.portrait .bet-notice {
		top: 10vw;
		font-size: 2.2vw;
		padding: 1.2vw 2vw;
	}
	/* Everything else that is set in vw and would otherwise come out ~1.78x smaller than it does in
	   landscape: the HUD, the chip faces, and the round's own read-outs. */
	/* The rail: balance bottom-left, wager bottom-right, both in the balance's own hand. The panel
	   is lifted clear of it so the chip tray and the read-outs do not share a line. */
	.game.portrait .hud {
		--hud-mark: 7vw;
		padding: 2.4vw 3vw;
	}
	.game.portrait .bottom-panel {
		bottom: 12vw;
	}
	.game.portrait .balance-hud {
		gap: 1.4vw;
	}
	.game.portrait .hud-lbl,
	.game.portrait .total-bet-lbl {
		font-size: 2vw;
	}
	.game.portrait .hud-val,
	.game.portrait .total-bet-val {
		font-size: 4vw;
	}
	.game.portrait .chip span {
		font-size: 2.6vw;
	}
	.game.portrait .chip.selected {
		outline-width: 0.6vw;
	}
	.game.portrait .win-float {
		font-size: 3vw;
	}
	.game.portrait .stake-panel {
		max-width: 92vw;
		padding: 2vw 2.4vw 2.4vw;
		border-radius: 2.4vw;
	}
	.game.portrait .stake-panel-title {
		font-size: 1.9vw;
		margin-bottom: 1.4vw;
	}
	.game.portrait .stake-panel-grid {
		gap: 1.2vw;
	}

	/* ---- HUD ---- */
	/* The rail: balance bottom-left, wager bottom-right, both in the same hand. In landscape they sit
	   in the margins either side of the board; in portrait the panel lifts clear of them. */
	.hud {
		--hud-mark: 3.2vw;
		position: absolute;
		bottom: 0;
		left: 0;
		right: 0;
		/* Over the bonus screen (30), which covers the rest of the game: what a player has and what
		   they staked has to read the same in a room as on the board, in the same corners. Still
		   under the stake panel's backdrop (35), so choosing a chip dims it like everything else. */
		z-index: 33;
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		padding: 1vw 1.2vw;
		pointer-events: none;
	}
	.hud .total-bet {
		flex-direction: column;
		align-items: flex-end;
		gap: 0;
		margin: 0;
	}
	.balance-hud {
		display: flex;
		align-items: center;
		gap: 0.7vw;
		font-family: 'Alexandria', sans-serif;
		text-shadow: 0 0.1vw 0.3vw rgba(0, 0, 0, 0.8);
	}
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
		background: url('img/chip_yellow.svg') no-repeat center / contain;
		filter: drop-shadow(0 0.1vw 0.2vw rgba(0, 0, 0, 0.6));
	}
	.balance-text {
		display: flex;
		flex-direction: column;
	}
	/* The balance and the wager are the same read-out in two places, so they share their type. */
	.hud-lbl,
	.total-bet-lbl {
		font-size: 0.95vw;
		font-weight: 500;
		letter-spacing: 0.05vw;
		text-transform: uppercase;
		color: #d6c6b4;
	}
	.hud-val,
	.total-bet-val {
		font-size: 1.9vw;
		font-weight: 700;
		color: #ffe14d;
		white-space: nowrap;
		font-variant-numeric: tabular-nums;
	}

	/* ---- Bet board ---- */
	/* The tile metrics live on the board rather than in the grid, because the group buttons are
	   placed on the gaps between tiles and have to be able to work out where those gaps are. */
	.board {
		position: relative;
		margin: 0.45vw auto 0;
		width: fit-content;
		--tile-w: 10.4vw;
		--tile-h: 4.6vw;
		--tile-gap-x: 0.3vw;
		--tile-gap-y: 0.25vw;
	}
	.tiles {
		display: grid;
		grid-template-columns: repeat(4, var(--tile-w));
		grid-auto-rows: var(--tile-h);
		gap: var(--tile-gap-y) var(--tile-gap-x);
	}
	/* ---- Group bets ----
	   A coin sat astride a seam of the board: the spots it buys, painted as equal sectors of a pie,
	   with the group's name over a dark core so it still reads against eight colours. Landscape
	   counts seams across the columns; portrait counts them down the rows (see the portrait block).
	   Sizes are held off the tile metrics so the button keeps its proportion at any fit. */
	.bundle-btn {
		position: absolute;
		top: 50%;
		left: calc(var(--seam) * var(--tile-w) + (var(--seam) - 0.5) * var(--tile-gap-x));
		translate: -50% -50%;
		width: 3.35vw;
		height: 3.35vw;
		z-index: 30;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 50%;
		border: 0.12vw solid #4c2813;
		background-image:
			radial-gradient(circle at 50% 50%, #1c0f06 0 36%, rgba(28, 15, 6, 0) 37%), var(--face);
		box-shadow: 0 0.15vw 0.35vw rgba(0, 0, 0, 0.55);
		transition:
			opacity 180ms ease,
			filter 150ms ease,
			transform 150ms ease,
			visibility 260ms;
	}
	.bundle-btn:hover {
		filter: brightness(1.15);
		transform: scale(1.06);
	}
	/* Already fully covered: the tap that follows lifts the group back off, so say so. */
	.bundle-btn.on {
		outline: 0.2vw solid #ffe14d;
		outline-offset: 0.06vw;
		filter: brightness(1.12);
	}
	.bundle-btn.hidden {
		opacity: 0;
		visibility: hidden;
		pointer-events: none;
	}
	/* The name sits over the core but is free to run onto the ring — a stroke keeps it legible where
	   it does, and the alternative is type too small to read. */
	.bundle-lbl {
		font-family: 'Alexandria', sans-serif;
		font-weight: 700;
		font-size: 0.7vw;
		letter-spacing: 0.01vw;
		line-height: 1;
		color: #fff6d8;
		white-space: nowrap;
		pointer-events: none;
		paint-order: stroke;
		-webkit-text-stroke: 0.14vw rgba(0, 0, 0, 0.75);
	}
	/* Tiles carry a gold border and a label + sub-label over a solid fill in the
	   spot's own colour, the same flat fill its wedges use on the wheel. */
	.tile {
		position: relative;
		isolation: isolate;
		cursor: pointer;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.15vw;
		border-radius: 0.35vw;
		background: var(--tile);
		border: 0.12vw solid #4c2813;
		font-family: 'Alexandria', sans-serif;
		color: var(--tile-text);
		transition:
			opacity 300ms ease,
			filter 150ms ease,
			transform 150ms ease;
	}
	.tile:hover {
		filter: brightness(1.15);
	}
	/* The spot's name is set in the wheel's own face; weight 400 because it has a single cut. Sized
	   and tracked so the longest name — TREASURE CHEST — still clears the tile's edges. */
	.tile-lbl {
		font-family: 'PiecesOfEight', 'Alexandria', sans-serif;
		font-size: 1.05vw;
		font-weight: 400;
		letter-spacing: 0.04vw;
		white-space: nowrap;
		/* The wheel's own label outline: same colour, and the same share of the type size (the wedges
		   use a 2.4 stroke on 21px). `paint-order` keeps it behind the glyph where a browser honours
		   it on HTML text; where it does not, a stroke this thin still reads as an edge. */
		paint-order: stroke;
		-webkit-text-stroke: 0.11vw rgba(0, 0, 0, 0.55);
	}
	/* A number's badge has the tile to itself; a bonus crest shares it with the room's name. */
	.tile-badge {
		height: 3.4vw;
		width: auto;
		filter: drop-shadow(0 0.1vw 0.2vw rgba(0, 0, 0, 0.5));
	}
	.tile-crest {
		height: 1.7vw;
		width: auto;
		filter: drop-shadow(0 0.1vw 0.2vw rgba(0, 0, 0, 0.5));
	}
	/* A tile with a chip on it wears the same gold ring a covered group button does, so the two ways
	   of backing a spot read as one state. It sits OUTSIDE the tile — the win ring is inset, and the
	   two have to be told apart at a glance — which is why it is thin: the outline has half a grid
	   gap to live in before it meets its neighbour's. Declared ahead of `win` and `landed` so those
	   heavier rings replace it once the wheel has stopped. */
	.tile.backed {
		outline: 0.1vw solid #ffe14d;
		outline-offset: 0.02vw;
	}
	.tile.win {
		outline: 0.3vw solid #ffe14d;
		outline-offset: -0.3vw;
		filter: brightness(1.15);
	}
	.tile.landed {
		outline: 0.2vw solid rgba(255, 255, 255, 0.7);
		outline-offset: -0.2vw;
	}
	/* The cover that shadows a losing tile is inside its box, and an outline is not — so the ring has
	   to be taken off by hand, or a spot that just lost would still be wearing the gold. */
	.tile.dimmed.backed {
		outline: none;
	}
	/* Two states cover a tile rather than fade it, so its own colour stays underneath instead of the
	   backdrop showing through: `locked` while another spot holds the bet, and `dimmed` once the wheel
	   has stopped on someone else. The result cover is the heavier of the two — the winner should be
	   the only tile still reading at full strength. */
	.tile.locked,
	.tile.dimmed {
		--cover: rgba(0, 0, 0, 0.55);
	}
	.tile.dimmed {
		--cover: rgba(0, 0, 0, 0.68);
	}
	.tile.locked {
		pointer-events: none;
	}
	.tile.locked::after,
	.tile.dimmed::after {
		content: '';
		position: absolute;
		inset: 0;
		z-index: 20;
		border-radius: inherit;
		background: var(--cover);
	}
	/* The Top Slot's multiplier, in the same hand the reel sets it in: a golden-brown stroke layer
	   under a near-white fill. Worn by the copy in flight and by the one parked on the tile. */
	/* Parked: sitting on the tile's top-right corner, mostly inside it and overhanging just enough
	   to read as applied to the tile rather than printed on it. */
	.tile-mult {
		position: absolute;
		top: -0.35vw;
		right: -0.3vw;
		z-index: 502;
		font-size: var(--mult-land);
	}
	/* Laid out but not shown, while the flying copy is still travelling to where it sits. */
	.tile-mult.waiting {
		visibility: hidden;
	}
	/* In flight: a zero-size box carried between the two points, so `scale` shrinks the reel-sized
	   copy about the point it is travelling to rather than about a corner. */
	.mult-flight {
		position: absolute;
		top: 0;
		left: 0;
		width: 0;
		height: 0;
		z-index: 60;
		pointer-events: none;
		animation: mult-fly var(--ms) cubic-bezier(0.32, 0.72, 0.24, 1) forwards;
	}
	.mult-flight .mult-badge {
		position: absolute;
		left: 0;
		top: 0;
		transform: translate(-50%, -50%);
		font-size: var(--size, 1.9vw);
		white-space: nowrap;
	}
	@keyframes mult-fly {
		from {
			translate: var(--from-x) var(--from-y);
			scale: 1;
		}
		to {
			translate: var(--to-x) var(--to-y);
			scale: var(--land-scale, 0.6);
		}
	}
	.tile .placed-chip {
		position: absolute;
		top: 50% !important;
		bottom: auto !important;
		left: 50% !important;
		transform: translate(-50%, calc(-50% - var(--tier, 0) * var(--rise, 0.5vw)));
		width: 2.9vw;
		height: 2.9vw;
		z-index: calc(12 + var(--tier, 0));
		margin: 0 !important;
		pointer-events: none;
		filter: drop-shadow(0 0.15vw 0.25vw rgba(0, 0, 0, 0.5));
	}
	.tile .placed-chip.won {
		animation: chip-stack var(--pop-ms) cubic-bezier(0.22, 1.3, 0.5, 1) both;
	}
	@keyframes chip-stack {
		0% {
			opacity: 0;
			transform: translate(-50%, calc(-50% - var(--tier) * var(--rise, 0.5vw) - 2.4vw)) scale(1.35);
		}
		65% {
			opacity: 1;
			transform: translate(-50%, calc(-50% - var(--tier) * var(--rise, 0.5vw) + 0.2vw)) scale(0.94);
		}
		100% {
			opacity: 1;
			transform: translate(-50%, calc(-50% - var(--tier) * var(--rise, 0.5vw)));
		}
	}

	/* ---- Total ---- */
	.total-bet {
		position: relative;
		display: flex;
		align-items: baseline;
		justify-content: center;
		gap: 0.4vw;
		margin-top: 0.35vw;
		font-family: 'Alexandria', sans-serif;
		text-shadow: 0 0.1vw 0.3vw rgba(0, 0, 0, 0.8);
	}
</style>
