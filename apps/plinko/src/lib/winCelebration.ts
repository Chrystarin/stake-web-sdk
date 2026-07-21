/**
 * Win-celebration configuration — the full-screen pirate win reveal that replaces the old win card
 * on the 10/20/50-ball tiers (see WinCelebration.svelte). Kept out of the component so the tier
 * thresholds, banner mapping, coin counts and timing are all editable in one place.
 */

export type WinTier = 'massive' | 'epic' | 'captain';

/**
 * Tier boundaries on the TOTAL payout multiplier (round win ÷ total wager, = `winPopupMultiplier`).
 * A 10/20/50-ball drop's multiplier is the average across its balls, so these are deliberately low:
 * most wins land under `epic` (Massive Plunder), a strong round reaches `epic` (Epic Bounty), and a
 * bonus/near-wincap round reaches `captain` (Captain's Jackpot). Edit here to re-tune the tiering.
 */
export const WIN_TIER_MIN_MULTIPLIER = {
	epic: 5,
	captain: 25,
} as const;

export function winTierForMultiplier(multiplier: number): WinTier {
	if (multiplier >= WIN_TIER_MIN_MULTIPLIER.captain) return 'captain';
	if (multiplier >= WIN_TIER_MIN_MULTIPLIER.epic) return 'epic';
	return 'massive';
}

/** Headline banner art per tier (in `static/img/win_popup`). */
export const WIN_TIER_BANNER: Record<WinTier, string> = {
	massive: 'img/win_popup/massive_plunder.png',
	epic: 'img/win_popup/epic_bounty.png',
	captain: 'img/win_popup/captains_jackpot.png',
};

/**
 * How many shower coins erupt per tier — scaled up so the bigger the win, the bigger the burst
 * (Captain's Jackpot throws the most). Clamped inside the shower renderer regardless.
 */
export const WIN_TIER_COIN_COUNT: Record<WinTier, number> = {
	massive: 30,
	epic: 54,
	captain: 84,
};

/** Static art shared by every tier. */
export const WIN_RAYS_ART = 'img/win_popup/shine_rays.png';
export const WIN_BACKDROP_ART = 'img/win_popup/backdrop_shade.png';
export const WIN_COIN_ART = 'img/win_popup/coin.png';

/** Digit-glyph art for the counter (silver 3D numerals 0–9). */
export const winDigitArt = (digit: string): string => `img/win_popup/${digit}.png`;

/** Decimal-point glyph art, matched to the digit style (silver 3D dot). */
export const WIN_DOT_ART = 'img/win_popup/dot.png';

/**
 * Sequence timing (ms), all measured from the moment the overlay mounts. The overlay owns its own
 * lifecycle end-to-end: reveal → count-up → hold → merge → fade, then it clears `showWinPopup`.
 *
 * Timeline:
 *   0                    backdrop + rays + banner play their CSS enter transitions
 *   countDelay           the number starts counting 0 → win
 *   countDelay+countUp   the number lands (pops), coins erupt from the middle
 *   …+hold               "win is done showing": coins turn and stream into the balance coin,
 *                        while the backdrop/rays/banner/number fade out
 *   …+merge              last coin has reached the balance coin → overlay dismisses
 */
export const WIN_TIMING = {
	countDelay: 550,
	countUp: 1150,
	/**
	 * Beat between the count finishing (the shower has stopped erupting) and the coins turning to
	 * stream into the balance coin — short, so the merge follows the count-up promptly.
	 */
	hold: 550,
	/** Window over which coins are launched into, and travel to, the balance coin. */
	merge: 1500,
	/** How long the backdrop/rays/banner/number take to fade once the merge begins. */
	fadeOut: 600,
	/**
	 * Gap from the merge STARTING to the balance itself counting up. Set so the count-up begins as the
	 * FIRST coins reach the balance coin (~620ms of travel) and then runs DURING the rest of the merge —
	 * the balance ticks up while the coins are still pouring in, not after they've all landed. (The
	 * balance is held at its pre-win value until this point so it never jumps ahead of the animation.)
	 */
	balanceReleaseDelay: 700,
	/** Duration of the balance count-up (pre-win → credited total) — runs concurrently with the merge. */
	balanceCountUp: 700,
} as const;

/** When (ms after mount) the balance is released to count up — as the first coins reach the coin. */
export const WIN_BALANCE_RELEASE_AT_MS =
	WIN_TIMING.countDelay + WIN_TIMING.countUp + WIN_TIMING.hold + WIN_TIMING.balanceReleaseDelay;

/** Total lifetime of the celebration, from mount through the balance count-up finishing. */
export const WIN_CELEBRATION_TOTAL_MS = WIN_BALANCE_RELEASE_AT_MS + WIN_TIMING.balanceCountUp;
