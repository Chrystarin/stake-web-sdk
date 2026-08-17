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
 *
 * ⚠️ FLAT 2% DESIGN (2026-08): the bars were re-cut 7 / 9 / 17 → 6 / 8 / 16 so that EVERY feature tier
 * earns the bonus on exactly 2.000% of bets. Unlike the earlier flat-1% draft, the DROP-SIDE coin-peg
 * probability is NOT re-solved per tier — it stays on the shared 0.18, so the meter keeps its familiar
 * cadence. Each bar is instead the smallest one whose natural fire rate `P(Binomial(balls, 0.18) >= bar)`
 * sits at or below that tier's required rate, and the math's `BONUS_IN_DROP_RATE` quota tops up the
 * remainder (0.01540 / 0.00064 / 0.00243).
 *
 * "2%" counts a bet as a bonus whether it arrived through THIS meter or through the free-spin wheel's
 * BONUS segment chaining one. The free-spin rate differs per tier, so the meter path is solved down to
 * compensate and is deliberately NOT itself flat: 1.9008% / 1.8338% / 1.4428%.
 *
 * Changing a bar here without the math re-solving its quota desyncs the notch count from the number of
 * hits the bonus actually needs — keep in step with math `BONUS_METER_TIER` + `BONUS_IN_DROP_RATE`.
 * These bars are the NOTCH COUNT the bar renders; the math stays authoritative via
 * `plinkoDrop.bonusMeterMax`. */
