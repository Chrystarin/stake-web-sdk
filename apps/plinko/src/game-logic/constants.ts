/** Bet amount presets shown in the HUD (filtered by min/max at runtime). */
export const BET_PER_BALL_PRESETS = [0.01, 0.1, 0.2, 1, 5, 10, 20, 50] as const;

/** Balls released per drop tier selector. */
export const BALL_PER_DROP_TIERS = [1, 10, 20, 50] as const;

/** Cosmetic BONUS-meter max for tiers without a per-drop entry (1-ball): it fills visually but never
 * fires. Mirror of stake-math-sdk plinko_data.BONUS_METER_COSMETIC_MAX. */
export const BONUS_METER_COSMETIC_MAX = 20;

/** PER-DROP BONUS meter (max + start) per balls-per-drop tier (Option A) — mirror of
 * `stake-math-sdk/games/crimson_plinko/plinko_data.BONUS_METER_TIER`. The meter ALWAYS starts EMPTY
 * (startRatio 0 on every tier — no per-tier head start) and fires the bonus in-drop when this drop's
 * coin-pegs fill it to `max`. So `max` IS the hits-to-fill, scaled per tier (more balls ⇒ higher bar).
 * The 1-ball tier is ABSENT — one ball can't fill the meter, AND that tier has no bonus at all (the math
 * publishes no bonus stratum for `onedrop`), so its (cosmetic) meter can never fire.
 * ⚠️ 10-ball `max` RAISED 6 → 7 when the entry wheel went back to 20..100 (avg 60) so the award matches
 * the painted art: at max 6 that tier's natural fire rate alone lands it on 96.198%, above TARGET_RTP
 * with a zero quota and no lever left. Keep in step with math `BONUS_METER_TIER`. */
export const BONUS_METER_TIER: Record<number, { max: number; startRatio: number }> = {
	10: { max: 7, startRatio: 0 },
	20: { max: 9, startRatio: 0 },
	50: { max: 17, startRatio: 0 },
};

/** Bonus-meter `{ max, start }` for a balls-per-drop tier (PER-DROP). The meter resets to `start` each
 * round and fires the bonus in-drop at `max`. 1-ball (no entry) is cosmetic → never fires (start 0).
 * Analogous to `spinMeterTierFor`; mirror of stake-math-sdk plinko_data `scaled_bonus_meter_start`. */
export function bonusMeterTierFor(ballsPerDrop: number): { max: number; start: number } {
	const cfg = BONUS_METER_TIER[Math.max(1, Math.floor(ballsPerDrop))];
	if (!cfg) return { max: BONUS_METER_COSMETIC_MAX, start: 0 };
	return { max: cfg.max, start: Math.round(cfg.max * cfg.startRatio) };
}

/** True for tiers whose per-drop bonus meter can fire the bonus in-drop (10/20/50); false for 1-ball. */
export function bonusInDropForBalls(ballsPerDrop: number): boolean {
	return Math.max(1, Math.floor(ballsPerDrop)) in BONUS_METER_TIER;
}

/** Per-drop FREE-SPIN meter (max + start) per balls-per-drop tier — mirror of
 * `stake-math-sdk/games/crimson_plinko/plinko_data.SPIN_METER_TIER`. The meter resets to `start`
 * each round and fires the free spin in-drop at `max`. 1-ball is absent (no free spin). */
export const SPIN_METER_TIER: Record<number, { max: number; startRatio: number }> = {
	10: { max: 6, startRatio: 0 },
	20: { max: 10, startRatio: 0.125 },
	50: { max: 21, startRatio: 0.25 },
};

/** Free-spin meter `{ max, start }` for a balls-per-drop tier (1-ball has no free spin → max 1). */
export function spinMeterTierFor(ballsPerDrop: number): { max: number; start: number } {
	const cfg = SPIN_METER_TIER[Math.max(1, Math.floor(ballsPerDrop))];
	if (!cfg) return { max: 1, start: 0 };
	return { max: cfg.max, start: Math.round(cfg.max * cfg.startRatio) };
}

/** Balls-per-drop the math simulates a BUY BONUS at, regardless of the player's selected tier — mirror
 * of stake-math-sdk plinko_data.BUY_BONUS_BALLS_PER_DROP_REF. A buy's book is generated at this tier, so
 * its `spinMeterMax` / `spinMeterStart` (and the in-bonus free-spin gating) come from this tier, NOT the
 * selected one. Used to seed the free-spin meter to the math default the moment a buy is activated. */
export const BUY_BONUS_BALLS_PER_DROP_REF = 10;

/** Pyramid row counts available in the UI. */
export const ROW_COUNT_OPTIONS = [10, 14, 20] as const;

