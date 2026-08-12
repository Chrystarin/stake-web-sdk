// Mirrors games/colour_dice/colour_dice_data.py in stake-math-sdk. Keep the two in sync.

// Canonical colour order, shared with the math SDK.
export const COLOURS = ['yellow', 'blue', 'white', 'green', 'pink', 'red'] as const;

export type Colour = (typeof COLOURS)[number];

export const NUM_DICE = 3;

// Colour hexes lifted from the original ColourDice dice-box face patch.
export const COLOUR_HEX: Record<Colour, string> = {
	yellow: '#F6C928',
	blue: '#2D6BFF',
	white: '#FFFFFF',
	green: '#43B047',
	pink: '#FF4DB8',
	red: '#E53935',
};

// Colour -> d6 pip mapping, matching dice-box.component.ts (1=yellow..6=red).
export const COLOUR_TO_PIP: Record<Colour, number> = {
	yellow: 1,
	blue: 2,
	white: 3,
	green: 4,
	pink: 5,
	red: 6,
};

// Gross return multiplier per matching die count, per unit staked on that colour.
// 3 matches is absent: a triple resolves on the wheel instead.
export const MATCH_PAYOUT: Record<number, number> = { 0: 0, 1: 2, 2: 3 };

// Jackpot awards. Still named for the wheel, because the math and the book event
// (`wheelSpin`) are — but the wheel is gone from the client: a triple is now played out on the
// plinko screen, where these become the pockets (see src/plinko). Only the presentation changed;
// the awards and their weights are the math's, untouched.
//
// RETUNED 2026-08 alongside the math: the old ladder put the game at 97.01% RTP, above Stake's
// 96.70% ceiling. Weights now give E = 13.42 -> 96.49% RTP.
export const WHEEL: readonly (readonly [value: number, weight: number])[] = [
	[4, 58],
	[10, 22],
	[20, 12],
	[50, 5],
	[100, 2],
	[200, 1],
] as const;

export const WHEEL_VALUES = WHEEL.map(([value]) => value);
export const WHEEL_TOP = Math.max(...WHEEL_VALUES);

export const RTP = 0.964907;

// ---------------------------------------------------------------------------
// Backed-colour count -> bet modes
// ---------------------------------------------------------------------------
// EQUAL STAKE: the player backs 1-6 colours, every one carrying the same stake. The RGS
// settles from a precomputed book keyed by `mode`, so the shape of the bet must be fixed
// before it is sent — and since the stake is equal and all six colours are statistically
// identical, a round is fully described by HOW MANY colours were backed. Which ones is
// irrelevant. That gives exactly one mode per count:
//
//     mode   = '3_colours'       three colours backed
//     cost   = 3                 (total stake = cost x amount)
//     amount = stake per colour  (sent verbatim, so always a tray denomination)

export const MAX_COLOURS = COLOURS.length;

/** Per-colour stakes for a mode. Always all 1s here — the weights are equal by construction. */
export type Layout = number[];

/** The 6 published layouts, one per backed-colour count. */
export const LAYOUTS: readonly Layout[] = Array.from({ length: MAX_COLOURS }, (_, index) =>
	Array.from({ length: index + 1 }, () => 1),
);

/** RGS mode for a layout: how many colours were backed. [1,1,1] -> '3_colours'. */
export const modeName = (layout: Layout): string => `${layout.length}_colours`;

/** RGS mode for a backed-colour count. */
export const modeForCount = (count: number): string => `${count}_colours`;

export const MODE_NAMES: readonly string[] = LAYOUTS.map(modeName);

const PUBLISHED_MODES = new Set(MODE_NAMES);

export const isPublishedMode = (mode: string): boolean => PUBLISHED_MODES.has(mode);

/**
 * Max win in PAYOUT-MULTIPLIER units — a multiple of `amount` (the per-colour stake),
 * matching the math config's `max_win`. The RGS settles payout = amount x payoutMultiplier
 * and charges `cost` separately, so this is not divided by the number of colours.
 *
 * Under equal stakes it is WHEEL_TOP for every mode: the best round is one backed colour
 * taking a triple with the wheel on its top value, and a triple uses all three dice, so no
 * other colour can also pay.
 */
export const maxWinForLayout = (layout: Layout): number => Math.max(...layout) * WHEEL_TOP;

/** Player-facing max win: a multiple of the TOTAL stake — WHEEL_TOP / colours backed. */
export const maxWinVsTotalStake = (layout: Layout): number =>
	maxWinForLayout(layout) / layout.reduce((sum, stake) => sum + stake, 0);

/** Player-facing max win for a backed-colour count. */
export const maxWinForCount = (count: number): number => WHEEL_TOP / Math.max(1, count);
