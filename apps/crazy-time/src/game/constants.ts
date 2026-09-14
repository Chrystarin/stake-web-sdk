// Mirrors games/crazy_time/crazy_time_data.py in stake-math-sdk. Keep the two in sync.

// ---------------------------------------------------------------------------
// Spots
// ---------------------------------------------------------------------------
export const NUMBER_SPOTS = ['x1', 'x2', 'x5', 'x10'] as const;
export const ROOM_SPOTS = ['piratePlinko', 'bonusWheel', 'chest', 'oceanVoyage'] as const;
export const SPOTS = [...NUMBER_SPOTS, ...ROOM_SPOTS] as const;

export type NumberSpot = (typeof NUMBER_SPOTS)[number];
export type RoomSpot = (typeof ROOM_SPOTS)[number];
export type Spot = (typeof SPOTS)[number];

export const isRoomSpot = (spot: Spot): spot is RoomSpot =>
	(ROOM_SPOTS as readonly string[]).includes(spot);

export const isSpot = (value: unknown): value is Spot =>
	typeof value === 'string' && (SPOTS as readonly string[]).includes(value);

/** n:1 payout of a number spot. x1 pays 1:1, so a hit returns 2x the chip. */
export const NUMBER_PAY: Record<NumberSpot, number> = { x1: 1, x2: 2, x5: 5, x10: 10 };

/** Player-facing names. */
export const SPOT_LABEL: Record<Spot, string> = {
	x1: 'X1',
	x2: 'X2',
	x5: 'X5',
	x10: 'X10',
	piratePlinko: 'PIRATE PLINKO',
	bonusWheel: 'BONUS WHEEL',
	chest: 'TREASURE CHEST',
	oceanVoyage: 'OCEAN VOYAGE',
};

/**
 * Badge art per bonus room, drawn on the wheel's label ring, on the bet tile and on the Top Slot's
 * reel — so a room is the same picture everywhere it appears. Each file is named for the room it
 * belongs to rather than for what it happens to be a picture of, so swapping the art is a swap of
 * one file and nothing else. Paths are relative to `static/`; the caller wraps them, because this
 * file is plain data and knows nothing about how assets resolve. `aspect` is width over height of
 * the file, which is what the wheel sizes its badge box from — so it has to be re-read whenever the
 * art is. All four are square today.
 */
export const ROOM_ICON: Record<RoomSpot, { src: string; aspect: number }> = {
	piratePlinko: { src: 'img/wheel/pirate-plinko.png', aspect: 1 },
	bonusWheel: { src: 'img/wheel/bonus-wheel.png', aspect: 1 },
	chest: { src: 'img/wheel/chest.png', aspect: 1 },
	oceanVoyage: { src: 'img/wheel/ocean-voyage.png', aspect: 1 },
};

/** Tile / segment palette. Number spots follow the LuckyWheel reference art (steel, gold, rose, violet). */
export const SPOT_COLOUR: Record<Spot, { base: string; deep: string; text: string }> = {
	x1: { base: '#5f8fb3', deep: '#2f5f84', text: '#dff3ff' },
	x2: { base: '#d9a62a', deep: '#9a6d0c', text: '#fff4cc' },
	x5: { base: '#d67b91', deep: '#9a3d55', text: '#ffe3ea' },
	x10: { base: '#7f6ec7', deep: '#4a3b91', text: '#ece6ff' },
	piratePlinko: { base: '#2b8fd6', deep: '#135a8f', text: '#e2f3ff' },
	bonusWheel: { base: '#c8352f', deep: '#7d1a17', text: '#ffe6e4' },
	chest: { base: '#2f9e5b', deep: '#176437', text: '#e3ffe9' },
	oceanVoyage: { base: '#7a3aa8', deep: '#4b1f6e', text: '#f3e4ff' },
};

// ---------------------------------------------------------------------------
// Wheel
// ---------------------------------------------------------------------------
/**
 * Physical order around the rim, clockwise from the flapper. 54 entries: x1 21, x2 13, x5 7,
 * x10 4, chest 4, piratePlinko 2, oceanVoyage 2, bonusWheel 1 (Crazy Time's own split). One room
 * every six segments, so exactly five numbers sit between any two rooms: chests every 12, Pirate
 * Plinko and Ocean Voyage opposite pairs, the Bonus Wheel on its own.
 */
