# Bonus mode — defined values and probabilities, per mode

Every value below is the **shipped** configuration. Source of truth is
`stake-math-sdk/games/crimson_plinko/plinko_data.py` unless stated otherwise.

Probabilities marked *(derived)* are closed-form from the binomial the math actually samples.
Probabilities marked *(modelled)* are Monte-Carlo estimates of the real `simulate_bonus_round` walk;
they carry sampling error in the last digit and should be re-confirmed with
`measure_tuning_capped.py` / `verify_buybonus.py` after any change.

---

## 1. Board

| Item | Value |
| --- | --- |
| Rows (math contract) | 14 → 15 pockets |
| Shared board (`BOARD_SLOT_MULTIPLIERS`) | `100, 50, 20, 5, 1.5, 0.4, 0.2, 0, 0.2, 0.4, 1.5, 5, 20, 50, 100` |
| Shared board EV per ball | **0.89635** *(derived)* |
| 1-ball board (`onedrop` only) | `100, 50, 20, 5, 1.5, 0.4, 0.25, 0.2, 0.25, 0.4, 1.5, 5, 20, 50, 100` |
| 1-ball board EV per ball | **0.95657** *(derived)* — this **is** the `onedrop` RTP; that tier has no feature and no quota |
| Centre pocket (index 7) | Free-spin pocket on 10 / 20 / 50 — pays 0×, feeds the spin meter. On `onedrop` it is an ordinary paying pocket (0.2×). |
| P(ball lands centre) | **0.20947** = C(14,7)/2¹⁴ *(derived)* |
| Target RTP (`TARGET_RTP`) | 0.957 |
| Compliance band | 90.00 % – 96.70 %, all modes inside a 1.00 %-wide window |

## 2. Coin-peg probability — **per mode**

Per ball, independent of where the ball lands, `hitBonusPeg` is rolled at this probability. It drives
**both** meters: the per-drop bonus trigger in the base game and the in-bonus energy/level-up meter.

`BONUS_PEG_HIT_PROB_BY_MODE`, published on each distribution's `peg_hit_prob` condition:

| Mode | Coin-peg probability | Mean coin pegs per 100 balls |
| --- | --- | --- |
| `onedrop` | 0.18 | 18 |
| `tendrop` | 0.18 | 18 |
| `twentydrop` | 0.18 | 18 |
| `fiftydrop` | 0.18 | 18 |
| `buystandard` | **0.04487** | 4.5 |
| `buyenhanced` | **0.02931** | 2.9 |
| `buypremium` | **0.02515** | 2.5 |
| `buysuperfury` | **0.02846** | 2.8 |

`BONUS_PEG_HIT_PROB = 0.18` remains as the default for any mode not listed.

This is the **RTP lever that lets all seven feature modes share one level-up ladder** (§6a). A buy
tier enters the bonus with 72–239 fixed balls; on the shared ladder at 0.18 those balls would run the
×10 award cascade away to level 9 (RTP 145–252 %, ~5,100 balls per book). Lowering the probability
means a bought bonus needs the same 5 / 8 / 14 / … hits to climb, but collects them far more slowly.

⚠️ The cascade self-sustains just above the base value. Measured on the earned bonus: p = 0.18 gives
a mean payout of 125 and P(level 9) = 0.001 %; **p = 0.25 gives a mean payout of 1,519 and P(level 9)
= 29.7 %**. Never interpolate an increase — re-measure it.

## 3. Per-drop BONUS-TRIGGER meter (base game)

`BONUS_METER_TIER` — the meter starts empty every drop and fires the bonus when this drop's own
coin-peg hits reach `max`. The maximum **scales up with the ball count**, as intended:

| Mode | Balls / drop | Meter max | Mean pegs per drop | Natural fire rate *(derived)* | Quota `BONUS_IN_DROP_RATE` | Total bonus rate *(derived)* |
| --- | --- | --- | --- | --- | --- | --- |
| `onedrop` | 1 | 20 (cosmetic, never fires) | 0.18 | — | 0 | **0** |
| `tendrop` | 10 | **7** | 1.8 | 0.0440 % (1 in 2,272) | 0.323 % | 0.367 % (1 in 273) |
| `twentydrop` | 20 | **9** | 3.6 | 0.4877 % (1 in 205) | 0.298 % | 0.786 % (1 in 127) |
| `fiftydrop` | 50 | **17** | 9.0 | 0.5005 % (1 in 200) | 1.333 % | 1.834 % (1 in 55) |

