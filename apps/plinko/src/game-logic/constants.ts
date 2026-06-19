/** Bet amount presets shown in the HUD (filtered by min/max at runtime). */
export const BET_PER_BALL_PRESETS = [0.01, 0.1, 0.2, 0.5, 1, 5, 10, 20, 50] as const;

/** Balls released per drop tier selector. */
export const BALL_PER_DROP_TIERS = [1, 10, 20, 50] as const;

/** Reference BONUS-meter max (10-ball tier); per-tier max = this × maxRatio. Mirror of
 * stake-math-sdk plinko_data.BONUS_METER_MAX. */
export const BONUS_METER_MAX_REF = 20;

/** BONUS-meter limits per balls-per-drop tier (SESSION meter). `startRatio` is the per-tier value the
 * meter resets to on a bonus trigger (and that a fresh tier first shows): 0 on 1/10-ball, 1/8 on
 * 20-ball, 1/4 on 50-ball — higher tiers start partially filled. Mirror of stake-math-sdk
 * plinko_data.METER_TIER_CONFIG. */
export const METER_TIER_CONFIG: Record<number, { startRatio: number; maxRatio: number }> = {
	1: { startRatio: 0, maxRatio: 1 },
	10: { startRatio: 0, maxRatio: 1 },
	20: { startRatio: 0.125, maxRatio: 1 },
	50: { startRatio: 0.25, maxRatio: 1 },
};

/** Bonus-meter `{ max, start }` for a balls-per-drop tier (session meter). Start = the per-tier value
 * the meter resets to on a bonus trigger / when a fresh tier is first seen. Analogous to
 * `spinMeterTierFor`; mirror of stake-math-sdk plinko_data `scaled_bonus_meter_start`. */
export function bonusMeterTierFor(ballsPerDrop: number): { max: number; start: number } {
	const cfg = METER_TIER_CONFIG[Math.max(1, Math.floor(ballsPerDrop))] ?? METER_TIER_CONFIG[10];
	const max = Math.max(1, Math.round(BONUS_METER_MAX_REF * cfg.maxRatio));
	return { max, start: Math.round(max * cfg.startRatio) };
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

/** Bonus roulette RELATIVE free-ball multipliers (8 segments, avg ≈ 1) — mirror of stake-math-sdk
 * `plinko_data.BONUS_WHEEL_RELATIVE`. The per-tier values are `round(m × tier balls)`, so the wheel
 * resizes with the balls-per-drop tier (rendered data-driven on `bonus-roulette-wheel-empty.png`). */
export const BONUS_WHEEL_RELATIVE = [0.6, 0.8, 1.0, 1.2, 1.4, 1.0, 0.8, 1.2] as const;

/** Per-tier bonus-wheel free-ball values (avg ≈ balls-per-drop). Mirror of math `bonus_wheel_free_balls`. */
export function bonusRouletteSegmentsForTier(ballsPerDrop: number): number[] {
	const balls = Math.max(1, Math.floor(ballsPerDrop));
	return BONUS_WHEEL_RELATIVE.map((m) => Math.max(1, Math.round(m * balls)));
}

/** @deprecated 10-ball reference values; use `bonusRouletteSegmentsForTier`. */
export const BONUS_ROULETTE_SEGMENTS = bonusRouletteSegmentsForTier(10);

/** Free-spin wheel segment labels — the original wheel's values, NO BONUS (the old BONUS slot
 * repeats 2X). The free spin fires IN-DROP and the multiplier applies to the BET PER BALL, so it
 * pays `stake_per_ball × M` on top of the drop. Rendered on the label-less wheel with a data-driven
 * text overlay (FreeSpinRoulette.svelte). Must match `stake-math-sdk/games/crimson_plinko/
 * plinko_data.FREE_SPIN_SEGMENTS` (same order). */
export const FREE_SPIN_SEGMENTS = [
	'2X',
	'0.5X',
	'1X',
	'5X',
	'10X',
	'2X',
	'20X',
	'15X',
] as const;
