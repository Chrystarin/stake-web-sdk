/**
 * How a chip of the tray looks, shared by every place that draws one (the tray, its panel, the
 * chips in flight and on the tiles in Game.svelte, and the Buy Bonus screen's chip rail).
 *
 * Every chip is the same `chip_base.svg` art, tinted per denomination with a CSS hue-rotate: the
 * tray's denominations are spread evenly along CHIP_HUES, smallest first, so a chip's colour comes
 * from where it stands in the tray rather than from its value.
 */

/** The hue the untinted art is drawn in (yellow). */
export const CHIP_BASE_HUE = 42;
const CHIP_HUES = [133, 222, 264, 324, 362];

/** The hue of the `index`th of `count` tray chips. */
const chipHue = (index: number, count: number) => {
	if (count <= 1) return CHIP_HUES[0];
	const position = (index / (count - 1)) * (CHIP_HUES.length - 1);
	const stop = Math.min(Math.floor(position), CHIP_HUES.length - 2);
	return CHIP_HUES[stop] + (CHIP_HUES[stop + 1] - CHIP_HUES[stop]) * (position - stop);
};

/** The hue-rotate that turns the art into the `index`th of `count` tray chips, in degrees. */
export const chipHueShift = (index: number, count: number) =>
	Math.round(chipHue(index, count) - CHIP_BASE_HUE);

/** The label colour on the `index`th of `count` tray chips: a dark shade of its own hue. */
export const chipTextColour = (index: number, count: number) =>
	`hsl(${Math.round(chipHue(index, count)) % 360}, 70%, ${Math.round(55 * 0.7)}%)`;

/**
 * A chip's face value. Sums are written by game/currency.ts, exact and in the currency's own form;
 * only a chip's face is abbreviated, to fit the disc.
 */
export const fmtChip = (value: number) => (value >= 1000 ? `${value / 1000}k` : `${value}`);

/**
 * A chip being put down, wherever it is put down — from the tray onto a tile (Game.svelte) or from
 * the Buy Bonus rail onto a card (BuyBonusModal.svelte). It swells where it stands, travels on an
 * arc still swollen, and settles where it lands: the global `chip-flight` keyframes (Game.svelte),
 * run over CHIP_FLIGHT_MS, with the whoosh as it takes off and the pop as it touches down.
 */
export const CHIP_GROW_MS = 80;
export const CHIP_TRAVEL_MS = 240;
export const CHIP_SETTLE_MS = 80;
export const CHIP_FLIGHT_MS = CHIP_GROW_MS + CHIP_TRAVEL_MS + CHIP_SETTLE_MS;
