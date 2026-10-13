import { stateBet, stateConfig } from 'state-shared';

import { BUY_MODES, SPOTS, buyPrice, modeCost, modeForSpots, type Spot } from './constants';
import { rememberCommittedSpots } from './activeRound';
import type { GameType } from './types';
import type { RoundResult } from './typesEmitterEvent';

/**
 * Stake denominations for the chip tray, taken from the RGS bet template.
 *
 * `stateConfig.betAmountOptions` is populated by Authenticate.svelte from the RGS `betLevels`
 * grid, so the tray offers exactly the amounts this operator/currency allows. `amount` is
 * submitted unscaled (one chip per covered spot, cost does the multiplying), so any option
 * here is bettable.
 */
const stakeOptions = (): number[] => {
	const grid = [...(stateConfig.betAmountOptions ?? [])].sort((a, b) => a - b);
	// The grid is the template; minBet/maxBet normally just echo its ends. If the RGS ever sends
	// a tighter maxBet than the grid (e.g. a chip trimmed to keep top win x bet under the
	// exposure cap), honour it rather than offer a chip the server would refuse.
	const { minBet, maxBet } = stateConfig;
	const within = grid.filter(
		(value) => (minBet > 0 ? value >= minBet : true) && (maxBet > 0 ? value <= maxBet : true),
	);
	return within.length ? within : grid;
};

/** One pill in a round's My Bet History row. */
export type HistoryChip = {
	/** Pill text, e.g. "X5", "Top Slot x10", "x80". */
	label: string;
	/** Pill background colour. */
	color: string;
};

/** One row per round in My Bet History. */
export type HistoryEntry = {
	date: string;
	/** Total wager for the round: chip x spots covered, or the full price of a buy. */
	bet: number;
	/** Chip value for the round. */
	chip: number;
	/** What was covered: the number of spots, or "Buy" for a bought room. */
	spots: string;
	/** Where the wheel stopped, plus the Top Slot multiplier and the room's result when they applied. */
	chips: HistoryChip[];
	win: number;
};

export type InfoModalTab = 'rules' | 'history' | 'howToPlay';

const noneBacked = (): Record<Spot, boolean> =>
	Object.fromEntries(SPOTS.map((spot) => [spot, false])) as Record<Spot, boolean>;

export const stateGame = $state({
	gameType: 'basegame' as GameType,
	// Which spots carry a chip this round. Every one carries the same stake.
	backed: noneBacked(),
	// Spots in the order they were backed: drives undo.
	selectionOrder: [] as Spot[],
	// The placement each backed spot went down in. Spots sharing an id (a MULTI / ALL / BONUS tap)
	// come off together on undo; a spot with no id comes off alone.
	placement: {} as Partial<Record<Spot, number>>,
	// Chip value. 0 until the RGS bet template arrives; `ensureValidStake` snaps it onto the grid.
	stake: 0,
	// Last committed round, for "repeat".
	prevRound: null as { stake: number; spots: Spot[] } | null,
	// Spots frozen at spin time. The result readouts resolve against this, not the live selection.
	backedOrder: [] as Spot[],
	// The Top Slot pair for the spin in flight / just resolved.
	topSlot: null as { spot: Spot | null; multiplier: number | null } | null,
	// The settled round.
	result: null as RoundResult | null,
	rolling: false,
	resultReady: false,
	// The buy-bonus mode in flight / just resolved, or null for a board bet. A buy has no chips on
	// the board: the round is the room, and `backedOrder` holds the rooms it can open so the
	// landed room reads as covered.
	buying: null as string | null,
	// Set when an RGS round is stuck open and the server refuses to close it.
	openRoundError: '',
	/**
	 * True once the intro preload has every asset in memory (lib/preloadAssets.ts). The layout mounts
	 * <Game> only then, so nothing it renders can be its first fetch of anything — every image is
	 * already a resident `blob:` and every video already holds a decoded frame.
	 */
	assetsReady: false,
	/** True once the intro splash has finished (it flips at the START of the fade-out). */
	introLoaderComplete: false,
	// The top-right menu (HudMenuPopup.svelte) and what it opens (InfoModal.svelte).
	menuOpen: false,
	infoModalOpen: false,
	infoModalTab: 'rules' as InfoModalTab,
	// The 4-page walkthrough (QuickGuideModal.svelte): opens once after the splash, and from How to Play?.
	quickGuideOpen: false,
	// The menu's two switches. Sound gates every effect, music the looping track (game/sound.ts).
	soundEnabled: true,
	musicEnabled: true,
	// This session's rounds, newest first, for My Bet History.
	history: [] as HistoryEntry[],
});

