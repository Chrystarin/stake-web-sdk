# Bonus mode — how it works

This describes the **shipped** behaviour. Every number quoted here is tabulated with its source in
[bonus-values.md](bonus-values.md).

---

## 1. The modes

Eight bet modes are published. `cost` is always a multiple of the **bet per ball** (a Stake mode's
cost is `× amount`, never `× total bet`).

| Mode | Cost | Kind | Bonus reachable? |
| --- | --- | --- | --- |
| `onedrop` | 1 | base, 1 ball per drop | **No — feature-free** |
| `tendrop` | 10 | base, 10 balls per drop | Yes |
| `twentydrop` | 20 | base, 20 balls per drop | Yes |
| `fiftydrop` | 50 | base, 50 balls per drop | Yes |
| `buystandard` | 80 | buy bonus | Always |
| `buyenhanced` | 100 | buy bonus | Always |
| `buypremium` | 150 | buy bonus | Always |
| `buysuperfury` | 250 | buy bonus | Always |

The seven modes other than `onedrop` are collectively "the feature modes"; everything below applies
to them.

`onedrop` is deliberately excluded: a single ball can contribute at most one coin-peg hit, so it can
never fill a bonus meter, and its bonus quota is omitted from `game_config.py` entirely. Its books
can therefore never contain a `bonusRoulette` / `bonusRound` / `freeSpinTrigger` event, and the
client enforces the same rule independently (`isSingleBallMode`).

---

## 2. Two different meters, both called "the bonus meter"

This is the single most common source of confusion, so it is worth being explicit.

### 2a. The per-drop BONUS-TRIGGER meter (base game only)

* Lives in the **normal game**, on the 10 / 20 / 50 tiers.
* Starts **empty every drop** — there is no carry across bets. The game is stateless per bet.
* Fills by **+1 for each ball in this drop whose book outcome carries `hitBonusPeg`**.
* Its maximum is `BONUS_METER_TIER[balls].max` — **7 / 9 / 17** for 10 / 20 / 50 balls per drop.
  This maximum is literally "how many coin-peg hits this one drop must produce", so it **scales up
  with the ball count** (more balls ⇒ more hits per drop ⇒ a higher bar is needed to keep the
  bonus rare).
* Reaching the maximum fires the bonus **in-drop**, inside the same book.

### 2b. The in-bonus ENERGY meter (bonus mode only)

* Lives **inside** a bonus round. Different meter, same on-screen bar.
* Starts empty, fills by +1 per coin-peg hit on the falling **free** balls.
* Its maximum is the **level-up threshold for the level you are currently on** — see §4.
* Reaching the maximum **levels you up**, resets the meter to 0, and awards more free balls.

Whenever this document says "the meter fills", the surrounding section tells you which of the two.

---

## 3. The four ways a bonus starts

| # | Path | Modes | Mechanism |
| --- | --- | --- | --- |
| 1 | **Meter completion** | 10 / 20 / 50 | The per-drop trigger meter fills from this drop's own coin pegs (§2a). |
| 2 | **Quota stratum** | 10 / 20 / 50 | A small `force_bonus` distribution guarantees a bonus so the mode lands exactly on target RTP. `ensure_coin_pegs_fill_meter` flips enough balls' `hitBonusPeg` flags that the meter fills 0→max from *real* hits, spread across the drop, so the player still watches an organic completion instead of a snap. This is EV-neutral: `hitBonusPeg` is independent of where a ball lands. |
| 3 | **Free-spin wheel `BONUS` segment** | 10 / 20 / 50 | The in-drop free-spin wheel has a `BONUS` wedge (1 of 8). Landing it chains a free bonus round. |
| 4 | **Buy bonus** | the 4 buy modes | The paid drop is **empty** (no base balls). The trigger meter is pre-filled to full and the bonus fires immediately, seeded with the tier's **fixed** entry ball count instead of a wheel spin. |

In paths 1–3 the bonus is **free**: the player pays only the normal drop cost, and the bonus is
funded by the lowered board EV (≈0.896 per ball rather than a fair ~1.0). The whole bonus resolves
inside that same book, which settles `drop win + bonus win` as one bet.

---

## 4. Inside a bonus round

### 4.1 Entry balls

An entry ball count is awarded first and emitted as a `bonusRoulette` event.

* **Earned bonus** (paths 1–3): drawn uniformly from the bonus wheel — `[100, 90, 80, 70, 60, 50,
  40, 30, 20]`, mean **60**. Tier-independent: a 10-ball drop and a 50-ball drop win the same
  distribution of free balls.
  *The wheel art is the source of truth for these numbers.* They must match what is painted on
  `wheel_values.png` in wedge order, or the player is paid a different number from the one they
  watched the wheel land on.
* **Buy bonus** (path 4): a fixed per-tier count (72 / 95 / 145 / 239) — no wheel spin.

### 4.2 The level ladder

The bonus starts at **level 1** and can climb to **level 9**. The on-screen arch tiles show
`1, 2, 4, 8, 16, 32, 64, 128, 256`.

Reaching level *L* awards `label(L) × 10` extra free balls:

| Level reached | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Free balls awarded | 20 | 40 | 80 | 160 | 320 | 640 | 1280 | 2560 |

Level 1 has **no** ladder award — its balls come only from the wheel (or the buy).