/** Default pyramid row count. */
export const DEFAULT_ROW_COUNT = 14;

/**
 * Visual peg-pyramid row count rendered by the engine. DECOUPLED from the math `rowCount` (kept at
 * DEFAULT_ROW_COUNT for the server contract) — the ball is choreographed to its server slot index
 * regardless of peg rows, so this only shapes the on-screen pyramid (6 top → 17 bottom over 12 rows).
 */
export const PLINKO_VISUAL_ROWS = 12;

/** Serialized on `plinkoDrop.difficulty` for RGS / published math (single default board). */
export const PLINKO_DEFAULT_VARIANT_ID = 0;

/** Row tier index 0..12 for pyramid row counts 8..20. */
export function rowTierIndex(rowCount: number): number {
	return Math.max(0, Math.min(rowCount - 8, 12));
}

/** Slot multipliers for a row count from `config.coefficientSets`. */
export function coefficientsForRowCount(sets: number[][], rowCount: number): number[] {
	return sets[rowTierIndex(rowCount)] ?? [];
}

/**
 * Slot multipliers for a row count on the board a balls-per-drop TIER plays. Tiers listed in
 * `config.coefficientSetsByBalls` (currently only the feature-free 1-ball tier, whose center pocket
 * pays instead of feeding a free-spin meter it doesn't have) use their own table; every other tier
 * falls back to the shared `config.coefficientSets`. Mirror of math `coefficients_for(row, balls)`.
 */
export function coefficientsForTier(
	sets: number[][],
	setsByBalls: Record<string, number[][]> | undefined,
	rowCount: number,
	ballsPerDrop: number,
): number[] {
	const tier = String(Math.max(1, Math.floor(ballsPerDrop || 1)));
	const override = setsByBalls?.[tier];
	return coefficientsForRowCount(override?.length ? override : sets, rowCount);
}

/** Auto-bet round count options. */
export const AUTO_BET_OPTIONS = [5, 10, 15, 20, 25, 50, 75, 100] as const;

/** Minimum milliseconds between consecutive ball spawns. */
export const MIN_MS_BETWEEN_BALL_SPAWNS = 400;

/**
 * Bonus hold-to-drop: milliseconds between free balls while the player holds Play during a bonus
 * round. Sits inside the spacing the board already uses for a spaced 10-ball drop (~110–220ms per
 * ball, see `PlinkoBoard.spawnOutcomes`), so a held stream reads like a normal multi-ball drop rather
 * than a new density of ball. Fast Game compresses it by the `SIM_SPEED` ratio, like that spread.
 */
export const BONUS_HOLD_DROP_INTERVAL_MS = 200;

/** Normal vs fast simulation speed multipliers. (`fast` reduced 25% from 2.4 → 1.8 so peg
 * bounces stay readable — see PlinkoEngine speed-factor handling.) */
export const SIM_SPEED = { normal: 0.7, fast: 1.4 } as const;

/** Bonus level ladder labels. */
export const BONUS_LEVEL_LABELS = [1, 2, 4, 8, 16, 32, 64, 128, 256] as const;

/** Bonus-meter fill animation speed (fraction of the whole bar per second). Single source of truth,
 * mirrored by `BonusMeterEngine.fillAnimationSpeedPerSecond`. The bonus-round level-up reveal delay is
 * sized against this so the reward only lands once the bar has visibly finished filling
 * (`bonusLevelActivationDelayMs` in `gameOrchestrator`). */
export const BONUS_METER_FILL_SPEED_PER_SECOND = 1.8;

/**
 * Additional free balls granted on each bonus level-up (level reached → extra balls).
 * Level 1 entry balls come from the bonus wheel (`BONUS_ROULETTE_SEGMENTS`); levels 2..9
 * add these when the bonus meter re-fills during the round. Mirror of stake-math-sdk
 * `plinko_data.BONUS_LEVEL_BALLS` — keep both tables in sync (or drive from FE config).
 */
// Award = the on-screen level-bar value (`BONUS_LEVEL_LABELS`) ×10 for the reached level — inout's
// Plinko Aztec free-ball ladder (L2→20, L3→40, … L9→2560). Mirror of stake-math-sdk
// `plinko_data.BONUS_LEVEL_BALLS` (= LABELS × BONUS_LEVEL_BALL_MULTIPLIER=10). NOTE: this is only a
// session-meter FALLBACK — production level balls come from the book's `bonusRound.freeBalls`.
export const BONUS_LEVEL_BALLS: Record<number, number> = {
	2: 20,
	3: 40,
	4: 80,
	5: 160,
	6: 320,
	7: 640,
	8: 1280,
	9: 2560,
};