/** Keep `stake` on the RGS grid, starting from the operator's suggested bet. */
const ensureValidStake = () => {
	const options = stakeOptions();
	if (!options.length) return;
	if (options.includes(stateGame.stake)) return;

	const suggested = stateConfig.defaultBetLevel;
	if (suggested > 0) {
		const nearest = options.reduce((best, option) =>
			Math.abs(option - suggested) < Math.abs(best - suggested) ? option : best,
		);
		stateGame.stake = nearest;
		return;
	}
	stateGame.stake = options[0];
};

const backedSpots = (): Spot[] => stateGame.selectionOrder.filter((s) => stateGame.backed[s]);

const backedCount = (): number => backedSpots().length;

const totalStake = (): number => backedCount() * stateGame.stake;

const hasBets = (): boolean => backedCount() > 0;

const canRepeat = (): boolean => Boolean(stateGame.prevRound?.spots.length);

/** Live backed ordering for the board as it stands (or the frozen one once resolved). */
const currentBackedOrder = (): Spot[] =>
	stateGame.resultReady && stateGame.backedOrder.length ? stateGame.backedOrder : backedSpots();

/**
 * The published mode for the current board, or null when the selection is not a ticket.
 *
 * `amount` is the chip, sent verbatim, so it is always one of the tray denominations and lands
 * on the RGS betLevels grid by construction.
 */
const currentBet = (): { mode: string; count: number; amount: number; cost: number } | null => {
	const spots = backedSpots();
	const mode = modeForSpots(spots);
	if (!mode) return null;
	return { mode, count: spots.length, amount: stateGame.stake, cost: modeCost(mode) };
};

let lastPlacement = 0;

/** A fresh placement id, to back several spots as one undoable step. */
const newPlacement = (): number => ++lastPlacement;

const resetBoard = () => {
	stateGame.backed = noneBacked();
	stateGame.selectionOrder = [];
	stateGame.placement = {};
	stateGame.resultReady = false;
	stateGame.result = null;
	stateGame.topSlot = null;
	stateGame.buying = null;
};

/** Total charged for one buy of `mode` at the current chip. */
const buyTotal = (mode: string): number => buyPrice(mode) * stateGame.stake;

const canBuy = (mode: string): boolean =>
	!stateGame.rolling && mode in BUY_MODES && buyTotal(mode) <= stateBet.balanceAmount;

/**
 * Commit a buy: no chips on the board, the rooms the buy can open stand in as the covered spots,
 * and the RGS is told the buy mode with the chip as `amount` (the price is the mode's cost).
 */
const beginBuy = (mode: string): boolean => {
	if (!canBuy(mode)) return false;
	// The buy's rooms carry the chips on the board (the price split across them) and stand in
	// as the covered spots, so the landed room reads as paid and is collected like any winner.
	stateGame.backed = noneBacked();
	for (const room of BUY_MODES[mode].rooms) stateGame.backed[room] = true;
	stateGame.selectionOrder = [...BUY_MODES[mode].rooms];
	stateGame.placement = {};
	stateGame.backedOrder = [...BUY_MODES[mode].rooms];
	rememberCommittedSpots(stateGame.backedOrder);
	stateGame.resultReady = false;
	stateGame.result = null;
	stateGame.topSlot = null;
	stateGame.buying = mode;
	stateBet.activeBetModeKey = mode;
	stateBet.betAmount = stateGame.stake;
	return true;
};

/** True when the balance covers a chip of `value`. The tray greys out every chip it does not. */
const canAffordStake = (value: number): boolean => value <= stateBet.balanceAmount;

/** The biggest tray chip the balance covers, or null when it covers none of them. */
const largestAffordableStake = (): number | null =>
	stakeOptions()
		.filter(canAffordStake)
		.reduce<number | null>((best, value) => (best === null || value > best ? value : best), null);

/**
 * Switch the tray denomination. The board is cleared (every placed chip carries the tray's amount)
 * and the same spots are backed again at the new value, provided the balance covers all of them;
 * otherwise the board stays empty.
 *
 * Returns the spots re-backed at the new value (possibly none), or null if the denomination did
 * not change, so the caller can animate the clear and the re-placement.
 */
