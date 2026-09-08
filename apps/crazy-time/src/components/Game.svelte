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
		BUNDLE_MODES,
		MODE_COVERAGE,
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
	import BonusRound from './BonusRound.svelte';
	import RoundResult from './RoundResult.svelte';
	import EnableGameActor from './EnableGameActor.svelte';
	import DevHarness from './DevHarness.svelte';

	const context = getContext();

	// When launched without an RGS session (dev / preview), play sample books locally.
	const online = $derived(Boolean(stateUrlDerived.rgsUrl()));

	// Bet board order follows the LuckyWheel reference: X1 X2 bonus bonus / X5 X10 bonus bonus.
	const BOARD: Spot[] = ['x1', 'x2', 'plinko', 'wheel', 'x5', 'x10', 'chest', 'tower'];

	// The wooden ring art (static/img/wheel/frame_v2.png, 1911x1925) with its pin at 12 o'clock and
	// its own ship's-wheel hub. `hole` is the transparent circle, least-squares fitted to the ring's
	// inner edge: centre (955.7, 972.8) px, radius 758.1 px (residual under 2 px). The wedges run to
	// the centre point so the hub art covers solid colour, and 1.5% past the hole so no seam shows.
	const WHEEL_FRAME: WheelFrame = {
		src: staticUrl('img/wheel/frame_v2.png'),
		aspect: 1911 / 1925,
		hole: { cx: 955.7 / 1911, cy: 972.8 / 1925, r: 758.1 / 1911 },
		overscan: 0.015,
	};

	const WHEEL_SEGMENTS: WheelSegment[] = SEGMENT_LAYOUT.map((spot) => ({
		label: isRoomSpot(spot) ? SPOT_LABEL[spot].split(' ').at(-1) ?? spot : String(NUMBER_PAY[spot]),
		fill: SPOT_COLOUR[spot].base,
		text: SPOT_COLOUR[spot].text,
		kind: isRoomSpot(spot) ? 'room' : 'number',
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

	// --- Chip carousel (five visible, selected in the middle, clamped at the ends) ---------------
	const VISIBLE_CHIPS = 5;
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
	const notTicket = $derived(stateGameDerived.selectionIsNotTicket());
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
	const confirmTucked = $derived(!bettingOpen && !(settled && !confirmDisabled));

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

	const centreIn = (host: DOMRect, rect: DOMRect) => ({
		x: rect.left - host.left + rect.width / 2,
		y: rect.top - host.top + rect.height / 2,
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
		const floor = host.height + window.innerWidth * 0.035;
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
			banner = null;
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

	/** One-tap bundle tickets: chips fly onto every spot the ticket covers. */
	const selectTicket = (mode: string) => {
		if (!idle || settled || clearing) return;
		const before = new Set(stateGameDerived.backedSpots());
		const coverage = MODE_COVERAGE[mode] ?? [];
		// A bundle already on the board toggles off.
		if (coverage.length && coverage.every((spot) => before.has(spot)) && before.size === coverage.length) {
			clearBoard();
			return;
		}
		const face = currentChipFace();
		const removed = [...before].filter((spot) => !coverage.includes(spot));
		const spots = stateGameDerived.selectTicket(mode);
		if (!spots.length) return;
		sweepChips(removed, face);
		for (const [i, spot] of spots.entries()) {
			if (before.has(spot)) continue;
			setTimeout(() => flyChip(spot, 'place'), i * 60);
		}
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
		banner = null;
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

	// --- The stage: Top Slot + wheel ------------------------------------------------------------
	let wheel: Wheel | undefined = $state();
	let topSlot: TopSlot | undefined = $state();
	let wheelHighlight = $state<number | null>(null);
	let topSlotApplied = $state(false);
	/** The result strip under the wheel: what landed, and what it pays. */
	let banner = $state<{ spot: Spot; multiplier: number; covered: boolean } | null>(null);

	context.eventEmitter.subscribeOnMount({
		topSlotSpin: async (event) => {
			await topSlot?.spin(event.spot, event.multiplier);
		},
		wheelSpin: async (event) => {
			await wheel?.spinTo(event.segment, { turns: 5, ms: 4600 });
			wheelHighlight = event.segment;
			landedSpot = event.spot;
			topSlotApplied = event.multiplier > 1;
			banner = { spot: event.spot, multiplier: event.multiplier, covered: event.covered };
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

	const bannerText = (b: NonNullable<typeof banner>) => {
		if (isRoomSpot(b.spot)) return SPOT_LABEL[b.spot];
		const pays = NUMBER_PAY[b.spot] * b.multiplier;
		return `${SPOT_LABEL[b.spot]} · PAYS ${pays}:1`;
	};
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

	<!-- The show: Top Slot over the wheel, result strip under it. -->
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
		</div>
		{#if banner}
			<div
				class="banner"
				class:covered={banner.covered}
				style="--b:{SPOT_COLOUR[banner.spot].base}; --bd:{SPOT_COLOUR[banner.spot].deep}"
			>
				<span class="banner-main">{bannerText(banner)}</span>
				{#if banner.multiplier > 1}
					<span class="banner-ts">TOP SLOT x{banner.multiplier}</span>
				{/if}
				{#if !banner.covered}
					<span class="banner-miss">no chip here</span>
				{/if}
			</div>
		{/if}
	</div>

	<div class="bottom-panel">
		<div class="betting-panel-wrap">
			<div class="betting-panel">
				<div class="inner-panel">
					<div
						class="confirm-btn"
						class:clear-mode={settled}
						class:disabled={confirmDisabled}
						class:tucked={confirmTucked}
						onclick={onConfirmClick}
						aria-hidden="true"
					>
						<div class="confirm-lbl">
							{stateGame.rolling ? '…' : settled ? 'PLAY AGAIN' : 'SPIN'}
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

					<!-- Bet board: LuckyWheel's 4x2 tile grid, plus the two bundle tickets alongside. -->
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
									class:backed
									style="--tile:{colour.base}; --tile-deep:{colour.deep}; --tile-text:{colour.text}"
									onclick={() => toggleSpot(spot)}
									aria-hidden="true"
								>
									<div class="tile-accent"></div>
									<span class="tile-lbl">{SPOT_LABEL[spot]}</span>
									<span class="tile-sub">{isRoomSpot(spot) ? 'BONUS GAME' : `PAYS ${NUMBER_PAY[spot]}:1`}</span>

									{#if stateGame.resultReady && landed}
										<div class="result-badge" class:paid={win}>
											{#if win}
												x{stateGame.result?.payout}
											{:else if isRoomSpot(spot)}
												x{(stateGame.result?.roomValue ?? 0) * (stateGame.result?.multiplier ?? 1)}
											{:else}
												x{1 + NUMBER_PAY[spot] * (stateGame.result?.multiplier ?? 1)}
											{/if}
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
						<div class="tickets">
							{#each BUNDLE_MODES as ticket (ticket.mode)}
								<div
									class="ticket"
									class:active={currentBet?.mode === ticket.mode}
									class:disabled={!bettingOpen}
									onclick={() => selectTicket(ticket.mode)}
									aria-hidden="true"
								>
									<span class="ticket-lbl">{ticket.label}</span>
									<span class="ticket-cost">{MODE_COVERAGE[ticket.mode].length} chips</span>
								</div>
							{/each}
						</div>
					</div>

					{#if notTicket}
						<div class="ticket-hint">Bet one spot, ALL BONUS or FULL BOARD</div>
					{/if}
				</div>
			</div>
			<!-- Total wager, below the bet panel (colour-dice's readout). -->
			<div class="total-bet">
				<span class="total-bet-lbl">Total Bet</span>
				<span class="total-bet-val">{sign}{fmt(total)}</span>
			</div>
		</div>
	</div>

	{#if stakePanelOpen}
		<div class="stake-panel-backdrop" onclick={() => (stakePanelOpen = false)} aria-hidden="true"></div>
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
		width: 3.5vw;
		height: 3.5vw;
		margin: -1.75vw 0 0 -1.75vw;
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
		--chip-pitch: 4.3vw;
		width: calc(var(--slots, 5) * var(--chip-pitch));
		overflow: hidden;
		padding: 1vw 0.5vw 0.5vw;
		margin: -1vw -0.5vw -0.5vw;
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
	.undo-btn.disabled,
	.clear-btn.disabled {
		cursor: not-allowed;
		opacity: 0.5;
		filter: grayscale(1);
		pointer-events: none;
	}

	/* ---- Frame ---- */
	.game {
		--panel-inset: 12.5vw;
		background:
			radial-gradient(ellipse at 50% 20%, #3a1d5e 0%, #160b26 55%, #0a0512 100%);
	}
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
	.wheel-wrap {
		width: 31vw;
	}
	/* The Top Slot cabinet sits beside the wheel (there is no room above the frame's pointer). */
	.topslot-wrap {
		position: absolute;
		top: 9vw;
		left: calc(50% + 17.5vw);
	}
	.banner {
		position: absolute;
		top: 32.6vw;
		padding: 0.35vw 1.4vw;
		border-radius: 2vw;
		background: linear-gradient(180deg, var(--b), var(--bd));
		border: 0.12vw solid #f0c65a;
		box-shadow: 0 0.3vw 1vw rgba(0, 0, 0, 0.6);
		font-family: 'Alexandria', sans-serif;
		font-weight: 700;
		font-size: 1.2vw;
		color: #fff;
		text-shadow: 0 0.1vw 0.3vw rgba(0, 0, 0, 0.7);
		display: flex;
		gap: 0.8vw;
		align-items: baseline;
		animation: banner-in 350ms cubic-bezier(0.2, 1.4, 0.4, 1) both;
	}
	.banner.covered {
		box-shadow:
			0 0 1.2vw #ffe14d,
			0 0.3vw 1vw rgba(0, 0, 0, 0.6);
	}
	.banner-ts {
		font-size: 0.85vw;
		color: #ffe14d;
	}
	.banner-miss {
		font-size: 0.75vw;
		font-weight: 500;
		color: rgba(255, 255, 255, 0.75);
	}
	@keyframes banner-in {
		from {
			opacity: 0;
			transform: translateY(0.8vw) scale(0.9);
		}
		to {
			opacity: 1;
			transform: none;
		}
	}

	.bottom-panel {
		left: var(--panel-inset);
		right: var(--panel-inset);
		justify-content: center;
		bottom: 0.6vw;
		z-index: 2;
	}
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
		display: grid;
		grid-template-columns: 1fr auto;
		gap: 0.6vw;
		align-items: stretch;
		margin: 0.6vw auto 0;
		width: fit-content;
	}
	.tiles {
		display: grid;
		grid-template-columns: repeat(4, 12vw);
		grid-auto-rows: 5.6vw;
		gap: 0.25vw 0.3vw;
	}
	/* Tiles share the bundle-ticket look: dark plate, gold border, label + sub-label. A thin bar in
	   the spot's colour along the top ties each tile to its wedges on the wheel. */
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
		background: linear-gradient(180deg, #3a2f5c, #1e1636);
		border: 0.12vw solid #f0c65a;
		font-family: 'Alexandria', sans-serif;
		color: #ffe9b0;
		transition: opacity 300ms ease, filter 150ms ease, transform 150ms ease;
	}
	.tile:hover {
		filter: brightness(1.15);
	}
	.tile-accent {
		position: absolute;
		top: 0;
		left: 0.6vw;
		right: 0.6vw;
		height: 0.28vw;
		border-radius: 0 0 0.2vw 0.2vw;
		background: var(--tile);
	}
	.tile-lbl {
		font-size: 1.15vw;
		font-weight: 700;
		letter-spacing: 0.08vw;
		white-space: nowrap;
	}
	.tile-sub {
		font-size: 0.6vw;
		letter-spacing: 0.06vw;
		opacity: 0.85;
	}
	.tile.backed {
		background: linear-gradient(180deg, #ffe89a, #f0b429);
		color: #4a2c00;
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
	.result-badge {
		position: absolute;
		top: 0.25vw;
		left: 50%;
		transform: translateX(-50%);
		z-index: 501;
		padding: 0.1vw 0.5vw;
		border-radius: 0.9vw;
		background: rgba(0, 0, 0, 0.65);
		border: 0.08vw solid rgba(255, 255, 255, 0.5);
		color: #fff;
		font-family: 'Alexandria', sans-serif;
		font-weight: 700;
		font-size: 0.9vw;
		line-height: 1.35;
		white-space: nowrap;
		pointer-events: none;
		animation: badge-in 420ms cubic-bezier(0.22, 1.4, 0.36, 1) both;
	}
	.result-badge.paid {
		background: linear-gradient(180deg, #fff3b0 0%, #ffc93c 55%, #e59a09 100%);
		border-color: #fff6cf;
		color: #4a2c00;
		font-size: 1.05vw;
	}
	@keyframes badge-in {
		0% {
			opacity: 0;
			transform: translateX(-50%) scale(0.4);
		}
		100% {
			opacity: 1;
			transform: translateX(-50%) scale(1);
		}
	}
	.tile .placed-chip {
		position: absolute;
		top: 50% !important;
		bottom: auto !important;
		left: 50% !important;
		transform: translate(-50%, calc(-50% - var(--tier, 0) * var(--rise, 0.5vw)));
		width: 3.5vw;
		height: 3.5vw;
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

	/* Bundle tickets, stacked beside the grid: one per row. */
	.tickets {
		display: grid;
		grid-template-rows: 1fr 1fr;
		gap: 0.25vw;
	}
	.ticket {
		width: 7.2vw;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.15vw;
		border-radius: 0.35vw;
		background: linear-gradient(180deg, #3a2f5c, #1e1636);
		border: 0.12vw solid #f0c65a;
		cursor: pointer;
		font-family: 'Alexandria', sans-serif;
		color: #ffe9b0;
		transition: filter 150ms ease, transform 150ms ease;
	}
	.ticket:hover {
		filter: brightness(1.15);
	}
	.ticket.active {
		background: linear-gradient(180deg, #ffe89a, #f0b429);
		color: #4a2c00;
		transform: scale(1.03);
	}
	.ticket.disabled {
		opacity: 0.45;
		pointer-events: none;
	}
	.ticket-lbl {
		font-size: 0.95vw;
		font-weight: 700;
		letter-spacing: 0.08vw;
	}
	.ticket-cost {
		font-size: 0.65vw;
		opacity: 0.85;
	}

	/* ---- Total / hint ---- */
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
	.ticket-hint {
		margin-top: 0.4vw;
		text-align: center;
		font-family: 'Alexandria', sans-serif;
		font-size: 0.8vw;
		font-weight: 600;
		color: #ff9a8a;
		text-shadow: 0 0.1vw 0.3vw rgba(0, 0, 0, 0.8);
	}

	/* ---- Play tab (from colour-dice) ---- */
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
		overflow: hidden;
		transition:
			height 260ms cubic-bezier(0.4, 0, 0.2, 1),
			padding-top 260ms cubic-bezier(0.4, 0, 0.2, 1),
			margin-bottom 260ms cubic-bezier(0.4, 0, 0.2, 1),
			opacity 180ms ease,
			visibility 260ms;
	}
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
	.confirm-btn.tucked {
		height: 0 !important;
		padding-top: 0 !important;
		margin-bottom: 0 !important;
		opacity: 0;
		visibility: hidden;
		pointer-events: none;
	}
</style>