/** Additional free balls when reaching `level` (0 outside the ladder). */
export function bonusLevelBalls(level: number): number {
	return BONUS_LEVEL_BALLS[Math.floor(level)] ?? 0;
}

/**
 * SHARED in-bonus level-up ladder — coin-peg hits needed to LEAVE level L (index L-1).
 *
 * IDENTICAL IN EVERY MODE: an earned bonus (10/20/50) and a bought bonus need the same hits to climb.
 * What differs per mode is how often a falling ball awards a coin peg (math
 * `BONUS_PEG_HIT_PROB_BY_MODE`), which is the per-mode RTP lever — the buy tiers use a much lower
 * probability so their big fixed entry batch cannot run the ×10 award ladder away to level 9.
 *
 * The threshold ESCALATES because the free-ball award ladder is exponential (`BONUS_LEVEL_BALLS`,
 * ×2 per level): a flat bar is bimodal — either the bonus stalls at level 1-2, or one award becomes
 * big enough to fund the next level-up and the round runs away. Growth ~1.7 keeps each level roughly
 * as hard as its award is large.
 *
 * Mirror of stake-math-sdk `plinko_data.BONUS_LEVELUP_PEG_HITS_BY_LEVEL`
 * (= `round(5 × 1.7^(L-1))`). This is a FALLBACK only: production sizes each level's bar from the
 * book's own `bonusRound.levelupPegs`, and this table is used when a book omits it.
 */
export const BONUS_LEVELUP_PEGS = [5, 8, 14, 25, 42, 71, 121, 205] as const;

/** Coin-peg hits needed to advance FROM `level` to `level + 1` (clamped to the ladder). */
export function bonusLevelupPegs(level: number): number {
	const index = Math.max(1, Math.min(Math.floor(level || 1), BONUS_LEVELUP_PEGS.length)) - 1;
	return BONUS_LEVELUP_PEGS[index];
}

/** Bonus roulette ABSOLUTE entry free-ball awards (9 segments, avg 60). Mirror of stake-math-sdk
 * `plinko_data.BONUS_WHEEL_FREE_BALLS`. Tier-INDEPENDENT.
 * ⚠️ THE ART IS THE SOURCE OF TRUTH: these are exactly the numbers painted on `wheel_values.png`, in
 * wedge order (index 0 = the wedge under the pointer = 100, then clockwise). The player must be awarded
 * the number they watched the wheel land on, so DO NOT change this list without repainting the art —
 * a 2026-07-24 change to 10..90 left the art at 20..100 and every spin paid 10 less than it showed
 * (QA 2026-07-27: "landed on 80, won 70"). `BonusRoulette.svelte` `ART_SLOT_FREE_BALLS` must stay in
 * this same wedge order. The avg-60 entry is paid for by the 10-ball BONUS_METER_TIER max 6 → 7. */
export const BONUS_WHEEL_FREE_BALLS = [100, 90, 80, 70, 60, 50, 40, 30, 20] as const;

/** Bonus-wheel free-ball values. ABSOLUTE, independent of the balls-per-drop tier. Mirror of
 * math `bonus_wheel_free_balls`. */
export function bonusRouletteSegmentsForTier(_ballsPerDrop?: number): number[] {
	return [...BONUS_WHEEL_FREE_BALLS];
}

/** @deprecated use `bonusRouletteSegmentsForTier` (now tier-independent). */
export const BONUS_ROULETTE_SEGMENTS = bonusRouletteSegmentsForTier();

/** Free-spin wheel segment labels, clockwise around the wheel. `BONUS` (1-in-8) chains a free bonus
 * round; a numeric `M` pays `stake_per_ball × M` on top of the drop. Must match `stake-math-sdk/games/
 * crimson_plinko/plinko_data.FREE_SPIN_SEGMENTS` (same order) — so treat the ORDER as fixed.
 * ⚠️ Index 0 is NOT the wedge under the pointer: the art (`img/bonus_roulette_v2/wheel_values.webp`)
 * parks BONUS there at rest. Only `FreeSpinRoulette.svelte` maps index → angle; see
 * `ART_TOP_SEGMENT_INDEX` there rather than assuming `index * 45°`. */
export const FREE_SPIN_SEGMENTS = [
	'2X',
	'0.5X',
	'1X',
	'5X',
	'10X',
	'BONUS',
	'20X',
	'15X',
] as const;

/** Free-spin wheel landing WEIGHTS (index-aligned). EQUAL (the labeled wheel is 8 equal slices). The
 * math is authoritative (the book carries the landed segment); mirrored for display only. Mirror of
 * stake-math-sdk `plinko_data.FREE_SPIN_WEIGHTS`. */
export const FREE_SPIN_WEIGHTS = [1, 1, 1, 1, 1, 1, 1, 1] as const;
