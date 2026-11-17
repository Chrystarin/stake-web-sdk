/**
 * The win popup's configuration: the full-screen pirate reveal One-Eyed Willy's Plinko plays on a
 * big win (apps/plinko lib/winCelebration.ts), brought over for the table. Its art is that game's —
 * the banners, the shine rays, the shade behind them and the silver numerals.
 *
 * Plinko tiers a win by how close it got to its mode's max win. That does not carry over: here a
 * mode's ceiling runs from 50x to 50,000x, so nearly every win would read as the lowest tier. The
 * tiers are multiples of what the round staked instead, and they are the three numbers to edit.
 */

export type WinTier = 'massive' | 'epic' | 'captain';

/**
 * A win of at least this many times the stake gets the popup; anything under it stays on the tile.
 * 0 for now: every win gets it, the smallest at the lowest tier (Massive Plunder). Raise it to
 * gate the popup again (it was 10).
 */
export const WIN_POPUP_MIN_MULT = 0;
/** The lowest multiple of each tier above Massive Plunder. */
export const WIN_TIER_FROM_MULT = { epic: 50, captain: 200 } as const;

export const winTierForMultiplier = (multiplier: number): WinTier =>
	multiplier >= WIN_TIER_FROM_MULT.captain
		? 'captain'
		: multiplier >= WIN_TIER_FROM_MULT.epic
			? 'epic'
			: 'massive';

/** The headline banner per tier. */
export const WIN_TIER_BANNER: Record<WinTier, string> = {
	massive: 'img/win_popup/massive_plunder.webp',
	epic: 'img/win_popup/epic_bounty.webp',
	captain: 'img/win_popup/captains_jackpot.webp',
};

export const WIN_RAYS_ART = 'img/win_popup/shine_rays.webp';
export const WIN_BACKDROP_ART = 'img/win_popup/backdrop_shade.webp';
export const WIN_DOT_ART = 'img/win_popup/dot.webp';
export const winDigitArt = (digit: string): string => `img/win_popup/${digit}.webp`;

/** Everything the popup paints, for the preload manifest. */
export const WIN_POPUP_ART: readonly string[] = [
	...Object.values(WIN_TIER_BANNER),
	WIN_RAYS_ART,
	WIN_BACKDROP_ART,
	WIN_DOT_ART,
	...'0123456789'.split('').map(winDigitArt),
];

/** The sequence (ms from the popup mounting): reveal, count up, hold, fade. */
export const WIN_POPUP_TIMING = {
	/** The reveal's pop-in, before the number starts to climb. */
	countDelay: 550,
	countUp: 1150,
	/** The number standing finished. */
	hold: 900,
	/** The whole thing fading off, back to the table. */
	fadeOut: 600,
} as const;

export const WIN_POPUP_TOTAL_MS =
	WIN_POPUP_TIMING.countDelay +
	WIN_POPUP_TIMING.countUp +
	WIN_POPUP_TIMING.hold +
	WIN_POPUP_TIMING.fadeOut;

/** The counter's decimals: a round win is clean, a normal one shows cents, a tiny one keeps four. */
export const popupDecimals = (amount: number): number =>
	!Number.isFinite(amount) || Number.isInteger(amount) ? 0 : amount < 1 ? 4 : 2;

/** No thousands separators: the counter is drawn from digit art, and there is no comma glyph. */
export const popupFormat = (value: number, decimals: number): string =>
	value.toLocaleString('en-US', {
		minimumFractionDigits: decimals,
		maximumFractionDigits: decimals,
		useGrouping: false,
	});
