# One shared level-up ladder across all 7 feature modes

**Status: Option A implemented in the source; books not yet regenerated.** The math and client code
carry the change; `make run GAME=crimson_plinko` + `sync-math-books` still have to be run before it
reaches a player. This document records the investigation, the alternatives that were rejected, and
the verification the change still needs.

## Goal

1. In the **normal game**, the bonus-trigger meter maximum should scale up with balls per drop
   (10 < 20 < 50).
2. In **bonus mode**, the coin-peg count needed to leave each level should be **identical across all
   seven feature modes**, and should escalate as the level rises.
3. Per-mode RTP compliance should be restored by adjusting the **coin-peg hit probability** per mode,
   not by giving each mode its own level thresholds.

---

## Finding 1 — requirement 1 is already met

`BONUS_METER_TIER` is **7 / 9 / 17** for 10 / 20 / 50 balls per drop. It already scales monotonically
with the ball count, and it is already published per tier on `plinkoDrop.bonusMeterMax`, so the
client displays the right bar on every tier. No change is required for this requirement, and any
change here re-tunes the base modes (the natural trigger rate is a first-order RTP lever — see
[bonus-values.md §3](bonus-values.md#3-per-drop-bonus-trigger-meter-base-game)).

## Finding 2 — requirement 2 was not met, and only the buy modes were at fault

The three base modes already shared the escalating ladder `5, 8, 14, 25, 42, 71, 121, 205`.
The four buy modes overrode it with a **flat** per-tier bar of `16 / 22 / 29 / 37`.

So the work was: **delete the buy override, and re-tune each buy mode with its own coin-peg
probability.**

## Finding 3 — the constraint that decides the ladder's shape

The free-ball award ladder is exponential: level *L* awards `2^(L-1) × 10` balls. A level-up
threshold ladder that grows **faster than ×2 per level** therefore becomes unclimbable almost
immediately, because the balls you win can never generate the hits the next level demands.

Measured, at the wheel's mean 60 entry balls (n = 12,000 per row):

| Ladder | growth | p | P(reach L2) | P(reach L3) | P(reach L4) | mean payout |
| --- | --- | --- | --- | --- | --- | --- |
| `5, 8, 14, 25, …` (current) | ×1.7 | 0.18 | 86.5 % | 60.2 % | 22.5 % | 124.8 |
| `10, 30, 90, 270, …` | **×3** | 0.18 | 56.2 % | **0.0 %** | 0.0 % | 71.8 |
| `10, 30, 90, 270, …` | **×3** | 0.36 | 86.2 % | **17.2 %** | 0.0 % | 85.1 |

A ×3 ladder — the shape in the "10 then 30" example — reduces the feature to a two-level ladder at
any playable coin-peg probability: tiles 8 through 256 on the arch would never light up, and the
deep-tail jackpot that makes the 400× max win on `fiftydrop` achievable disappears. **Recommend
against ×3.** The growth rate has to stay meaningfully below the ×2 award growth; the shipped ×1.7
is a good choice and the analysis below keeps it.

---

## Option A — keep the existing ladder, retune only the buys **(chosen, implemented)**

**Shared ladder, all 7 modes:**

| Leaving level | 1→2 | 2→3 | 3→4 | 4→5 | 5→6 | 6→7 | 7→8 | 8→9 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Coin-peg hits | **5** | **8** | **14** | **25** | **42** | **71** | **121** | **205** |

**Per-mode coin-peg probability** (replaces the single global `BONUS_PEG_HIT_PROB = 0.18`):

| Mode | Coin-peg probability | Change |
| --- | --- | --- |
| `tendrop` | **0.18** | unchanged |
| `twentydrop` | **0.18** | unchanged |
| `fiftydrop` | **0.18** | unchanged |
| `buystandard` | **0.0447** | new (was 0.18 with a flat bar of 16) |
| `buyenhanced` | **0.0292** | new (was 0.18 with a flat bar of 22) |
| `buypremium` | **0.0252** | new (was 0.18 with a flat bar of 29) |
| `buysuperfury` | **0.0283** | new (was 0.18 with a flat bar of 37) |

Everything else — entry balls, costs, wincaps, meter maxima, quotas — stays exactly as shipped.

**Verified result** — buys against the real `GameState.simulate_bonus_round` (`verify_buybonus.py`,
n = 150,000/tier); base modes re-solved with `measure_tuning_capped.py`:

| Mode | RTP | P(wincap hit) | Mean level | P(L≥2) | Mean balls | Max balls seen |
| --- | --- | --- | --- | --- | --- | --- |
| `buystandard` | 95.64 % | 1 in 6,803 | 1.22 | 21.9 % | 76 | 132 |
| `buyenhanced` | 95.76 % | 1 in 5,780 | 1.15 | 14.6 % | 98 | 155 |
| `buypremium` | 95.74 % | 1 in 1,136 | 1.30 | 30.5 % | 151 | 205 |
| `buysuperfury` | 95.68 % | 1 in 1,898 | 1.84 | 80.7 % | 257 | 299 |
| `tendrop` / `twentydrop` / `fiftydrop` | 95.700 % (unchanged) | — | 2.70 | 86 % | 122 | 5,200 |

* Cross-mode spread across the 7 feature modes = **0.12 %** (limit 1.00 %). Including the
  feature-free `onedrop` at 95.40 %, 0.36 %.
* Max win stays achievable everywhere by a wide margin (worst case 1 in 6,803, limit 1 in 20,000,000).
* `measure_tuning_capped.py` re-solves the base quotas to **exactly** the shipped
  `BONUS_IN_DROP_RATE` (0.00283 / 0.00253 / 0.01350), spread 0.000 % — confirming the base modes are
  untouched.
* Book size is unchanged for the base modes and *smaller* for the buys (max 299 balls vs the old 259
  — still nowhere near the 5,200-ball RAM risk).

**Why this is the recommendation**

* The three base modes are bit-for-bit unchanged, so their RTP, their max-win achievability and
  their RAM profile stay exactly where they were verified.
* No new concept is introduced. `BONUS_PEG_HIT_PROB` simply becomes a per-mode lookup.
* The lever is smooth and monotone (≈3–4 RTP points per 0.01 of probability), so it tunes to ±0.1 %
  easily.
* It is the only option that requires no re-solve of `BONUS_IN_DROP_RATE`.

**Known cost:** in a bought bonus the energy bar advances in ~3 chunky steps of 20 % rather than
~13 small steps of 6 %. The *number* of level-ups is unchanged (mean level 1.22 vs 1.22 today), but
the bar animates less. Option B exists to address exactly this.

---

## Option B — scale the whole ladder up ×2 for a livelier bar *(considered, not taken)*

**Shared ladder, all 7 modes:**

| Leaving level | 1→2 | 2→3 | 3→4 | 4→5 | 5→6 | 6→7 | 7→8 | 8→9 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Coin-peg hits | **10** | **16** | **27** | **46** | **78** | **132** | **224** | **380** |

Doubling the coin-peg probability alongside the ladder holds the level distribution roughly fixed,
so this is the *same* feature with a finer-grained bar: a bought bonus gets ~7.5 visible ticks
instead of ~3, and an earned bonus ~22 instead of ~11.

The complication is that in the base game the **same** probability also feeds the bonus-trigger
meter, so doubling it changes the trigger rate. There are two ways to absorb that, and they are
genuinely different amounts of work.

### B1 — separate the two probabilities *(lighter)*

Keep the paid drop at 0.18 and use 0.36 only for balls falling inside a bonus round. The base-game
trigger meter, its maxima (7 / 9 / 17) and its natural fire rates are then completely untouched.

| Mode | Paid-drop probability | In-bonus probability |
| --- | --- | --- |
| `tendrop` / `twentydrop` / `fiftydrop` | 0.18 (unchanged) | **0.36** |
| `buystandard` | — (no paid drop) | **0.1049** |
| `buyenhanced` | — | **0.0722** |
| `buypremium` | — | **0.0565** |
| `buysuperfury` | — | **0.0571** |

Cost: the earned-bonus mean payout moves 124.1 → 121.3, so `BONUS_IN_DROP_RATE` needs a small
re-solve (~2–3 %) — a full `make run`, but no structural retune. Concept cost: "a coin peg" now has
different odds in the base game and in the bonus, which is invisible to the player but is one more
thing to hold in your head.

### B2 — one probability per mode, re-space the trigger meter *(heavier)*

Use 0.36 everywhere in the base modes and move the trigger meter maxima to keep the bonus rare:

| Mode | Meter max today (p = 0.18) | Meter max at p = 0.36 | Natural fire rate |
| --- | --- | --- | --- |
| `tendrop` | 7 | **9** | 0.069 % |
| `twentydrop` | 9 | **14** | 0.208 % |
| `fiftydrop` | 17 | **28** | 0.307 % |

Those still scale with the ball count, satisfying requirement 1, and no split concept is needed.
Cost: `BONUS_IN_DROP_RATE` must be fully re-solved for all three base modes, and twice as many coin
pegs light up during a normal paid drop — livelier, or noisy, depending on taste.

**Modelled result (both B1 and B2):** buy RTPs 95.57 / 95.67 / 95.71 / 95.68 %, max-win hit rates
1 in 6,780 / 4,878 / 1,307 / 2,424 — indistinguishable from Option A.

**Cost common to B1 and B2**

* The deep tail thins: P(L≥5) drops from 1.72 % to 0.81 % and the largest bonus seen falls from
  5,200 balls to 720. That is good for RAM, but it lowers the in-bonus wincap hit rate on
  `fiftydrop` from 1 in 158 to 1 in 291. Still far above the compliance floor, but the "runaway
  jackpot" moment gets rarer.
* A full `make run` plus a fresh compliance report, rather than a buy-mode-only re-sim.

---

## What changed in the source

**Math SDK — `stake-math-sdk/games/crimson_plinko/`**

1. `plinko_data.py`
   * `BONUS_PEG_HIT_PROB_BY_MODE` + `bonus_peg_hit_prob(mode)` added; `BONUS_PEG_HIT_PROB = 0.18`
     kept as the default.
   * `BUY_BONUS_TIER_DEFS[..].levelup_pegs` → `peg_hit_prob`; `buy_bonus_levelup_pegs()` →
     `buy_bonus_peg_hit_prob()`.
2. `game_calculations.py`
   * `peg_hit_prob` threaded through `build_drop_outcomes`, `simulate_bonus_round` and
     `build_feature_meter_events` instead of reading the module-level constant.
   * `levelup_pegs_override` / the `buy_flat` branch in `threshold_for` deleted — `threshold_for` is
     now just `bonus_levelup_pegs(level)`.
3. `game_config.py` — every distribution carries `peg_hit_prob` in its conditions.
4. `gamestate.py` — reads that condition and passes it into both the drop and the feature walk.
5. `game_events.py` — **`bonusRound` now serialises `levelupPegs`.** It was computed but never
   written to the book, so the client could only ever size the level-1 bar; without this the
   escalating ladder is invisible to the player.
6. `run.py` — exports `bonusPegHitProbByMode` and `bonusLevelupPegs` into `config_fe_*.json`.
7. `verify_buybonus.py`, `gate_tune.py`, `confirm_x10.py` — retargeted from the deleted flat-bar
   lever to the coin-peg probability.

**Web SDK — `apps/plinko/`**

* `src/game-logic/constants.ts` — `BONUS_LEVELUP_PEGS` + `bonusLevelupPegs(level)` mirror.
* `src/game/gameOrchestrator.ts` — `sizeBonusMeterForLevel` takes the level and falls back to the
  mirrored ladder when a book omits `levelupPegs`, instead of reusing the previous level's threshold.

**Verification**

Done (results above):

```bash
env/Scripts/python.exe games/crimson_plinko/verify_buybonus.py 150000
```
```bash
env/Scripts/python.exe games/crimson_plinko/measure_tuning_capped.py
```

Still outstanding — these regenerate the published artefacts and must be run before release:

```bash
make run GAME=crimson_plinko
```
```bash
env/Scripts/python.exe games/crimson_plinko/compliance_report.py
```

Then `sync-math-books` into the web app.

---

## Risks and things that will bite

| Risk | Detail |
| --- | --- |
| **Runaway cascade** | The ×10 award ladder self-sustains once `award(L) × p ≥ threshold(L)`. On the current ladder the earned bonus is stable at p = 0.18 but **explodes at p = 0.25** (mean payout 125 → 1,519, mean level 2.7 → 5.0, P(L9) 0.001 % → 29.7 %). Any future increase to a base mode's coin-peg probability must be re-measured, not interpolated. |
| **Unpublished `levelupPegs`** | Until `game_events.py` serialises it, every in-bonus bar renders against the level-1 threshold. Two prior QA reports ("meter stops updating after level 4", "levelled up on a part-full bar") trace back to bar sizing; expect to re-test that area. |
| **Client fallback path** | `sizeBonusMeterForLevel` falls back to the previous threshold when `levelupPegs` is 0. Once the field is published the fallback stops being exercised — good, but it means the newly active path needs explicit QA. |
| **Buy-mode bar pacing** | Option A gives a bought bonus ~3 visible energy-bar ticks (Option B, ~7.5). Worth a look in-game before committing. |
| **Wincap re-check** | Both options change the buy modes' payout tail. `compliance_report.py` must confirm each advertised max win still appears in the published lookup tables at ≥ 1 / 20,000,000. |
| **Tuning precision** | The probabilities were solved on a fast model, then confirmed against the shipped `simulate_bonus_round` at n = 150,000/tier (95.64–95.76 %). The lever is ≈3–4 RTP points per 0.01 of probability, so a 4th-decimal change is worth ~0.04 % — re-run `verify_buybonus.py` after any nudge rather than interpolating. |
| **Stale local books** | `src/stories/data/base_books` (dev-local play, Storybook, `devLocalBet.ts`) still holds pre-change books: buy books whose level-ups came off a flat 16–37 bar and which carry no `levelupPegs`. Until `sync-math-books` refreshes them, a dev-local bought bonus renders its bar against the new 5/8/14 ladder while the book's level-ups were authored against the old one. Self-resolving; do not chase it as a bug. The same applies to any replay of a book generated before this change. |
| **Art** | Nothing in either option changes the arch tile labels or the wheel values, so no art regeneration is needed. |
