import { stateBet, stateConfig } from 'state-shared';

import { COLOURS, MAX_COLOURS, modeForCount, type Colour } from './constants';
import { rememberCommittedColours } from './activeRound';
import type { GameType } from './types';
import type { ColourWin } from './typesEmitterEvent';

/**
 * Stake denominations for the chip tray, taken from the RGS bet template.
 *
 * `stateConfig.betAmountOptions` is populated by Authenticate.svelte from the RGS
 * `betLevels` grid, so the tray offers exactly the amounts this operator/currency allows —
 * never a hard-coded ladder that might not be a valid wager. `amount` is submitted unscaled
 * (one mode per colour count, cost does the multiplying), so any option here is bettable.
 */
const stakeOptions = (): number[] => [...(stateConfig.betAmountOptions ?? [])].sort((a, b) => a - b);

const noneBacked = (): Record<Colour, boolean> =>
	Object.fromEntries(COLOURS.map((colour) => [colour, false])) as Record<Colour, boolean>;

export const stateGame = $state({
	gameType: 'basegame' as GameType,
	// Which colours are backed this round. Every one carries the same stake.
	backed: noneBacked(),
	// Colours in the order they were backed — drives undo, and fixes the B1..Bk ordering that
	// book slots resolve against. (Stakes are equal, so the order is arbitrary but must be stable.)
	selectionOrder: [] as Colour[],
	// Stake placed on each backed colour. 0 until the RGS bet template arrives; `ensureValidStake`
	// snaps it onto the published grid.
	stake: 0,
	// Last committed round, for "repeat".
	prevRound: null as { stake: number; colours: Colour[] } | null,
	// Backed colours frozen at roll time. Book slots B1..Bk map onto this, so it must not
	// shift while a roll is in flight even if the board is cleared.
	backedOrder: [] as Colour[],
	// Concrete colours on the three dice (null before the first roll).
	dice: [null, null, null] as (Colour | null)[],
	// Per-colour results for the resolved round — every backed colour that landed pays.
	wins: [] as ColourWin[],
	// What the jackpot paid and which colour took it, once the plinko round has settled it. Held
	// alongside the rest of the result so the board can show the award on the colour that won it.
	jackpot: null as { colour: Colour; multiplier: number } | null,
	rolling: false,
	resultReady: false,
	// Set when an RGS round is stuck open and the server refuses to close it — betting cannot
	// proceed until it clears, so the board says so rather than failing silently.
	openRoundError: '',
});

/**
 * Keep `stake` on the RGS grid, starting from the operator's suggested bet.
 *
 * The bet template only arrives once /wallet/authenticate resolves, so the initial 0 has to
 * be replaced then; this also covers an operator whose grid does not contain whatever was
 * previously selected.
 *
 * Preference order: the RGS `defaultBetLevel` (its suggested opening stake), then the
 * nearest published level to it if it is not itself on the grid, then the cheapest option.
 */
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

const backedColours = (): Colour[] => stateGame.selectionOrder.filter((c) => stateGame.backed[c]);

const backedCount = (): number => backedColours().length;

const totalStake = (): number => backedCount() * stateGame.stake;

const hasBets = (): boolean => backedCount() > 0;

const canRepeat = (): boolean => Boolean(stateGame.prevRound?.colours.length);

/** Live backed ordering for the board as it stands (or the frozen one once resolved). */
const currentBackedOrder = (): Colour[] =>
	stateGame.resultReady && stateGame.backedOrder.length ? stateGame.backedOrder : backedColours();

/**
 * The published mode for the current board and the stake to bet at.
 *
 * `amount` is the per-colour stake, sent verbatim — no scaling — so it is always one of the
 * tray denominations and lands on the RGS betLevels grid by construction.
 */
const currentBet = (): { mode: string; count: number; amount: number; cost: number } | null => {
	const count = backedCount();
	if (!count) return null;
	return { mode: modeForCount(count), count, amount: stateGame.stake, cost: count };
};

const resetBoard = () => {
	stateGame.backed = noneBacked();
	stateGame.selectionOrder = [];
	stateGame.resultReady = false;
	stateGame.wins = [];
	stateGame.jackpot = null;
};

/**
 * Switch the tray denomination, clearing the board as it goes.
 *
 * Every placed chip carries the tray's amount, so a new denomination would silently re-price
 * bets that were already made. Wiping them instead keeps what is on the felt honest: whatever
 * chips are showing were placed at the amount currently in the tray. It also sidesteps a
 * step-up landing over the balance.
 *
 * Returns whether the denomination actually changed, so the caller can animate the clear.
 */
