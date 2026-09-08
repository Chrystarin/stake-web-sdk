# Money-Wheel Game Show (Crazy Time-style) — Game Design Document & Stake Engine Feasibility

Prepared 2026-09-04 for the question: *"How long would it take to make Plinko a bonus game — like Evolution's Crazy Time?"*

This document has four parts:

1. **What is actually being asked** — three readings of the question, and which one we recommend answering.
2. **Reference: how Evolution's Crazy Time works** — the complete rule set, so everyone argues from the same facts.
3. **Our version** — a design spec for a single-player RNG money-wheel game on Stake Engine, with our Plinko as one of the bonus games.
4. **Feasibility on Stake Engine, limitations, and effort estimates.**

---

## 1. Clarifying the ask

"Make Plinko a bonus game like Crazy Time" can mean three different projects. They differ by an order of magnitude in effort.

| Reading | What gets built | Feasible on Stake Engine? | Rough size |
| --- | --- | --- | --- |
| **A. New game-show wheel title, Plinko is one of its bonus games** (most literal: in Crazy Time, "Pachinko" *is* a Plinko board used as a bonus) | A new game: 54-segment money wheel + Top Slot + 3–4 bonus games. Our existing Plinko board becomes the "Pachinko" bonus. | Yes, as an RNG single-player game (no live host, no shared table). | New title. ~5–6 months to submission for one developer with Claude Code doing math and front end; ~3–3.5 months for a cut-down MVP. |
| **B. Bolt a game-show style bonus onto the existing Plinko** | Existing Plinko stays the base game; the current 9-level ladder / free-spin wheel gets replaced or extended by a Crazy-Time-style wheel with mini-games. | Yes, but it reopens the whole math (all 8 modes re-simulated, RTP spread re-approved). | ~8–11 weeks, most of it math + re-verification. Note the Plinko already has two wheels and a bonus ladder, so the question is what this adds. |
| **C. Trigger our Plinko as a bonus from *another* game (cross-game bonus)** | Some other title fires a Plinko round. | **No.** Every Stake Engine game is a self-contained set of pre-simulated books; there is no cross-game state or trigger. | Not buildable. The Plinko would have to be re-implemented *inside* that other game's math and client (which is reading A). |

**Recommendation:** answer the boss with reading **A**, because that is what Crazy Time literally is, and because it is the only reading that produces a new product. The rest of this document specs A in full. Reading B is estimated in §5 for completeness.

One sentence you can send back: *"Crazy Time is a money wheel where Plinko ('Pachinko') is one of four bonus rooms. We can build a single-player RNG version of that on Stake Engine, reusing our Plinko board, wheel components and RGS plumbing. It is a new game, not a patch: with me doing both math and front end alongside Claude Code, and art coming from the artist as today, roughly 5–6 months to submission, or 3–3.5 months for an MVP with two bonus rooms."*

---

## 2. Reference: how Evolution's Crazy Time works

Crazy Time (Evolution, July 2020) is a **live-dealer** game show: a physical 54-segment wheel spun by a host in a Riga studio, an RNG-driven "Top Slot" above it, and four bonus rooms. Players bet on where the wheel stops. Below are the rules as published in Evolution's game help and independent analyses (sources at the end).

### 2.1 Round flow (live version)

1. **Betting time** (roughly 13–15 s). Players place chips on any of 8 bet spots, any combination, any amounts within table limits.
2. **Top Slot spins** the moment betting closes (two independent reels).
3. **Host spins the wheel.** Segment under the flapper is the result.
4. **Number result:** number bets on that spot are paid (with Top Slot multiplier if it aligned). Round ends.
5. **Bonus result:** the game moves to that bonus room. **Only players who bet on that bonus spot participate.** Everyone else watches.
6. Bonus resolves, bonus bets are paid, round ends. Full cycle in the live game is about 2–2.5 minutes.

### 2.2 Bet spots and base payouts

| Spot | Segments (of 54) | Hit probability | Pays |
| --- | --- | --- | --- |
| 1 | 21 | 38.89% | 1:1 |
| 2 | 13 | 24.07% | 2:1 |
| 5 | 7 | 12.96% | 5:1 |
| 10 | 4 | 7.41% | 10:1 |
| Coin Flip | 4 | 7.41% | bonus multiplier |
| Pachinko | 2 | 3.70% | bonus multiplier |
| Cash Hunt | 2 | 3.70% | bonus multiplier |
| Crazy Time | 1 | 1.85% | bonus multiplier |