export const BONUS_METER_TIER: Record<number, { max: number; startRatio: number }> = {
	10: { max: 6, startRatio: 0 },
	20: { max: 8, startRatio: 0 },
	50: { max: 16, startRatio: 0 },
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
 * each round and fires the free spin in-drop at `max`. 1-ball is absent (no free spin).
 *
 * ⚠️ UNCHANGED BY THE FLAT 2% RE-TUNE, and back to the math's values after an abandoned flat-1% draft
 * had moved two of them (10-ball `max` 6 → 8, which effectively deleted that tier's free spin; 50-ball
 * `startRatio` 0.25 → 0.3333, which roughly tripled its wheel cadence to absorb RTP budget). Flat 2%
 * pays for itself out of the bonus WHEEL's landing weights instead (math `BONUS_WHEEL_WEIGHTS_BY_BALLS`)
 * and out of a slower in-bonus climb, so this meter did not have to move at all.
 *
 * ⚠️ DO NOT RAISE 50-ball's `startRatio` again without re-checking the bonus rate. At 0.3333 its free
 * spin fires 14.678% of drops, and 1-in-8 of those chains a bonus — 1.83% of bets on its own, which
 * leaves only 0.168% for the meter path to reach a 2% total and would make any target at or under 1.83%
 * unreachable no matter what the meter does.
 * Keep in step with math `SPIN_METER_TIER`; the math stays authoritative via `plinkoDrop.spinMeterMax`. */
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
 * its board (and the in-bonus free-spin gating) come from this tier, NOT the selected one. Used to seed
 * the meters to the math default the moment a buy is activated. */
export const BUY_BONUS_BALLS_PER_DROP_REF = 10;

/** In-bonus FREE-SPIN meter max for a BOUGHT bonus. A buy is bonus-only, so this is the ONLY free-spin
 * bar in the round, and the math publishes it on the buy book's `plinkoDrop.spinMeterMax`.
 *
 * The math has no constant of its own for this — it derives the bar from
 * `scaled_spin_meter_max(BUY_BONUS_BALLS_PER_DROP_REF)`, i.e. the 10-ball tier's — so today this is
 * simply `SPIN_METER_TIER[10].max` and the two agree at 6. It is kept SEPARATE on purpose: the four buy
 * tiers are FROZEN (their RTP was solved against a bar of 6), so if the 10-ball drop-side bar is ever
 * moved again for reasons that have nothing to do with buys, the buys must not follow it. An abandoned
 * flat-1% draft did exactly that (10-ball 6 → 8) and it cost the buys 0.48 / 0.22 / 0.23 / 0.47 RTP
 * points. ⚠️ If that ever happens again, the math must gain its own pinned constant rather than let the
 * buys inherit the tier.
 *
 * Because a buy book still reports `ballsPerDrop` 10, `bookEventHandlerMap` must NOT cache a buy book's
 * `spinMeterMax` as tier 10's — see the guard there. That guard is latent while the two numbers agree,
 * and load-bearing the moment they diverge. */
export const BUY_BONUS_IN_BONUS_SPIN_METER_MAX = 6;

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

/**
 * Bonus hold-to-drop: how long Play must stay pressed before the press counts as a HOLD and starts
 * streaming free balls. A press shorter than this drops exactly one ball — an unhurried single click
 * (easily 200-300ms on touch) must not quietly spend a second free ball.
 *
 * Matches the Space hold threshold in `OnHotkey`, so pointer and keyboard qualify a hold on the same
 * clock. Deliberately NOT compressed by Fast Game like the interval above: this measures the player's
 * intent, not the board's cadence.
 */
export const BONUS_HOLD_ACTIVATION_DELAY_MS = 400;

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
 * What differs per mode is how often a falling ball awards a coin peg, which is the per-mode RTP lever —
 * the buy tiers use a much lower probability so their big fixed entry batch cannot run the ×10 award
 * ladder away to level 9. ⚠️ That probability is TWO numbers in the math, not one: a mode's DROP-SIDE
 * peg (`BONUS_PEG_HIT_PROB_BY_MODE`) paces the paid drop and sets the bonus TRIGGER rate, while its
 * IN-BONUS peg (`IN_BONUS_PEG_HIT_PROB_BY_MODE`) paces the bonus balls and sets what the bonus is
 * WORTH. They diverge sharply on 10-ball (0.1504 vs 0.030), so its energy bar barely moves while the
 * bonus balls fall even though its drop meter fills briskly — that is the math, not a bug. Neither
 * value is needed to render: every coin-peg hit is authored per ball on the book's outcomes.
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
 * this same wedge order.
 * ⚠️ THE VALUES ARE FROZEN, BUT THE LANDING ODDS ARE NOT — see `BONUS_WHEEL_WEIGHTS` below, which is
 * how the flat 2% trigger is paid for. The smallest wedge (20 balls = 17.93x) is a HARD FLOOR on what
 * one bonus can be worth, and that floor is what caps the trigger rate: the 10-ball tier can only
 * afford `6.07 RTP points / 17.93x = 2.98%` of them even with the wheel pinned to all-20s, so a "flat
 * 5%" is unreachable there under any weighting (it reads 99.32% RTP). Repainting the wheel with smaller
 * values is the only lever past that. */
export const BONUS_WHEEL_FREE_BALLS = [100, 90, 80, 70, 60, 50, 40, 30, 20] as const;

/** Bonus roulette LANDING WEIGHTS per balls-per-drop tier (index-aligned to BONUS_WHEEL_FREE_BALLS,
 * per-10,000 so `weight / 100` reads as a percentage). Mirror of stake-math-sdk
 * `plinko_data.BONUS_WHEEL_WEIGHTS_BY_BALLS`; also published on FE config `bonusWheelWeightsByBalls`.
 *
 * ⚠️ INFORMATIONAL ONLY on the client — `BonusRoulette.svelte` resolves the winning wedge from the
 * BOOK's `bonusRoulette.freeBalls`, so it never rolls the wheel itself and these weights cannot desync
 * the animation from the award. They are mirrored here so the two repos can be read side by side.
 *
 * ⚠️ THE TIERS SKEW IN OPPOSITE DIRECTIONS, and that is the design. A 50-ball bet costs 5x a 10-ball
 * bet, so at the same trigger rate it can afford 5x the bonus: big-ball players land the big wedges
 * (100 lands 27.66% of the time), small-ball players land the small ones (10-ball lands 20 on 68.01%
 * and 100 on 0.01%). Mean entry is 24.70 / 46.00 / 77.80 balls. Every wedge keeps a non-zero weight, so
 * none is unreachable on any tier. This is the same device `FREE_SPIN_WEIGHTS` already uses, and it
 * matches the per-tier boards in `coefficientSetsByBalls` and the per-tier max-win ladder.
 * ⚠️ The game-rules copy should say the bonus award scales with the ball count. */
export const BONUS_WHEEL_WEIGHTS: Record<number, readonly number[]> = {
	10: [1, 2, 7, 23, 71, 223, 696, 2176, 6801],
	20: [386, 483, 604, 755, 945, 1182, 1479, 1851, 2315],
	50: [2766, 2053, 1524, 1132, 840, 624, 463, 344, 255],
};

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
