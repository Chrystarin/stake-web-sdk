// Canonical colour order — MUST match the math SDK (games/colour_dice/game_config.py `colours`).
// The math encodes each die relative to the backed colour: 'MATCH' = backed colour,
// 'C1'..'C5' = the five other colours in this canonical order (excluding the backed colour).
export const COLOURS = ['yellow', 'blue', 'white', 'green', 'pink', 'red'] as const;

export type Colour = (typeof COLOURS)[number];

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

// Payout (gross return multiplier) by number of matching dice. Triple (3) resolves via the wheel.
export const MATCH_PAYOUT: Record<number, number> = { 0: 0, 1: 2, 2: 3 };

// Wheel award values (must match the math WHEEL values). Top value == wincap.
export const WHEEL_VALUES = [4, 10, 20, 50, 100, 200] as const;
export const WINCAP_MULTIPLIER = 200;
