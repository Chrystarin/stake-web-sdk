<script lang="ts">
	import '../styles/global.scss';
	import '../styles/table.scss';

	import { onMount, tick, untrack } from 'svelte';

	import { stateBet, stateConfig } from 'state-shared';
	import { stateUrlDerived } from 'state-shared';
	import { waitForTimeout } from 'utils-shared/wait';

	import { getContext } from '../game/context';
	import { stateGame, stateGameDerived, type InfoModalTab } from '../game/stateGame.svelte';
	import { hasActiveRoundToResume, describeModeMismatch } from '../game/activeRound';
	import { forcedRoomKind } from '../game/devLocalBet';
	import {
		isReplay,
		seedReplayStake,
		stageReplayRound,
		takeReplayRound,
		type ReplayRound,
	} from '../game/replay';
	import { formatBalance, formatMoney } from '../game/currency';
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
		coverageOf,
		isBuyMode,
		motionOf,
		ICON_MOTION_MS,
		type RoomSpot,
		type Spot,
	} from '../game/constants';

	import Wheel, { type WheelSegment, type WheelFrame } from './Wheel.svelte';
	import { staticCssUrl, staticUrl } from '../lib/staticUrl';
	import { markGameBooted } from '../lib/preloadAssets';
	import TopSlot from './TopSlot.svelte';
	import Background from './Background.svelte';
	import BonusRound from './BonusRound.svelte';
	import RoomReveal from './RoomReveal.svelte';
	import WheelReveal from './WheelReveal.svelte';
	import PlinkoReveal from './PlinkoReveal.svelte';
	import VoyageReveal from './VoyageReveal.svelte';
	import EnableGameActor from './EnableGameActor.svelte';
	import DevHarness from './DevHarness.svelte';
	import BuyBonusModal from './BuyBonusModal.svelte';
	import ConfirmPromptModal from './ConfirmPromptModal.svelte';
	import HudMenuPopup from './HudMenuPopup.svelte';
	import InfoModal from './InfoModal.svelte';
	import QuickGuideModal from './QuickGuideModal.svelte';
	import { isConfirmPromptOpen, requestConfirmPrompt } from '../game/confirmPrompt.svelte';

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
	 * The cabinet with the stage to itself — a bought room has no wheel to turn, so the Top Slot is
	 * the whole show and is set twice as large: two fifths of the height in landscape, near the
	 * viewport's width in portrait. Centred in the room above the panel by the stage's `solo` rule.
	 */
	const SOLO_CABINET_SHARE = 0.4;
	const PORTRAIT_SOLO_CABINET_VW = 96;
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
	let soloCabinetVw = $state(45);
	let lapVw = $state(1.29);
	/**
	 * The wheel while bets are being placed, when the Top Slot is up out of sight: it takes the
	 * cabinet's room as well as its own. Landscape keeps the wheel's bottom where it is and runs its
	 * top up to the frame's, so it grows by the cabinet's height less the lap. Portrait is already a
	 * full-width wheel, so it only comes up to the top and grows a little past the sides — the ring's
	 * outer rim runs off the edges, and the gem stays well clear of the board.
	 */
	let wheelBigVw = $state(54);
	const PORTRAIT_BIG_WHEEL_VW = 108;
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
		soloCabinetVw = portrait
			? PORTRAIT_SOLO_CABINET_VW
			: localVw * SOLO_CABINET_SHARE * CABINET_ASPECT;
		lapVw = (cabinetVw / CABINET_ASPECT) * WHEEL_LAP_SHARE;
		wheelBigVw = portrait ? PORTRAIT_BIG_WHEEL_VW : (localVw - lapVw) / WHEEL_ASPECT;
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

	/**
	 * The chip row's span — the clear button's outer edge to the undo button's — in the frame's own
	 * units. Portrait sizes the board to it, so the tiles line up with the row under them. Measured
	 * rather than restated: the row's width is its chip count times the pitch plus the buttons and
	 * their margins, and the count comes from the stake ladder.
	 */
	let actionsEl: HTMLElement | undefined = $state();
	let chipRowW = $state(0);
	const measureChipRow = () => {
		const clear = actionsEl?.querySelector('.clear-btn')?.getBoundingClientRect();
		const undo = actionsEl?.querySelector('.undo-btn')?.getBoundingClientRect();
		if (!clear || !undo || undo.right <= clear.left) return;
		chipRowW = (undo.right - clear.left) / fitScale;
	};
	$effect(() => {
		void fitScale;
		void portrait;
		if (!actionsEl) return;
		measureChipRow();
		const observer = new ResizeObserver(measureChipRow);
		observer.observe(actionsEl);
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
	 * The buy disc, for Random Bonus only. That buy can only end in a room, and the book says which,
	 * so while it is in flight the wheel shows just the four rooms on quarter wedges and spins to
	 * the one authored. A single-room buy keeps the main wheel and spins it to the bought room's own
	 * segment, as any round does. The ink is sized as if the wedges were BUY_WHEEL_INK_STEP wide so
	 * the crests and names keep the main wheel's scale.
	 */
	const buyWheelSegments = (mode: string): WheelSegment[] => {
		const rooms = BUY_MODES[mode]?.rooms ?? ROOM_SPOTS;
		return rooms.map((spot) => ({
			...WHEEL_SEGMENTS[SEGMENT_LAYOUT.indexOf(spot)],
			// Across the wedge in two big lines, not down it: a quarter wedge has the room for it.
			kind: 'wide' as const,
		}));
	};
	const BUY_WHEEL_INK_STEP = 30;
	/** Whether a buy gets the buy disc: only one the wheel still has to decide between rooms. */
	const usesBuyDisc = (mode: string): boolean => (BUY_MODES[mode]?.rooms.length ?? 0) > 1;

	/**
	 * The main-disc segment to stop under the flapper. The book's `segment` indexes the math's
	 * SEGMENT_LAYOUT, which this client mirrors, so normally it is used as-is. If the two ever
	 * disagree (books generated before a rim re-order and not re-synced or republished), the wheel
	 * must still stop on the spot the book actually pays: stopping on the index would show one
	 * room and then play another. Any segment of that spot will do; the mismatch is reported.
	 */
	const mainSegmentFor = (segment: number, spot: Spot): number => {
		if (SEGMENT_LAYOUT[segment] === spot) return segment;
		const candidates = SEGMENT_LAYOUT.map((s, i) => (s === spot ? i : -1)).filter((i) => i >= 0);
		const fallback = candidates[Math.floor(Math.random() * candidates.length)] ?? 0;
		console.error(
			`[crazy-time] book segment ${segment} is "${SEGMENT_LAYOUT[segment]}" on this wheel but the ` +
				`book pays "${spot}": the books predate the current SEGMENT_LAYOUT (re-run the math and ` +
				`sync-math-books / republish). Stopping on segment ${fallback} instead.`,
		);
		return fallback;
	};

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
			// would leave the buy wedges askew.
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

	/**
	 * A bought room has nothing for the wheel to decide, so for a single-room buy the wheel is taken
	 * off the stage and the Top Slot — the one thing still in play — is centred in its place, twice
	 * the size. While it is away the wheel is set on the room's segment unseen, and it returns behind
	 * the bonus screen (the door takes 700 ms to close, and the screen is opaque once it has), so
	 * when the room opens back onto the table the wheel is there with the room under the flapper and
	 * the PLAY AGAIN gem at its hub, as after any other round. Settling is the fallback: a round that
	 * never reached a room still needs the gem.
	 */
	let wheelOff = $state(false);
	/** The wheel's fade and the cabinet's growth into its place, before the reels start. */
	const WHEEL_LEAVE_MS = 600;
	const WHEEL_RETURN_MS = 800;
	$effect(() => {
		if (!wheelOff) return;
		if (settled) {
			wheelOff = false;
			return;
		}
		if (!bonusUp) return;
		const timer = setTimeout(() => (wheelOff = false), WHEEL_RETURN_MS);
		return () => clearTimeout(timer);
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

	/** Stake's Bet Replay: fixed by the launch URL, so it is read once. See the replay block below. */
	const replayMode = isReplay();
	let replayRound = $state.raw<ReplayRound | null>(null);
	let replayStarting = $state(false);

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

	// --- A room walked into through its own wedge's icon ----------------------------------------
	// The Treasure Chest through its chest, opened, and its light (RoomReveal); the Bonus Wheel
	// through its ship's wheel, spun up over the screen and back down onto the room's hub
	// (WheelReveal).
	let roomReveal: RoomReveal | undefined = $state();
	let wheelReveal: WheelReveal | undefined = $state();
	/** The wedge whose icon has been lifted off the disc by the reveal. */
	let revealIcon = $state<number | null>(null);
	/** The screen is covered by a reveal: the bonus screen goes up under it, unmoving. */
	let revealLit = $state(false);
	/** Which reveal has the screen, so the right one takes itself off. */
	let revealBy: 'chest' | 'wheel' | null = null;
	/** How big the icon is drawn in the middle of the wheel, as a share of the disc. */
	const REVEAL_CHEST_OF_DISC = 0.5;
	const REVEAL_WHEEL_OF_DISC = 0.42;
	/** The cannonball landing on the hub (PlinkoReveal). */
	const REVEAL_BALL_OF_DISC = 0.26;

	// --- Pirate Plinko and Ocean Voyage: their icons carry the player out of the table -----------
	// The cannonball bounces off the hub and falls, and the camera goes down with it: the table
	// slides up and away and the room, which lies under it, comes up from below (PlinkoReveal); the
	// ship sails off to the right, comes back across the screen drawing the room in behind it, and
	// docks where the room's own ship waits (VoyageReveal). Neither covers the screen, so the rooms
	// keep their own ways out (the slide).
	let plinkoReveal: PlinkoReveal | undefined = $state();
	let voyageReveal: VoyageReveal | undefined = $state();
	/** How the next bonus screen comes on (BonusRound's `entrance`) when no cover has it. */
	let roomEntrance = $state<'slide' | 'wipe' | 'descend'>('slide');
	/** The room's own ship is held back while the one that brought the player docks onto it. */
	let shipArriving = $state(false);
	/** The lifted wedge badge goes back on the table once the bonus screen is fully over it. */
	let restoreIconOnOpen = false;
	const ROOM_SLIDE_MS = 700;

	const frameSize = () => ({ w: gameEl?.clientWidth ?? 0, h: gameEl?.clientHeight ?? 0 });

	/**
	 * Wedge `target`'s cannonball, landed on the hub. Its bounce off it, and the camera going down
	 * after it, are the room's entrance (`descend`).
	 */
	const dropBall = async (target: number): Promise<boolean> => {
		const icon = wheel?.iconRect(target);
		const disc = wheel?.discOnScreen();
		if (!plinkoReveal || !gameEl || !icon?.width || !disc?.d) return false;
		const host = gameEl.getBoundingClientRect();
		const from = { ...centreIn(host, icon), size: Math.max(icon.width, icon.height) / fitScale };
		const to = { ...pointIn(host, disc.cx, disc.cy), size: (disc.d * REVEAL_BALL_OF_DISC) / fitScale };
		revealIcon = target;
		roomEntrance = 'descend';
		await plinkoReveal.play(from, to);
		// The room is next and takes the ball on down. Should it never come, the ball does not sit
		// on the hub for good.
		setTimeout(() => {
			if (roomEntrance !== 'descend' || bonusUp) return;
			plinkoReveal?.hide();
			revealIcon = null;
			roomEntrance = 'slide';
		}, 4000);
		return true;
	};

	/**
	 * The clouds on the seam between the table and the room as the camera goes down: a bank of them
	 * as tall as this share of the frame, laid end to end across it — every other one mirrored, and
	 * each over the tapered end of the last — carried on the room's top edge. The picture is three
	 * times as wide as it is tall, so one of them across a landscape frame would stand over half of
	 * it. They come in and go out on the camera's first and last stretches, since at either end of
	 * the move they would sit over one screen or the other.
	 */
	const SEAM_OF_FRAME = 0.3;
	const SEAM_RATIO = 2172 / 724;
	/** How much of each cloud bank the next one covers: the thin, tapered end. */
	const SEAM_OVERLAP = 0.12;
	/** The shares of the camera's move the clouds take to come in, and to go out. */
	const SEAM_IN = 0.12;
	const SEAM_OUT = 0.3;
	let seam = $state<{ h: number; tiles: number } | null>(null);
	let seamEl: HTMLElement | undefined = $state();

	/**
	 * BonusRound's `enter` for a descent: the ball's bounce off the hub, and the camera going down
	 * after it — the table (its backdrop, the wheel, the board, and the buttons that sit under the
	 * bonus screen) up and away by a whole frame, and the screen up from a frame below, with the
	 * clouds on the seam between them. The balance and the wager stay put: they keep their corners
	 * over the bonus screen anyway. The ball comes to rest under the room's cannon, where the room
	 * takes it on (RoomPiratePlinko's `.load-mark`).
	 */
	const descend = async (screen: HTMLElement) => {
		const frame = frameSize();
		const table = gameEl
			? [
					...gameEl.querySelectorAll<HTMLElement>(
						':scope > .stage, :scope > .bottom-panel, :scope > .buy-bonus-trigger, :scope > .menu-anchor',
					),
				]
			: [];
		// The backdrop is the game frame's sibling, the same size, and pans by its own height.
		const backdrop = gameEl?.parentElement?.querySelector<HTMLElement>(':scope > .background');
		// Where the cannon takes the ball, measured off the screen itself: it is held a frame down
		// for now, and what is wanted is where the mark will be once it is up.
		const mark = screen.querySelector('.load-mark')?.getBoundingClientRect();
		const cannon = mark?.width
			? { ...centreIn(screen.getBoundingClientRect(), mark), size: mark.width / fitScale }
			: { x: frame.w / 2, y: frame.h * 0.25, size: frame.h * 0.08 };
		const tileW = frame.h * SEAM_OF_FRAME * SEAM_RATIO;
		seam = {
			h: frame.h * SEAM_OF_FRAME,
			tiles: Math.ceil(frame.w / (tileW * (1 - SEAM_OVERLAP))) + 1,
		};
		await tick();
		const moves: Animation[] = [];
		try {
			await plinkoReveal?.fall(frame, cannon, (camera, ms) => {
				const opts = { duration: ms, fill: 'forwards' } as const;
				const up = camera.map((c) => ({ translate: `0 ${-c}px` }));
				for (const el of table) moves.push(el.animate(up, opts));
				if (backdrop)
					moves.push(
						backdrop.animate(
							camera.map((c) => ({ translate: `0 ${(-100 * c) / frame.h}%` })),
							opts,
						),
					);
				// Left at rest where it lands: `translate` is the screen's for this alone, and its way
				// out animates `transform`.
				screen.animate(
					camera.map((c) => ({ translate: `0 ${frame.h - c}px` })),
					opts,
				);
				seamEl?.animate(
					camera.map((c) => {
						const k = c / frame.h;
						return {
							translate: `0 ${frame.h - c}px`,
							opacity: Math.max(0, Math.min(1, k / SEAM_IN, (1 - k) / SEAM_OUT)),
						};
					}),
					opts,
				);
			});
		} finally {
			// The screen is over the table now: it goes back where it was, unseen, badge and all.
			moves.forEach((a) => a.cancel());
			seam = null;
			revealIcon = null;
			roomEntrance = 'slide';
		}
	};

	/** Wedge `target`'s ship, into the middle of the screen and off to the right. */
	const sailShipOff = async (target: number): Promise<boolean> => {
		const icon = wheel?.iconRect(target);
		if (!voyageReveal || !gameEl || !icon?.width) return false;
		const from = wedgeBox(target) ?? {
			...centreIn(gameEl.getBoundingClientRect(), icon),
			size: icon.width / fitScale,
		};
		revealIcon = target;
		restoreIconOnOpen = true;
		roomEntrance = 'wipe';
		await voyageReveal.sailOff(from, frameSize());
		return true;
	};

	/** The room's own ship, where the one that brought the player docks, in frame pixels. */
	const roomShipBox = () => {
		const ship = gameEl?.querySelector('.voyage .ship')?.getBoundingClientRect();
		if (!gameEl || !ship?.height) return null;
		return { ...centreIn(gameEl.getBoundingClientRect(), ship), size: ship.height / fitScale };
	};

	/**
	 * BonusRound's `enter`: for a wipe, the ship across the screen, then onto the room's ship; for a
	 * descent, the camera down after the cannonball.
	 */
	const enterRoom = async (screen: HTMLElement) => {
		if (roomEntrance === 'descend') return descend(screen);
		if (!voyageReveal) return;
		shipArriving = true;
		try {
			await voyageReveal.cross(screen, frameSize());
			await voyageReveal.dock(roomShipBox(), frameSize(), () => (shipArriving = false));
		} finally {
			shipArriving = false;
			roomEntrance = 'slide';
		}
	};

	/**
	 * Lift wedge `target`'s icon into the middle of the wheel and cover the screen with it — the
	 * chest's light, or the ship's wheel itself. False, having done nothing, when there is nothing
	 * on the screen to lift it from.
	 */
	const revealRoom = async (target: number, by: 'chest' | 'wheel'): Promise<boolean> => {
		const reveal = by === 'chest' ? roomReveal : wheelReveal;
		const icon = wheel?.iconRect(target);
		const disc = wheel?.discOnScreen();
		// A disc not laid out yet (a page loaded in a background tab) measures 0: nothing to go by.
		if (!reveal || !gameEl || !icon || !disc?.d || !icon.width) return false;
		const host = gameEl.getBoundingClientRect();
		// The chest is square and sized by its longer side; the ship's wheel starts from exactly the
		// badge it lifts off, turn and all, since it comes back down onto it on the way out.
		const from =
			by === 'chest'
				? { ...centreIn(host, icon), size: Math.max(icon.width, icon.height) / fitScale }
				: (wedgeBox(target) ?? { ...centreIn(host, icon), size: icon.width / fitScale });
		const share = by === 'chest' ? REVEAL_CHEST_OF_DISC : REVEAL_WHEEL_OF_DISC;
		const to = { ...pointIn(host, disc.cx, disc.cy), size: (disc.d * share) / fitScale };
		revealIcon = target;
		revealBy = by;
		if (by === 'wheel') {
			wheelRoomTarget = target;
			// The room comes up under the cover without its hub: the hub is this icon, on its way.
			hubLifted = true;
		} else chestRoomTarget = target;
		await reveal.play(from, to, { w: gameEl.clientWidth, h: gameEl.clientHeight });
		revealLit = true;
		// The bonus screen is next and takes the cover off (see `onBonusOpenChange`). Should it
		// never come, the table is not left behind a covered screen.
		setTimeout(() => {
			if (revealLit && !bonusUp) void endReveal();
		}, 4000);
		return true;
	};

	/**
	 * The Bonus Wheel room's hub is its own icon, so while that icon is in the air there is none on
	 * the room's wheel (RoomBonusWheel hides it under `.game.hub-lifted`): the one in flight is it.
	 */
	let hubLifted = $state(false);
	/** The room's wheel rattling from the icon being slammed into its middle (RoomBonusWheel). */
	let hubSlammed = $state(false);
	const HUB_SLAM_MS = 420;

	/** The room wheel's hub, where the ship's wheel comes to rest, in the frame's own pixels. */
	const bonusHubBox = () => {
		const hub = gameEl?.querySelector('[data-bonus-hub]')?.getBoundingClientRect();
		if (!gameEl || !hub?.width) return null;
		return { ...centreIn(gameEl.getBoundingClientRect(), hub), size: hub.width / fitScale };
	};

	const endReveal = async () => {
		revealIcon = null;
		if (revealBy === 'wheel')
			await wheelReveal?.clear(bonusHubBox(), () => {
				// Slammed into the room wheel's middle: the hub is up, and the wheel takes the knock.
				hubLifted = false;
				hubSlammed = true;
				setTimeout(() => (hubSlammed = false), HUB_SLAM_MS);
			});
		else await roomReveal?.clear();
		hubLifted = false;
		revealBy = null;
		revealLit = false;
	};

	/** Wedge `index`'s badge on the table's wheel, turn and all, in the frame's own pixels. */
	const wedgeBox = (index: number) => {
		const pose = wheel?.iconPose(index);
		if (!gameEl || !pose?.w) return null;
		return {
			...pointIn(gameEl.getBoundingClientRect(), pose.cx, pose.cy),
			size: pose.w / fitScale,
			angle: pose.angle,
		};
	};

	// --- ...and back out of the Bonus Wheel and the Treasure Chest the same way -----------------
	/** The wedge the Bonus Wheel was walked into from, which is where its way out lands. */
	let wheelRoomTarget: number | null = null;
	/** The same for the Treasure Chest. */
	let chestRoomTarget: number | null = null;
	/** Which reveal has the screen on the way out: the room comes down under it, unmoving. */
	let exitCovered: 'chest' | 'wheel' | null = null;

	/** The room's own chest — the last one, grown in the middle of the board — in frame pixels. */
	const roomChestBox = () => {
		const chest = gameEl?.querySelector('.chest.centred')?.getBoundingClientRect();
		if (!gameEl || !chest?.width) return null;
		return { ...centreIn(gameEl.getBoundingClientRect(), chest), size: chest.width / fitScale };
	};

	/**
	 * Asked by the bonus screen as it is about to go: the Bonus Wheel's hub comes up over the screen,
	 * or the Treasure Chest's chest lights it white, so the room can go unseen. False, having done
	 * nothing, for any other way out — a room that was not walked into through its icon keeps the
	 * slide.
	 */
	const coverRoomExit = async (room: RoomSpot): Promise<boolean> => {
		const frame = gameEl ? { w: gameEl.clientWidth, h: gameEl.clientHeight } : null;
		if (room === 'chest') {
			const target = chestRoomTarget;
			chestRoomTarget = null;
			if (target === null || !roomReveal || !frame) return false;
			// Light from the room's chest; failing that, from the middle of the screen.
			const from = roomChestBox() ?? { x: frame.w / 2, y: frame.h / 2, size: frame.w * 0.2 };
			revealIcon = target;
			await roomReveal.cover(from, frame);
			exitCovered = 'chest';
			return true;
		}
		const target = wheelRoomTarget;
		wheelRoomTarget = null;
		const hub = bonusHubBox();
		if (room !== 'bonusWheel' || target === null || !wheelReveal || !frame || !hub) return false;
		revealIcon = target;
		// The hub leaves the room's wheel in the same frame the flying one is laid over it.
		hubLifted = true;
		await wheelReveal.cover(hub, frame);
		exitCovered = 'wheel';
		return true;
	};

	/** The wheel rattling from the chest, or the Bonus Wheel's icon, being slammed back onto it. */
	let wheelShaking = $state(false);
	const WHEEL_SHAKE_MS = 420;
	const shakeWheel = () => {
		wheelShaking = false;
		void tick().then(() => {
			wheelShaking = true;
			setTimeout(() => (wheelShaking = false), WHEEL_SHAKE_MS);
		});
	};

	/** Where the chest waits on the table as the light fades: the middle of the wheel, as it left. */
	const tableChestBox = () => {
		const disc = wheel?.discOnScreen();
		if (!gameEl || !disc?.d) return null;
		return {
			...pointIn(gameEl.getBoundingClientRect(), disc.cx, disc.cy),
			size: (disc.d * REVEAL_CHEST_OF_DISC) / fitScale,
		};
	};

	/** Wedge `index`'s chest, upright and sized by its longer side, in frame pixels. */
	const wedgeChestBox = (index: number) => {
		const icon = wheel?.iconRect(index);
		if (!gameEl || !icon?.width) return null;
		return {
			...centreIn(gameEl.getBoundingClientRect(), icon),
			size: Math.max(icon.width, icon.height) / fitScale,
		};
	};

	const onBonusOpenChange = (open: boolean) => {
		bonusUp = open;
		if (open && restoreIconOnOpen) {
			// The table is out of sight once the screen is over it: the badge can go back unseen.
			restoreIconOnOpen = false;
			setTimeout(() => {
				if (bonusUp) revealIcon = null;
			}, ROOM_SLIDE_MS);
		}
		if (!open) roomEntrance = 'slide';
		if (open) {
			// Give the room its first paint under the cover before the cover lifts off it.
			if (revealLit)
				void tick()
					.then(() => waitForTimeout(150))
					.then(endReveal);
			return;
		}
		if (exitCovered) {
			const by = exitCovered;
			exitCovered = null;
			// The table's first paint back, under the cover, before the icon backs off onto its wedge
			// — whose own badge stays hidden until the icon is on it.
			const target = revealIcon;
			void tick()
				.then(() => waitForTimeout(150))
				.then(() =>
					by === 'chest'
						? roomReveal?.uncover(
								tableChestBox(),
								target === null ? null : wedgeChestBox(target),
								{ w: gameEl?.clientWidth ?? 0, h: gameEl?.clientHeight ?? 0 },
								// The chest hits its wedge: its own badge is back, and the wedge and
								// the whole wheel take the knock.
								() => {
									revealIcon = null;
									if (target !== null) wheel?.slam(target);
									shakeWheel();
								},
							)
						: wheelReveal?.uncover(target === null ? null : wedgeBox(target), () => {
								// Slammed into its wedge, the same knock as the chest's.
								revealIcon = null;
								if (target !== null) wheel?.slam(target);
								shakeWheel();
							}),
				)
				.then(() => {
					revealIcon = null;
					hubLifted = false;
				});
		}
		// The bonus sequence is over: the Top Slot's badge goes with it. With no badge parked, the
		// payout skips the merge and the tile's readout reads the room's total straight away.
		multFlight = null;
		tileMult = null;
		multHidden = false;
	};

	// A replay is watched, never bet on: betting stays shut for the life of the page, which takes
	// the tray, the group buttons, SPIN and Buy Bonus with it.
	const bettingOpen = $derived(idle && !settled && !clearing && !bonusUp && !replayMode);
	// A buy has no chips to choose: the tray and the group buttons go the moment it starts.
	const controlsHidden = $derived(!bettingOpen || stateGame.buying !== null);
	const canSpin = $derived(bettingOpen && currentBet !== null && !stateGame.openRoundError);
	const canReplay = $derived(replayRound !== null && idle && !replayStarting);
	const confirmDisabled = $derived(
		settled ? clearing || payingOut || replayStarting : replayMode ? !canReplay : !canSpin,
	);
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
	const GROW_MS = 80;
	const TRAVEL_MS = 240;
	const SETTLE_MS = 80;
	const FLIGHT_MS = GROW_MS + TRAVEL_MS + SETTLE_MS;
	const SWEEP_WINDOW_MS = 260;
	const SWEEP_FALL_MS = 220;
	const COLLECT_TRAVEL_MS = 560;
	const COLLECT_MERGE_MS = 200;
	const COLLECT_MS = COLLECT_TRAVEL_MS + COLLECT_MERGE_MS;
	const COLLECT_STAGGER_MS = 90;
	const WIN_FLOAT_MS = 1100;
	/** How long the wheel's stop is left to read before the winning tile writes its readout. */
	const PAYOUT_LEAD_MS = 420;
	/** The readout's pop onto the tile. */
	const PAYOUT_POP_MS = 300;
	/** How long the readout stands alone before a Top Slot badge on the same tile joins it. */
	const MERGE_LEAD_MS = 650;
	/** The badge's slide from the tile's corner into the readout. */
	const MERGE_FLY_MS = 420;
	/** The flare the readout gives when the badge lands in it and the total appears. */
	const MERGE_GLOW_MS = 650;
	/** The beat between the multiplier settling (merged or not) and the amount coming up. */
	const WIN_LEAD_MS = 220;
	/** How far each chip in a pile rises over the one under it. A tile only ever holds one chip
	 *  now (tier 0), so this is inert; `.placed-chip` keeps the tier maths for a pile to return. */
	const TIER_RISE_VW = 0.5;
	/** How long the board is given to sweep before its bets are cleared. */
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

	/**
	 * A chip sitting on the tile — the same test that draws its `.placed-chip`. Not `backed`: a tile
	 * is backed the moment it is clicked, while its chip is still in flight.
	 */
	const chipDown = (spot: Spot) =>
		stateGameDerived.isBacked(spot) && !arrivingSpots.has(spot) && !clearing;

	/**
	 * Each tile's motion, played by its icons: a bonus tile does its room's own thing (the chest
	 * rattles, the cannonball hops, the Bonus Wheel's wheel turns, the ship rides a swell) and a
	 * number tile's badges pop. Only on cue: the mouse coming onto the tile, or a chip landing on
	 * it — the latter once its side icons have sprung out to their slots. (`motionOf` and the
	 * lengths live in constants.ts: the wheel and the Top Slot play the same motions.)
	 */
	const TILE_MOTION_MS = ICON_MOTION_MS;
	/** The side icons' small lag behind the centre (`.side .tile-art`). */
	const TILE_MOTION_LAG_MS = 70;
	/** The side icons' spring out to their slots (`.tile.chip-down .tile-icon.side`). */
	const SIDE_SPRING_MS = 380;

	let tileMoving = $state<Partial<Record<Spot, boolean>>>({});
	const tileMotionTimers: Partial<Record<Spot, ReturnType<typeof setTimeout>>> = {};
	const tileMotionClass = (spot: Spot) => (tileMoving[spot] ? motionOf(spot) : 'none');
	const stopTileMotion = (spot: Spot) => {
		clearTimeout(tileMotionTimers[spot]);
		tileMoving[spot] = false;
	};
	/** Plays the tile's motion once through; a cue while it is already playing is let go. */
	const playTileMotion = (spot: Spot) => {
		if (tileMoving[spot]) return;
		tileMoving[spot] = true;
		tileMotionTimers[spot] = setTimeout(
			() => (tileMoving[spot] = false),
			TILE_MOTION_MS[motionOf(spot)] + TILE_MOTION_LAG_MS,
		);
	};
	/** Mouse only: on touch the same tap places a chip, and the landing plays it anyway. */
	const onTileHover = (event: PointerEvent, spot: Spot) => {
		if (event.pointerType === 'mouse') playTileMotion(spot);
	};

	// On a chip landing: whatever the tile was doing is cut short so its icons spring out still, and
	// the motion plays from the start once they are in their slots.
	const chipWasDown: Partial<Record<Spot, boolean>> = {};
	const landTimers: Partial<Record<Spot, ReturnType<typeof setTimeout>>> = {};
	$effect(() => {
		for (const spot of SPOTS) {
			const down = chipDown(spot);
			if (down && !chipWasDown[spot]) {
				stopTileMotion(spot);
				clearTimeout(landTimers[spot]);
				landTimers[spot] = setTimeout(() => {
					if (chipDown(spot)) playTileMotion(spot);
				}, SIDE_SPRING_MS);
			}
			chipWasDown[spot] = down;
		}
	});
	onMount(() => () => {
		for (const spot of SPOTS) {
			clearTimeout(landTimers[spot]);
			clearTimeout(tileMotionTimers[spot]);
		}
	});
	let balanceChipEl: HTMLElement | undefined = $state();
	let buyBonusEl: HTMLElement | undefined = $state();
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

	/**
	 * Fly a chip between the tray and `spot`'s tile. A buy's chip comes from elsewhere: `from` and
	 * `to` stand in for the tray and the tile, and `onLand` fires as the chip is dropped, for
	 * whatever takes its place.
	 */
	const flyChip = (
		spot: Spot,
		kind: 'place' | 'return',
		delay = 0,
		face = currentChipFace(),
		pace = 1,
		opts: { from?: HTMLElement; to?: HTMLElement; onLand?: () => void } = {},
	) => {
		const tray = opts.from ?? chipEls[stateGame.stake];
		const box = opts.to ?? tileEls[spot];
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
		if (opts.onLand) schedule(id, opts.onLand, delay + ms);
		schedule(id, () => dropFlight(id), delay + ms);
		if (opts.from || opts.to) followLanding(id, box, delay + ms);
	};

	/**
	 * A buy's chip takes off as the tray folds away, and the board — pinned to the bottom — slides
	 * down under it. Aimed at where the tile was at take-off, the chip landed short and the placed
	 * chip then jumped to the tile. So its landing is re-read every frame until it touches down.
	 */
	const followLanding = (id: number, box: HTMLElement, forMs: number) => {
		const end = performance.now() + forMs;
		const step = () => {
			const flight = flights.find((f) => f.id === id);
			if (!gameEl || !flight || flight.turned || performance.now() > end) return;
			const to = centreIn(gameEl.getBoundingClientRect(), box.getBoundingClientRect());
			if (Math.abs(to.x - flight.to.x) > 0.5 || Math.abs(to.y - flight.to.y) > 0.5) {
				flights = flights.map((f) => (f.id === id ? { ...f, to } : f));
			}
			requestAnimationFrame(step);
		};
		requestAnimationFrame(step);
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
	// Once the round settles, the winning tile writes the round's readout on itself, in order: the
	// multiplier across its top edge, then a Top Slot badge on the tile merging into it, then the
	// cash it all came to across its bottom. The chip stays one chip — the readout is the only
	// thing that changes on the board. `payoutStage`: 1 = multiplier up, 2 = amount up.
	let payoutStage = $state(0);
	/** The Top Slot badge on the winning tile joining the readout: 0 parked, 1 sliding in, 2 in. */
	let mergeStage = $state(0);
	/** The slide, in the frame's units: how far the badge travels and how much it shrinks. */
	let mergeSlide = $state<{ dx: number; dy: number; scale: number } | null>(null);
	let readoutMultEl: HTMLElement | undefined = $state();
	/** The wheel's own figure for the win: a room's result, or a number's n. A buy is no different —
	 *  the price buys the room for ONE chip, and the room pays that chip. */
	const baseMult = $derived.by(() => {
		const result = stateGame.result;
		if (!result) return 0;
		return isRoomSpot(result.spot) ? (result.roomValue ?? 0) : NUMBER_PAY[result.spot];
	});
	const topMult = $derived(stateGame.result?.multiplier ?? 1);
	/** True while the Top Slot's badge is still parked on the winning tile, waiting to join in. */
	const mergePending = $derived(
		topMult > 1 && tileMult !== null && tileMult.spot === stateGame.result?.spot && mergeStage < 2,
	);
	/** What the tile reads: the wheel's figure until the badge has joined it, then the total. */
	const readoutMult = $derived(mergePending ? baseMult : baseMult * topMult);
	const readoutShown = $derived(payoutStage >= 1 && winCash > 0 && !clearing);
	/**
	 * The win is written in full, so its length runs with the currency: up to READOUT_CHARS it is
	 * set at the readout's own size (a tile holds that many), past that it is scaled to still fit.
	 */
	const READOUT_CHARS = 11;
	const readoutFit = (text: string) => Math.min(1, READOUT_CHARS / text.length).toFixed(3);
	const fmtMult = (value: number) =>
		`${Number.isInteger(value) ? value : value.toFixed(2).replace(/\.?0+$/, '')}x`;

	$effect(() => {
		if (!stateGame.resultReady) {
			payoutStage = 0;
			mergeStage = 0;
			mergeSlide = null;
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
			if (untrack(() => mergePending)) {
				await waitForTimeout(MERGE_LEAD_MS);
				if (cancelled) return;
				await mergeBadge();
				if (cancelled) return;
				await waitForTimeout(MERGE_GLOW_MS);
				if (cancelled) return;
			}
			await waitForTimeout(WIN_LEAD_MS);
			if (cancelled) return;
			payoutStage = 2;
			playSound('pop');
			await waitForTimeout(PAYOUT_POP_MS + 200);
			if (cancelled) return;
			payingOut = false;
		})();
		return () => (cancelled = true);
	});

	/**
	 * The Top Slot's badge leaves the tile's corner and slides into the readout, shrinking to the
	 * readout's size on the way; when it lands, the readout flares and reads the total. Both boxes
	 * are measured through the frame's `zoom`, so the slide is divided back into the frame's units
	 * — the badge moves in those.
	 */
	const mergeBadge = async () => {
		const from = tileMultEl?.getBoundingClientRect();
		const to = readoutMultEl?.getBoundingClientRect();
		if (from && to && from.width && to.width) {
			mergeSlide = {
				dx: (to.left + to.width / 2 - (from.left + from.width / 2)) / fitScale,
				dy: (to.top + to.height / 2 - (from.top + from.height / 2)) / fitScale,
				scale: to.height / from.height,
			};
			mergeStage = 1;
			playSound('whoosh');
			await waitForTimeout(MERGE_FLY_MS);
		}
		mergeStage = 2;
		tileMult = null;
		playSound('merge');
	};

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
		const picks: { spot: Spot; x: number; y: number }[] = [];
		for (const spot of winners) {
			const box = tileEls[spot];
			if (!box) continue;
			const centre = centreIn(host, box.getBoundingClientRect());
			picks.push({ spot, x: centre.x, y: centre.y });
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
		const face = placedChipFace();
		const placed = stateGameDerived.backedSpots();
		const winners = placed.filter((spot) => stateGameDerived.isWinSpot(spot));
		const losers = placed.filter((spot) => !stateGameDerived.isWinSpot(spot));
		const collected = winCash;

		context.eventEmitter.broadcast({ type: 'boardClear' });
		sweepChips(losers, face);
		const collecting = collectChips(winners, face);

		void waitForTimeout(RESULT_CLOSE_MS).then(() => {
			stateGameDerived.clearBets();
			clearing = false;
			landedSpot = null;
			wheelHighlight = null;
			topSlotApplied = false;
			tileMult = null;
			multHidden = false;
			panelDimmed = false;
			if (!revealBy && !exitCovered) revealIcon = null;
		});

		await collecting;
		balanceHold = null;
		if (collected > 0) showWinFloat(collected);
	};

	const onConfirmClick = () => {
		if (confirmDisabled) return;
		playSound('click');
		if (replayMode) void (settled ? replayAgain() : startReplay());
		else if (settled) void finishRound();
		else spin();
	};

	/**
	 * Stake requires the spacebar on the bet button: it presses the gem, SPIN or PLAY AGAIN alike.
	 * It stays out of the way of anything laid over the table (a press there belongs to that
	 * screen), of a field being typed in, and of operators that switch it off.
	 */
	const onSpaceKey = (event: KeyboardEvent) => {
		if ((event.code !== 'Space' && event.key !== ' ') || event.repeat) return;
		if (stateConfig.jurisdiction?.disabledSpacebar) return;
		const target = event.target as HTMLElement | null;
		if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
		if (
			buyBonusOpen ||
			bonusUp ||
			stateGame.menuOpen ||
			stateGame.infoModalOpen ||
			stateGame.quickGuideOpen ||
			isConfirmPromptOpen()
		)
			return;
		// A focused button would also take the space as its own click: the gem gets it, once.
		event.preventDefault();
		if (target instanceof HTMLButtonElement) target.blur();
		onConfirmClick();
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
		// The splash's last step: the game is standing (lib/preloadAssets.ts, `booted`).
		markGameBooted();
		preloadSounds();
		startMusic();
		// Whatever loaded the round (Authenticate online, the dev harness offline) mounted first.
		if (replayMode) loadReplay();
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
		if (!idle || settled || clearing || replayMode) return;
		const wasBacked = stateGameDerived.isBacked(spot);
		if (!stateGameDerived.toggleSpot(spot)) return;
		if (wasBacked) recallChip(spot);
		else flyChip(spot, 'place');
	};

	/** Gap between a bundle's chips, so a group lands as a run rather than a single thud. */
	const BUNDLE_STEP_MS = 60;

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
		// One tap, one undo step.
		const placement = stateGameDerived.newPlacement();
		let moved = 0;
		for (const spot of wanted) {
			if (!stateGameDerived.toggleSpot(spot, placement)) continue;
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
	 *
	 * The game mounts behind the intro splash, which waits for it to stand before fading, so this
	 * also waits for the splash to be gone: otherwise the wheel is already turning, or done, by the
	 * time there is anything to see.
	 */
	let autoStarted = false;
	/** `introLoaderComplete` flips at the START of the splash's fade-out; mirrors `FADE_OUT_MS` there. */
	const SPLASH_HANDOVER_MS = 400;
	$effect(() => {
		if (autoStarted || online || !forcedRoomKind()) return;
		if (!stateGame.introLoaderComplete) return;
		// Everything has to be ready: the machine idle, a chip value in from the bet template, and
		// enough balance to cover a board. Otherwise wait for the next run of this effect.
		if (!bettingOpen || !stakes.length || !stateGame.stake) return;
		if (!stateGameDerived.canBackAnother()) return;
		const timer = setTimeout(() => {
			autoStarted = true;
			toggleBundle(SPOTS);
			// A tick, so the board's new state has reached `canSpin` before the spin asks it.
			void tick().then(spin);
		}, SPLASH_HANDOVER_MS);
		return () => clearTimeout(timer);
	});

	const undoBet = () => {
		stateGameDerived
			.undoBet()
			.forEach((spot, index) => recallChip(spot, index * BUNDLE_STEP_MS));
	};

	// --- Bet Replay (`?replay=true`, ported from the Plinko) -----------------------------------
	// One recorded round, played back through the resume path with no session behind it. The gem
	// is the whole interface: PLAY starts it, PLAY AGAIN runs it once more. The board shows the
	// bet that was made and cannot be touched, and the rail reads Win where the balance would be.
	/** True once the load has been looked at, so "nothing to play" is a failure and not a wait. */
	let replayChecked = $state(false);
	const replayFailed = $derived(replayMode && replayChecked && replayRound === null);
	/** What the round won, in cash, once it has settled: exact, never abbreviated. */
	const replayWin = $derived(settled ? (stateGame.result?.payout ?? 0) * stateBet.betAmount : 0);

	/** The recorded bet goes down on the board, so the wager can be read before PLAY is pressed. */
	const showReplayBoard = (round: ReplayRound) => {
		stateGameDerived.applyResumedSelection(
			[...coverageOf(round.mode)],
			isBuyMode(round.mode) ? round.mode : null,
		);
	};

	const loadReplay = () => {
		seedReplayStake();
		replayRound = takeReplayRound();
		replayChecked = true;
		if (replayRound) showReplayBoard(replayRound);
	};

	const startReplay = async () => {
		const round = replayRound;
		if (!round || !canReplay) return;
		replayStarting = true;
		showReplayBoard(round);
		committedStake = total;
		landedSpot = null;
		wheelHighlight = null;
		topSlotApplied = false;
		multFlight = null;
		tileMult = null;
		multHidden = false;
		panelDimmed = false;
		// A bought single room was played with the wheel off the stage (see `wheelOff`).
		if (isBuyMode(round.mode) && !usesBuyDisc(round.mode)) {
			wheelOff = true;
			await waitForTimeout(WHEEL_LEAVE_MS);
		}
		stageReplayRound(round);
		stateGame.rolling = true;
		replayStarting = false;
		void focusTopSlot();
		context.eventEmitter.broadcast({ type: 'resumeBet' });
	};

	/** PLAY AGAIN: clear the table the way any settled round is cleared, then run it once more. */
	const replayAgain = async () => {
		if (replayStarting) return;
		replayStarting = true;
		const wasBuy = stateGame.buying !== null;
		await finishRound();
		// The board's sweep, and for a buy the white wash back to the full wheel.
		await waitForTimeout(RESULT_CLOSE_MS + (wasBuy ? FLASH_IN_MS + FLASH_OUT_MS + 200 : 60));
		replayStarting = false;
		await startReplay();
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
		// The Top Slot comes down into the middle as the bet goes in, not once the book is back.
		void focusTopSlot();
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

	// --- Menu (top-right): rules, history, how to play, sound and music --------------------------
	const toggleMenu = () => {
		playSound('click');
		stakePanelOpen = false;
		stateGame.menuOpen = !stateGame.menuOpen;
	};

	const openInfo = (tab: InfoModalTab) => {
		playSound('click');
		stateGame.infoModalTab = tab;
		stateGame.infoModalOpen = true;
		stateGame.menuOpen = false;
	};

	/**
	 * Menu → How to Play? opens the 4-page quick guide (the walkthrough shown once after the intro
	 * splash), as it does in the Plinko. The InfoModal's text `howToPlay` tab is left in place but
	 * nothing opens it; restoring it is the commented line below.
	 */
	const openQuickGuide = () => {
		// openInfo('howToPlay');
		playSound('click');
		stateGame.menuOpen = false;
		stateGame.quickGuideOpen = true;
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
		// A yellow chip for the full price goes down on every room the buy can open — whichever
		// opens, the whole price bought it — flown from the Buy Bonus button that bought it, one
		// after another. The reels wait for the last one to land.
		const rooms = BUY_MODES[mode].rooms;
		rooms.forEach((room, i) =>
			flyChip(room, 'place', i * 90, buyChipFace(), 1, { from: buyBonusEl }),
		);
		await waitForTimeout(FLIGHT_MS + (rooms.length - 1) * 90 + 150);
		// Then, for Random Bonus, the wheel flashes white and comes back as the four-wedge disc — or,
		// for a single room, leaves the stage to the Top Slot (see `wheelOff`).
		if (usesBuyDisc(mode)) await swapDisc('buy', mode);
		else {
			wheelOff = true;
			await waitForTimeout(WHEEL_LEAVE_MS);
		}
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
		void focusTopSlot();
		context.eventEmitter.broadcast({ type: 'bet' });
	};

	$effect(() => {
		if (controlsHidden) stakePanelOpen = false;
	});

	$effect(() => {
		if (context.stateXstateDerived.isIdle() && stateGame.rolling) stateGame.rolling = false;
	});

	// Sums are written by game/currency.ts, exact and in the currency's own form. Only a chip's
	// face is abbreviated: it names a denomination, it does not state an amount.
	const fmtChip = (value: number) => (value >= 1000 ? `${value / 1000}k` : `${value}`);
	/** A buy's chip is yellow — the chip art untinted — whatever the tray's denomination. */
	const BUY_CHIP_TEXT = `hsl(${CHIP_BASE_HUE}, 70%, 36%)`;
	/** The chip a buy puts on the room wears the chip the buy was priced in — the price bought the
	 *  room for that one chip, and the room pays that chip — so its face and the readout agree. */
	const buyChipFace = () => ({
		label: fmtChip(stateGame.stake),
		hue: 0,
		text: BUY_CHIP_TEXT,
	});
	/** The face a chip on the board wears: the tray's, or during a buy the buy's yellow one. */
	const placedChipFace = () =>
		stateGame.buying ? buyChipFace() : currentChipFace();

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
	let multFlight = $state<{
		id: number;
		label: string;
		from: Point;
		to: Point;
		/** The reel's own type size, in the frame's units, and the size it has to end at. */
		size: number;
		land: number;
	} | null>(null);
	/** Parked on that tile once it lands, until the board clears — or, on a room, until the bonus
	 *  screen lifts: the room already paid the Top Slot in, so the badge has nothing left to add. */
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
		// The reel's type size is its own, before the cabinet's grow in the middle of the screen
		// (`topSlotMove.k`, a transform), which the copy leaves at when it flies from there.
		const grown = topSlotFocus ? topSlotMove.k : 1;
		const size = ((topSlot?.multFontPx() ?? 0) * grown) / fitScale || land;
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

	/**
	 * The Top Slot takes the floor for its spin. The moment SPIN is pressed the cabinet comes down
	 * off its perch into the middle of the screen, grown, swinging slowly from side to side like a
	 * sign on its ropes; once its pair has been read it goes back up to its place, and it is left
	 * idling with a much smaller sway.
	 *
	 * The move is a transform on a box that has already painted untransformed (it has been on the
	 * table since load), which is what keeps it clear of the iOS first-paint drop that a
	 * transform-scaled box suffers in the Stake Engine iframe. A bought single room has the stage
	 * to the Top Slot already (`wheelOff`): it stays where it is and only swings.
	 */
	let topSlotWrapEl: HTMLElement | undefined = $state();
	let tsSwingEl: HTMLElement | undefined = $state();
	/** In the middle, grown and swinging. */
	let topSlotFocus = $state(false);
	/** Over the wheel rather than under its lap: held until the cabinet is home again. */
	let topSlotRaised = $state(false);
	let topSlotMove = $state({ x: 0, y: 0, k: 1 });
	const TS_FOCUS_MS = 700;
	/**
	 * How much bigger it comes in the middle of the screen, at most — and never wider or taller than
	 * nearly the whole frame. Landscape reaches the full 2.3x; a portrait frame is only as wide as
	 * the cabinet's round size allows, so there it is the width that stops it.
	 */
	const TS_FOCUS_SCALE = 2.3;
	const TS_FOCUS_MAX_W = 0.96;
	const TS_FOCUS_MAX_H = 0.94;
	/** The swing while it has the floor: this far each way, once there and back in this long. */
	const TS_SWING_DEG = 3;
	const TS_SWING_PERIOD_MS = 3400;
	/**
	 * The trip home, the sway on the way, and the judder after it lands (`releaseTopSlot`). The trip
	 * is brisk, three swings on the ropes (`swayHome`) in a second, and picks up at the very end,
	 * into the slam.
	 */
	const TS_HOME_MS = 1000;
	const TS_HOME_SWAY_DEG = 6;
	/**
	 * The swings of the trip home, as where each one peaks (a share of the trip) and how far it goes
	 * (a share of TS_HOME_SWAY_DEG; positive is LEFT, see `swayHome`): left, right, left — the last
	 * a little smaller — and then level for the slam.
	 */
	const TS_HOME_SWINGS: readonly { at: number; amp: number }[] = [
		{ at: 0.25, amp: 1 },
		{ at: 0.55, amp: -1 },
		{ at: 0.82, amp: 0.7 },
	];
	/** Where the third swing begins — the second's peak — which is the wheel's cue to drop... */
	const TS_DROP_SWING_AT = TS_HOME_SWINGS[1].at;
	/** ...a beat into it rather than on it. Short enough for the drop to be done by the slam. */
	const WHEEL_DROP_DELAY_MS = 100;
	/**
	 * The wheel's shrink and drop out of the way (`.wheel-wrap.dropped`), quicker than its other
	 * resizes so it is done before the cabinet lands: third swing (0.55 of the trip) + the delay +
	 * this has to stay under TS_HOME_MS.
	 */
	const WHEEL_DROP_MS = 300;
	const TS_SLAM_SHAKE_MS = 480;
	/** The bounce on landing in the middle, before the reels start (`arriveBounce`). */
	const TS_ARRIVE_MS = 900;
	const TS_ARRIVE_LEAD_MS = 40;

	/** Start, or wind down, the big swing. Run from script so stopping eases out of wherever it is. */
	const swingTopSlot = (on: boolean) => {
		const el = tsSwingEl;
		if (!el) return;
		const now = parseFloat(getComputedStyle(el).rotate) || 0;
		el.getAnimations().forEach((a) => a.cancel());
		if (on) {
			el.animate(
				[
					{ rotate: '0deg' },
					{ rotate: `${TS_SWING_DEG}deg`, offset: 0.25 },
					{ rotate: '0deg', offset: 0.5 },
					{ rotate: `${-TS_SWING_DEG}deg`, offset: 0.75 },
					{ rotate: '0deg' },
				],
				{ duration: TS_SWING_PERIOD_MS, iterations: Infinity, easing: 'linear' },
			);
		} else if (now) {
			el.animate([{ rotate: `${now}deg` }, { rotate: '0deg' }], {
				duration: TS_FOCUS_MS,
				easing: 'ease-out',
			});
		}
	};

	/**
	 * Betting has the wheel to itself: the Top Slot is hauled up out of sight on its ropes and the
	 * wheel grows into its room (`bigWheel`, `wheelBigVw`). Pressing SPIN lets the Top Slot down on
	 * its ropes straight into the middle of the screen, over the still-big wheel, for its spin; only
	 * when it slams back onto its perch does the wheel give the room back, shrinking to its round
	 * size and moving down into place under it (`releaseTopSlot`). It goes back up when betting opens
	 * again.
	 */
	let bigWheel = $state(true);
	let topSlotHidden = $state(true);
	/** The wheel's resize (`.wheel-wrap` width and margin), and its drop out of the way with it. */
	const WHEEL_RESIZE_MS = 500;
	/** Down out of the cabinet's way while it comes home (`releaseTopSlot`), and back up after it. */
	let wheelDropped = $state(false);
	/** The wheel's slide back up into place (`.wheel-wrap`'s `translate` transition). */
	const WHEEL_RISE_MS = 200;
	/** From the cabinet slamming onto its perch to the wheel slamming into place under it. */
	const WHEEL_SLAM_GAP_MS = 250;

	let focusing: Promise<void> | null = null;
	/**
	 * Into the middle. Its perch is out of the flow and the middle is the screen's, so neither depends
	 * on the wheel's size: the wheel is left big until the cabinet goes home (`releaseTopSlot`).
	 *
	 * Resolves once it has ARRIVED — come down into the middle, landed and bounced to a stop on its
	 * ropes, and started swinging — so the reels (`topSlotSpin`) only start on a cabinet that is standing
	 * there. A second call while it is on its way waits for the same arrival.
	 */
	const focusTopSlot = (): Promise<void> => {
		if (focusing) return focusing;
		if (topSlotFocus) return Promise.resolve();
		focusing = (async () => {
			placeTopSlot();
			// The bounce starts a hair before the drop ends, so no frame sits still between them.
			await waitForTimeout(TS_FOCUS_MS - TS_ARRIVE_LEAD_MS);
			// Sent home in the meantime (a refused bet): nothing to land.
			if (!topSlotFocus) return;
			arriveBounce();
			await waitForTimeout(TS_ARRIVE_MS);
			if (topSlotFocus) swingTopSlot(true);
		})().finally(() => (focusing = null));
		return focusing;
	};

	/**
	 * Landed in the middle: it bounces on its ropes, straight up and down — drops past its place,
	 * springs back up above it, and each bounce after is smaller until it hangs still. Gravity in
	 * each hop (eased in on the way down, out on the way up), a squash where it bottoms out and a
	 * stretch as it springs back. No sideways shake: that is the slam home's (`slamShake`). The
	 * bounce is on the swing element's `translate`; the squash on the hanger's `scale`, about its
	 * own middle (the hanger uses `translate` for nothing but being hauled up).
	 */
	let tsHangEl: HTMLElement | undefined = $state();
	const arriveBounce = () => {
		playSound('boom', 1.5, 0.35);
		const down = 'cubic-bezier(0.5, 0, 0.9, 0.5)';
		const up = 'cubic-bezier(0.1, 0.5, 0.5, 1)';
		// The first dip carries on at the speed the drop arrived with and is caught by the ropes at
		// the bottom — it starts fast and slows, rather than starting from rest like the later hops.
		const caught = 'cubic-bezier(0.25, 0.7, 0.55, 1)';
		tsSwingEl?.getAnimations().forEach((a) => a.cancel());
		tsSwingEl?.animate(
			[
				{ translate: '0 0', easing: caught },
				{ translate: '0 7%', offset: 0.12, easing: up },
				{ translate: '0 -6%', offset: 0.34, easing: down },
				{ translate: '0 2.5%', offset: 0.52, easing: up },
				{ translate: '0 -2.5%', offset: 0.68, easing: down },
				{ translate: '0 0.8%', offset: 0.82, easing: up },
				{ translate: '0 -0.6%', offset: 0.92, easing: down },
				{ translate: '0 0' },
			],
			{ duration: TS_ARRIVE_MS },
		);
		tsHangEl?.animate(
			[
				{ scale: '1 1' },
				{ scale: '1.07 0.9', offset: 0.12 },
				{ scale: '0.96 1.05', offset: 0.24 },
				{ scale: '1 1', offset: 0.34 },
				{ scale: '1.03 0.96', offset: 0.52 },
				{ scale: '1 1', offset: 0.64 },
				{ scale: '1 1' },
			],
			{ duration: TS_ARRIVE_MS, easing: 'ease-out' },
		);
	};

	const placeTopSlot = () => {
		if (topSlotFocus) return;
		const rect = topSlotWrapEl?.getBoundingClientRect();
		if (!wheelOff && gameEl && rect?.width) {
			const host = gameEl.getBoundingClientRect();
			const k = Math.min(
				TS_FOCUS_SCALE,
				(host.width * TS_FOCUS_MAX_W) / rect.width,
				(host.height * TS_FOCUS_MAX_H) / rect.height,
			);
			// Landscape: dead centre of the screen. Portrait: the middle of the wheel (still at its
			// betting size — it only moves once the cabinet has gone home), since a phone's own middle
			// falls on the board. Held inside the frame's top edge either way.
			const disc = portrait ? wheel?.discOnScreen() : null;
			const cx = disc?.d ? disc.cx : host.left + host.width / 2;
			const cy = Math.max(
				disc?.d ? disc.cy : host.top + host.height / 2,
				host.top + (rect.height * k) / 2,
			);
			topSlotMove = {
				x: (cx - (rect.left + rect.width / 2)) / fitScale,
				y: (cy - (rect.top + rect.height / 2)) / fitScale,
				k,
			};
		} else topSlotMove = { x: 0, y: 0, k: 1 };
		topSlotFocus = true;
		topSlotRaised = true;
		topSlotHidden = false;
	};

	/**
	 * Back up to its place, and the wheel to its round size under it. Resolves once both are home.
	 *
	 * The two take turns, so neither is drawn across the other until they are both in place: the
	 * cabinet sways home, and a beat into its third swing the wheel shrinks to its round size and slides DOWN
	 * out of its way (`wheelDropped` — clear of the perch by a gap, marker and all); the cabinet is
	 * slammed onto its perch, and a quarter of a second later, while it is still juddering, the
	 * wheel has slid back UP, faster and faster, and is slammed into place under it — its own boom and knock — and only at that impact
	 * does its marker come to lap over the cabinet's lower rail (`topSlotRaised` off).
	 *
	 * With nothing in the middle to bring home (a resumed round) it still has the wheel make room,
	 * and waits for it: the wheel is about to spin.
	 */
	const releaseTopSlot = async () => {
		const wheelToRoundSize = async () => {
			if (!bigWheel || betting) return;
			bigWheel = false;
			if (!wheelOff) await waitForTimeout(WHEEL_RESIZE_MS + 40);
		};
		if (!topSlotFocus) {
			await wheelToRoundSize();
			return;
		}
		const travels = topSlotMove.k !== 1 || topSlotMove.x !== 0 || topSlotMove.y !== 0;
		topSlotFocus = false;
		if (!travels || wheelOff) {
			// A bought room's cabinet never left its place (and its wheel is off the stage): it only
			// stops swinging.
			swingTopSlot(false);
			await Promise.all([waitForTimeout(TS_FOCUS_MS), wheelToRoundSize()]);
			if (!topSlotFocus) topSlotRaised = false;
			return;
		}
		// The cabinet home the hard way: swaying on its ropes, faster and faster at the end (the
		// wrap's return transition is an ease-in, see `.topslot-wrap`), slammed onto its perch, and
		// juddering there.
		swayHome();
		// The wheel waits until a beat into the third swing to get out of the way: to its round size
		// and down, clear of the perch, done before the cabinet arrives.
		const dropAt = TS_HOME_MS * TS_DROP_SWING_AT + WHEEL_DROP_DELAY_MS;
		await waitForTimeout(dropAt);
		if (topSlotFocus) return;
		if (!betting) bigWheel = false;
		wheelDropped = true;
		await waitForTimeout(TS_HOME_MS - dropAt);
		if (topSlotFocus) return;
		playSound('boom', 1.3, 0.5);
		slamShake();
		// Then the wheel, hard on its heels — up into place under it and slammed home a quarter of a
		// second after the cabinet (WHEEL_SLAM_GAP_MS), while the cabinet is still juddering. Its
		// marker is over the rail from the impact on.
		await waitForTimeout(WHEEL_SLAM_GAP_MS - WHEEL_RISE_MS);
		wheelDropped = false;
		await waitForTimeout(WHEEL_RISE_MS);
		if (!topSlotFocus) topSlotRaised = false;
		playSound('boom', 1.1, 0.55);
		shakeWheel();
		await waitForTimeout(WHEEL_SHAKE_MS);
	};

	/**
	 * The trip home: three slow swings on the ropes — left, right, left — each eased at both ends
	 * like a pendulum's, the last a little smaller (`TS_HOME_SWINGS`), and then straight down into
	 * the slam, dead level as it lands. The third sends the wheel down out of the way
	 * (`releaseTopSlot`). The swing turns about a pivot far up the ropes, so a clockwise
	 * (positive) turn carries the cabinet to the LEFT.
	 */
	const swayHome = () => {
		const el = tsSwingEl;
		if (!el) return;
		const now = parseFloat(getComputedStyle(el).rotate) || 0;
		el.getAnimations().forEach((a) => a.cancel());
		const swing = 'ease-in-out';
		el.animate(
			[
				{ rotate: `${now}deg`, easing: swing },
				...TS_HOME_SWINGS.map(({ at, amp }, i) => ({
					rotate: `${TS_HOME_SWAY_DEG * amp}deg`,
					offset: at,
					// The last one comes out of its peak falling, straight into the slam.
					easing: i === TS_HOME_SWINGS.length - 1 ? 'ease-in' : swing,
				})),
				{ rotate: '0deg' },
			],
			{ duration: TS_HOME_MS },
		);
	};

	/**
	 * The judder after the slam: knocked down onto the perch and bounced back up, rocking on its
	 * ropes, each swing smaller than the last. The rock is about the swing's pivot far up the ropes,
	 * so it reads as the cabinet shaken sideways rather than tipped; the bounce is on `translate`,
	 * which the swing element uses for nothing else.
	 */
	const slamShake = () => {
		const el = tsSwingEl;
		if (!el) return;
		el.getAnimations().forEach((a) => a.cancel());
		el.animate(
			[
				{ rotate: '0deg', translate: '0 0' },
				{ rotate: '-1.6deg', translate: '0 5%', offset: 0.1 },
				{ rotate: '1.3deg', translate: '0 -2.5%', offset: 0.26 },
				{ rotate: '-0.9deg', translate: '0 1.5%', offset: 0.42 },
				{ rotate: '0.6deg', translate: '0 -0.8%', offset: 0.58 },
				{ rotate: '-0.3deg', translate: '0 0.35%', offset: 0.76 },
				{ rotate: '0deg', translate: '0 0' },
			],
			{ duration: TS_SLAM_SHAKE_MS, easing: 'ease-out' },
		);
	};

	/**
	 * Betting: the show steps back and the board steps up. Until a bet is down the wheel and the
	 * Top Slot are dimmed and the panel is lit; once one is down the wheel comes back and its
	 * middle — the SPIN gem — glows, which is the next thing to press. A buy has no board to bet
	 * on, and a replay no betting at all.
	 */
	const betting = $derived(bettingOpen && stateGame.buying === null);
	const betDown = $derived(betting && canSpin);

	// Betting again: the Top Slot goes back up out of sight and the wheel grows into its room.
	$effect(() => {
		if (betting && !untrack(() => topSlotFocus)) {
			bigWheel = true;
			topSlotHidden = true;
		}
	});

	// A round that never got as far as the Top Slot (a refused bet) still sends the cabinet home.
	$effect(() => {
		if (idle && untrack(() => topSlotFocus)) void releaseTopSlot();
	});

	context.eventEmitter.subscribeOnMount({
		topSlotSpin: async (event) => {
			// Normally already on its way from the press of SPIN; a resumed round comes straight here.
			await focusTopSlot();
			await topSlot?.spin(event.spot, event.multiplier);
			// Let the pair be read before anything moves again.
			await waitForTimeout(TOP_SLOT_HOLD_MS);
			// The multiplier goes to the board first, straight out of the cabinet in the middle of the
			// screen (a blank is the miss: nothing to carry over), and only once it has landed does
			// the cabinet go home — the trip home counts towards the badge's settle on its tile.
			const { spot, multiplier } = event;
			const carried = spot !== null && multiplier !== null && multiplier > 1;
			if (carried) await flyMultiplier(spot, multiplier);
			await releaseTopSlot();
			if (carried) await waitForTimeout(Math.max(0, MULT_SETTLE_MS - TS_FOCUS_MS));
			// Only now does the board give the floor to the wheel — unless a bought room took the
			// wheel off the stage: nothing spins, so the board stays at full strength and goes
			// straight to the landed room's shadowing.
			if (!wheelOff) panelDimmed = true;
		},
		wheelSpin: async (event) => {
			// The Top Slot is home before the wheel turns (it normally went on its own after its pair).
			await releaseTopSlot();
			// A Random Bonus round spins the buy disc, so the book's 54-segment index maps to the
			// room; every other round spins the main wheel to the segment. A single-room buy has the
			// wheel off the stage: it is set on the room's segment unseen, ready for its return.
			const buying = stateGame.buying;
			if (buying && usesBuyDisc(buying)) await swapDisc('buy', buying);
			const target =
				wheelDisc === 'buy'
					? ROOM_SPOTS.indexOf(event.spot as RoomSpot)
					: mainSegmentFor(event.segment, event.spot);
			if (wheelOff) {
				// Unseen, so there is nothing to wait for: the board shows the result at once.
				wheel?.jumpTo(target);
			} else {
				await wheel?.spinTo(target, { turns: 5, ms: 4600 });
			}
			wheelHighlight = target;
			landedSpot = event.spot;
			topSlotApplied = event.multiplier > 1;
			// The wheel is done; the board comes back to full strength to show what it paid.
			panelDimmed = false;
			playSound(event.covered ? 'merge' : 'pop');
			// The landed wedge's badge does its tile's motion: the chest rattles, the ball hops, the
			// number pops. Not for a wheel off the stage — nobody would see it.
			const landMotionMs = wheelOff ? 0 : TILE_MOTION_MS[motionOf(event.spot)];
			if (!wheelOff) wheel?.playIcon(target, motionOf(event.spot), landMotionMs);
			// Every room is walked into through its own icon (RoomReveal, WheelReveal, PlinkoReveal,
			// VoyageReveal) — when the wheel is on the stage to lift it from. A bought room has the
			// wheel off, so it keeps the plain slide.
			if (isRoomSpot(event.spot) && !wheelOff) {
				// The reveal lifts the badge off the wedge, so it waits for the motion to finish.
				await waitForTimeout(Math.max(400, landMotionMs));
				if (event.spot === 'piratePlinko') {
					if (await dropBall(target)) return;
				} else if (event.spot === 'oceanVoyage') {
					if (await sailShipOff(target)) return;
				} else if (await revealRoom(target, event.spot === 'chest' ? 'chest' : 'wheel')) return;
			}
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

<svelte:window onkeydown={onSpaceKey} />

{#if online}
	<EnableGameActor />
{:else}
	<DevHarness />
{/if}

<!-- The chip art rides in as custom properties so the stylesheet's `url(var(--…))` paints the
     preload's resident copy (lib/preloadAssets.ts); a literal `url('img/…')` in a component
     stylesheet cannot be redirected, and in a production build resolves against the CSS file's own
     folder rather than the game's. -->
<div
	class="viewport-fit"
	style="--fit:{fitScale}; --art-chip-base:{staticCssUrl('img/chip_base.svg')}; --art-chip-yellow:{staticCssUrl('img/chip_yellow.svg')}; --art-tile-frame:{staticCssUrl('img/bet_tile_frame_rectangle.webp')}; --art-bundle-frame:{staticCssUrl('img/bet_tile_frame_circle.webp')}; --art-tile-texture:{staticCssUrl('img/bet_tile_texture.webp')}"
>
	<Background {portrait} />
	<div
		class="game"
		class:portrait
		class:hub-lifted={hubLifted}
		class:hub-slammed={hubSlammed}
		class:ship-arriving={shipArriving}
		style="--wheel-w:{bigWheel ? wheelBigVw : wheelVw}vw; --ts-width:{cabinetVw}vw; --ts-solo:{soloCabinetVw}vw; --wheel-lap:{lapVw}vw; --panel-top:{panelTop}px; --rail-h:{railH}px"
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
				<span class="total-bet-val">{formatMoney(total)}</span>
			</div>
		{/snippet}

		{#if !replayMode}
			<button
				type="button"
				class="buy-bonus-trigger"
				bind:this={buyBonusEl}
				disabled={buyDisabled}
				onclick={openBuyBonus}
				aria-label="Buy bonus"
			>
				<img src={staticUrl('img/buy-bonus/buy-bonus-btn.webp')} alt="" aria-hidden="true" />
			</button>
		{:else}
			<div class="replay-badge" aria-hidden="true">
				<span class="replay-dot"></span>
				REPLAY
			</div>
			{#if replayFailed}
				<div class="bet-notice replay-notice">
					This replay could not be loaded. Check the link and try again.
				</div>
			{/if}
		{/if}

		<!-- The menu, opposite the Buy Bonus badge: rules, history, how to play, sound and music. -->
		<div class="menu-anchor">
			<button
				type="button"
				class="menu-trigger"
				style:background-image={staticCssUrl(
					portrait ? 'img/menu/menu-btn-mobile.webp' : 'img/menu/menu-btn.webp',
				)}
				onclick={toggleMenu}
				aria-label="Menu"
				aria-expanded={stateGame.menuOpen}
			></button>
			{#if stateGame.menuOpen}
				<HudMenuPopup
					soundEnabled={stateGame.soundEnabled}
					onToggleSound={() => (stateGame.soundEnabled = !stateGame.soundEnabled)}
					musicEnabled={stateGame.musicEnabled}
					onToggleMusic={() => (stateGame.musicEnabled = !stateGame.musicEnabled)}
					onOpenRules={() => openInfo('rules')}
					onOpenHistory={() => openInfo('history')}
					onOpenHowToPlay={openQuickGuide}
					onClose={() => (stateGame.menuOpen = false)}
				/>
			{/if}
		</div>

		<div class="hud" bind:this={hudEl}>
			{#if replayMode}
				<!-- No session, so no balance: the rail reads what the round won instead. -->
				<div class="balance-hud">
					<div class="balance-text">
						<span class="hud-lbl">Win</span>
						<span class="hud-val">{formatMoney(replayWin)}</span>
					</div>
				</div>
			{:else}
				{#key balancePulse}
					<div class="balance-hud" class:collected={balancePulse > 0}>
						<div bind:this={balanceChipEl} class="balance-chip" aria-hidden="true"></div>
						<div class="balance-text">
							<span class="hud-lbl">Balance</span>
							<span class="hud-val">{formatBalance(shownBalance)}</span>
						</div>
					</div>
				{/key}
			{/if}
			{@render totalBet()}
		</div>

		<!-- The show: Top Slot over the wheel — or, for a bought room, the Top Slot alone. -->
		<div
			class="stage"
			class:solo={wheelOff}
			class:betting
			class:bet-down={betDown}
			class:big-wheel={bigWheel}
		>
			<div
				class="topslot-wrap"
				class:focus={topSlotFocus}
				class:raised={topSlotRaised}
				style="--ts-x:{topSlotMove.x}px; --ts-y:{topSlotMove.y}px; --ts-k:{topSlotMove.k}; --ts-focus-ms:{TS_FOCUS_MS}ms; --ts-home-ms:{TS_HOME_MS}ms"
				bind:this={topSlotWrapEl}
			>
				<!-- Two sways: the idle one always (CSS), the big one only while it has the floor
				     (script, `swingTopSlot`, so it can ease out of wherever it is). -->
				<!-- Hauled up out of sight while bets are placed, and let down on its ropes for the spin. -->
				<div class="ts-hang" class:up={topSlotHidden} bind:this={tsHangEl}>
					<div class="ts-sway">
						<div class="ts-swing" bind:this={tsSwingEl}>
							<TopSlot
								bind:this={topSlot}
								applied={topSlotApplied}
								onTick={() => playSound('peg', 1.9, 0.5)}
								onReelStop={() => playSound('notify')}
							/>
						</div>
					</div>
				</div>
			</div>
			<div
				class="wheel-wrap"
				class:off={wheelOff}
				class:shaking={wheelShaking}
				class:under-focus={topSlotFocus}
				class:dropped={wheelDropped}
				style="--wheel-rise-ms:{WHEEL_RISE_MS}ms; --wheel-drop-ms:{WHEEL_DROP_MS}ms"
			>
				<Wheel
					bind:this={wheel}
					segments={wheelDisc === 'buy' && buyDisc ? buyDisc : WHEEL_SEGMENTS}
					sizeStep={wheelDisc === 'buy' ? BUY_WHEEL_INK_STEP : undefined}
					flash={wheelFlash}
					frame={WHEEL_FRAME}
					innerRadius={0}
					highlight={wheelHighlight}
					liftedIcon={revealIcon}
					onTick={() => playSound('peg', 1.4, 0.5)}
				/>
				<!-- Once a bet is down the wheel stays dimmed and only its middle lights: the frame art again,
				     undimmed, cut to a circle just past the hub (see `.hub-lit`), then a warm pool over it —
				     the gem is what to press next. -->
				<img class="hub-lit" class:on={betDown} src={WHEEL_FRAME.src} alt="" draggable="false" />
				<div
					class="hub-glow"
					class:on={betDown}
					style="left:{WHEEL_FRAME.hole.cx * 100}%; top:{WHEEL_FRAME.hole.cy * 100}%"
					aria-hidden="true"
				></div>
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
					<span class="hub-cta"
						>{stateGame.rolling || replayStarting
							? '…'
							: settled
								? 'PLAY\nAGAIN'
								: replayMode
									? 'PLAY'
									: 'SPIN'}</span
					>
				</div>
			</div>
		</div>

		<div class="bottom-panel" class:dimmed={panelDimmed} class:lit={betting} bind:this={panelEl}>
			<div class="betting-panel-wrap">
				<div class="betting-panel">
					<div class="inner-panel">
						<!-- Bet board: LuckyWheel's 4x2 tile grid. -->
						<div class="board" style:--chip-row-w={chipRowW ? `${chipRowW}px` : null}>
							<div class="tiles">
								{#each BOARD as spot (spot)}
									{@const backed = stateGameDerived.isBacked(spot)}
									{@const win = stateGameDerived.isWinSpot(spot)}
									{@const landed = stateGameDerived.isLandedSpot(spot)}
									{@const colour = SPOT_COLOUR[spot]}
									{@const iconSrc = isRoomSpot(spot)
										? staticUrl(ROOM_ICON[spot].src)
										: staticUrl(`img/wheel/${NUMBER_PAY[spot]}.png`)}
									<div
										bind:this={tileEls[spot]}
										class="tile"
										class:win
										class:landed={landed && !win}
										class:dimmed={shadowed(spot)}
										class:room={isRoomSpot(spot)}
										class:locked={bettingOpen && !backed && !stateGameDerived.canBackAnother()}
										class:backed
										class:chip-down={chipDown(spot)}
										style="--tile:{colour.base}; --tile-deep:{colour.deep}; --tile-text:{colour.text}"
										onclick={() => toggleSpot(spot)}
										onpointerenter={(event) => onTileHover(event, spot)}
										aria-hidden="true"
									>
										<!-- A tile wears its wedge's icon three times in a row, the middle one
										     biggest — a number its badge, a room its own icon, with no name. -->
										<div
											class="tile-icons"
											class:crest={isRoomSpot(spot)}
											style="--aspect:{isRoomSpot(spot) ? ROOM_ICON[spot].aspect : BADGE_ASPECT}"
										>
											<!-- Each icon's wrapper slides and casts the shadow; the art inside plays the
											     room's idle motion, so a turning icon's shadow stays underneath it. -->
											{#each ['side', 'centre', 'side'] as pos, i (i)}
												<span class="tile-icon" class:side={pos === 'side'}>
													<img
														class="tile-art motion-{tileMotionClass(spot)}"
														src={iconSrc}
														alt=""
														draggable="false"
													/>
												</span>
											{/each}
										</div>

										{#if tileMult?.spot === spot}
											<div
												class="tile-mult mult-badge"
												class:waiting={multHidden}
												class:merging={mergeStage === 1 && mergeSlide !== null}
												style="--dx:{mergeSlide?.dx ?? 0}px; --dy:{mergeSlide?.dy ?? 0}px; --land-scale:{mergeSlide?.scale ?? 1}; --merge-ms:{MERGE_FLY_MS}ms"
												bind:this={tileMultEl}
											>
												<span class="mult-stroke" aria-hidden="true">{tileMult.label}</span>
												<span class="mult-fill">{tileMult.label}</span>
											</div>
										{/if}

										{#if backed && !arrivingSpots.has(spot) && !clearing}
											{@const chipFace = placedChipFace()}
											<div
												class="placed-chip chip"
												style="--tier:0; --rise:{TIER_RISE_VW}vw; --chip-hue:{chipFace.hue}deg; --chip-text:{chipFace.text}"
											>
												<span>{chipFace.label}</span>
											</div>
										{/if}

										<!-- The round's readout, on the tile that paid: the multiplier its chip
										     returned along the top edge, the cash along the bottom. -->
										{#if win && readoutShown}
											<div
												class="tile-readout-mult mult-badge"
												class:merged={mergeStage >= 2}
												style="--pop-ms:{PAYOUT_POP_MS}ms; --glow-ms:{MERGE_GLOW_MS}ms"
												bind:this={readoutMultEl}
												aria-hidden="true"
											>
												<span class="mult-stroke" aria-hidden="true">{fmtMult(readoutMult)}</span>
												<span class="mult-fill">{fmtMult(readoutMult)}</span>
											</div>
											{#if payoutStage >= 2}
												{@const winText = formatMoney(winCash)}
												<div
													class="tile-readout-win win-amount"
													style="--pop-ms:{PAYOUT_POP_MS}ms; --len-fit:{readoutFit(winText)}"
													aria-hidden="true"
												>
													<span class="win-stroke" aria-hidden="true">{winText}</span>
													<span class="win-fill">{winText}</span>
												</div>
											{/if}
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

						<div class="actions-wrap" class:hidden={controlsHidden} bind:this={actionsEl}>
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
				+{formatMoney(winFloat.amount)}
			</div>
		{/if}

		<BonusRound
			chip={stateBet.betAmount}
			{portrait}
			entrance={revealLit ? 'lit' : roomEntrance}
			enter={enterRoom}
			coverExit={coverRoomExit}
			onOpenChange={onBonusOpenChange}
		/>
		<RoomReveal bind:this={roomReveal} />
		<WheelReveal bind:this={wheelReveal} />
		{#if seam}
			<!-- Over the bonus screen and under the balance and the wager, like the screen's own edge. -->
			<div class="seam" bind:this={seamEl} aria-hidden="true">
				<div class="seam-row" style="--seam-h:{seam.h}px; --seam-overlap:{SEAM_OVERLAP}">
					{#each { length: seam.tiles }, i (i)}
						<img
							src={staticUrl('img/pirate-plinko/divider.webp')}
							alt=""
							draggable="false"
							class:mirrored={i % 2 === 1}
						/>
					{/each}
				</div>
			</div>
		{/if}
		<PlinkoReveal bind:this={plinkoReveal} />
		<VoyageReveal bind:this={voyageReveal} />

	</div>
</div>

<BuyBonusModal
	open={buyBonusOpen}
	disabled={buyDisabled}
	onClose={() => (buyBonusOpen = false)}
	onActivate={handleBuyActivate}
/>
<ConfirmPromptModal />

<InfoModal />

<!-- 4-page walkthrough. Opens itself once the intro splash clears, and again from Menu → How to Play?. -->
<QuickGuideModal />

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
		background: var(--art-chip-base) no-repeat center / contain;
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
	/* The clouds on the seam as the camera goes down into Pirate Plinko: a line on the room's top
	   edge, moved and faded by `descend`, with the bank centred on it — on the middle of the
	   clouds' own weight, which sits a little below the middle of the picture. Unseen until the
	   camera moves. */
	.seam {
		position: absolute;
		left: 0;
		right: 0;
		top: 0;
		height: 0;
		z-index: 31;
		opacity: 0;
		pointer-events: none;
	}
	.seam-row {
		position: absolute;
		left: 50%;
		top: 0;
		display: flex;
		transform: translate(-50%, -57%);
	}
	.seam-row img {
		flex: none;
		height: var(--seam-h);
		width: auto;
		aspect-ratio: 2172 / 724;
	}
	.seam-row img + img {
		margin-left: calc(var(--seam-h) * 2172 / 724 * var(--seam-overlap) * -1);
	}
	.seam-row img.mirrored {
		scale: -1 1;
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
	/* Menu button (art from the Plinko), top-right of the table, centred on the badge's line. */
	.menu-anchor {
		position: absolute;
		top: 2.2vw;
		right: 1.6vw;
		z-index: 25;
		width: 4.2vw;
		height: 4.2vw;
	}
	.menu-trigger {
		display: block;
		width: 100%;
		height: 100%;
		padding: 0;
		border: none;
		background: center / contain no-repeat;
		cursor: pointer;
		filter: drop-shadow(0 0.15vw 0.45vw rgba(0, 0, 0, 0.5));
		transition: transform 0.12s ease;
	}
	.menu-trigger:hover {
		transform: scale(1.06);
	}
	.menu-trigger:active {
		transform: scale(0.96);
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
	/* Replay: the badge sits where Buy Bonus would, since there is nothing to buy. */
	.replay-badge {
		position: absolute;
		top: 1.2vw;
		left: 1.2vw;
		z-index: 34;
		display: inline-flex;
		align-items: center;
		gap: 0.6vw;
		padding: 0.5vw 1.1vw;
		border-radius: 999px;
		background: rgba(18, 18, 22, 0.82);
		border: 0.12vw solid #ffe14d;
		color: #ffe14d;
		font-family: 'Alexandria', sans-serif;
		font-size: 0.95vw;
		font-weight: 700;
		letter-spacing: 0.16em;
		box-shadow: 0 0.2vw 1vw rgba(0, 0, 0, 0.45);
		user-select: none;
	}
	.replay-dot {
		width: 0.7vw;
		height: 0.7vw;
		border-radius: 50%;
		background: #ffe14d;
		box-shadow: 0 0 0.6vw #ffe14d;
		animation: replay-pulse 1.2s ease-in-out infinite;
	}
	@keyframes replay-pulse {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.3;
		}
	}
	.replay-notice {
		cursor: default;
	}
	.game.portrait .replay-badge {
		top: 3vw;
		left: 3vw;
		gap: 1.4vw;
		padding: 1.2vw 2.6vw;
		border-width: 0.3vw;
		font-size: 2.4vw;
	}
	.game.portrait .replay-dot {
		width: 1.8vw;
		height: 1.8vw;
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
		/* No stacking context of its own: the wheel (z 1) and the Top Slot on its perch (z 0) stay
		   under the board (z 2) in the frame's context, but the Top Slot in the middle for its spin
		   (`.raised`, z 3) can stand over the board — on a phone the middle of the screen IS the
		   board. */
		pointer-events: none;
	}
	/* The Top Slot cabinet crowns the wheel, in flow above it and centred by the stage. Its own
	   stacking context, so the frame art's z-index stays inside it and the wheel — which laps over
	   the cabinet's lower edge — still paints in front. */
	/* Out of the flow, at the top of the stage and centred: its perch is the same whether the wheel
	   is at its betting size or its round size, so it never pushes the wheel about, and where it
	   goes for its spin is measured from the one place it always is. The wheel keeps the room under
	   it with its own margin (`.wheel-wrap`). */
	.topslot-wrap {
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		width: fit-content;
		margin: 0 auto;
		z-index: 0;
		isolation: isolate;
		translate: 0 0;
		scale: 1;
		/* Registered below so the cabinet GROWS into its solo size rather than jumping to it; the
		   move down to centre rides the same clock. The trip into the middle of the wheel and back
		   is on `translate`/`scale`, over the box it has already painted. */
		/* This is the way HOME (the transition is the state being entered): a slow drift for most of
		   the trip while it sways, then faster and faster at the end, so it arrives at speed and is
		   slammed onto its perch (`releaseTopSlot` shakes it on arrival). */
		transition:
			--ts-width 600ms ease,
			margin-top 600ms ease,
			translate var(--ts-home-ms, 1000ms) cubic-bezier(0.4, 0.12, 0.93, 0.4),
			scale var(--ts-home-ms, 1000ms) cubic-bezier(0.4, 0.12, 0.93, 0.4);
	}
	/* Its turn: in the middle of the wheel, grown, and over the wheel's lap rather than under it
	   (`raised` outlasts `focus` by the trip home, so the lap does not cut across it on the way). */
	.topslot-wrap.focus {
		translate: var(--ts-x, 0px) var(--ts-y, 0px);
		scale: var(--ts-k, 1);
		/* The way in: dropped, not placed — the move gathers speed and arrives still moving, and the
		   landing bounce (`arriveBounce`) takes that speed straight on into its first dip, with no
		   stop in between. The grow is eased out, so it has reached full size by the landing. */
		transition:
			--ts-width 600ms ease,
			margin-top 600ms ease,
			translate var(--ts-focus-ms, 700ms) cubic-bezier(0.45, 0.05, 0.8, 0.5),
			scale var(--ts-focus-ms, 700ms) cubic-bezier(0.3, 0.9, 0.3, 1);
	}
	.topslot-wrap.raised {
		z-index: 3;
	}
	/* Hauled up out of sight: above the frame's top edge by its own height and a little more, on
	   `translate` so it composes with the trip into the middle (on the wrap) — coming down, it drops
	   out of the rigging straight into the middle of the wheel. */
	.ts-hang {
		translate: 0 0;
		/* Let down: falling, faster and faster, into the landing bounce (same curve as the wrap's way in). */
		transition: translate var(--ts-focus-ms, 700ms) cubic-bezier(0.45, 0.05, 0.8, 0.5);
	}
	.ts-hang.up {
		translate: 0 calc(-100% - 3vw);
		transition-timing-function: cubic-bezier(0.5, 0, 0.8, 0.4);
	}
	/* The idle sway: a degree each way, slow. It swings about a point well up its ropes (TopSlot's
	   `.rope`), not about its own rail, so it moves like a sign hung from the rigging rather than
	   rocking in place. Held back a beat after load so the cabinet's first paint is an
	   untransformed one (the iOS first-paint drop again). */
	.ts-sway {
		transform-origin: 50% -150%;
		animation: ts-idle-sway 6s ease-in-out 1.2s infinite alternate both;
		transition: filter 500ms ease;
	}
	@keyframes ts-idle-sway {
		from {
			rotate: -1deg;
		}
		to {
			rotate: 1deg;
		}
	}
	.ts-swing {
		transform-origin: 50% -150%;
	}
	/* Betting: the wheel is dimmed the whole time bets are being placed — once one is down only its
	   middle comes back (`.hub-lit`). While the Top Slot has the floor the wheel stays stepped back
	   behind it. On the wheel itself rather than the wrap, so the gem, its glow and the lit hub,
	   which sit over the wheel inside the wrap, are not dimmed with it. */
	.wheel-wrap :global(.wheel) {
		transition: filter 500ms ease;
	}
	.stage.betting .wheel-wrap :global(.wheel) {
		filter: brightness(0.5) saturate(0.75);
	}
	.wheel-wrap.under-focus :global(.wheel) {
		filter: brightness(0.62) saturate(0.85);
	}
	/* The hub, lit: the frame art laid exactly over the wheel's own (which fills the wheel's box, as
	   this fills the wrap) and cut to a circle about the hole's centre (955.7, 972.8 of 1911x1925).
	   The hub's art ends at r ≈ 290 px of the 1911 and the ring starts at r ≈ 720, so a cut at 330
	   falls on nothing but transparency and leaves no edge anywhere. */
	.hub-lit {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		pointer-events: none;
		user-select: none;
		clip-path: circle(17.2% at 50.01% 50.54%);
		opacity: 0;
		transition: opacity 400ms ease;
	}
	.hub-lit.on {
		opacity: 1;
	}
	/* The light at the wheel's middle once a bet is down: a warm pool screened over the hub, pulsing
	   with the gem's own ring. */
	.hub-glow {
		position: absolute;
		width: 30%;
		aspect-ratio: 1;
		translate: -50% -50%;
		border-radius: 50%;
		pointer-events: none;
		mix-blend-mode: screen;
		background: radial-gradient(
			circle closest-side,
			rgba(255, 240, 180, 0.85) 0%,
			rgba(255, 210, 90, 0.45) 35%,
			rgba(255, 170, 40, 0) 100%
		);
		opacity: 0;
		scale: 0.6;
		transition:
			opacity 400ms ease,
			scale 400ms ease;
	}
	.hub-glow.on {
		opacity: 1;
		scale: 1;
		animation: hub-glow-pulse 1.7s ease-in-out infinite;
	}
	@keyframes hub-glow-pulse {
		0%,
		100% {
			opacity: 0.65;
		}
		50% {
			opacity: 1;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.ts-sway,
		.hub-glow.on {
			animation: none;
		}
	}
	@property --ts-width {
		syntax: '<length>';
		inherits: true;
		initial-value: 0px;
	}
	/* The Top Slot with the stage to itself (a bought room): twice the cabinet, centred in the room
	   above the panel — half of what that room has left once the cabinet's own height (half its
	   width, the art being 2:1) is taken out of it. Scaled in layout, not transform: iOS drops the
	   first paint of a transform-scaled box in the Stake Engine iframe. */
	.stage.solo .topslot-wrap {
		--ts-width: var(--ts-solo, 45vw);
		margin-top: calc((var(--panel-top, 41vw) - 0.4vw - var(--ts-solo, 45vw) / 2) / 2);
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
		/* Under the cabinet's perch (half its width tall — the art is 2:1), lapped over its lower rail
		   only as far as WHEEL_LAP_SHARE says, which keeps the lap a share of the cabinet's height so
		   it tracks the viewport with everything else. A positive margin: the cabinet is out of the
		   flow, so nothing here spends a negative one. */
		margin-top: calc(var(--ts-width, 22.8vw) / 2 - var(--wheel-lap, 1.29vw));
		/* `translate` is the way back UP from `.dropped`: faster and faster, into the slam. */
		transition:
			opacity 400ms ease,
			visibility 0s,
			width 500ms cubic-bezier(0.4, 0, 0.2, 1),
			margin-top 500ms cubic-bezier(0.4, 0, 0.2, 1),
			translate var(--wheel-rise-ms, 200ms) cubic-bezier(0.55, 0, 0.95, 0.45);
	}
	/* Down out of the Top Slot's way while it comes home (`releaseTopSlot`): below its round place by
	   the lap and a gap, so its marker clears the perch. Eased out, alongside the shrink to round
	   size. The slam's shake (`.shaking`) also runs on `translate`, but only once it is back up. */
	.wheel-wrap.dropped {
		translate: 0 calc(var(--wheel-lap, 1.29vw) + var(--wheel-drop-gap, 2vw));
		transition:
			opacity 400ms ease,
			visibility 0s,
			width var(--wheel-drop-ms, 300ms) cubic-bezier(0.4, 0, 0.2, 1),
			margin-top var(--wheel-drop-ms, 300ms) cubic-bezier(0.4, 0, 0.2, 1),
			translate var(--wheel-drop-ms, 300ms) cubic-bezier(0.25, 0.7, 0.4, 1);
	}
	.game.portrait .wheel-wrap.dropped {
		--wheel-drop-gap: 4vw;
	}
	/* Betting: the Top Slot is up out of sight and the wheel has its room — up to the top of the
	   stage, at `wheelBigVw`. */
	.stage.big-wheel .wheel-wrap {
		margin-top: 0;
	}
	/* Off the stage for a bought room: faded out and kept in flow (below the grown cabinet, out of
	   the frame) so its return is the same fade back into place. */
	.wheel-wrap.off {
		opacity: 0;
		visibility: hidden;
		pointer-events: none;
		transition:
			opacity 400ms ease,
			visibility 0s 400ms,
			width 500ms cubic-bezier(0.4, 0, 0.2, 1),
			margin-top 500ms cubic-bezier(0.4, 0, 0.2, 1);
	}
	/* The knock of the Treasure Chest's chest landing back on its wedge. On `translate`, which the
	   wrap uses for nothing else. */
	.wheel-wrap.shaking {
		animation: wheel-shake 420ms linear;
	}
	@keyframes wheel-shake {
		0% {
			translate: 0 0;
		}
		12% {
			translate: 0 0.7vw;
		}
		28% {
			translate: -0.35vw -0.3vw;
		}
		44% {
			translate: 0.3vw 0.25vw;
		}
		60% {
			translate: -0.2vw -0.15vw;
		}
		78% {
			translate: 0.1vw 0.08vw;
		}
		100% {
			translate: 0 0;
		}
	}
	.wheel-wrap.off .hub-spin {
		pointer-events: none;
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
		line-height: 1.05;
		letter-spacing: 0.08vw;
		/* Two words, two lines — PLAY over AGAIN — both centred on the gem. */
		white-space: pre-line;
		text-align: center;
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
	/* Betting: the board is the thing to act on, so it is the lit thing — a shade brighter, on a
	   warm pool of light behind it while the show above it is dimmed. */
	.bottom-panel::before {
		content: '';
		position: absolute;
		inset: -18% -6% -10%;
		z-index: -1;
		pointer-events: none;
		border-radius: 50%;
		background: radial-gradient(
			ellipse closest-side,
			rgba(255, 214, 120, 0.3) 0%,
			rgba(255, 190, 80, 0.14) 55%,
			rgba(255, 170, 60, 0) 100%
		);
		opacity: 0;
		transition: opacity 500ms ease;
	}
	.bottom-panel.lit::before {
		opacity: 1;
	}
	.bottom-panel .betting-panel-wrap {
		transition: filter 500ms ease;
	}
	.bottom-panel.lit .betting-panel-wrap {
		filter: brightness(1.12) saturate(1.05);
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
		--mult-land: 4.3vw;
		/* The board is held well clear of the viewport's edges: the tiles are sized off this, so the
		   margin is set here once rather than tuned into the grid. The chip tray is trimmed to
		   match, since its row would otherwise be the widest thing in the panel. */
		--panel-inset: 6.5vw;
	}
	/* Betting on a tall screen: the grown wheel is centred in the room above the board rather than
	   pinned to the top with a band of empty sea under it. Never above the top: on a short phone the
	   room is less than the wheel, and it simply starts at the top as in landscape. */
	.game.portrait .stage.big-wheel .wheel-wrap {
		margin-top: max(0px, calc((var(--panel-top, 0px) - 0.4vw - var(--wheel-w) * 1.0073) / 2));
	}
	/* The 1vw that used to be the stage's gap between the cabinet and the wheel. */
	.game.portrait .stage:not(.big-wheel) .wheel-wrap {
		margin-top: calc(var(--ts-width, 67vw) / 2 + 1vw - var(--wheel-lap, 1.29vw));
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
		/* The board spans the chip row under it (`--chip-row-w`, measured), so the tiles' outer
		   edges line up with the clear and undo buttons' — never wider than the panel. Until the row
		   is measured, 3.1 times the tile's height stands in. */
		--tile-w: min(
			calc((100vw / var(--fit, 1) - 2 * var(--panel-inset) - var(--tile-gap-x)) / 2),
			calc((var(--chip-row-w, calc(var(--tile-h) * 6.2)) - var(--tile-gap-x)) / 2)
		);
		--tile-h: 14vw;
		--tile-gap-x: 0vw;
		--tile-gap-y: 0vw;
	}
	.game.portrait .tiles {
		grid-template-columns: repeat(2, var(--tile-w));
	}
	/* Two columns of four turns the board's seams from vertical into horizontal: the group buttons
	   ride the row gaps instead, on the one column seam, only overlapping the inner edge of each
	   tile beside it. */
	.game.portrait .bundle-btn {
		top: calc(var(--seam) * var(--tile-h) + (var(--seam) - 0.5) * var(--tile-gap-y));
		left: 50%;
		--bundle-w: 9vw;
	}
	.game.portrait .bundle-btn::before {
		box-shadow:
			var(--inner-shade),
			0 0.4vw 0.9vw rgba(0, 0, 0, 0.55);
	}
	.game.portrait .bundle-lbl {
		font-size: 1.9vw;
		letter-spacing: 0.02vw;
		-webkit-text-stroke: 0.3vw rgba(0, 0, 0, 0.75);
	}
	.game.portrait .tile {
		--frame: 3.1vw;
		gap: 0.35vw;
	}
	.game.portrait .tile-icons {
		--icon-h: 8.91vw;
	}
	.game.portrait .tile-icons.crest {
		--icon-h: 7.56vw;
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
		width: 9.2vw;
		height: 9.2vw;
	}
	.game.portrait .flying-chip {
		margin: -4.6vw 0 0 -4.6vw;
	}
	.game.portrait .tile-mult {
		top: -1.05vw;
		right: -0.92vw;
	}
	.game.portrait .tile-readout-mult {
		top: 0.2vw;
	}
	/* Landscape's readout scaled to the portrait tile (1.3vw on a 4.6vw-tall tile), so
	   READOUT_CHARS still fit across it. */
	.game.portrait .tile-readout-win {
		bottom: 0.5vw;
		font-size: calc(3.95vw * var(--len-fit, 1));
	}
	/* The Buy Bonus badge takes the corner beside the cabinet: 67vw centred leaves 16.5vw either side,
	   and the frame's rope post starts a hair further in, so 2vw + 14.5vw just clears it. */
	.game.portrait .buy-bonus-trigger {
		top: 2vw;
		left: 2vw;
		width: 14.5vw;
		height: 14.5vw;
	}
	/* The menu takes the other corner beside the cabinet, on the badge's centre line. */
	.game.portrait .menu-anchor {
		top: 3.75vw;
		right: 2.75vw;
		width: 11vw;
		height: 11vw;
	}
	.game.portrait .buy-bonus-trigger img {
		filter: drop-shadow(0 0.35vw 1vw rgba(0, 0, 0, 0.5));
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
		background: var(--art-chip-yellow) no-repeat center / contain;
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
		/* How much of their brightness the gold frames keep — tiles and group buttons alike. */
		--frame-shade: 0.47;
		position: relative;
		margin: 0.45vw auto 0;
		width: fit-content;
		--tile-w: 10.4vw;
		--tile-h: 4.6vw;
		/* No grid gap: the frame art carries its own margin outside the bars, so neighbouring
		   frames meet corner to corner with a sliver of backdrop between their bars. */
		--tile-gap-x: 0vw;
		--tile-gap-y: 0vw;
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
	   Sizes are held off the tile metrics so the
	   button keeps its proportion at any fit. */
	.bundle-btn {
		position: absolute;
		top: 50%;
		left: calc(var(--seam) * var(--tile-w) + (var(--seam) - 0.5) * var(--tile-gap-x));
		translate: -50% -50%;
		--bundle-w: 3.7vw;
		width: var(--bundle-w);
		height: var(--bundle-w);
		z-index: 30;
		isolation: isolate;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 50%;
		transition:
			opacity 180ms ease,
			filter 150ms ease,
			transform 150ms ease,
			visibility 260ms;
	}
	/* The pie is a disc tucked under the gold ring (bet_tile_frame_circle): the ring's inner edge
	   sits at 83% of the art's radius and its studs reach the edge, so the disc stops at 88%, under
	   the middle of the band. Its inner shadow matches the tiles': solid over the sliver hidden under
	   the ring (2.5% of the button), then fading in from the ring's inner edge. */
	.bundle-btn::before,
	.bundle-btn::after {
		content: '';
		position: absolute;
		pointer-events: none;
	}
	.bundle-btn::before {
		inset: 6%;
		z-index: -1;
		border-radius: 50%;
		background-image:
			radial-gradient(circle at 50% 50%, #1c0f06 0 36%, rgba(28, 15, 6, 0) 37%), var(--face);
		--inner-shade: inset 0 0 calc(var(--bundle-w) * 0.14) calc(var(--bundle-w) * 0.025)
			rgba(0, 0, 0, 0.6);
		box-shadow:
			var(--inner-shade),
			0 0.15vw 0.35vw rgba(0, 0, 0, 0.55);
		transition: box-shadow 200ms ease;
	}
	/* Hovered while betting: the inner shadow turns into an inner glow of the ring's gold, reaching
	   further in than the shadow did — the same turn the tiles take (`.bottom-panel.lit .tile:hover`). */
	.bottom-panel.lit .bundle-btn:hover::before {
		--inner-shade: inset 0 0 calc(var(--bundle-w) * 0.24) calc(var(--bundle-w) * 0.045)
			rgba(255, 210, 74, 0.9);
	}
	.bundle-btn::after {
		inset: 0;
		background: var(--art-bundle-frame) center / contain no-repeat;
		filter: brightness(var(--frame-shade)) drop-shadow(0 0.08vw 0.12vw rgba(0, 0, 0, 0.5));
		transition: filter 150ms ease;
	}
	/* Fully covered: its ring comes out of the shade, as a backed tile's frame does. */
	.bundle-btn.on::after {
		filter: brightness(1) drop-shadow(0 0.08vw 0.12vw rgba(0, 0, 0, 0.5));
	}
	.bundle-btn:hover {
		filter: brightness(1.15);
		transform: scale(1.06);
	}
	.bundle-btn.hidden {
		opacity: 0;
		visibility: hidden;
		pointer-events: none;
	}
	/* The name sits over the core but is free to run onto the ring — a stroke keeps it legible where
	   it does, and the alternative is type too small to read. */
	.bundle-lbl {
		position: relative;
		z-index: 1;
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
	/* Tiles sit in the gold frame (bet_tile_frame_rectangle) over a solid fill in the spot's own
	   colour, the same flat fill its wedges use on the wheel. The frame is nine-sliced so its corner
	   studs keep their shape at any tile size: `--frame` is the corner's size on screen, and the art's
	   bars run from 0.08 to 0.45 of it — the fill stops under the middle of the bar. The slice is
	   drawn as a zero-width border's image, so it takes no room from the tile's contents. */
	.tile {
		--frame: 1vw;
		--frame-inner: calc(var(--frame) * 0.45);
		--fill-in: calc(var(--frame) * 0.28);
		position: relative;
		isolation: isolate;
		cursor: pointer;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.15vw;
		/* An inner shadow round the fill: four edge fades laid over the colour, solid under the bars
		   (the fill starts beneath them) and fading out from the bars' inner edge. The fade follows
		   0.6·(1 − t)³ rather than a straight line, so it tails off into the fill with no visible
		   edge where it ends. Painted as background, below the frame, so none of it shows past the
		   gold. */
		--shade-from: calc(var(--frame-inner) - var(--fill-in));
		--shade-len: var(--frame);
		/* The edge's colour: black, a shadow — or gold on hover while betting, the same fades turned
		   into an inner glow (see `.bottom-panel.lit .tile:hover`). */
		--shade-stops:
			color-mix(in srgb, var(--edge) 60%, transparent) var(--shade-from),
			color-mix(in srgb, var(--edge) 37%, transparent) calc(var(--shade-from) + var(--shade-len) * 0.15),
			color-mix(in srgb, var(--edge) 21%, transparent) calc(var(--shade-from) + var(--shade-len) * 0.3),
			color-mix(in srgb, var(--edge) 10%, transparent) calc(var(--shade-from) + var(--shade-len) * 0.45),
			color-mix(in srgb, var(--edge) 4%, transparent) calc(var(--shade-from) + var(--shade-len) * 0.6),
			color-mix(in srgb, var(--edge) 0.5%, transparent) calc(var(--shade-from) + var(--shade-len) * 0.8),
			transparent calc(var(--shade-from) + var(--shade-len));
		/* Under the edge shade, two washes set the fill's light over its colour and grain: dimmed
		   while the tile is empty, lifted once a chip sits on it (`.tile.chip-down`). */
		background-image:
			linear-gradient(to bottom, var(--shade-stops)),
			linear-gradient(to top, var(--shade-stops)),
			linear-gradient(to right, var(--shade-stops)),
			linear-gradient(to left, var(--shade-stops)),
			linear-gradient(rgba(255, 255, 255, var(--fill-lift)), rgba(255, 255, 255, var(--fill-lift))),
			linear-gradient(rgba(0, 0, 0, var(--fill-dim)), rgba(0, 0, 0, var(--fill-dim))),
			/* Plank grain over the flat colour, under the shade. Its transparency is baked into the
			   art (bet_tile_texture.webp, 28% alpha): CSS cannot fade one background layer alone. */
			var(--art-tile-texture),
			linear-gradient(var(--tile), var(--tile));
		background-position: center;
		background-size: calc(100% - 2 * var(--fill-in)) calc(100% - 2 * var(--fill-in));
		background-repeat: no-repeat;
		font-family: 'Alexandria', sans-serif;
		color: var(--tile-text);
		--fill-dim: 0.32;
		--fill-lift: 0;
		--edge: #000;
		transition:
			opacity 300ms ease,
			filter 150ms ease,
			transform 150ms ease,
			--fill-dim 250ms ease,
			--fill-lift 250ms ease,
			--edge 200ms ease,
			--shade-len 200ms ease;
	}
	.tile.chip-down {
		--fill-dim: 0;
		--fill-lift: 0.08;
	}
	/* Betting: the board is the lit thing (`.bottom-panel.lit`), so an empty tile shows its fill at
	   full colour too — no dark wash over it. A chip still lifts the fill it lands on. */
	.bottom-panel.lit .tile {
		--fill-dim: 0;
	}
	/* Hovered while betting: the inner shadow turns into an inner glow of gold, the frame's own
	   colour, so the tile under the pointer lights from its edges in. */
	.bottom-panel.lit .tile:hover {
		--edge: #ffd24a;
		/* Reaching further in than the shadow does: most of the shadow's run is under the bars,
		   and a glow that stopped there would barely clear the gold. */
		--shade-len: calc(var(--frame) * 2.2);
	}
	/* Registered so the edge fades from shadow to glow, and grows into the fill, rather than
	   snapping. */
	@property --edge {
		syntax: '<color>';
		inherits: false;
		initial-value: #000;
	}
	@property --shade-len {
		syntax: '<length>';
		inherits: false;
		initial-value: 0px;
	}
	/* Registered so the fill's light fades between empty and backed rather than snapping. */
	@property --fill-dim {
		syntax: '<number>';
		inherits: false;
		initial-value: 0;
	}
	@property --fill-lift {
		syntax: '<number>';
		inherits: false;
		initial-value: 0;
	}
	/* The frame on its own layer, so it can be shaded without the fill. z-index -1 inside
	   the tile's isolation: over the fill, under the badge and name. */
	.tile::before {
		content: '';
		position: absolute;
		inset: 0;
		z-index: -1;
		pointer-events: none;
		border: 0 solid transparent;
		border-image: var(--art-tile-frame) 71 / var(--frame) stretch;
		filter: brightness(var(--frame-shade));
		transition: filter 150ms ease;
	}
	/* A chip on the tile takes its frame out of the shade — the tile's only "backed" mark. A fully
	   covered group button does the same with its ring (`.bundle-btn.on::after`). */
	.tile.backed::before {
		filter: brightness(1);
	}
	.tile:hover {
		filter: brightness(1.15);
	}
	/* Three of the spot's icon in a row, the middle one biggest, all on one centre line. A room's
	   icon is square against a number badge's 30:48, so it runs a little shorter to keep the row
	   inside the frame. Sides are sized in layout, not by transform (iOS drops the first paint of
	   transform-scaled art in the Stake iframe). */
	.tile-icons {
		--icon-h: 3.06vw;
		--icon-side: 0.55;
		/* The row spans the fill inside the frame's bars and spreads its icons evenly: the same space
		   from the frame to a side icon as between each icon. */
		align-self: stretch;
		box-sizing: border-box;
		padding-inline: var(--frame-inner);
		display: flex;
		flex-direction: row;
		align-items: center;
		justify-content: space-evenly;
	}
	.tile-icons.crest {
		--icon-h: 2.7vw;
	}
	/* A hard, unblurred copy of the icon's own silhouette dropped straight down beneath it, so the
	   icon stands up off the planks. The drop scales with the icon, so a side icon's is smaller. */
	.tile-icon {
		--h: var(--icon-h);
		display: block;
		height: var(--h);
		filter: drop-shadow(0 calc(var(--h) * 0.095) 0 rgba(0, 0, 0, 0.6));
	}
	.tile-art {
		display: block;
		height: 100%;
		width: auto;
	}
	.tile-icon:not(.side) {
		position: relative;
		z-index: 1;
	}
	/* The side icons only show while a chip sits on the tile. Otherwise each keeps its slot in the row (so the
	   spacing never shifts) but is slid back behind the centre icon and faded out; a chip landing
	   springs them out to the sides, and lifting it slides them back in behind. The slide is the
	   distance between the two icons' centres, which with the row's even spacing works out to a
	   quarter of (row width + centre icon width) — `--aspect` is the art's width over height. */
	.tile-icon.side {
		--h: calc(var(--icon-h) * var(--icon-side));
		--home: calc(
			(var(--tile-w) - 2 * var(--frame-inner) + var(--icon-h) * var(--aspect)) / 4
		);
		opacity: 0;
		transform: translateX(var(--home));
		transition:
			transform 220ms cubic-bezier(0.55, 0, 0.8, 0.4),
			opacity 120ms ease-in 100ms;
	}
	.tile-icon.side:last-child {
		transform: translateX(calc(-1 * var(--home)));
	}
	/* Keyed to the chip sitting on the tile (the same test that draws `.placed-chip`), not to
	   `backed`: a tile is backed the moment it is clicked, while its chip is still in flight. */
	.tile.chip-down .tile-icon.side {
		opacity: 1;
		transform: none;
		transition:
			transform 380ms cubic-bezier(0.34, 1.56, 0.64, 1),
			opacity 120ms ease-out;
	}
	/* The tiles' motions (see `motionOf`): on the art inside each tile icon's wrapper, played on
	   hover or a chip landing, and on the landed wedge's badge (Wheel's `playIcon`) — global, so
	   the wheel's SVG badges wear the same classes. Each is worked in the icon's own box (`fill-box`
	   for an SVG badge, whose turn onto its wedge sits on the group around it). On a tile the sides
	   lag the centre a beat (TILE_MOTION_LAG_MS), so the three read as a ripple, not a stamp. */
	:global([class^='motion-']),
	:global([class*=' motion-']) {
		transform-box: fill-box;
		/* An SVG element's own default is its viewport's corner, not its middle. */
		transform-origin: 50% 50%;
	}
	.tile-icon.side .tile-art {
		animation-delay: 70ms;
	}
	/* The chest: a rattle on its base, as if something inside wants out. */
	:global(.motion-shake) {
		transform-origin: 50% 90%;
		animation-name: motion-shake;
		animation-duration: 700ms;
		animation-timing-function: ease-in-out;
	}
	@keyframes -global-motion-shake {
		0%,
		100% {
			transform: none;
		}
		12% {
			transform: rotate(-9deg) translateX(-3%);
		}
		26% {
			transform: rotate(8deg) translateX(3%);
		}
		40% {
			transform: rotate(-7deg) translateX(-2%);
		}
		54% {
			transform: rotate(5deg) translateX(2%);
		}
		68% {
			transform: rotate(-3deg);
		}
		82% {
			transform: rotate(1.5deg);
		}
	}
	/* The cannonball: squats, hops, lands with a squash and a smaller second hop. */
	:global(.motion-bounce) {
		transform-origin: 50% 100%;
		animation-name: motion-bounce;
		animation-duration: 850ms;
		animation-timing-function: linear;
	}
	@keyframes -global-motion-bounce {
		0%,
		100% {
			transform: none;
		}
		10% {
			transform: scale(1.12, 0.86);
			animation-timing-function: cubic-bezier(0.2, 0.7, 0.4, 1);
		}
		36% {
			transform: translateY(-32%) scale(0.94, 1.07);
			animation-timing-function: cubic-bezier(0.6, 0, 0.8, 0.4);
		}
		58% {
			transform: scale(1.1, 0.88);
			animation-timing-function: cubic-bezier(0.2, 0.7, 0.4, 1);
		}
		74% {
			transform: translateY(-10%);
			animation-timing-function: cubic-bezier(0.6, 0, 0.8, 0.4);
		}
		88% {
			transform: scale(1.04, 0.96);
		}
	}
	/* The Bonus Wheel's wheel: one full turn, winding up and coasting to a stop. */
	:global(.motion-spin) {
		animation-name: motion-spin;
		animation-duration: 1200ms;
		animation-timing-function: cubic-bezier(0.45, 0, 0.2, 1);
	}
	@keyframes -global-motion-spin {
		from {
			transform: rotate(0deg);
		}
		to {
			transform: rotate(360deg);
		}
	}
	/* The ship: rolls to one side and back as a swell passes under it, rising a touch on the crest,
	   and settles. Pivoted low, on the waterline. */
	:global(.motion-rock) {
		transform-origin: 50% 85%;
		animation-name: motion-rock;
		animation-duration: 2200ms;
		animation-timing-function: ease-in-out;
	}
	@keyframes -global-motion-rock {
		0%,
		100% {
			transform: none;
		}
		20% {
			transform: translateY(-4%) rotate(-11deg);
		}
		45% {
			transform: translateY(-1%) rotate(9deg);
		}
		68% {
			transform: translateY(-3%) rotate(-5deg);
		}
		86% {
			transform: rotate(2deg);
		}
	}
	/* A number's badge: ducks small, springs up past its size, and settles with a wobble. */
	:global(.motion-pop) {
		animation-name: motion-pop;
		animation-duration: 600ms;
		animation-timing-function: ease-in-out;
	}
	@keyframes -global-motion-pop {
		0%,
		100% {
			transform: none;
		}
		18% {
			transform: scale(0.78);
		}
		45% {
			transform: scale(1.18);
		}
		65% {
			transform: scale(0.93);
		}
		83% {
			transform: scale(1.04);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		:global([class^='motion-']),
		:global([class*=' motion-']) {
			animation: none !important;
		}
	}
	/* A backed tile wears no ring of its own — its frame lights instead (see `.tile.backed::before`).
	   A winner wears none either: it stays lit while the rest are shadowed, and its readout says
	   the rest. The landed ring is inset past the frame's bars, onto the fill, so the gold of the
	   art stays whole. */
	.tile.win {
		filter: brightness(1.15);
	}
	.tile.landed {
		outline: 0.2vw solid rgba(255, 255, 255, 0.7);
		outline-offset: calc(-0.2vw - var(--frame-inner));
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
	/* A tile the wheel passed over is shadowed badge and all: the badge stands above the cover and
	   overhangs the tile, so the cover can't reach it — it is darkened by the cover's own amount
	   instead (1 - 0.68), keeping `.mult-badge`'s drop shadow. */
	.tile.dimmed .tile-mult {
		filter: drop-shadow(0.034em 0.068em 0 #000) brightness(0.32);
	}
	/* Laid out but not shown, while the flying copy is still travelling to where it sits. */
	.tile-mult.waiting {
		visibility: hidden;
	}
	/* Joining the readout: slides from the corner into it, shrinking to its size on the way. The
	   slide is measured by Game.svelte when it starts. */
	.tile-mult.merging {
		animation: mult-merge var(--merge-ms, 420ms) cubic-bezier(0.32, 0.72, 0.24, 1) forwards;
	}
	@keyframes mult-merge {
		from {
			translate: 0 0;
			scale: 1;
		}
		to {
			translate: var(--dx) var(--dy);
			scale: var(--land-scale, 0.8);
		}
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
	/* The round's readout on the tile that paid. Both lines are centred on the tile and kept inside
	   it — the multiplier hugs the top edge in the Top Slot's own hand, a touch smaller than the
	   corner badge it will swallow (`mergeBadge`); the cash hugs the bottom edge in `.win-amount`'s
	   gold. Each pops in with `readout-pop` as its payout stage comes up. */
	.tile-readout-mult,
	.tile-readout-win {
		position: absolute;
		left: 50%;
		translate: -50% 0;
		z-index: 503;
		white-space: nowrap;
		pointer-events: none;
		animation: readout-pop var(--pop-ms, 300ms) cubic-bezier(0.22, 1.3, 0.5, 1) both;
	}
	.tile-readout-mult {
		top: 0.05vw;
		font-size: calc(var(--mult-land) * 0.82);
	}
	/* The amount, in the house's cash hand (`.win-amount`, global): only its place and size live
	   here. */
	.tile-readout-win {
		bottom: 0.15vw;
		font-size: calc(1.3vw * var(--len-fit, 1));
	}
	/* The badge has landed in it: the readout swells and flares gold as the total appears, then
	   settles with a glow it keeps. The badge's own hard shadow is carried through the flare. */
	.tile-readout-mult.merged {
		animation: readout-merge var(--glow-ms, 650ms) cubic-bezier(0.22, 1.3, 0.5, 1) both;
	}
	@keyframes readout-merge {
		0% {
			scale: 1;
			filter: drop-shadow(0.034em 0.068em 0 #000) drop-shadow(0 0 0.5em rgba(255, 225, 77, 1))
				brightness(1.7);
		}
		40% {
			scale: 1.4;
			filter: drop-shadow(0.034em 0.068em 0 #000) drop-shadow(0 0 0.8em rgba(255, 225, 77, 1))
				brightness(1.5);
		}
		100% {
			scale: 1;
			filter: drop-shadow(0.034em 0.068em 0 #000) drop-shadow(0 0 0.35em rgba(255, 225, 77, 0.85))
				brightness(1.1);
		}
	}
	@keyframes readout-pop {
		0% {
			opacity: 0;
			scale: 1.35;
		}
		65% {
			opacity: 1;
			scale: 0.94;
		}
		100% {
			opacity: 1;
			scale: 1;
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