export const SEGMENT_LAYOUT: readonly Spot[] = [
	'chest', 'x1', 'x2', 'x1', 'x5', 'x2',
	'piratePlinko', 'x1', 'x10', 'x1', 'x2', 'x1',
	'chest', 'x2', 'x1', 'x5', 'x1', 'x2',
	'oceanVoyage', 'x1', 'x2', 'x1', 'x5', 'x1',
	'chest', 'x1', 'x10', 'x2', 'x1', 'x2',
	'piratePlinko', 'x1', 'x5', 'x1', 'x2', 'x1',
	'chest', 'x2', 'x1', 'x10', 'x1', 'x5',
	'oceanVoyage', 'x1', 'x2', 'x1', 'x5', 'x2',
	'bonusWheel', 'x1', 'x10', 'x2', 'x1', 'x5',
]; // prettier-ignore

export const NUM_SEGMENTS = SEGMENT_LAYOUT.length;

export const SEGMENT_COUNT: Record<Spot, number> = Object.fromEntries(
	SPOTS.map((spot) => [spot, SEGMENT_LAYOUT.filter((s) => s === spot).length]),
) as Record<Spot, number>;

// ---------------------------------------------------------------------------
// Top Slot
// ---------------------------------------------------------------------------
/** Right-reel multipliers, in reel order. */
export const TOP_SLOT_MULTS = [2, 3, 4, 5, 7, 10, 15, 20, 25, 50] as const;

// ---------------------------------------------------------------------------
// Bonus rooms
// ---------------------------------------------------------------------------
/** Pirate Plinko landing slots, left to right (before any Top Slot multiplier). */
export const PLINKO_SLOTS = [400, 100, 50, 30, 20, 12, 7, 12, 20, 30, 50, 100, 400] as const;
/**
 * Rows the math walks the ball down. The front end no longer draws them — the jackpot board
 * derives its own row count from the pocket ladder (see `src/plinko`) — but this stays because
 * the file mirrors the math, and the math still has them.
 */
export const PLINKO_ROWS = 12;

/**
 * Bonus Wheel wedge values in rim order. The 1,000x wedge under a 50x Top Slot is the game's
 * 50,000x max win; mirror of the math's WHEEL_LAYOUT.
 */
export const WHEEL_LAYOUT = [
	1000, 10, 15, 20, 10, 10, 25, 15, 10, 20, 15, 10, 100, 10, 15, 20, 10, 10,
	25, 15, 10, 20, 15, 10, 50, 10, 15, 20, 10, 10, 25, 15, 10, 20, 15, 10,
] as const; // prettier-ignore

export const NUM_CHESTS = 12;

/** Ocean Voyage depth multipliers, shallowest to deepest. */
export const VOYAGE_DEPTHS = [2, 3, 5, 8, 12, 20, 35, 60, 120, 400] as const;
export const TILES_PER_DEPTH = 4;

/** Seconds the player has to make a pick in a pick room before it is made for them. */
export const PICK_SECONDS = 15;

// ---------------------------------------------------------------------------
// Modes: one per combination of spots
// ---------------------------------------------------------------------------
export const RTP = 0.967;

/**
 * Short code per spot. A mode name is the covered spots' codes joined in SPOTS order, e.g. `x1`
 * (one spot), `pp_bw_tc_ov` (all four rooms), `x1_x2_x5_x10_pp_bw_tc_ov` (the full board).
 * The math derives the same name (`crazy_time_data.mode_name`), so the two must never diverge.
 */
export const SPOT_CODE: Record<Spot, string> = {
	x1: 'x1',
	x2: 'x2',
	x5: 'x5',
	x10: 'x10',
	piratePlinko: 'pp',
	bonusWheel: 'bw',
	chest: 'tc',
	oceanVoyage: 'ov',
};

/** Stake wants a base mode to pay at least once in this many spins. */
export const MIN_HIT_RATE = 20;

/** The mode name for a set of spots, whether or not it is published. */
export const modeName = (spots: readonly Spot[]): string =>
	SPOTS.filter((spot) => spots.includes(spot))
		.map((spot) => SPOT_CODE[spot])
		.join('_');

const clearsHitRate = (spots: readonly Spot[]): boolean =>
	spots.reduce((sum, spot) => sum + SEGMENT_COUNT[spot], 0) * MIN_HIT_RATE >= NUM_SEGMENTS;

/**
 * Every published mode: each non-empty combination of the eight spots that clears the hit-rate
 * floor, at ONE chip per spot. `cost` is the number of spots and the RGS charges cost x amount.
 *
 * 252 of the 255 combinations. The three that are not published are the one-spot bets on the
 * rooms with 2 or 1 segments (Pirate Plinko, Ocean Voyage, Bonus Wheel): fewer than 3 of 54 segments
 * pays less than once in 20 spins, which Stake does not accept for a base mode. Any combination
 * that includes one of those rooms with anything else is fine.
 */
