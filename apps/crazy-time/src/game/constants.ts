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
	wheel: 'LUCKY WHEEL',
	chest: 'TREASURE CHEST',
	tower: 'DRAGON TOWER',
};

/** Tile / segment palette. Number spots follow the LuckyWheel reference art (steel, gold, rose, violet). */
export const SPOT_COLOUR: Record<Spot, { base: string; deep: string; text: string }> = {
	x1: { base: '#5f8fb3', deep: '#2f5f84', text: '#dff3ff' },
	x2: { base: '#d9a62a', deep: '#9a6d0c', text: '#fff4cc' },
	x5: { base: '#d67b91', deep: '#9a3d55', text: '#ffe3ea' },
	x10: { base: '#7f6ec7', deep: '#4a3b91', text: '#ece6ff' },
	plinko: { base: '#7a3aa8', deep: '#4b1f6e', text: '#f3e4ff' },
	wheel: { base: '#2b8fd6', deep: '#135a8f', text: '#e2f3ff' },
	chest: { base: '#2f9e5b', deep: '#176437', text: '#e3ffe9' },
	tower: { base: '#c8352f', deep: '#7d1a17', text: '#ffe6e4' },
};

// ---------------------------------------------------------------------------
// Wheel
// ---------------------------------------------------------------------------
/** Physical order around the rim, clockwise from the flapper. 54 entries. */
export const SEGMENT_LAYOUT: readonly Spot[] = [
	'plinko', 'x1', 'x2', 'x1', 'wheel', 'x1', 'x5', 'x1', 'x2', 'chest', 'x1', 'x10', 'x2',
	'plinko', 'x1', 'x2', 'x1', 'x5', 'tower', 'x1', 'x2', 'x1', 'wheel', 'x1', 'x10', 'x2', 'x1',
	'plinko', 'x2', 'x1', 'x5', 'chest', 'x1', 'x2', 'x1', 'tower', 'x1', 'x5', 'x2', 'x1',
	'plinko', 'x1', 'x10', 'x2', 'x5', 'wheel', 'x1', 'x5', 'x2', 'chest', 'x1', 'x10', 'tower', 'x2',
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
export const PLINKO_SLOTS = [400, 80, 40, 20, 12, 7, 4, 7, 12, 20, 40, 80, 400] as const;
export const PLINKO_ROWS = 12;

/** Lucky Wheel wedge values in rim order. */
export const WHEEL_LAYOUT = [
	2, 3, 2, 5, 2, 10, 3, 2, 5, 2, 3, 100, 2, 3, 5, 2, 20, 3, 2, 5, 2, 3, 50, 2,
	3, 5, 2, 10, 3, 2, 200, 2, 5, 3, 20, 10,
] as const; // prettier-ignore

export const NUM_CHESTS = 12;

/** Dragon Tower floor multipliers, bottom to top. */
export const TOWER_FLOORS = [2, 3, 5, 8, 12, 20, 35, 60, 120, 250] as const;
export const TOWER_TILES_PER_FLOOR = 4;

/** Seconds the player has to make a pick in a pick room before it is made for them. */
export const PICK_SECONDS = 8;

// ---------------------------------------------------------------------------
// Modes
// ---------------------------------------------------------------------------
export const RTP = 0.965;

/**
 * The ten published tickets. A ticket covers a fixed set of spots at ONE chip each, so
 * `cost` is the number of spots and the RGS charges cost x amount.
 *
 * Any other combination of spots has no book set and cannot be bet: Stake caps a game at
 * 50 modes, and free combination of 8 spots would need 255.
 */
export const MODE_COVERAGE: Record<string, readonly Spot[]> = {
	x1: ['x1'],
	x2: ['x2'],
	x5: ['x5'],
	x10: ['x10'],
	plinko: ['plinko'],
	wheel: ['wheel'],
	chest: ['chest'],
	tower: ['tower'],
	bonuses: ROOM_SPOTS,
	full_board: SPOTS,
};

export const MODE_NAMES: readonly string[] = Object.keys(MODE_COVERAGE);

/** Tickets that cover more than one spot, offered as one-tap buttons on the board. */
export const BUNDLE_MODES: readonly { mode: string; label: string }[] = [
	{ mode: 'bonuses', label: 'ALL BONUS' },
	{ mode: 'full_board', label: 'FULL BOARD' },
];

const PUBLISHED_MODES = new Set(MODE_NAMES);

export const isPublishedMode = (mode: string): boolean => PUBLISHED_MODES.has(mode);

export const modeCost = (mode: string): number => MODE_COVERAGE[mode]?.length ?? 0;

const sameSet = (a: readonly string[], b: readonly string[]) =>
	a.length === b.length && a.every((item) => b.includes(item));

/** The published mode for a set of backed spots, or null when that set is not a ticket. */
export const modeForSpots = (spots: readonly Spot[]): string | null => {
	if (!spots.length) return null;
	for (const [mode, coverage] of Object.entries(MODE_COVERAGE)) {
		if (sameSet(spots, coverage)) return mode;
	}
	return null;
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
