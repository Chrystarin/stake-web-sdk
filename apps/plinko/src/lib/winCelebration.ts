/**
 * Win-celebration configuration — the full-screen pirate win reveal that replaces the old win card
 * on the 10/20/50-ball tiers (see WinCelebration.svelte). Kept out of the component so the tier
 * thresholds, banner mapping, coin counts and timing are all editable in one place.
 */

export type WinTier = 'massive' | 'epic' | 'captain';

/**
 * Tier boundaries as a FRACTION of the MODE'S OWN max win (= `winPopupMultiplier ÷ modeMaxWin`, where
 * `modeMaxWin` is that mode's `max_win` payout cap from `config.betModes`). The banner scales with how
 * close the round got to the mode's ceiling, not to an absolute multiplier:
 *   • Massive Plunder — up to 25% of max win
 *   • Epic Bounty      — 26%–75% of max win
 *   • Captain's Jackpot — 76% of max win and above
 * Both `winPopupMultiplier` and `max_win` are normalized to the PER-BALL stake (NOT round-payout ÷
 * total-wager — see `bookEventHandlerMap`), so their ratio is a clean 0…1 fraction (a round can reach —
 * but never exceed — its mode's cap). Edit here to re-tune.
 */
export const WIN_TIER_MAX_WIN_FRACTION = {
	epic: 0.26,
	captain: 0.76,
} as const;

export function winTierForMultiplier(multiplier: number, modeMaxWin: number): WinTier {
	const fraction = modeMaxWin > 0 ? multiplier / modeMaxWin : 0;
	if (fraction >= WIN_TIER_MAX_WIN_FRACTION.captain) return 'captain';
	if (fraction >= WIN_TIER_MAX_WIN_FRACTION.epic) return 'epic';
	return 'massive';
}

/** Headline banner art per tier (in `static/img/win_popup`). */
export const WIN_TIER_BANNER: Record<WinTier, string> = {
	massive: 'img/win_popup/massive_plunder.webp',
	epic: 'img/win_popup/epic_bounty.webp',
	captain: 'img/win_popup/captains_jackpot.webp',
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
export const WIN_RAYS_ART = 'img/win_popup/shine_rays.webp';
export const WIN_BACKDROP_ART = 'img/win_popup/backdrop_shade.webp';
export const WIN_COIN_ART = 'img/win_popup/coin.webp';

/** Digit-glyph art for the counter (silver 3D numerals 0–9). */
export const winDigitArt = (digit: string): string => `img/win_popup/${digit}.webp`;

/** Decimal-point glyph art, matched to the digit style (silver 3D dot). */
export const WIN_DOT_ART = 'img/win_popup/dot.webp';

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

/**
 * The three timeline milestones, derived from the hold. `holdMs` overrides `WIN_TIMING.hold` — the
 * only stage that can stretch without desyncing anything, since it's dead time between the number
 * landing and the merge starting. DEV console triggers pass one to park the reveal on screen; every
 * production caller passes nothing and gets `WIN_TIMING.hold`. Both the overlay (which schedules the
 * merge) and Game.svelte (which clears the gate at the end) must derive from the SAME hold, or the
 * overlay is torn down mid-reveal.
 */
function holdOrDefault(holdMs?: number | null): number {
	return holdMs != null && Number.isFinite(holdMs) && holdMs >= 0 ? holdMs : WIN_TIMING.hold;
}

/** When (ms after mount) the coins turn for the balance and the reveal starts fading. */
export function winCelebrationMergeAtMs(holdMs?: number | null): number {
	return WIN_TIMING.countDelay + WIN_TIMING.countUp + holdOrDefault(holdMs);
}

/** When (ms after mount) the balance is released to count up — as the first coins reach the coin. */
export function winCelebrationBalanceReleaseAtMs(holdMs?: number | null): number {
	return winCelebrationMergeAtMs(holdMs) + WIN_TIMING.balanceReleaseDelay;
}

/** Total lifetime of the celebration, from mount through the balance count-up finishing. */
export function winCelebrationTotalMs(holdMs?: number | null): number {
	return winCelebrationBalanceReleaseAtMs(holdMs) + WIN_TIMING.balanceCountUp;
}

/** Production-timing shorthands (no hold override). */
export const WIN_BALANCE_RELEASE_AT_MS = winCelebrationBalanceReleaseAtMs();
export const WIN_CELEBRATION_TOTAL_MS = winCelebrationTotalMs();

/**
 * Fixed part of the reveal — mount → the number finishing its count-up. A "keep it on screen for N
 * seconds" debug request is measured from mount, so the hold it needs is N minus this.
 */
export const WIN_REVEAL_BEFORE_HOLD_MS = WIN_TIMING.countDelay + WIN_TIMING.countUp;