`start_ratio` is 0 on all three tiers — no head start.

Note the shape: the *absolute* bar rises (7 → 9 → 17) while the bar as a *fraction of the ball
count* falls (0.70 → 0.45 → 0.34). That is what makes a 50-ball drop reach the bonus about 5×
more often per drop than a 10-ball drop. The 10-ball bar was deliberately raised 6 → 7 when the
entry wheel went back to a mean of 60 free balls: at 6 that tier's natural fire rate alone put it at
96.198 % RTP, i.e. above target with a zero quota and no lever left.

Buy modes have no paid drop — the trigger meter is pre-filled to full and the bonus fires
immediately, so this table does not apply to them.

## 4. Per-drop FREE-SPIN meter (base game)

`SPIN_METER_TIER` — resets every round to `round(max × start_ratio)`, fills on centre-pocket lands.

| Mode | Balls / drop | Max | Start ratio | Start | Centre lands needed | In-drop fire rate *(derived)* |
| --- | --- | --- | --- | --- | --- | --- |
| `onedrop` | 1 | — | — | — | no free spin | 0 |
| `tendrop` | 10 | 6 | 0 | 0 | 6 | 0.809 % (1 in 124) |
| `twentydrop` | 20 | 10 | 0.125 | 1 | 9 | 1.354 % (1 in 74) |
| `fiftydrop` | 50 | 21 | 0.25 | 5 | 16 | 4.523 % (1 in 22) |

Free-spin wheel (`FREE_SPIN_SEGMENTS`, equal weights, 8 slices):

| Segment | `2X` | `0.5X` | `1X` | `5X` | `10X` | `BONUS` | `20X` | `15X` |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Weight | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 |
| P | 12.5 % | 12.5 % | 12.5 % | 12.5 % | 12.5 % | 12.5 % | 12.5 % | 12.5 % |

* A numeric segment pays `bet per ball × M`.
* `BONUS` (12.5 %) chains a free bonus round.
* Mean numeric multiplier = **7.6429**; unconditional mean including the `BONUS` wedge as 0× cash =
  6.6875 plus the value of the chained bonus.
* Inside a bonus round `BONUS` is re-rolled, so an in-bonus free spin is always numeric (mean 7.6429).

## 5. Bonus entry free balls

| Source | Values | Mean |
| --- | --- | --- |
| `BONUS_WHEEL_FREE_BALLS` (earned bonus, all of 10 / 20 / 50) | `100, 90, 80, 70, 60, 50, 40, 30, 20` — uniform over 9 wedges | **60** |
| `buystandard` | fixed 72 | 72 |
| `buyenhanced` | fixed 95 | 95 |
| `buypremium` | fixed 145 | 145 |
| `buysuperfury` | fixed 239 | 239 |

⚠️ The wheel list is **wedge order from the pointer** and must match the painted art exactly. A
mismatch pays the player a different number from the one the wheel visibly landed on.

## 6. Level ladder

| Level | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Arch tile label | 1 | 2 | 4 | 8 | 16 | 32 | 64 | 128 | 256 |
| Free balls awarded on reaching | — | 20 | 40 | 80 | 160 | 320 | 640 | 1280 | 2560 |

`BONUS_LEVEL_BALL_MULTIPLIER = 10`; award = tile label × 10. Level 1 gets no award.
`MAX_BONUS_LEVEL = 9`.

### 6a. Coin-peg hits needed to leave each level — **identical in all 7 feature modes**

`BONUS_LEVELUP_PEG_HITS_BY_LEVEL` = `round(BONUS_LEVELUP_BASE × BONUS_LEVELUP_GROWTH^(L-1))` with
`BASE = 5`, `GROWTH = 1.7`:

| Leaving level | 1→2 | 2→3 | 3→4 | 4→5 | 5→6 | 6→7 | 7→8 | 8→9 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Pegs needed | **5** | **8** | **14** | **25** | **42** | **71** | **121** | **205** |

An earned bonus and a bought bonus need exactly these hits. There is no per-mode override; the buy
tiers are held at target RTP by their lower coin-peg probability (§2) instead. See
[unified-levelup-proposal.md](unified-levelup-proposal.md) for the derivation and the alternatives
that were rejected.

