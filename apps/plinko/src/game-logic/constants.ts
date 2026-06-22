/** Bet amount presets shown in the HUD (filtered by min/max at runtime). */
export const BET_PER_BALL_PRESETS = [0.01, 0.1, 0.2, 0.5, 1, 5, 10, 20, 50] as const;

/** Balls released per drop tier selector. */
export const BALL_PER_DROP_TIERS = [1, 10, 20, 50] as const;

/** Cosmetic BONUS-meter max for tiers without a per-drop entry (1-ball): it fills visually but never
 * fires. Mirror of stake-math-sdk plinko_data.BONUS_METER_COSMETIC_MAX. */
export const BONUS_METER_COSMETIC_MAX = 20;

/** PER-DROP BONUS meter (max + start) per balls-per-drop tier (Option A) — mirror of
 * `stake-math-sdk/games/crimson_plinko/plinko_data.BONUS_METER_TIER`. The meter ALWAYS starts EMPTY
 * (startRatio 0 on every tier — no per-tier head start) and fires the bonus in-drop when this drop's
 * coin-pegs fill it to `max`. So `max` IS the hits-to-fill, scaled per tier (more balls ⇒ higher bar).
 * The 1-ball tier is ABSENT — one ball can't fill the meter, so its (cosmetic) meter never fires and its
 * bonus comes from the math quota instead. */
export const BONUS_METER_TIER: Record<number, { max: number; startRatio: number }> = {
	10: { max: 6, startRatio: 0 },
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

/** Pyramid row counts available in the UI. */
export const ROW_COUNT_OPTIONS = [10, 14, 20] as const;

/** Default pyramid row count. */
export const DEFAULT_ROW_COUNT = 14;

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

/** Auto-bet round count options. */
export const AUTO_BET_OPTIONS = [5, 10, 15, 20, 25, 50, 75, 100] as const;

/** Minimum milliseconds between consecutive ball spawns. */
export const MIN_MS_BETWEEN_BALL_SPAWNS = 400;

/** Normal vs fast simulation speed multipliers. */
export const SIM_SPEED = { normal: 0.7, fast: 3.0 } as const;

/** Bonus level ladder labels. */
export const BONUS_LEVEL_LABELS = [1, 2, 4, 8, 16, 32, 64, 128, 256] as const;

/**
 * Additional free balls granted on each bonus level-up (level reached → extra balls).
 * Level 1 entry balls come from the bonus wheel (`BONUS_ROULETTE_SEGMENTS`); levels 2..9
 * add these when the bonus meter re-fills during the round. Mirror of stake-math-sdk
 * `plinko_data.BONUS_LEVEL_BALLS` — keep both tables in sync (or drive from FE config).
 */
export const BONUS_LEVEL_BALLS: Record<number, number> = {
	2: 20,
	3: 30,
	4: 50,
	5: 75,
	6: 100,
	7: 150,
	8: 200,
	9: 300,
};

/** Additional free balls when reaching `level` (0 outside the ladder). */
export function bonusLevelBalls(level: number): number {
	return BONUS_LEVEL_BALLS[Math.floor(level)] ?? 0;
}

/** Bonus roulette ABSOLUTE free-ball awards (9 Aztec segments) — mirror of stake-math-sdk
 * `plinko_data.BONUS_WHEEL_FREE_BALLS`. Tier-INDEPENDENT: the bonus is a free feature that dumps the
 * same big ball counts on every tier (rendered data-driven on `bonus-roulette-wheel-empty.png`). */
export const BONUS_WHEEL_FREE_BALLS = [60, 90, 80, 40, 30, 100, 50, 70, 20] as const;

/** Bonus-wheel free-ball values. ABSOLUTE (Aztec), independent of the balls-per-drop tier. Mirror of
 * math `bonus_wheel_free_balls`. */
export function bonusRouletteSegmentsForTier(_ballsPerDrop?: number): number[] {
	return [...BONUS_WHEEL_FREE_BALLS];
}

/** @deprecated use `bonusRouletteSegmentsForTier` (now tier-independent). */
export const BONUS_ROULETTE_SEGMENTS = bonusRouletteSegmentsForTier();

/** Free-spin wheel segment labels — Aztec values INCLUDING a BONUS slot (lands → a free bonus round).
 * The free spin fires IN-DROP and a numeric multiplier applies to the BET PER BALL (pays
 * `stake_per_ball × M` on top of the drop). Rendered on the label-less wheel with a data-driven text
 * overlay (FreeSpinRoulette.svelte). Must match `stake-math-sdk/games/crimson_plinko/
 * plinko_data.FREE_SPIN_SEGMENTS` (same order). */
export const FREE_SPIN_SEGMENTS = [
	'100X',
	'10X',
	'0.5X',
	'1X',
	'2X',
	'20X',
	'5X',
	'BONUS',
] as const;

/** Free-spin wheel landing WEIGHTS (index-aligned to FREE_SPIN_SEGMENTS; relative). The wheel shows 8
 * equal slices but LANDS weighted so the big 100X / BONUS jackpots are rare and 0.5X–5X land often —
 * keeping the wheel's mean ≈ 5.4 (compliant) while it still appears frequently. The math is authoritative
 * (the book carries the landed segment); these are mirrored for client-side display/animation only.
 * Mirror of stake-math-sdk `plinko_data.FREE_SPIN_WEIGHTS`. */
export const FREE_SPIN_WEIGHTS = [1, 10, 22, 22, 20, 6, 18, 1] as const;