Numbers occupy 45 segments (83.3%), bonuses 9 (16.7%). Some bonus is hit about once every 6 spins; the Crazy Time room about once every 54.

Table limits vary per operator, typically 0.10–0.25 minimum and 5,000 maximum per spot. A €500,000 per-player payout cap applies.

### 2.3 Top Slot

- Two reels above the wheel. **Left reel** picks one of the 8 bet spots. **Right reel** picks a multiplier: 2×, 3×, 4×, 5×, 7×, 10×, 15×, 20×, 25×, 50× (or a "miss" position between values).
- If the two reels **align horizontally**, the multiplier is attached to that spot for this round only.
  - If it is a **number**, and the wheel lands on that number, the payout is multiplied (e.g. 10 with 25× pays 250:1).
  - If it is a **bonus**, and the wheel lands on that bonus, **every multiplier in that bonus room is multiplied** before the room is played.
- If the reels do not align, or the wheel lands elsewhere, nothing happens.
- Independent estimate of the right-reel distribution (Wizard of Odds, from tracked data): miss 21.5%, 2× 25.0%, 3× 21.3%, 4× 10.2%, 5× 9.0%, 7× 5.3%, 10× 3.4%, 15× 1.7%, 20× 1.3%, 25× 0.8%, 50× 0.3%. Average multiplier when not a miss ≈ 3.8×.

### 2.4 Coin Flip (4 segments)

- A two-sided coin, **red** and **blue**. The RNG assigns a multiplier to each side and shows both before the flip.
- Low side typically 2×–5× (2×: 29%, 3×: 34%, 4×: 20%, 5×: 18%), high side 7×–100× (100× about 0.8%). Average win ≈ 9.3×.
- The host presses Flip; a mechanical flipper flips the coin; the face-up side pays.
- **Rescue Flip:** if the outcome is low, the game may flip again automatically with new multipliers.
- With a Top Slot 50× on Coin Flip the maximum is **5,000×** (100 × 50).

### 2.5 Cash Hunt (2 segments)

- A wall of **108 random multipliers**, shown briefly, then covered by symbols (hats, cakes, ducks, etc.) and **shuffled**.
- Each player independently aims a cannon at one symbol before a countdown ends. If they do not choose, a target is picked for them.
- The cannon fires; the chosen multiplier is revealed and paid. Everyone can win a different amount.
- Board multipliers run from 5× up to 500×; several board layouts exist with different distributions. Average win ≈ 19.5×.
- With Top Slot 50× the maximum is **25,000×** (500 × 50). Some third-party sources quote 12,500×; Evolution's own maximum-payout list says 25,000×.

### 2.6 Pachinko (2 segments) — the Plinko bonus

- A large pegged wall: **16 drop zones** at the top, **16 landing zones** at the bottom. Each landing zone shows a multiplier or **DOUBLE**.
- The host drops the puck from one of the middle zones (4–12, chosen randomly). It bounces down through the pegs and lands.
- **Multiplier:** paid, bonus ends.
- **DOUBLE:** every multiplier on the wall doubles and the puck is dropped again. This repeats until it lands on a multiplier or the values reach the **10,000×** cap.
- **Rescue Drop:** if the puck lands on 2×, 3× or 4×, the game may raise all the low values and drop again.
- Average win ≈ 17.6×. Maximum **10,000×**.

### 2.7 Crazy Time (1 segment)

- Players enter a virtual room with a **64-segment** giant wheel and **three flappers**: green, blue, yellow.
- Each player picks a flapper before a countdown (auto-picked if they do not).
- The wheel spins. Each player wins the multiplier under **their** flapper. Segments carry multipliers plus **DOUBLE** and **TRIPLE** wedges.
- Landing on DOUBLE/TRIPLE under a flapper multiplies every value on the wheel by 2 or 3 **for the players on that flapper** and the wheel re-spins, until the **20,000×** cap.
- Four wheel layouts exist with different DOUBLE/TRIPLE frequencies. Average win ≈ 36.4×. Maximum **20,000×**.

### 2.8 Return to player and caps

Evolution publishes a different RTP per bet spot (players choose their own exposure):

