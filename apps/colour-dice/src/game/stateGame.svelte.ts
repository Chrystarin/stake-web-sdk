import { stateBet } from 'state-shared';

import { COLOURS, type Colour } from './constants';
import type { GameType } from './types';

export type HistoryEntry = { colours: Colour[] };
export type Placement = { colour: Colour; amount: number };

// Chip denominations, matching the original ColourDice tray (and the .ch0..ch5 art).
export const CHIPS = [5, 10, 50, 100, 1000, 10000] as const;

const emptyBets = (): Record<Colour, number> =>
	Object.fromEntries(COLOURS.map((colour) => [colour, 0])) as Record<Colour, number>;

export const stateGame = $state({
	gameType: 'basegame' as GameType,
	// Chip stack currently placed on each colour this round (0 = nothing placed).
	bets: emptyBets(),
	// Individual chip placements in order, so "undo" can peel them off one at a time.
	placementHistory: [] as Placement[],
	// Snapshot of the last committed round's bets, so "repeat" can re-lay them.
	prevRoundBets: emptyBets(),
	// Selected chip denomination in the tray.
	activeChip: CHIPS[0] as number,
	// The colour whose match-count drives the settled book multiplier for the round.
	// It is the most-staked colour (ties -> most recently placed). Frozen at roll time
	// so the reveal resolves against a stable reference even if the board is cleared.
	primaryColour: 'red' as Colour,
	// Concrete colours currently shown on the three dice (null before the first roll).
	dice: [null, null, null] as (Colour | null)[],
	// Number of dice matching the primary colour on the last resolved roll.
	matchCount: 0,
	// Whether a roll animation is currently in flight.
	rolling: false,
	// Whether the last roll has resolved (drives odds-panel win highlight + board reset).
	resultReady: false,
	// Recent rolled results, newest last (for the history strip).
	history: [] as HistoryEntry[],
});

const totalBet = (): number => COLOURS.reduce((sum, colour) => sum + stateGame.bets[colour], 0);

const hasBets = (): boolean => totalBet() > 0;

const canRepeat = (): boolean => COLOURS.some((colour) => stateGame.prevRoundBets[colour] > 0);

// Colour carrying the largest stake; ties resolve to the most recently placed colour.
const computePrimaryColour = (): Colour => {
	let best: Colour = stateGame.primaryColour;
	let bestAmount = -1;
	// Walk placements newest-first so the latest colour wins ties.
	const order = [...stateGame.placementHistory].reverse();
	const seen = new Set<Colour>();
	for (const { colour } of order) {
		if (seen.has(colour)) continue;
		seen.add(colour);
		const amount = stateGame.bets[colour];
		if (amount > bestAmount) {
			bestAmount = amount;
			best = colour;
		}
	}
	return best;
};

// Reset the board (called when the player starts building a new round after a result).
const resetBoard = () => {
	stateGame.bets = emptyBets();
	stateGame.placementHistory = [];
	stateGame.resultReady = false;
};

const syncBetAmount = () => {
	stateBet.betAmount = totalBet();
};

const selectChip = (value: number) => {
	if (stateGame.rolling) return;
	stateGame.activeChip = value;
};

// Place the active chip on a colour. Returns false if it would exceed the balance.
const placeChip = (colour: Colour): boolean => {
	if (stateGame.rolling) return false;
	// A fresh placement after a resolved round starts a new bet.
	if (stateGame.resultReady) resetBoard();
	if (totalBet() + stateGame.activeChip > stateBet.balanceAmount) return false;
	stateGame.bets[colour] += stateGame.activeChip;
	stateGame.placementHistory.push({ colour, amount: stateGame.activeChip });
	syncBetAmount();
	return true;
};

const undoBet = () => {
	if (stateGame.rolling) return;
	const last = stateGame.placementHistory.pop();
	if (!last) return;
	stateGame.bets[last.colour] = Math.max(0, stateGame.bets[last.colour] - last.amount);
	syncBetAmount();
};

const clearBets = () => {
	if (stateGame.rolling) return;
	resetBoard();
	syncBetAmount();
};

const repeatBets = () => {
	if (stateGame.rolling || !canRepeat()) return;
	resetBoard();
	for (const colour of COLOURS) {
		const amount = stateGame.prevRoundBets[colour];
		if (amount > 0) {
			stateGame.bets[colour] = amount;
			stateGame.placementHistory.push({ colour, amount });
		}
	}
	syncBetAmount();
};

// Called the moment the player commits the round: freeze the primary colour, snapshot
// the board for "repeat", and publish the total as the wager.
const beginRoll = () => {
	stateGame.primaryColour = computePrimaryColour();
	stateGame.prevRoundBets = { ...stateGame.bets };
	// Drop the previous round's win highlights the instant a new roll is committed.
	stateGame.resultReady = false;
	syncBetAmount();
};

// Colour that will (or did) drive the settled multiplier: the most-staked colour.
// Before a roll it reflects the live board; once frozen at roll time it is `primaryColour`.
const currentPrimaryColour = (): Colour =>
	stateGame.resultReady ? stateGame.primaryColour : computePrimaryColour();

// winType badge for an odds panel (ColourDice's rate_2x / rate_3x / rate_jp classes).
// Only the primary colour is badged, because only its match-count is actually paid — its
// dice count equals `matchCount`, which drives the settled book multiplier. Badging a
// non-paying colour would imply a payout the player never receives.
const winTypeForColour = (colour: Colour): '' | 'rate_2x' | 'rate_3x' | 'rate_jp' => {
	if (!stateGame.resultReady || colour !== stateGame.primaryColour) return '';
	if (stateGame.matchCount === 1) return 'rate_2x';
	if (stateGame.matchCount === 2) return 'rate_3x';
	if (stateGame.matchCount >= 3) return 'rate_jp';
	return '';
};

const isWinColour = (colour: Colour): boolean =>
	stateGame.resultReady && colour === stateGame.primaryColour && stateGame.matchCount >= 1;

// Non-paying backed colours that still happened to land — shown as a neutral "you called
// it" glow (no multiplier badge), so the board stays lively without implying a payout.
const isBackedHit = (colour: Colour): boolean =>
	stateGame.resultReady &&
	colour !== stateGame.primaryColour &&
	stateGame.bets[colour] > 0 &&
	stateGame.dice.includes(colour);

const pushHistory = (colours: Colour[]) => {
	stateGame.history = [...stateGame.history, { colours }].slice(-10);
};

export const stateGameDerived = {
	COLOURS,
	CHIPS,
	totalBet,
	hasBets,
	canRepeat,
	selectChip,
	placeChip,
	undoBet,
	clearBets,
	repeatBets,
	beginRoll,
	currentPrimaryColour,
	winTypeForColour,
	isWinColour,
	isBackedHit,
	pushHistory,
};
