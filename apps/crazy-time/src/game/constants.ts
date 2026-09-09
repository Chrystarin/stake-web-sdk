// Mirrors games/crazy_time/crazy_time_data.py in stake-math-sdk. Keep the two in sync.

// ---------------------------------------------------------------------------
// Spots
// ---------------------------------------------------------------------------
export const NUMBER_SPOTS = ['x1', 'x2', 'x5', 'x10'] as const;
export const ROOM_SPOTS = ['plinko', 'wheel', 'chest', 'tower'] as const;
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

/** Player-facing names. Bonus rooms are working titles. */
export const SPOT_LABEL: Record<Spot, string> = {
	x1: 'X1',
	x2: 'X2',
	x5: 'X5',
	x10: 'X10',
	plinko: 'PLINKO',
	wheel: 'JACKPOT WHEEL',
	chest: 'TREASURE CHEST',
	tower: 'DRAGON TOWER',
};

/**
 * Badge art per bonus room, drawn on the wheel's label ring, on the bet tile and on the Top Slot's
 * reel — so a room is the same picture everywhere it appears. Paths are relative to `static/`; the
 * caller wraps them, because this file is plain data and knows nothing about how assets resolve.
 * `aspect` is width over height of the file, which is what the wheel sizes its badge box from.
 */
export const ROOM_ICON: Record<RoomSpot, { src: string; aspect: number }> = {
	plinko: { src: 'img/wheel/bomb.png', aspect: 1 },
	wheel: { src: 'img/wheel/center.png', aspect: 577 / 586 },
	chest: { src: 'img/wheel/treasure.png', aspect: 1 },
	tower: { src: 'img/wheel/dragon.png', aspect: 1 },
};

/** Tile / segment palette. Number spots follow the LuckyWheel reference art (steel, gold, rose, violet). */
export const SPOT_COLOUR: Record<Spot, { base: string; deep: string; text: string }> = {
	x1: { base: '#5f8fb3', deep: '#2f5f84', text: '#dff3ff' },
	x2: { base: '#d9a62a', deep: '#9a6d0c', text: '#fff4cc' },
	x5: { base: '#d67b91', deep: '#9a3d55', text: '#ffe3ea' },
	x10: { base: '#7f6ec7', deep: '#4a3b91', text: '#ece6ff' },
	plinko: { base: '#2b8fd6', deep: '#135a8f', text: '#e2f3ff' },
	wheel: { base: '#c8352f', deep: '#7d1a17', text: '#ffe6e4' },
	chest: { base: '#2f9e5b', deep: '#176437', text: '#e3ffe9' },
	tower: { base: '#7a3aa8', deep: '#4b1f6e', text: '#f3e4ff' },
};

// ---------------------------------------------------------------------------
// Wheel
// ---------------------------------------------------------------------------
/**
 * Physical order around the rim, clockwise from the flapper. 54 entries: x1 21, x2 13, x5 7,
 * x10 4, chest 4, plinko 2, tower 2, wheel 1 (Crazy Time's own split). One room every six
 * segments, so exactly five numbers sit between any two rooms: chests every 12, plinko and tower
 * opposite pairs, the jackpot wheel on its own.
 */
export const SEGMENT_LAYOUT: readonly Spot[] = [
	'chest', 'x1', 'x2', 'x1', 'x5', 'x2',
	'plinko', 'x1', 'x10', 'x1', 'x2', 'x1',
	'chest', 'x2', 'x1', 'x5', 'x1', 'x2',
	'tower', 'x1', 'x2', 'x1', 'x5', 'x1',
	'chest', 'x1', 'x10', 'x2', 'x1', 'x2',
	'plinko', 'x1', 'x5', 'x1', 'x2', 'x1',
	'chest', 'x2', 'x1', 'x10', 'x1', 'x5',
	'tower', 'x1', 'x2', 'x1', 'x5', 'x2',
	'wheel', 'x1', 'x10', 'x2', 'x1', 'x5',
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
/** Plinko landing slots, left to right (before any Top Slot multiplier). */
export const PLINKO_SLOTS = [400, 100, 50, 30, 20, 12, 7, 12, 20, 30, 50, 100, 400] as const;
/**
 * Rows the math walks the ball down. The front end no longer draws them — the jackpot board
 * derives its own row count from the pocket ladder (see `src/plinko`) — but this stays because
 * the file mirrors the math, and the math still has them.
 */
export const PLINKO_ROWS = 12;

/** Jackpot Wheel wedge values in rim order. */
export const WHEEL_LAYOUT = [
	10, 15, 20, 10, 25, 10, 50, 15, 25, 20, 100, 10, 15, 25, 10, 20, 150, 15, 10, 50, 20, 10, 25, 15,
	100, 10, 20, 50, 15, 10, 500, 25, 15, 20, 10, 15,
] as const; // prettier-ignore

export const NUM_CHESTS = 12;

/** Dragon Tower floor multipliers, bottom to top. */
export const TOWER_FLOORS = [2, 3, 5, 8, 12, 20, 35, 60, 120, 250] as const;
export const TOWER_TILES_PER_FLOOR = 4;

/** Seconds the player has to make a pick in a pick room before it is made for them. */
export const PICK_SECONDS = 8;

// ---------------------------------------------------------------------------
// Modes: one per combination of spots
// ---------------------------------------------------------------------------
export const RTP = 0.965;

/**
 * Short code per spot. A mode name is the covered spots' codes joined in SPOTS order, e.g. `x1`
 * (one spot), `pk_jw_tc_dt` (all four rooms), `x1_x2_x5_x10_pk_jw_tc_dt` (the full board).
 * The math derives the same name (`crazy_time_data.mode_name`), so the two must never diverge.
 */
export const SPOT_CODE: Record<Spot, string> = {
	x1: 'x1',
	x2: 'x2',
	x5: 'x5',
	x10: 'x10',
	plinko: 'pk',
	wheel: 'jw',
	chest: 'tc',
	tower: 'dt',
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
 * rooms with 2 or 1 segments (Plinko, Dragon Tower, Jackpot Wheel): fewer than 3 of 54 segments
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

const PUBLISHED_MODES = new Set(MODE_NAMES);

export const isPublishedMode = (mode: string): boolean => PUBLISHED_MODES.has(mode);

export const modeCost = (mode: string): number => MODE_COVERAGE[mode]?.length ?? 0;

/** The published mode for a set of backed spots, or null when that set is not published. */
export const modeForSpots = (spots: readonly Spot[]): string | null => {
	if (!spots.length) return null;
	const name = modeName(spots);
	return PUBLISHED_MODES.has(name) ? name : null;
};

/** Max win per mode, in units of `amount` (mirror of math `max_win_for_mode`). */
const roomTop: Record<RoomSpot, number> = {
	plinko: Math.max(...PLINKO_SLOTS),
	wheel: Math.max(...WHEEL_LAYOUT),
	chest: 250,
	tower: Math.max(...TOWER_FLOORS),
};
const TOP_SLOT_MAX = Math.max(...TOP_SLOT_MULTS);

export const spotMaxWin = (spot: Spot): number =>
	isRoomSpot(spot) ? roomTop[spot] * TOP_SLOT_MAX : 1 + NUMBER_PAY[spot] * TOP_SLOT_MAX;

export const maxWinForMode = (mode: string): number =>
	Math.max(...(MODE_COVERAGE[mode] ?? []).map(spotMaxWin));