const selectStake = (value: number): Spot[] | null => {
	if (stateGame.rolling) return null;
	if (value === stateGame.stake) return null;
	if (!stakeOptions().includes(value)) return null;
	if (!canAffordStake(value)) return null;
	const spots = backedSpots();
	const placement = { ...stateGame.placement };
	stateGame.stake = value;
	resetBoard();
	if (!spots.length || spots.length * value > stateBet.balanceAmount) return [];
	for (const spot of spots) stateGame.backed[spot] = true;
	stateGame.selectionOrder = spots;
	// Same chips at a new value: undo still lifts them in the steps they went down in.
	stateGame.placement = placement;
	return spots;
};

/** True when `spots` is a board the game can bet: nothing yet, or one of the published tickets. */
const isTicket = (spots: readonly Spot[]): boolean =>
	spots.length === 0 || modeForSpots(spots) !== null;

/** True when a chip can go down at all: the round is open and the balance covers one chip. */
const canBackAnother = (): boolean =>
	!stateGame.rolling && stateGame.stake <= stateBet.balanceAmount;

const isBacked = (spot: Spot): boolean => stateGame.backed[spot];

/** What a tap changed, for the chip flights: what came off (most recent first) and what went down. */
export type BoardChange = { lifted: Spot[]; placed: Spot[] };

/**
 * A placement comes off as one piece (a tap on one chip of a MULTI lifts the MULTI; so does
 * Undo). Once a placement has joined the board, any older group whose lifting would leave a
 * board that is not a ticket is folded into it — x1, then MULTI: lifting x1 alone would leave
 * three numbers — so every group on the board can always be lifted on its own.
 */
const foldGroups = (into: number) => {
	const board = backedSpots();
	for (const group of new Set(board.map((spot) => stateGame.placement[spot]))) {
		if (group === into) continue;
		const rest = board.filter((spot) => stateGame.placement[spot] !== group);
		if (!rest.length || isTicket(rest)) continue;
		for (const spot of board) {
			if (stateGame.placement[spot] === group) stateGame.placement[spot] = into;
		}
	}
};

/**
 * Put `spots` down as one placement. The board only ever holds one ticket — a single spot, the
 * four numbers, the four rooms or the whole board — so the new chips join what is there when the
 * two make a ticket together (x1 then MULTI, MULTI then BONUS) and replace it otherwise (x2 on
 * top of x1 moves the chip). Returns what changed, or null when nothing could: the round is in
 * flight, nothing new was asked for, or the balance does not cover the ticket.
 */
const placeSpots = (
	spots: readonly Spot[],
	placement: number = newPlacement(),
): BoardChange | null => {
	if (stateGame.rolling) return null;
	// A fresh selection after a resolved round starts a new bet.
	if (stateGame.resultReady) resetBoard();
	const wanted = spots.filter((spot) => !stateGame.backed[spot]);
	if (!wanted.length) return null;
	const current = backedSpots();
	const joins = isTicket([...current, ...wanted]);
	const kept = joins ? current : current.filter((spot) => spots.includes(spot));
	const lifted = joins ? [] : current.filter((spot) => !spots.includes(spot)).reverse();
	if (!isTicket([...kept, ...wanted])) return null;
	if ((kept.length + wanted.length) * stateGame.stake > stateBet.balanceAmount) return null;
	for (const spot of lifted) {
		stateGame.backed[spot] = false;
		delete stateGame.placement[spot];
	}
	for (const spot of wanted) {
		stateGame.backed[spot] = true;
		stateGame.placement[spot] = placement;
	}
	stateGame.selectionOrder = [
		...stateGame.selectionOrder.filter((spot) => kept.includes(spot)),
		...wanted,
	];
	foldGroups(placement);
	return { lifted, placed: wanted };
};

/**
 * Lift the placement `spot` went down in: the spot alone, or the whole group it was tapped on
 * with (MULTI / ALL / BONUS). Returns what came off, most recent first.
 */
