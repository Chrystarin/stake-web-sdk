import { COLOURS, type Colour } from './constants';
import type { GameType } from './types';

export type HistoryEntry = { colours: Colour[] };

export const stateGame = $state({
	gameType: 'basegame' as GameType,
	// The colour the player is backing this round (cosmetic to EV; every colour is identical).
	selectedColour: 'red' as Colour,
	// Concrete colours currently shown on the three dice (null before the first roll).
	dice: [null, null, null] as (Colour | null)[],
	// Number of dice matching the backed colour on the last resolved roll.
	matchCount: 0,
	// Whether a roll animation is currently in flight.
	rolling: false,
	// Whether the last roll has resolved (drives odds-panel win highlight).
	resultReady: false,
	// Recent rolled results, newest last (for the history strip).
	history: [] as HistoryEntry[],
});

const setSelectedColour = (colour: Colour) => {
	if (stateGame.rolling) return;
	stateGame.selectedColour = colour;
};

// winType for an odds panel, matching ColourDice's rate_2x / rate_3x / rate_jp classes.
const winTypeForColour = (colour: Colour): '' | 'rate_2x' | 'rate_3x' | 'rate_jp' => {
	if (!stateGame.resultReady || colour !== stateGame.selectedColour) return '';
	if (stateGame.matchCount === 1) return 'rate_2x';
	if (stateGame.matchCount === 2) return 'rate_3x';
	if (stateGame.matchCount >= 3) return 'rate_jp';
	return '';
};

const isWinColour = (colour: Colour): boolean =>
	stateGame.resultReady && colour === stateGame.selectedColour && stateGame.matchCount >= 1;

const pushHistory = (colours: Colour[]) => {
	stateGame.history = [...stateGame.history, { colours }].slice(-10);
};

export const stateGameDerived = {
	COLOURS,
	setSelectedColour,
	winTypeForColour,
	isWinColour,
	pushHistory,
};
