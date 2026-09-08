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
	import {
		NUMBER_PAY,
		SEGMENT_LAYOUT,
		SPOT_COLOUR,
		SPOT_LABEL,
		isRoomSpot,
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

	const context = getContext();

	// When launched without an RGS session (dev / preview), play sample books locally.
	const online = $derived(Boolean(stateUrlDerived.rgsUrl()));

	// Bet board order follows the LuckyWheel reference: X1 X2 bonus bonus / X5 X10 bonus bonus.
	/**
	 * The layout is authored in vw against a 16:9 frame, so a viewport of any other shape either
	 * clips it (short windows) or strands it (tall ones). Scale the whole frame to fit whatever is
	 * there and centre it, letterboxing the remainder.
	 *
	 * `zoom`, not `transform: scale()`: zoom scales in layout — vw still resolves against the
	 * viewport and is then multiplied — so the box's rendered size stays honest to the flow, and
	 * iOS keeps the first paint (a transform-scaled box loses it inside the Stake Engine iframe).
	 */
	let fitScale = $state(1);
	const updateFit = () => {
		const w = window.innerWidth;
		const h = window.innerHeight;
		if (!w || !h) return;
		fitScale = Math.min(1, h / (w * (9 / 16)));
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

	const BOARD: Spot[] = ['x1', 'x2', 'plinko', 'wheel', 'x5', 'x10', 'chest', 'tower'];

	// The wooden ring art (static/img/wheel/frame_v2.png, 1911x1925) with its pin at 12 o'clock and
	// its own ship's-wheel hub. `hole` is the transparent circle, least-squares fitted to the ring's
	// inner edge: centre (955.7, 972.8) px, radius 758.1 px (residual under 2 px). The wedges run to
	// the centre point so the hub art covers solid colour. The ring's inner edge is feathered — the
	// art only goes fully opaque at r ~= 796 px — so the wedges overscan to ~803 px (6%) and finish
	// underneath the wood instead of stopping short of it in the soft band.
	const WHEEL_FRAME: WheelFrame = {
		src: staticUrl('img/wheel/frame_v2.png'),
		aspect: 1911 / 1925,
		hole: { cx: 955.7 / 1911, cy: 972.8 / 1925, r: 758.1 / 1911 },
		overscan: 0.06,
	};

	// Every wedge wears badge art on the label ring: number wedges their value (img/wheel/N.png,
	// 30x48), room wedges the bonus crest (img/wheel/bonus.png, 44x44) with the name lettered down
	// the wedge below it by the Wheel itself.
	const BADGE_ASPECT = 30 / 48;
	const CREST_ASPECT = 1;
	/**
	 * The play button's diameter as a fraction of the frame box: the gem at the middle of the hub,
	 * not the whole ship's wheel. The gem and its red ring run to about r=60px in the 1911px frame
	 * art (sampled: strongly red to r≈55, wood from r≈60), so 72 leaves a small margin around it.
	 */
	const HUB_HIT = (2 * 72) / 1911;

	const WHEEL_SEGMENTS: WheelSegment[] = SEGMENT_LAYOUT.map((spot) => ({
		label: isRoomSpot(spot)
			? (SPOT_LABEL[spot].split(' ').at(-1) ?? spot)
			: String(NUMBER_PAY[spot]),
		fill: SPOT_COLOUR[spot].base,
		text: SPOT_COLOUR[spot].text,
		kind: isRoomSpot(spot) ? 'room' : 'number',
		image: isRoomSpot(spot)
			? { src: staticUrl('img/wheel/bonus.png'), aspect: CREST_ASPECT }
			: { src: staticUrl(`img/wheel/${NUMBER_PAY[spot]}.png`), aspect: BADGE_ASPECT },
	}));

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
	const total = $derived(stateGameDerived.totalStake());
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
		if (!stateGameDerived.selectStake(value)) return;
		sweepChips(placed, face);
	};

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

	const flyChip = (spot: Spot, kind: 'place' | 'return') => {
		const tray = chipEls[stateGame.stake];
		const box = tileEls[spot];
		if (!gameEl || !tray || !box) return;
		const host = gameEl.getBoundingClientRect();
		const id = ++flightId;
		flights = [
			...flights,
			{
				id,
				kind,
				spot,
				...currentChipFace(),
				from: centreIn(host, tray.getBoundingClientRect()),
				to: centreIn(host, box.getBoundingClientRect()),
				delay: 0,
				spin: 0,
				turned: false,
			},
		];
		schedule(id, () => playSound('whoosh'), GROW_MS);
		schedule(id, () => playSound('pop'), GROW_MS + TRAVEL_MS);
		schedule(id, () => dropFlight(id), FLIGHT_MS);
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
		if (elapsed > GROW_MS) playSound('whoosh');
		schedule(flight.id, () => playSound('pop'), Math.max(0, elapsed - GROW_MS));
		schedule(flight.id, () => dropFlight(flight.id), elapsed);
	};

	const recallChip = (spot: Spot) => {
		const arriving = flights.find((f) => f.kind === 'place' && !f.turned && f.spot === spot);
		if (arriving) turnBack(arriving);
		else flyChip(spot, 'return');
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
		panelDimmed = false;
		stateGame.rolling = true;
		context.eventEmitter.broadcast({ type: 'bet' });
	};

	let betNotice = $state('');

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
	/** The board keeps full strength through the Top Slot; it only steps back for the wheel. */
	let panelDimmed = $state(false);
	/** In flight, from the Top Slot's multiplier window to the tile's top-right corner. */
	let multFlight = $state<{ id: number; label: string; from: Point; to: Point } | null>(null);
	/** Parked on that tile once it lands, until the board clears. */
	let tileMult = $state<{ spot: Spot; label: string } | null>(null);
	let multFlightId = 0;

	const flyMultiplier = async (spot: Spot, multiplier: number) => {
		const box = tileEls[spot];
		const reel = topSlot?.multRect();
		if (!gameEl || !box || !reel) {
			tileMult = { spot, label: `${multiplier}x` };
			return;
		}
		const host = gameEl.getBoundingClientRect();
		const tile = box.getBoundingClientRect();
		const id = ++multFlightId;
		multFlight = {
			id,
			label: `${multiplier}x`,
			from: centreIn(host, reel),
			// The corner it is going to sit on, not the tile's middle.
			to: pointIn(host, tile.right, tile.top),
		};
		playSound('whoosh');
		await waitForTimeout(MULT_FLIGHT_MS);
		if (multFlight?.id !== id) return;
		multFlight = null;
		tileMult = { spot, label: `${multiplier}x` };
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
			await waitForTimeout(TOP_SLOT_HOLD_MS);
			// A blank is the miss: nothing to carry over to the board.
			if (event.spot && event.multiplier && event.multiplier > 1) {
				await flyMultiplier(event.spot, event.multiplier);
				await waitForTimeout(MULT_SETTLE_MS);
			}
			// Only now does the board give the floor to the wheel.
			panelDimmed = true;
		},
		wheelSpin: async (event) => {
			await wheel?.spinTo(event.segment, { turns: 5, ms: 4600 });
			wheelHighlight = event.segment;
			landedSpot = event.spot;
			topSlotApplied = event.multiplier > 1;
			// The wheel is done; the board comes back to full strength to show what it paid.
			panelDimmed = false;
			playSound(event.covered ? 'merge' : 'pop');
			await waitForTimeout(isRoomSpot(event.spot) ? 900 : 700);
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
	<div class="game" bind:this={gameEl}>
		{#if stateGame.openRoundError || betNotice}
			<div class="bet-notice" onclick={() => (betNotice = '')} aria-hidden="true">
				{stateGame.openRoundError || betNotice}
			</div>
		{/if}

		<div class="hud">
			{#key balancePulse}
				<div class="balance-hud" class:collected={balancePulse > 0}>
					<div bind:this={balanceChipEl} class="balance-chip" aria-hidden="true"></div>
					<div class="balance-text">
						<span class="hud-lbl">Balance</span>
						<span class="hud-val">{sign}{balanceFormat.format(shownBalance)}</span>
					</div>
				</div>
			{/key}
		</div>

		<!-- The show: Top Slot over the wheel. -->
		<div class="stage">
			<div class="topslot-wrap">
				<TopSlot bind:this={topSlot} applied={topSlotApplied} />
			</div>
			<div class="wheel-wrap">
				<Wheel
					bind:this={wheel}
					segments={WHEEL_SEGMENTS}
					frame={WHEEL_FRAME}
					innerRadius={0}
					highlight={wheelHighlight}
					onTick={() => playSound('peg', 1.4)}
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

		<div class="bottom-panel" class:dimmed={panelDimmed}>
			<div class="betting-panel-wrap">
				<div class="betting-panel">
					<div class="inner-panel">
						<!-- Total wager, read straight off the play tab. -->
						<div class="total-bet">
							<span class="total-bet-lbl">Total Bet</span>
							<span class="total-bet-val">{sign}{fmt(total)}</span>
						</div>

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
										class:locked={bettingOpen && backedCount > 0 && !backed}
										class:backed
										style="--tile:{colour.base}; --tile-deep:{colour.deep}; --tile-text:{colour.text}"
										onclick={() => toggleSpot(spot)}
										aria-hidden="true"
									>
										<span class="tile-lbl">{SPOT_LABEL[spot]}</span>
										<span class="tile-sub">{isRoomSpot(spot) ? 'BONUS' : 'MULTIPLIER'}</span>

										{#if tileMult?.spot === spot}
											<div class="tile-mult mult-badge">
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
													<span>{fmtChip(stateGame.stake)}</span>
												</div>
											{/each}
										{/if}
									</div>
								{/each}
							</div>
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
					.x}px; --to-y:{multFlight.to.y}px; --ms:{MULT_FLIGHT_MS}ms"
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

		<BonusRound chip={stateBet.betAmount} {sign} onOpenChange={(open) => (bonusUp = open)} />

		{#if stateGame.resultReady}
			<RoundResult amount={winCash} {sign} closing={resultClosing} />
		{/if}
	</div>
</div>

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
	.flying-chip.place {
		animation: chip-flight var(--flight-ms) both;
	}
	.flying-chip.return {
		animation: chip-flight var(--flight-ms) reverse forwards;
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
		display: flex;
		align-items: center;
		justify-content: center;
		overflow: hidden;
		background-color: #160b26;
	}
	/* Width in vw (not the shared sheet's 100%) so `zoom` scales the box along with its vw interior:
	   a percentage resolves against the unzoomed parent and would leave the frame full size. The
	   frame itself is transparent — the backdrop behind it is the whole picture. */
	.game {
		--panel-inset: 12.5vw;
		position: relative;
		width: 100vw;
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
		gap: 0.4vw;
		z-index: 1;
		pointer-events: none;
	}
	/* The Top Slot cabinet crowns the wheel, in flow above it and centred by the stage. */
	.topslot-wrap {
		position: relative;
	}
	/* Sized to land the wheel's bottom just short of the frame: 0.4 top + the Top Slot cabinet
	   + 0.4 gap + the wheel has to stay inside the frame's 56.25vw. */
	.wheel-wrap {
		position: relative;
		width: 47vw;
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

	/* ---- HUD ---- */
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
	.hud-lbl {
		font-size: 0.95vw;
		font-weight: 500;
		letter-spacing: 0.05vw;
		text-transform: uppercase;
		color: #d6c6b4;
	}
	.hud-val {
		font-size: 1.9vw;
		font-weight: 700;
		color: #ffe14d;
		white-space: nowrap;
		font-variant-numeric: tabular-nums;
	}

	/* ---- Bet board ---- */
	.board {
		margin: 0.45vw auto 0;
		width: fit-content;
	}
	.tiles {
		display: grid;
		grid-template-columns: repeat(4, 10.4vw);
		grid-auto-rows: 4.6vw;
		gap: 0.25vw 0.3vw;
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
		/* A second, brighter edge just inside the brown one — inset rather than a real border, so
		   it follows the same corner radius without changing the tile's box. */
		box-shadow: inset 0 0 0 0.11vw #ea9f16;
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
	.tile-sub {
		font-size: 0.55vw;
		letter-spacing: 0.06vw;
		opacity: 0.85;
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
	.tile.dimmed {
		opacity: 0.3;
	}
	/* One bet at a time: once a spot is backed the others are covered over and stop answering. The
	   cover is a pseudo-element rather than a fade, so the tile's own colour stays underneath. */
	.tile.locked {
		pointer-events: none;
	}
	.tile.locked::after {
		content: '';
		position: absolute;
		inset: 0;
		z-index: 20;
		border-radius: inherit;
		background: rgba(0, 0, 0, 0.55);
	}
	/* The Top Slot's multiplier, in the same hand the reel sets it in: a golden-brown stroke layer
	   under a near-white fill. Worn by the copy in flight and by the one parked on the tile. */
	.mult-badge {
		display: inline-grid;
		font-family: 'AustereBlackCapsSSK', 'Arial Black', sans-serif;
		line-height: 1.1;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		filter: drop-shadow(0.034em 0.068em 0 #000);
	}
	.mult-badge .mult-stroke,
	.mult-badge .mult-fill {
		grid-area: 1 / 1;
		padding-left: 0.06em;
	}
	.mult-badge .mult-stroke {
		color: transparent;
		-webkit-text-stroke: 0.09em #6d460f;
		paint-order: stroke fill;
		text-shadow:
			0 0.05em 0 #6d460f,
			0.015em 0.09em 0.04em rgba(0, 0, 0, 0.6),
			0 0 0.42em rgba(255, 196, 62, 0.75),
			0 0 0.95em rgba(255, 178, 44, 0.45);
	}
	.mult-badge .mult-fill {
		color: #e9e4e4;
	}
	/* Parked: hung off the tile's top-right corner, clear of the payout badge at top centre. */
	.tile-mult {
		position: absolute;
		top: -0.6vw;
		right: -0.5vw;
		z-index: 502;
		font-size: 1.15vw;
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
		font-size: 1.9vw;
		white-space: nowrap;
	}
	@keyframes mult-fly {
		from {
			translate: var(--from-x) var(--from-y);
			scale: 1;
		}
		to {
			translate: var(--to-x) var(--to-y);
			scale: 0.6;
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

	/* ---- Total / hint ---- */
	.total-bet {
		display: flex;
		align-items: baseline;
		justify-content: center;
		gap: 0.4vw;
		margin-top: 0.35vw;
		font-family: 'Alexandria', sans-serif;
		text-shadow: 0 0.1vw 0.3vw rgba(0, 0, 0, 0.8);
	}
	.total-bet-lbl {
		font-size: 0.62vw;
		font-weight: 500;
		letter-spacing: 0.05vw;
		text-transform: uppercase;
		color: #d6c6b4;
	}
	.total-bet-val {
		font-size: 0.95vw;
		font-weight: 700;
		color: #ffe14d;
	}
</style>