const selectStake = (value: number): boolean => {
	if (stateGame.rolling) return false;
	// Re-picking the amount already in the tray is not a change, and must not cost the player
	// their board — the full bet-level grid offers the current chip alongside the rest.
	if (value === stateGame.stake) return false;
	// Only accept amounts the RGS actually publishes — the tray is built from the same list,
	// so this just guards against a stale value surviving a bet-template change.
	if (!stakeOptions().includes(value)) return false;
	stateGame.stake = value;
	resetBoard();
	return true;
};

/** True when another colour can be backed — one is left, and the balance covers it. */
const canBackAnother = (): boolean =>
	!stateGame.rolling &&
	backedCount() < MAX_COLOURS &&
	(backedCount() + 1) * stateGame.stake <= stateBet.balanceAmount;

const isBacked = (colour: Colour): boolean => stateGame.backed[colour];

/** Back or un-back a colour. Returns false if it could not be backed. */
const toggleColour = (colour: Colour): boolean => {
	if (stateGame.rolling) return false;
	// A fresh selection after a resolved round starts a new bet.
	if (stateGame.resultReady) resetBoard();

	if (stateGame.backed[colour]) {
		stateGame.backed[colour] = false;
		stateGame.selectionOrder = stateGame.selectionOrder.filter((c) => c !== colour);
		return true;
	}
	if (!canBackAnother()) return false;
	stateGame.backed[colour] = true;
	stateGame.selectionOrder = [...stateGame.selectionOrder, colour];
	return true;
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
	if (previous.colours.length * previous.stake > stateBet.balanceAmount) return;
	resetBoard();
	stateGame.stake = previous.stake;
	for (const colour of previous.colours) stateGame.backed[colour] = true;
	stateGame.selectionOrder = [...previous.colours];
};

/**
 * Commit the round: freeze the backed ordering that book slots resolve against, snapshot the
 * board for "repeat", and publish the mode + per-colour stake the RGS will settle on.
 */
const beginRoll = (): boolean => {
	const bet = currentBet();
	if (!bet) return false;
	stateGame.backedOrder = backedColours();
	// Which colours were backed never reaches the RGS, so stash it for a possible resume.
	rememberCommittedColours(stateGame.backedOrder);
	stateGame.prevRound = { stake: stateGame.stake, colours: [...stateGame.backedOrder] };
	stateGame.resultReady = false;
	stateGame.wins = [];
	stateBet.activeBetModeKey = bet.mode;
	stateBet.betAmount = bet.amount;
	return true;
};

/** Result for one colour on the resolved round, or undefined if it did not land. */
const winForColour = (colour: Colour): ColourWin | undefined =>
	stateGame.resultReady ? stateGame.wins.find((win) => win.colour === colour) : undefined;

/**
 * How many of the three dice landed on `colour`.
 *
 * Counted off the DICE rather than off `wins`, so it also covers colours nobody backed: the
 * board reports what every colour did this round, not only what was paid for. `wins` is the
 * settlement and stays the authority on money (see `winForColour`).
 */
const matchesForColour = (colour: Colour): number =>
	stateGame.resultReady ? stateGame.dice.filter((die) => die === colour).length : 0;

/**
 * Badge class for an odds panel (ColourDice's rate_2x / rate_3x / rate_jp).
 *
 * Shown on every colour the dice hit, backed or not — the odds a colour would have paid are
 * the same either way, and the player can see what the unbacked ones were worth.
 */
const rateTypeForColour = (colour: Colour): '' | 'rate_2x' | 'rate_3x' | 'rate_jp' => {
	const matches = matchesForColour(colour);
	if (matches === 1) return 'rate_2x';
	if (matches === 2) return 'rate_3x';
	if (matches >= 3) return 'rate_jp';
	return '';
};

/** True for a colour the dice landed on, whether or not a bet was riding on it. */
const isLandedColour = (colour: Colour): boolean => matchesForColour(colour) > 0;

const isWinColour = (colour: Colour): boolean => Boolean(winForColour(colour));

/**
 * Put the board into the state a resumed round was played with, so the replay lights up the
 * right boxes. Called before playback — the wager is already settled at this point.
 */
const applyResumedSelection = (colours: Colour[]) => {
	stateGame.backed = noneBacked();
	for (const colour of colours) stateGame.backed[colour] = true;
	stateGame.selectionOrder = [...colours];
	stateGame.backedOrder = [...colours];
	stateGame.resultReady = false;
	stateGame.wins = [];
	stateGame.jackpot = null;
};

export const stateGameDerived = {
	COLOURS,
	MAX_COLOURS,
	stakeOptions,
	ensureValidStake,
	backedColours,
	backedCount,
	totalStake,
	hasBets,
	canRepeat,
	canBackAnother,
	isBacked,
	selectStake,
	toggleColour,
	undoBet,
	clearBets,
	repeatBets,
	beginRoll,
	currentBet,
	currentBackedOrder,
	winForColour,
	matchesForColour,
	rateTypeForColour,
	isLandedColour,
	isWinColour,
	applyResumedSelection,
};
