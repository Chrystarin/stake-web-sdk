/**
 * The ball is painted in whatever colour opened the round, so it arrives on the board carrying
 * the result that sent it there.
 *
 * One accent hex in, four stops out — sheen, face, shade and edge — which is what turns a flat
 * colour into something round. Mixed here rather than with `color-mix()` in CSS so the stops are
 * plain hexes: they go straight into a gradient, and a colour that arrives malformed falls back
 * to gold instead of quietly painting nothing.
 */

type Rgb = [number, number, number];

const GOLD: Rgb = [255, 225, 77];
const WHITE: Rgb = [255, 255, 255];
const BLACK: Rgb = [0, 0, 0];

const parseHex = (hex: string): Rgb => {
	const clean = (hex ?? '').replace('#', '').trim();
	const full = clean.length === 3 ? [...clean].map((digit) => digit + digit).join('') : clean;
	if (full.length !== 6 || !/^[0-9a-f]{6}$/i.test(full)) return GOLD;
	const value = Number.parseInt(full, 16);
	return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
};

const toHex = (rgb: Rgb): string =>
	`#${rgb.map((channel) => Math.round(Math.max(0, Math.min(255, channel))).toString(16).padStart(2, '0')).join('')}`;

const mix = (rgb: Rgb, towards: Rgb, amount: number): string =>
	toHex(rgb.map((channel, index) => channel + (towards[index] - channel) * amount) as Rgb);

export type BallPalette = {
	/** The highlight where the light lands. */
	sheen: string;
	/** The colour itself. */
	face: string;
	/** Turning away from the light. */
	shade: string;
	/** The far edge, in shadow. */
	edge: string;
};

export const ballPalette = (accent: string): BallPalette => {
	const rgb = parseHex(accent);
	return {
		sheen: mix(rgb, WHITE, 0.8),
		face: toHex(rgb),
		shade: mix(rgb, BLACK, 0.34),
		edge: mix(rgb, BLACK, 0.7),
	};
};