| Spot | RTP |
| --- | --- |
| 1 | 96.08% |
| 2 | 95.95% |
| 5 | 95.78% |
| 10 | 95.73% |
| Coin Flip | 95.70% |
| Cash Hunt | 95.27% |
| Pachinko | 94.33% |
| Crazy Time | 94.41% |

Maximum multipliers: Coin Flip 5,000×, Pachinko 10,000×, Crazy Time 20,000×, Cash Hunt 25,000×. Absolute cap €500,000 per player per round.

Wizard of Odds' reverse-engineered model shows that the same wheel with tuned Top Slot pairing can hit **96.06–96.08% on every spot**, which matters for us (see §4: Stake requires a tight RTP spread across modes).

### 2.9 Presentation features worth copying

Live host and chat, spin history strip (last results), bonus-frequency stats panel, favourite/repeat bets, autoplay, "double bet" and "undo" chip controls, sound layers per room, an augmented-reality transition into each bonus room, and a per-room win-celebration ramp.

---

## 3. Our version: single-player RNG money-wheel show on Stake Engine

Working title placeholder: **"One-Eyed Willy's Wheel Show"** (keeps the existing Casino TV / One-Eyed Willy brand and art language; the name "Crazy Time" and Evolution's trade dress must not be used, see §4.8).

### 3.1 Design pillars and what changes versus the live game

| Live Crazy Time | Ours |
| --- | --- |
| Live host, physical wheel, shared table, ~2.5 min rounds | RNG, single player, round length set by animation (target 12–20 s normal, ~4 s turbo) |
| Any chips on any of 8 spots | A **ticket** (bet mode) chosen from a curated list, times a unit stake (§3.2) |
| Bonus room played only by players who bet on it | Same rule: the ticket determines whether the player is "in" the bonus |
| Player aims a cannon / picks a flapper and it genuinely selects among shuffled values | Player still aims/picks, but the awarded multiplier is authored in the book; the pick is presentation (industry-standard "pick" bonus, §3.7) |
| Per-spot RTP 94.3–96.1% | Per-mode RTP equal within 0.5% (Stake rule), target 96.0% |
| €500,000 cap | Per-mode `max_win` multiplier cap (Stake rule), e.g. 5,000×–10,000× of unit stake |
| Pachinko: host drops a puck | Our Plinko board, ball choreographed to the authored slot by the existing engine |

### 3.2 Bet structure — the key design decision

Stake's RGS accepts **one `amount` and one `mode` per `/play`**, and serves **one pre-simulated book** for that mode. Crazy Time's "different chips on eight spots" cannot be sent as one bet, and eight separate `/play` calls would be eight independent spins. The `meta` payload on `/play` only carries play-conditions for book selection; it cannot price a bet.

Therefore the bet is a **ticket**: a fixed set of spots covered at 1 unit each. `cost` = number of units. Proposed launch tickets:

| Mode id | Covers | cost (× unit) | Hit rate | Notes |
| --- | --- | --- | --- | --- |
| `spot_1` | 1 | 1 | 38.9% | |
| `spot_2` | 2 | 1 | 24.1% | |
| `spot_5` | 5 | 1 | 13.0% | |
| `spot_10` | 10 | 1 | 7.4% | |
| `spot_coinflip` | Coin Flip | 1 | 7.4% (1 in 13.5) | |
| `bonuses` | Coin Flip + Cash Hunt + Plinko + Crazy Wheel | 4 | 16.7% (1 in 6) | the "bonus hunter" ticket |
| `numbers` | 1 + 2 + 5 + 10 | 4 | 83.3% | |
| `full_board` | all 8 spots | 8 | 100% | the "watch everything" ticket |

Why not single-spot tickets for Cash Hunt, Plinko and Crazy Wheel: their hit rates are 1 in 27, 1 in 27 and 1 in 54. Stake's guideline for base modes is a **non-zero hit rate of at least 1 in 20**, so those spots are only sold inside bundles. (Whether a single-spot bonus ticket could be classed as a "feature/buy" mode instead of a base mode is an open question for Stake, §6.)

**Why not arbitrary combinations:** Stake confirmed on 2026-09-04 that a game may publish **at most 50 modes**. Any combination of 8 spots is 255 modes and any combination of 6 spots is 63, both over the cap. Within 50 the options are: the 10 tickets above; singles + every pair + the three bundles (39 modes); or a 5-spot board with full combination freedom (31 modes). Buy-bonus modes count against the same 50. Each mode is its own books file and lookup CSV (the CSV payout must hash-match the books, so modes cannot share a books file).

UI: the bet board still looks like Crazy Time's chip layout. Tapping spots highlights the nearest ticket (e.g. tapping all four bonus spots selects `bonuses`); the unit stake selector is the existing bet-amount control. Tickets are also directly selectable as chips/cards for clarity. Max bet per ticket = table max ÷ cost (RGS `config` bet levels).

### 3.3 Round flow (client state machine)

```
idle → betPlaced (/play) → topSlotSpin → wheelSpin → resolve
   resolve ─ number hit & covered  → payNumber → settle (/end-round) → idle
   resolve ─ number hit & not covered → lose → settle → idle
   resolve ─ bonus hit & covered → enterRoom → [CoinFlip | CashHunt | Plinko | CrazyWheel] → payBonus → settle → idle
   resolve ─ bonus hit & not covered → roomPreview (short, "you were not in") → settle → idle
```

- Every transition is driven by a book event (§3.10). No client RNG on anything payout-affecting, enforced the same way the Plinko's fairness guard does it today.
- **Turbo**: shortens the Top Slot and wheel to ~1.5 s each and collapses room intros; the room outcome animations still play.
- **Skip**: the existing skip-button pattern applies to bonus rooms.
- **Autoplay**: N rounds with the same ticket and unit stake; stops on bonus entry (optional toggle) and on loss/win limits.
- **Resume**: on authenticate with an active round, replay the stored book from the last acknowledged event (same mechanism as the Plinko's resume). A pick step that was pending simply re-shows the pick with the same authored result.

### 3.4 Main wheel

- 54 segments, same composition as §2.2 (21/13/7/4 numbers, 4/2/2/1 bonuses). Keeping the real composition is deliberate: the odds are well known to players and it is what makes the wheel "feel" like a Crazy Time wheel.
- Rendered in Pixi/Spine (the current DOM/CSS wheels top out visually well below a hero wheel). Spin: 3–4 full rotations + authored segment, ease-out, flapper click sound per segment, 5–6 s normal, 1.5 s turbo.
- Result banner shows segment, Top Slot multiplier if applied, and win.

### 3.5 Top Slot

- Two vertical reels, left = 8 spot symbols, right = 10 multipliers + miss gaps. Authored by the book: `{spot, multiplier | null}`.
- Match rule exactly as §2.3. The multiplier stays displayed on the wheel HUD until the round ends.
- Math lever: the pairing matrix between spot and multiplier is where the per-mode RTP is equalised (this is what the Wizard model does).

### 3.6 Bonus room: Coin Flip

- Two sides, red/blue. Book authors `{red, blue, result, rescue?: [...]}` where each rescue entry is another `{red, blue, result}`.
- Low side 2–5, high side 7–100 (weights per §2.4); Top Slot multiplier pre-applied to both values before display.
- Rescue Flip triggers only from the book. Cap: 5,000×.
- Duration ~8 s normal, ~3 s turbo. Reuses the existing coin Spine assets (`coin_act_1/2`) as a starting point.

### 3.7 Bonus room: Cash Hunt

- Wall of 108 tiles. Book authors the **full multiplier board** (108 values, one of the 3–4 board layouts), the shuffle seed for the cover animation, and the **awarded multiplier**.
- Player has 8 s to move a crosshair and lock a tile (tap/click). If no lock, centre tile is used.
- Reveal rule: the tile the player locked reveals the awarded multiplier; the other 107 tiles reveal the rest of the authored board. Because the board is authored and every tile is equiprobable to be "the one", the player's EV is identical for every tile, exactly as in the live game where the shuffle is random. This is the standard treatment of pick features on Stake Engine and is disclosed in the rules page ("all targets have equal chance").
- Cap: 25,000× would require `max_win` ≥ 25,000 in the bundle modes; we recommend capping the board at 500× and Top Slot on Cash Hunt at 20× for a 10,000× ceiling (see §3.10 max-win policy).

### 3.8 Bonus room: Plinko (the "Pachinko" slot) — reuses our board

- Our existing board with **16 landing slots** (the current engine uses 15; the change is a config, the engine already handles arbitrary slot counts by row tier).
- Landing values: 14 multipliers + 2 DOUBLE slots, e.g. `[DOUBLE, 5, 10, 20, 50, 15, 25, 100, 5, 10, 200, 20, 50, 10, 500, DOUBLE]` (illustrative; the math owns it). Top Slot pre-multiplies the board.
- Book authors a **sequence of drops**: `[{dropZone, slotIndex, valueShown}, ...]` with the doubling state between drops, plus optional rescue-drop entries. The existing `plinkoDrop` choreography (ball steered to `rateIndex`) is reused; the drop zone (4–12) becomes an authored spawn x.
- DOUBLE: board values ×2 (visible flip animation), re-drop. Cap: 10,000×.
- Rescue Drop: on 2×/3×/4× landing, the book may raise all values below a threshold and re-drop.
- This room is the cheapest of the four for us: physics, ball art, slot glows, coin fountain and sound already exist.

### 3.9 Bonus room: Crazy Wheel

- 64-segment inner wheel, three flappers (green/blue/yellow). Book authors the wheel layout id, the multiplier under **each** flapper for each spin, and the re-spin chain.
- Player picks a flapper within 8 s (default green). Same equal-EV logic as Cash Hunt: the book authors one outcome per flapper, the player's pick selects which is paid. Note this is exactly the live rule too (every flapper has a real authored outcome), so nothing is hidden here.
- DOUBLE/TRIPLE under the chosen flapper → values ×2/×3, re-spin (authored). Cap 20,000× in the live game; our cap per §3.10.

### 3.10 Math specification (for the math SDK repo)

- **Target RTP:** 96.0% every mode, spread ≤ 0.5% (Stake), final figure to confirm against Stake's current allowed range (90.0–96.7% was quoted publicly in 2026).
- **Max win policy:** Stake requires each mode's advertised `max_win` to be **actually reached in that mode's books at ≥ 1 in 20,000,000** (the same rule the Plinko already had to satisfy). Crazy Time's organic 20,000×/25,000× tails are far rarer than that, so either (a) force a max-win stratum in the distribution, accepting a small RTP transfer into the tail, or (b) cap lower. Recommendation: `max_win` 10,000× of unit stake for `bonuses` and `full_board`, 5,000× for `spot_coinflip`, and for number tickets the natural ceiling of number × 50 (Top Slot max): 50× / 100× / 250× / 500× for `spot_1` / `spot_2` / `spot_5` / `spot_10`, 500× for `numbers`. Those number ceilings are hit far more often than 1 in 20,000,000, so they need no forcing. Per-mode caps also keep the RGS max-bet sensible.
- **Hit-rate floor:** ≥ 1 in 20 per base mode (why single-spot bonus tickets are bundled).
- **Books per mode:** 1M simulations per mode is the baseline Stake expects for feature-heavy games; 8 modes → 8M rows. Book size is larger than a slot's (a Cash Hunt board is 108 values, a Plinko chain is a list of drops) but smaller than the Plinko's 50-ball books.
- **Distributions/criteria:** `number_hit`, `number_miss`, `bonus_coinflip`, `bonus_cashhunt`, `bonus_plinko`, `bonus_crazywheel`, `topslot_applied`, `wincap`. Quotas per mode so rare rooms are well sampled.
- **Equalisation levers:** Top Slot pairing matrix, Cash Hunt board mix, Plinko board and DOUBLE count, Crazy Wheel layout mix, rescue frequencies. Numbers' payouts and wheel composition stay fixed.
- **Book events** (client contract, mirroring the Plinko's typed event style):

| Event | Payload |
| --- | --- |
| `betInfo` | mode, coveredSpots[], unit |
| `topSlot` | spot, multiplier (null = miss), applied: boolean |
| `wheelSpin` | segmentIndex, spot |
| `numberWin` | spot, baseMultiplier, topSlotMultiplier, amount |
| `coinFlip` | red, blue, result, rescues[] |
| `cashHunt` | boardId, board[108], awardedMultiplier, shuffleSeed |
| `plinkoBonus` | board[16], drops[{dropZone, slotIndex, valueShown, doubledState}], rescues[] |
| `crazyWheel` | layoutId, spins[{green, blue, yellow, doubleTriple?}], flapperResults |
| `bonusWin` | room, multiplier, amount |
| `setTotalWin` / `finalWin` | as today |

### 3.11 Client scope

- Screens: bet board + ticket picker, wheel stage, Top Slot, four rooms, result/celebration, rules pages (per room, with the equal-chance disclosure), history strip (own rounds only), autoplay panel, settings (turbo, sound), resume overlay.
- Reused from the Plinko: RGS/XState/book plumbing, wallet sync, resume, replay, settlement, i18n set-up, sound manager, preloader, iOS audio/WebGL recovery work, portrait fit, HUD shell, skip button, Plinko engine + board renderer, coin Spine assets, debug console.
- New: hero wheel (Pixi/Spine), Top Slot reels, bet board/ticket UX, Coin Flip room, Cash Hunt room (108-tile grid + crosshair input), Crazy Wheel room, room transitions, four win-ramp presentations, rules content.
- Mobile: portrait-first like the Plinko; the 108-tile wall and the 64-segment wheel are the two layouts that need a real-phone sweep (h/w 1.3–1.7).

### 3.12 Art and audio list

Studio backdrop (landscape + portrait), hero wheel (54 segments, flapper, rim lights), Top Slot cabinet, chip/bet board, 8 spot icons, Coin Flip coin + flipper + red/blue sides, Cash Hunt wall + 6–8 cover symbols + cannon + crosshair, Plinko board re-skin (16 slots, DOUBLE tiles), Crazy Wheel + 3 flappers, room transition (curtain/door), host or mascot (One-Eyed Willy as animated presenter), win ramps ×4, UI kit. Audio: base BGM, 4 room BGMs, wheel ticks, reel stops, coin flip, cannon, doubling stinger, win tiers, presenter VO lines (optional).

---

## 4. Feasibility on Stake Engine and limitations

Verdict: **buildable and publishable**, as an RNG single-player game. The constraints below shape the design; none blocks it.

| # | Stake Engine fact | Consequence for a Crazy Time-style game |
| --- | --- | --- |
| 4.1 | RNG only, no live video/host, no shared rounds | It is a "First Person"-style game show. Evolution ships exactly such RNG versions of its shows, so the genre is proven, but the social "everyone on one wheel" hook is gone. Compensate with pace, presenter animation and room spectacle. |
| 4.2 | One `amount` × one `mode` per `/play`, one book served, weighted-random per mode | No free chips-per-spot betting. Bets are curated tickets (§3.2). This is the biggest change to the player experience. |
| 4.2a | Maximum 50 modes per game (confirmed by Stake, 2026-09-04) | Rules out full combination betting on 8 spots (255) or 6 spots (63). Ceiling for this design is 39 modes on 8 spots (singles + pairs + bundles) or 31 on a 5-spot board with any combination. |
| 4.3 | Stateless rounds: no jackpots, no progression, no carry-over | Crazy Time needs none, so this is free. The Plinko's meter carry-over trick is not needed here. |
| 4.4 | All outcomes pre-simulated; the client must never generate a payout-affecting number | Cash Hunt aim and Crazy Wheel flapper are presentation over an authored result. Legal and standard, but must be disclosed in rules and the fairness guard must cover every room. |
| 4.5 | RTP per mode within Stake's allowed band, spread ≤ 0.5% across modes | Cannot copy Evolution's 94.3–96.1% per-spot spread. All tickets ≈ 96.0%. The Wizard model shows this is achievable by tuning the Top Slot pairing. |
| 4.6 | `max_win` per mode must be hit ≥ 1 in 20,000,000 in that mode's own books | 20,000×/25,000× ceilings are not organically reachable at that frequency; force a wincap stratum or cap at 5,000–10,000×. Also affects marketing copy. |
| 4.7 | Base-mode hit rate ≥ 1 in 20 | Single-spot tickets on Cash Hunt (1/27), Plinko (1/27) and Crazy Wheel (1/54) are not sellable alone; bundle them. |
| 4.8 | Original IP only; no third-party branding | Do not use "Crazy Time", Evolution's wheel colours/typography, or room names as a set. "Pachinko", "Coin Flip" as generic words are fine; safer to rename rooms into the Willy theme. Evolution also files patents around its shows; a trademark/trade-dress review is recommended before art starts. |
| 4.9 | Bet levels come from RGS `config`; `cost` multiplies the unit stake | A cost-8 `full_board` ticket has 1/8 of the max unit stake. Show the effective total bet clearly. |
| 4.10 | Review by Stake (publicly "about 24 hours" per submission), math verification on their side | Faster than a lab certification cycle, but every math change means full re-simulation, re-optimisation and re-upload of 8 modes. Budget several submission rounds. |
| 4.11 | Two repos to ship in lockstep (math SDK game + web SDK app) | Same workflow as today. Every board/table value must mirror between `game_config.py` and the client constants, as with the Plinko. |
| 4.12 | Book payload size and count | 8 modes × 1M books with 108-value boards and multi-drop chains is a bigger publish than the Plinko's; still far below the 9.6M-book onedrop publish that already caused RGS timeouts, but keep it in mind. |

---

## 5. Effort estimates

**Staffing assumption: one developer working with Claude Code, covering both the math SDK and the front end.** Art (wheel, rooms, presenter, Spine) is assumed to keep arriving from the artist through the existing art-source → webp/Spine pipeline. Work is serial: math and client cannot overlap the way they would with two people, except that simulations and optimiser runs execute unattended while client work continues.

Calibration point: the current Plinko (one mechanic, one board, two wheels, ladder bonus, 8 modes, plus its math in the sibling repo) has taken **the same one-developer-plus-Claude set-up from 2026-05-16 to today, 431 commits over ~16 weeks**, and is still in polish. A four-room wheel show is roughly three to four times the feature surface, but about half of the Plinko's plumbing and one whole room carry over. Claude shortens first drafts, fixtures, sims and docs; it does not shorten the parts that dominated the Plinko's wall-clock: device testing on real iOS, optimiser runs on 8 modes, and Stake review loops.

### Option A — new wheel show, Plinko as a bonus room (recommended)

| Phase | Work | Weeks |
| --- | --- | --- |
| 0. Design lock | Ticket list, caps, room rules, IP check, art brief to the artist, this GDD signed off | 1 |
| 1. Math v1 | Wheel + Top Slot + 4 rooms in the math SDK, distributions, first optimisation of 8 modes, PAR sheet. Sims run unattended while phase 2 starts | 3–4 |
| 2. Client core | Bet board/tickets, hero wheel, Top Slot, number payouts, RGS/resume/replay/autoplay on the new event set, storybook fixtures | 4 |
| 3. Rooms | Plinko room (1), Coin Flip (1), Cash Hunt (2), Crazy Wheel (2) | 6 |
| 4. Math v2 + mirror | Equalise the RTP spread, force wincap strata, regenerate books, re-sync client constants and fixtures | 2 |
| 5. Presentation | Transitions, win ramps, presenter, audio, rules pages, i18n | 2–3 |
| 6. Hardening | Real-phone sweep, iOS audio/WebGL, performance, fairness audit, Stake submission loop | 3–4 |
| **Total** | | **~21–24 weeks ≈ 5–6 months** to submission |

**Pessimistic bound:** the Plinko's own polish tail (iOS audio, WebGL context loss, portrait fit, RGS latency) added a month or more after "feature complete". Allow **6–7 months** if the show hits the same class of issues, which a Pixi hero wheel and a 108-tile wall on phones plausibly will.

**MVP variant** (wheel + Top Slot + Plinko room + Coin Flip room; Cash Hunt and Crazy Wheel dropped or routed into those two rooms): **~13–15 weeks ≈ 3–3.5 months**. Rooms can be added later, but adding a room changes every ticket's math and requires full re-submission.

**If art also falls on the developer** (generated art plus the existing Pillow/webp pipeline, no Spine animator): add ~3–4 weeks and expect a visibly cheaper presentation.

### Option B — game-show bonus inside the existing Plinko

Replace the free-spin wheel/ladder with a Crazy-Time-style wheel that routes into Coin Flip / Cash Hunt / Crazy Wheel rooms while the Plinko board remains the base game.

| Work | Weeks |
| --- | --- |
| Math: fold rooms into all 7 feature modes, re-balance RTP and per-tier max wins, re-simulate, re-optimise | 3–4 |
| Client: rooms (3), wheel re-skin, event handling, resume paths for rooms, rules | 4–5 |
| Verification and re-submission | 1–2 |
| **Total (serial, one developer with Claude Code)** | **~8–11 weeks** |

Risk: this reopens an approved RTP/max-win configuration and the product already has two wheels and a bonus ladder, so the marginal appeal is unclear. Only worth it if the goal is "more bonus variety in Plinko", not "a Crazy Time competitor".

### Option C — cross-game Plinko bonus

Not possible on Stake Engine; there is no mechanism for one game to invoke another or share state. Zero weeks, but it needs to be said out loud so it stops coming up.

---

## 6. Open questions

For the boss:
1. Is the goal a **new title** (Option A) or **more bonus in Plinko** (Option B)?
2. Launch with **four rooms** or an **MVP with two**?
3. Team: the estimate assumes one developer with Claude Code on both math and front end. A second developer on the math would bring Option A down to roughly 4–5 months; confirm the artist stays on the project.
4. Theme: stay in the One-Eyed Willy / Casino TV universe (recommended, reuses art) or a new IP?

For Stake (via the Engine Discord / support):
5. Current allowed RTP band and cross-mode spread (96.7% ceiling and 0.5% spread as understood in 2026).
6. Can a single-spot bonus ticket with a 1-in-27 or 1-in-54 hit rate be classed as a non-base ("feature") mode, exempt from the 1-in-20 hit-rate rule?
7. Any objection to pick-style rooms (authored outcome, cosmetic choice) with a timer, given the equal-chance disclosure.
8. Practical ceiling on `max_win` they will approve for a wheel game.

Legal:
9. Trademark/trade-dress check on wheel look, room names and the "Top Slot" term.

---

## Sources

- Evolution official game help text (mirrored by theScore Bet): rules for wheel, Top Slot, all four rooms, rescue mechanics, disconnection policy — https://thescorebethelp.zendesk.com/hc/en-us/articles/13873609298829-Crazy-Time
- Wizard of Odds, Crazy Time analysis: wheel composition, Top Slot distribution, per-room average multipliers, equal-RTP model — https://wizardofodds.com/games/crazy-time/
- Casinos.com Crazy Time guide: segment counts, per-spot RTP list, bonus frequencies — https://www.casinos.com/games/crazy-time
- Gamblingcalc Crazy Time calculator: probabilities and hit frequencies — https://gamblingcalc.com/table-social-games/crazy-time-money-wheel-calculator/
- Slot Expanse review: limits, caps per room, €500,000 cap — https://slotexpanse.com/game/crazy-time/
- Live Casino Comparer review: per-spot RTP figures — https://www.livecasinocomparer.com/live-casino-software/evolution-live-casino-software/evolution-crazy-time/
- Evolution First Person (RNG) game range — https://games.evolution.com/first-person/ and https://www.livecasinos.com/blog/quick-guide-to-evolution-first-person-live-casino-games/
- Stake Engine math SDK documentation (books, lookup tables, bet modes, optimiser, stateless requirement) — https://stakeengine-math-sdk.mintlify.app/introduction and https://github.com/StakeEngine/math-sdk
- Stake Engine constraints summary (RTP band, 0.5% spread, 1-in-20 hit rate, max-win frequency, stateless, no jackpots/gamble/progression) — https://github.com/ReSkin-Games/stake-engine-skills/blob/main/stake-math-sdk/SKILL.md
- Stake Engine RGS client (`/wallet/play` takes `amount` + `mode`) — https://github.com/Raw-Fun-Gaming/stake-engine-client/blob/main/README.md and this monorepo's `packages/rgs-requests/src/rgs-requests.ts`
- Stake Engine overview and review turnaround — https://www.betensured.com/blog/stake-engine-what-it-is-and-how-it-works/ and https://stake.com/blog/what-is-stake-engine
- Stakelogic Live "Super Wheel Game Show" (a 54-segment wheel with a Pachinko bonus, 96.30% RTP, 10,000× max) as a competitor reference — https://stakelogic.com/en/stakelogic-live-to-captivate-audiences-with-super-wheel-game-show/
- In-repo: `apps/plinko/src/game/config.ts` (max-win ≥ 1/20,000,000 rule, cost × unit rule, rejected RTP spread), `apps/plinko/docs/bonus-mode.md`, `apps/plinko/src/game/plinkoSessionMeters.ts` (`/play` meta = play conditions only).