The book publishes this per level on `bonusRound.levelupPegs`, and the client mirrors it as
`BONUS_LEVELUP_PEGS` in `constants.ts` purely as a fallback for a book that omits the field.

**Why it escalates rather than being flat:** the free-ball award ladder is exponential (×2 per
level), so a flat threshold is bimodal — either the round stalls at level 1–2, or one award becomes
large enough to pay for the next level-up and the round runs away to level 9 (~5,100 balls: an RTP
blow-up and an out-of-memory risk during book generation). Growth of 1.7 sits just below the ×2
award growth, which keeps each level about as hard as its award is large.

## 7. Measured bonus-round profile *(modelled, n = 150,000 per row)*

Earned bonus (wheel entry, mean 60 balls), escalating ladder, p = 0.18:

| Tier | In-bonus spin max | Mean raw payout (× bet/ball) | After wincap | P(wincap hit) | Mean level | L≥2 | L≥3 | L≥4 | L≥5 | L≥6 | L≥9 | Mean balls | Max balls seen |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 10 | 6 | 124.1 | 118.9 | 1 in 12 | 2.70 | 86.1 % | 59.2 % | 22.5 % | 1.86 % | 0.053 % | 0.0007 % | 122 | 5,200 |
| 20 | 10 | 121.1 | 118.8 | 1 in 30 | 2.70 | 86.1 % | 59.4 % | 22.5 % | 1.77 % | 0.053 % | 0.0013 % | 122 | 5,200 |
| 50 | 21 | 115.0 | 114.6 | 1 in 158 | 2.70 | 86.2 % | 59.5 % | 22.4 % | 1.79 % | 0.052 % | 0.0007 % | 122 | 5,200 |

The bonus payout distribution is tier-independent apart from two things: the in-bonus free-spin
threshold (6 / 10 / 21 — a 10-ball tier fires it far more easily) and the wincap that clips the tail.

Buy bonuses on the shared ladder, each at its own coin-peg probability — **measured through the real
`GameState.simulate_bonus_round`** (`rtp_audit.py`, n = 150,000 per tier):

| Mode | Entry | Peg prob | Cost | Wincap | RTP | P(wincap hit) | Mean level | Mean balls | Max balls seen |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `buystandard` | 72 | 0.04487 | 80 | 250× | **95.689 %** | 0.0300 % (1 in 3,333) | 1.22 | 77 | 132 |
| `buyenhanced` | 95 | 0.02931 | 100 | 300× | **95.659 %** | 0.0087 % (1 in 11,494) | 1.15 | 98 | 155 |
| `buypremium` | 145 | 0.02515 | 150 | 350× | **95.706 %** | 0.0440 % (1 in 2,273) | 1.30 | 151 | 205 |
| `buysuperfury` | 239 | 0.02846 | 250 | 500× | **95.762 %** | 0.0327 % (1 in 3,058) | 1.85 | 257 | 299 |

And the four base modes at the same measurement (the 1-ball tier is closed-form — it has no feature):

| Mode | Quota | Wincap | RTP |
| --- | --- | --- | --- |
| `onedrop` | — (feature-free) | 100× | **95.657 %** *(derived)* |
| `tendrop` | 0.00323 | 250× | **95.703 %** |
| `twentydrop` | 0.00298 | 300× | **95.707 %** |
| `fiftydrop` | 0.01333 | 400× | **95.698 %** |

* **All eight published modes span 95.657 %–95.762 %: a 0.104 % cross-mode spread against Stake's
  0.50 % limit.** It was 0.66 % (see §9).
* Every advertised max win is produced far above the 1 / 20,000,000 achievability floor.
* Largest book seen is 299 balls — nowhere near the ~5,200-ball runaway that the old flat buy bar
  existed to prevent.
* The level-up *frequency* is unchanged from the old flat bars (mean level was 1.22 / 1.12 / 1.29 /
  1.87). Only the bar the player watches is different: the same threshold everywhere, filled by
  fewer, larger ticks.
* ⚠️ Don't re-tune on the last ~0.05 % of a buy tier. A bought bonus's ball count is heavy-tailed (a
  rare level 5–6 adds 160–320 balls at once), so the estimator's own uncertainty is ~±0.05 % per tier
  even at n = 150,000 — larger than its printed SE, which only covers the sampled ball-count variance.

## 8. Max win (wincap) ladder