export const MODE_COVERAGE: Record<string, readonly Spot[]> = (() => {
	const modes: Record<string, readonly Spot[]> = {};
	const n = SPOTS.length;
	for (let mask = 1; mask < 1 << n; mask++) {
		const spots = SPOTS.filter((_, i) => mask & (1 << i));
		if (clearsHitRate(spots)) modes[modeName(spots)] = spots;
	}
	return modes;
})();

export const MODE_NAMES: readonly string[] = Object.keys(MODE_COVERAGE);

/** Spots that cannot be bet on their own (hit-rate floor); they need company on the board. */
export const UNPUBLISHED_ALONE: readonly Spot[] = SPOTS.filter((spot) => !clearsHitRate([spot]));

/** Combinations offered as one-tap buttons on the board. */
export const BUNDLE_MODES: readonly { mode: string; label: string }[] = [
	{ mode: modeName([...ROOM_SPOTS]), label: 'ALL BONUS' },
	{ mode: modeName([...SPOTS]), label: 'FULL BOARD' },
];

// ---------------------------------------------------------------------------
// Buy-bonus modes
// ---------------------------------------------------------------------------
/**
 * A buy skips the wheel and opens a room straight away, at the room's natural odds of also
 * carrying a Top Slot multiplier. Four per-room buys and one "any bonus" buy that lands on a room
 * the way the wheel would (weighted by segments).
 *
 * Price, in chips, mirrors the math (`crazy_time_data.buy_price`): rooms x 54 / segments covered.
 * Every spot returns the target RTP on one chip, so a room's mean return per hit is
 * RTP x 54 / segments, and charging 54 / segments chips returns the same RTP. That gives Pirate
 * Plinko 27, Bonus Wheel 54, Treasure Chest 13.5, Ocean Voyage 27 and Any Bonus 24, the last
 * being what chasing the rooms costs naturally (four chips a spin, a room every six spins).
 */
export const BUY_MODES: Record<string, { rooms: readonly RoomSpot[]; label: string }> = {
	buy_any: { rooms: ROOM_SPOTS, label: 'RANDOM BONUS' },
	buy_tc: { rooms: ['chest'], label: SPOT_LABEL.chest },
	buy_pp: { rooms: ['piratePlinko'], label: SPOT_LABEL.piratePlinko },
	buy_ov: { rooms: ['oceanVoyage'], label: SPOT_LABEL.oceanVoyage },
	buy_bw: { rooms: ['bonusWheel'], label: SPOT_LABEL.bonusWheel },
};

export const BUY_MODE_NAMES: readonly string[] = Object.keys(BUY_MODES);

export const isBuyMode = (mode: string): boolean => mode in BUY_MODES;

/** Chips charged for one buy of `mode`. */
export const buyPrice = (mode: string): number => {
	const { rooms } = BUY_MODES[mode];
	return (rooms.length * NUM_SEGMENTS) / rooms.reduce((sum, room) => sum + SEGMENT_COUNT[room], 0);
};

/** The spots a mode pays on: the combination's spots, or the rooms a buy can open. */
export const coverageOf = (mode: string): readonly Spot[] =>
	MODE_COVERAGE[mode] ?? BUY_MODES[mode]?.rooms ?? [];

export const ALL_MODE_NAMES: readonly string[] = [...MODE_NAMES, ...BUY_MODE_NAMES];

const PUBLISHED_MODES = new Set(ALL_MODE_NAMES);

export const isPublishedMode = (mode: string): boolean => PUBLISHED_MODES.has(mode);

/** Chips charged per `amount`: spots covered for a combination, the price for a buy. */
export const modeCost = (mode: string): number =>
	isBuyMode(mode) ? buyPrice(mode) : (MODE_COVERAGE[mode]?.length ?? 0);

/** The published mode for a set of backed spots, or null when that set is not published. */
export const modeForSpots = (spots: readonly Spot[]): string | null => {
	if (!spots.length) return null;
	const name = modeName(spots);
	return name in MODE_COVERAGE ? name : null;
};

/** Max win per mode, in units of `amount` (mirror of math `max_win_for_mode`). */
const roomTop: Record<RoomSpot, number> = {
	piratePlinko: Math.max(...PLINKO_SLOTS),
	bonusWheel: Math.max(...WHEEL_LAYOUT),
	chest: 250,
	oceanVoyage: Math.max(...VOYAGE_DEPTHS),
};
const TOP_SLOT_MAX = Math.max(...TOP_SLOT_MULTS);

export const spotMaxWin = (spot: Spot): number =>
	isRoomSpot(spot) ? roomTop[spot] * TOP_SLOT_MAX : 1 + NUMBER_PAY[spot] * TOP_SLOT_MAX;

export const maxWinForMode = (mode: string): number =>
	Math.max(...coverageOf(mode).map(spotMaxWin));