const liftSpot = (spot: Spot): Spot[] => {
	if (stateGame.rolling || !stateGame.backed[spot]) return [];
	const group = stateGame.placement[spot];
	const lifted = stateGame.selectionOrder
		.filter((s) => s === spot || (group !== undefined && stateGame.placement[s] === group))
		.reverse();
	// A board that would not be a ticket without them (chips that went down with no group) all
	// comes off: there is nothing to bet in what is left.
	const rest = stateGame.selectionOrder.filter((s) => !lifted.includes(s));
	if (!isTicket(rest)) lifted.push(...[...rest].reverse());
	for (const s of lifted) {
		stateGame.backed[s] = false;
		delete stateGame.placement[s];
	}
	stateGame.selectionOrder = stateGame.selectionOrder.filter((s) => !lifted.includes(s));
	return lifted;
};

/** Back a spot, or lift the placement it is part of. Returns what changed, or null for nothing. */
const toggleSpot = (spot: Spot): BoardChange | null => {
	if (stateGame.rolling) return null;
	if (stateGame.backed[spot] && !stateGame.resultReady) {
		const lifted = liftSpot(spot);
		return lifted.length ? { lifted, placed: [] } : null;
	}
	return placeSpots([spot]);
};

/**
 * Lift the most recent placement: the last spot backed, plus every spot that went down in the
 * same tap. Returns the lifted spots, most recent first.
 */
const undoBet = (): Spot[] => {
	if (stateGame.rolling) return [];
	const last = stateGame.selectionOrder.at(-1);
	if (!last) return [];
	return liftSpot(last);
};

const clearBets = () => {
	if (stateGame.rolling) return;
	resetBoard();
};

const repeatBets = () => {
	if (stateGame.rolling || !stateGame.prevRound) return;
	const previous = stateGame.prevRound;
	if (previous.spots.length * previous.stake > stateBet.balanceAmount) return;
	resetBoard();
	stateGame.stake = previous.stake;
	// One placement: the repeated ticket comes off as one piece, whatever it is.
	const placement = newPlacement();
	for (const spot of previous.spots) {
		stateGame.backed[spot] = true;
		stateGame.placement[spot] = placement;
	}
	stateGame.selectionOrder = [...previous.spots];
};

/**
 * Commit the round: freeze the backed spots, snapshot the board for "repeat", and publish the
 * mode + chip the RGS will settle on.
 */
const beginSpin = (): boolean => {
	const bet = currentBet();
	if (!bet) return false;
	stateGame.backedOrder = backedSpots();
	rememberCommittedSpots(stateGame.backedOrder);
	stateGame.prevRound = { stake: stateGame.stake, spots: [...stateGame.backedOrder] };
	stateGame.resultReady = false;
	stateGame.result = null;
	stateGame.topSlot = null;
	stateGame.buying = null;
	stateBet.activeBetModeKey = bet.mode;
	stateBet.betAmount = bet.amount;
	return true;
};

/** True for the spot the wheel stopped on, once the round has settled. */
const isLandedSpot = (spot: Spot): boolean =>
	stateGame.resultReady && stateGame.result?.spot === spot;

/** True for the spot that paid: landed AND covered. */
const isWinSpot = (spot: Spot): boolean =>
	isLandedSpot(spot) && Boolean(stateGame.result?.covered) && (stateGame.result?.payout ?? 0) > 0;

/**
 * Put the board into the state a resumed round was played with, so the replay lights up the
 * right tiles. Called before playback; the wager is already settled at this point.
 */
const applyResumedSelection = (spots: Spot[], buying: string | null = null) => {
	stateGame.backed = noneBacked();
	for (const spot of spots) stateGame.backed[spot] = true;
	stateGame.selectionOrder = [...spots];
	stateGame.placement = {};
	stateGame.backedOrder = [...spots];
	stateGame.resultReady = false;
	stateGame.result = null;
	stateGame.topSlot = null;
	stateGame.buying = buying;
};

export const stateGameDerived = {
	SPOTS,
	stakeOptions,
	ensureValidStake,
	backedSpots,
	backedCount,
	totalStake,
	hasBets,
	canRepeat,
	canBackAnother,
	isBacked,
	canAffordStake,
	largestAffordableStake,
	selectStake,
	toggleSpot,
	placeSpots,
	liftSpot,
	isTicket,
	newPlacement,
	undoBet,
	clearBets,
	repeatBets,
	beginSpin,
	buyTotal,
	canBuy,
	beginBuy,
	currentBet,
	currentBackedOrder,
	isLandedSpot,
	isWinSpot,
	applyResumedSelection,
};