`WINCAP_BY_BALLS` / `BUY_BONUS_TIER_DEFS[..].wincap`. The advertised max must be achievable
(≥ 1 / 20,000,000), which is why it is per-mode rather than flat.

| Mode | Max win (× bet per ball) | Measured hit rate |
| --- | --- | --- |
| `onedrop` | 100× (the board's top pocket — that tier has no features) | 2 / 16,384 = 1 in 8,192 *(derived)* |
| `tendrop` | 250× | per bonus, see §7 |
| `twentydrop` | 300× | per bonus, see §7 |
| `fiftydrop` | 400× | per bonus, see §7 |
| `buystandard` | 250× | 1 in 3,043 buys *(modelled)* |
| `buyenhanced` | 300× | 1 in 10,000 buys *(modelled)* |
| `buypremium` | 350× | 1 in 2,692 buys *(modelled)* |
| `buysuperfury` | 500× | 1 in 3,043 buys *(modelled)* |

The buy caps were raised/lowered from 260 / 290 / 330 / 480 on request. Each still sits inside its tier's
**organic** payout tail (raw maxima of 294 / 336 / 436 / 598 were seen above the respective caps at
n = 70,000 per tier), so every advertised max win is still produced far above the 1 / 20,000,000
achievability floor. Moving a cap by ±10–20× barely moves RTP — it only re-prices the ~0.01–0.04 % of
bonuses that reach it — so `peg_hit_prob` remains the lever that holds each buy tier at target.

## 9. Declared RTP per mode

| Mode | Declared RTP | Why |
| --- | --- | --- |
| `onedrop` | 0.95657 | Feature-free — the board is all it pays, so this is its board EV exactly. Publishing 0.957 would overstate it by 0.043 %. |
| `tendrop` / `twentydrop` / `fiftydrop` | 0.957 | Tuned to `TARGET_RTP` by the bonus quota (`BONUS_IN_DROP_RATE`). |
| all 4 buy modes | 0.957 | Tuned to `TARGET_RTP` by `peg_hit_prob` at the PDF-fixed cost and fixed `entry_balls`. |

### Why these moved

`onedrop` used to declare 0.95396 and its board used to pay centre 0.1× / sides 0.3×. That left it
**0.30 % below** the 95.70 % every other mode targets, and the low tiers' quotas had been solved from a
sampled-payout tuner whose ~0.2 % of noise mis-set them (published `tendrop` 95.01 %, `twentydrop`
95.38 %). Together those two things produced a **0.66 % cross-mode RTP spread against Stake's 0.50 %
limit**. The fix was to re-cut the 1-ball board to 95.657 %, re-solve every lever with the closed-form
`rtp_audit.py`, and raise the published sim counts so the graded LUT means carry ≤ 0.10 % of sampling
error each (see the sizing note in the math `run.py` — at the old counts the range breached 0.50 % about
40 % of the time even with identical true RTPs).

## 10. Client mirrors that must stay in step

| Math constant | Client mirror |
| --- | --- |
| `BONUS_METER_TIER` | `BONUS_METER_TIER` in `src/game-logic/constants.ts` |
| `SPIN_METER_TIER` | `SPIN_METER_TIER` in `src/game-logic/constants.ts` |
| `BONUS_WHEEL_FREE_BALLS` | `BONUS_WHEEL_FREE_BALLS` + `ART_SLOT_FREE_BALLS` in `BonusRoulette.svelte` |
| `FREE_SPIN_SEGMENTS` / `FREE_SPIN_WEIGHTS` | same names in `constants.ts` |
| `BONUS_LEVEL_LABELS` / `BONUS_LEVEL_BALLS` | same names in `constants.ts` |
| `BUY_BONUS_TIER_DEFS` (cost / wincap / entry) | `betModes` in `src/game/config.ts`, `BUY_BONUS_TIERS` in `src/game/plinkoBetMode.ts` |
| `BONUS_LEVELUP_PEG_HITS_BY_LEVEL` | `BONUS_LEVELUP_PEGS` in `constants.ts` — **fallback only**; the book's `bonusRound.levelupPegs` wins |
| `BONUS_PEG_HIT_PROB_BY_MODE` | **no mirror needed** — every coin-peg hit is authored per ball in the book (`outcomes[].hitBonusPeg`); exported to `config_fe_*.json` as `bonusPegHitProbByMode` for reference only |