To leave level *L* you must land `bonus_levelup_pegs(L)` coin-peg hits on the in-bonus energy meter.
The threshold **escalates with the level**, and it is **the same in all seven feature modes** — an
earned bonus and a bought bonus cost identical hits to climb (see
[bonus-values.md §6a](bonus-values.md#6a-coin-peg-hits-needed-to-leave-each-level--identical-in-all-7-feature-modes)).
What differs per mode is how often a falling ball awards one of those hits, and that per-mode
coin-peg probability is the RTP lever.

The escalation is not cosmetic: the ball award ladder is exponential (×2 per level), so a **flat**
threshold makes the feature bimodal — either it stalls at level 1–2, or one award becomes large
enough to pay for the next level-up and the round runs away to level 9 (~5,000 balls: an RTP blow-up
and an out-of-memory risk during book generation). An escalating threshold whose growth is close to,
but below, the award growth keeps every level roughly equally hard *relative to its award*, so
leveling is frequent and graduated at low levels and progressively harder at high ones.

### 4.3 Ball flow and the "combine"

Awarded balls are queued behind the balls currently falling. The math walks them in FIFO batches and
emits one `bonusRound` event per level, carrying that level's balls and their outcomes.

On the client, the level-up fires **the instant the energy bar fills** — mid-drop — and the newly
awarded balls are poured into the still-falling pool rather than queued as a separate wave
(`combineNextBonusLevelNow`). This is a presentation-only decoupling: the level count, the awards
and every ball outcome remain server-authoritative, so RTP is untouched.

The bar the player sees is sized from what the book will actually deliver, not from the raw
threshold, so a level's bar always completes exactly on the hit that levels it up
(`sizeBonusMeterForLevel` / `applyBonusMeterLevelMax`).

### 4.4 The in-bonus free spin

The free-spin meter also runs during the bonus, fed by bonus balls landing in the centre pocket.
It starts at 0 (the per-tier head start applies to paid drops only) and its maximum is the tier's
`SPIN_METER_TIER[balls].max`; a buy uses the 10-ball reference, so 6.

At the **end of each level's batch**, if the spin meter is full, one free spin fires and the meter
resets — so a deep bonus can fire several. The segment is re-rolled if it lands `BONUS`, to prevent
a bonus recursing into itself, and pays `bet per ball × multiplier`.

### 4.5 End of the round

When the queue empties, the bonus is over. The client shows the post-bonus treasure/total-win screen
and settles at that screen's full cover; a bonus round shows **one** win presentation, not both the
treasure screen and the standard win celebration.

---

## 5. Book events

A bonus-bearing book looks like this:

```
plinkoDrop      rowCount, ballsPerDrop, coefficients, spinMeterMax, bonusMeterMax,
                spinMeterStart, bonusMeterStart, bonusLevelStart, outcomes[]
bonusMeter      value, level                      ← per coin-peg hit during the paid drop
...
bonusRoulette   freeBalls                         ← entry balls
bonusMeter      value, level, max                 ← in-bonus meter reset + level-1 threshold
bonusRound      freeBalls, outcomes[], level, ballsPlayed, levelupPegs  ← one per level
freeSpinTrigger segment, multiplier, amount, level ← optional, at a level boundary
...
setTotalWin / finalWin
```

Each ball outcome is `{ rateIndex, multiplier, amount, hitBonusPeg, hitSpinSlot }`. All randomness
is resolved server-side; the client only animates what the book already decided.

`bonusRound.levelupPegs` is what the client sizes each level's energy bar from
(`bookEventHandlerMap.ts` → `sizeBonusMeterForLevel`). Because the threshold escalates, the level-1
value on the `bonusMeter` event is not enough on its own; a book that omits the field falls back to
the client's mirrored `BONUS_LEVELUP_PEGS` table for that level.

---

## 6. Why the RTP levers are where they are

Per-mode RTP is `mean(min(payout, wincap)) / cost`, and must sit inside Stake's 90.00 %–96.70 %
band with all modes within a 1.00 %-wide window. The target is 95.70 % (`TARGET_RTP`).

The board is deliberately *under*-fair (0.89635 per ball on the shared 14-row table) so that the
free bonus and free spin can be funded without breaching the cap. Each feature mode is then trimmed
to target with a lever that does **not** touch the board:

| Mode kind | Primary lever | Secondary |
| --- | --- | --- |
| 10 / 20 / 50 | `BONUS_IN_DROP_RATE` — the quota of drops that force a bonus | `BONUS_METER_TIER[..].max` — the natural trigger rate |
| buy tiers | `BUY_BONUS_TIER_DEFS[..].peg_hit_prob` — how fast a bought bonus climbs the shared ladder | `entry_balls` at a fixed cost |
| 1 | **the board itself** (`ONE_BALL_BOARD_SLOT_MULTIPLIERS`) — feature-free, so its pocket values *are* its RTP | — |

Solve those levers with **`rtp_audit.py`**, not the older `measure_tuning_capped.py` / `verify_buybonus.py`.
Both of those average sampled payouts, and the board's 100× corners leave ~0.2 % of noise on the read at
their sample counts; the quota lever is ~11 RTP points per 0.001, so solving from them put the published
`tendrop` at 95.01 % and `twentydrop` at 95.38 %. `rtp_audit.py` takes the feature-fire rates from the
binomial in closed form and folds the board in as its exact analytic EV × the sampled ball count, reading
every mode to ±0.01–0.03 %.

Sim counts matter too: Stake grades RTP off the published LUT, so each figure carries `sd_book/sqrt(n)`
of sampling error. See the sizing note in the math `run.py`.

The level-up ladder itself is deliberately **not** a per-mode lever — it is the one number the player
reads off the screen, so it has to mean the same thing everywhere.

The advertised max win must additionally be *achievable* (hit rate ≥ 1 / 20,000,000), which is why
the wincap is a per-tier ladder set at each mode's organic payout tail rather than one flat number.
