import { stateBet, stateConfig } from 'state-shared';

import { BUY_MODES, MODE_COVERAGE, SPOTS, buyPrice, modeCost, modeForSpots, type Spot } from './constants';
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

const noneBacked = (): Record<Spot, boolean> =>
	Object.fromEntries(SPOTS.map((spot) => [spot, false])) as Record<Spot, boolean>;

export const stateGame = $state({
	gameType: 'basegame' as GameType,
	// Which spots carry a chip this round. Every one carries the same stake.
	backed: noneBacked(),
	// Spots in the order they were backed: drives undo.
	selectionOrder: [] as Spot[],
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

const resetBoard = () => {
	stateGame.backed = noneBacked();
	stateGame.selectionOrder = [];
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
	const spots = backedSpots();
	stateGame.stake = value;
	resetBoard();
	if (!spots.length || spots.length * value > stateBet.balanceAmount) return [];
	for (const spot of spots) stateGame.backed[spot] = true;
	stateGame.selectionOrder = spots;
	return spots;
};

/** True when another spot can be backed: one is left, and the balance covers it. */
const canBackAnother = (): boolean =>
	!stateGame.rolling &&
	backedCount() < SPOTS.length &&
	(backedCount() + 1) * stateGame.stake <= stateBet.balanceAmount;

const isBacked = (spot: Spot): boolean => stateGame.backed[spot];

/** Back or un-back a spot. Returns false if it could not be backed. */
const toggleSpot = (spot: Spot): boolean => {
	if (stateGame.rolling) return false;
	// A fresh selection after a resolved round starts a new bet.
	if (stateGame.resultReady) resetBoard();

	if (stateGame.backed[spot]) {
		stateGame.backed[spot] = false;
		stateGame.selectionOrder = stateGame.selectionOrder.filter((s) => s !== spot);
		return true;
	}
	if (!canBackAnother()) return false;
	stateGame.backed[spot] = true;
	stateGame.selectionOrder = [...stateGame.selectionOrder, spot];
	return true;
};

/**
 * Put a whole ticket down: the spots it covers, replacing whatever was on the board.
 * Returns the spots now backed (for the chip flights), or [] if it could not be placed.
 */
const selectTicket = (mode: string): Spot[] => {
	if (stateGame.rolling) return [];
	const coverage = MODE_COVERAGE[mode];
	if (!coverage) return [];
	if (coverage.length * stateGame.stake > stateBet.balanceAmount) return [];
	if (stateGame.resultReady) resetBoard();
	stateGame.backed = noneBacked();
	for (const spot of coverage) stateGame.backed[spot] = true;
	stateGame.selectionOrder = [...coverage];
	return [...coverage];
};

const undoBet = () => {
	if (stateGame.rolling) return;
	const last = stateGame.selectionOrder[stateGame.selectionOrder.length - 1];
	if (!last) return;
	stateGame.backed[last] = false;
	stateGame.selectionOrder = stateGame.selectionOrder.slice(0, -1);
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
	for (const spot of previous.spots) stateGame.backed[spot] = true;
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
	selectStake,
	toggleSpot,
	selectTicket,
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
