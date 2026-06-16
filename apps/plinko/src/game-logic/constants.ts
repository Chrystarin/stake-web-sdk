/** Bet amount presets shown in the HUD (filtered by min/max at runtime). */
export const BET_PER_BALL_PRESETS = [0.01, 0.1, 0.2, 0.5, 1, 5, 10, 20] as const;

/** Balls released per drop tier selector. */
export const BALL_PER_DROP_TIERS = [1, 10, 20, 50] as const;

/** Meter limits are identical for every balls-per-drop tier (no reward scaling). */
export const METER_TIER_CONFIG: Record<number, { startRatio: number; maxRatio: number }> = {
	1: { startRatio: 0, maxRatio: 1 },
	10: { startRatio: 0, maxRatio: 1 },
	20: { startRatio: 0, maxRatio: 1 },
	50: { startRatio: 0, maxRatio: 1 },
};

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

/** Bonus roulette segment prizes (free balls). */
export const BONUS_ROULETTE_SEGMENTS = [100, 20, 50, 50, 50, 80, 20, 20] as const;

/** Free-spin wheel segment labels. */
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
