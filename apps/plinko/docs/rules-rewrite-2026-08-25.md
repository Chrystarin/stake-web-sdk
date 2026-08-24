# Game rules rewrite — mechanics audit, 2026-08-25

The in-game rules were re-derived from what the game actually does. Every number the rules now print
is read off the client's own tables at render time, and every one of those tables was cross-checked
against the published math library before publishing it.

**Files changed**

- `src/components/InfoModal.svelte` — the Game Rules and How to Play tabs (the compliance surface)
- `src/game-logic/constants.ts` — comment only, three stale figures corrected

`QuickGuideModal.svelte` was edited and then reverted on request — see "Reverted on request" in §3.

---

## 1. How the mechanics were verified

Client read: `InfoModal`, `QuickGuideModal`, `constants.ts`, `boardMultipliers.ts`, `config.ts`,
`plinkoBetMode.ts`, `gameOrchestrator.ts`, `meterFlow.ts`, `Game.svelte`, `GameHud.svelte`.

Math verified by streaming **all eight published book files** in
`stake-math-sdk/games/crimson_plinko/library/publish_files/` — 13.6M simulated rounds — rather than
trusting the client's mirrors of the math tables. Everything below is measured, not assumed.

### Meters — the client's tables agree with the books exactly

| Ball per Drop | Bonus meter (max) | Free Spin meter (max / start) | Hits this drop must land |
| --- | --- | --- | --- |
| 1 | — (hidden) | — (hidden) | no features |
| 10 | 6 | 6 / 0 | 6 coin pegs · 6 SPIN slots |
| 20 | 8 | 10 / 1 | 8 coin pegs · 9 SPIN slots |
| 50 | 16 | 21 / 5 | 16 coin pegs · 16 SPIN slots |

Confirmed against `plinkoDrop.spinMeterMax` / `bonusMeterMax` / `spinMeterStart` on every book in
every base mode — a single value per mode across 3.2M rounds, no variance.

### Measured feature rates

| Ball per Drop | Bonus round fires | Free Spin fires (paid drop) | Typical entry award |
| --- | --- | --- | --- |
| 10 | 2.0022 % | 0.8176 % | ~23 free balls |
| 20 | 1.9958 % | 1.3817 % | ~44 free balls |
| 50 | 1.9805 % | 4.5157 % | ~76 free balls |

The flat-2 % bonus design holds on all three tiers. The Free Spin rate is *not* flat and rises
sharply with ball count.

### Level ladder — reached in practice

| Top level reached | 10 ball | 20 ball | 50 ball | Buy Standard | Buy Super Fury |
| --- | --- | --- | --- | --- | --- |
| 1 | 91.03 % | 57.30 % | 6.97 % | 75.04 % | 16.21 % |
| 2 | 8.78 % | 36.78 % | 20.36 % | 24.93 % | 79.14 % |
| 3 | 0.155 % | 5.85 % | 49.23 % | 0.032 % | 4.65 % |
| 4 | 0.003 % | 0.040 % | 22.57 % | — | 0.001 % |
| 5 | — | — | 0.82 % | — | — |
| 6–9 | injected deep books only (~0.0002 %) | | | | |

### Other claims verified

- **In-bonus Free Spin never lands BONUS** — 0 occurrences across every in-bonus spin in every mode.
  The rules' "cannot land on BONUS" is correct.
- **Free Spin fires repeatedly inside a bonus** — a bought Standard round averages 1.51 wheels.
- **3 gold coin pegs** — `PlinkoEngine.featuredPegs`, three of them.
- **Autobet ends when a bonus triggers** — `endAutoBetForBonusRound` → `finishAutoBet`, outright, not
  a pause.
- **Buy Bonus entry batches are fixed** — 72 / 95 / 145 / 239, 100 % of books, no wheel variance.
- **The 1-ball tier really is feature-free** — 9,600,000 `onedrop` books, zero bonus rounds and zero
  free spins, `spinMeterMax` 1 and a cosmetic `bonusMeterMax` 20 that never fires.

---

## 2. Corrections — statements that were factually wrong

| # | Old copy | Reality | Now says |
| --- | --- | --- | --- |
| 1 | Bonus free balls "drop automatically at no extra cost" | They do not drop themselves. Each one needs a Play press; holding Play or Space for 400 ms streams them (`startBonusBallHoldDrop`) | "press Play once for each free ball, or hold Play (or the Space bar) to release them as a continuous stream" |
| 2 | Buy Bonus "(Not available on the single-ball drop.)" | `buyBonusDisabled` has no tier check. A buy is balls-per-drop independent and plays the 10-ball reference board, meters live | "You can buy from any Ball per Drop, the 1-ball tier included" |
| 3 | On 1 ball "its meters are display only and can never fire" | `areTierMetersVisible` hides both meters entirely on that tier | "both meters stay hidden while you play it" |
| 4 | "The FREE SPIN meter (lower-right of the board)" | It lives in the betting panel (desktop) / under the board frame (mobile), never on the board | "the Free Spin meter in the betting panel" |
| 5 | "up to 500× your Bet per Ball, which is up to 500× ÷ cost your total bet" | The two caps come from **different modes** — 500× per ball is Buy Super Fury (2× total bet); 100× total bet is the 1-ball tier. Pairing them read as one mode paying both | The cap range (100×–500× Bet per Ball) plus one worked conversion: "400× at 50 balls per drop works out at 8× your total bet" |

---

## 3. Removals — copy for things that do not exist, and duplication

1. **"not a difficulty or rows setting"** — a leftover comparison to stock Plinko. No difficulty or
   row selector has ever shipped here; the sentence only raised a control the player then hunts for.
2. **"Main Betting Components" preamble + the multi-line worked example block** — three bullets and
   one formula line say the same thing.
3. **The duplicated paytable in How to Play** — the full 8-row pocket table appeared in both tabs.
   How to Play now carries two summary bullets and points at Game Rules.
4. **The duplicated RTP / max-win breakdown in How to Play** — same reason.
5. **The standalone per-mode max-win table** — its eight rows are now columns in the two tables that
   already existed (the tier table and the buy table), so no data was lost and one table went away.
Net: `InfoModal.svelte` went from 1,246 to 1,222 lines while publishing *more* data — the shrink is
duplication removed, and the added tables paid most of it back.

### Reverted on request

Two removals were rolled back after review and are **not** in the shipped change:

- **"Controls & Buttons" is restored in full, and MOVED to the Game Rules tab** — the "Main Bet
  Panel" and "Menu" sub-headings, the per-control list, the mobile coins-button line and the five
  menu entries, all as they read before. It had always lived in How to Play; it now sits in Game
  Rules after "Game Information", which is where it was being looked for. There is still only one
  copy — How to Play carries a one-line pointer to it rather than repeating it. Two small edits came
  with the move: Ball per Drop's "(1 / 10 / 20 / 50)" derives from `BALL_PER_DROP_TIERS` instead of
  being typed in, and the menu entries no longer describe How to Play as "this guide" (it isn't, from
  the Rules tab). The `.howto-subhead` CSS rule came back with the section and is renamed
  `.info-subhead`, since it is no longer a How-to-Play thing.
- **The Quick Guide is untouched** — its "BONUS PLAY FEATURE" / "LEVEL BONUSES" cards and the "Free
  Play" wording stand as they were. Worth noting for later: nothing else in the game calls a bonus
  round "Free Play", so the term is still inconsistent with the rules and the on-screen level bar.

---

## 4. Additions — real mechanics that were undocumented

1. **One tier comparison table** — Ball per Drop × (bonus meter hits, free spin meter hits, max win),
   with the 1-ball row spelled out as "no Bonus / no Free Spin" instead of being described in a
   paragraph two sections away. The free-spin column also shows the head start where there is one
   ("bar of 21, starting 5 filled") so 16 hits on a 21-notch bar is not a contradiction.
2. **How free balls are dropped** — press per ball, or hold Play/Space to stream (see correction 1).
3. **Autobet ends when a bonus starts** — previously nowhere in the rules.
4. **The bonus entry award scales with Ball per Drop** — the nine painted wheel values are identical
   on every tier, but the landing odds skew hard. `constants.ts` had carried a standing note that the
   rules ought to say this; they now do, **in prose only**. A table of per-tier averages
   (~23 / ~44 / ~76 balls) was drafted and then cut on request, see section 6.
5. **The in-bonus Free Spin fires on every refill**, not once per round.
6. **A bought bonus plays the 10-ball board**, so its Free Spin and level-up meters are live even
   when bought from the 1-ball tier.
7. **Space is the drop hotkey** — stated in the steps, not just in the controls list.

---

## 5. House style: no em dashes, no semicolons

Every player-facing string in `InfoModal.svelte` was rewritten to drop em dashes and prose
semicolons, because both read as machine-written and this modal is the game's most-read prose. 43 em
dashes, 6 semicolons and 1 en dash were removed. Nothing else about the copy changed.

What replaced them:

- A label followed by its gloss takes a full stop, not a dash. "Balance. Your available funds."
- Where the label is the sentence's subject, it just becomes one. "**Bet per Ball** is the stake on
  each single ball."
- Parenthetical dashes became commas, brackets, or a second sentence. "That wheel **cannot land on
  BONUS**, because a bonus can't start another bonus inside itself, so it always pays a multiplier."
- Number ranges are spelled out. "20 to 100 free balls", not "20-100".
- Semicolon joins became full stops. "so dry spells happen. The edge pockets and the features are
  where the big wins are."

The rule is recorded as a comment above `sectionTitles` in `InfoModal.svelte` so a later edit does not
quietly reintroduce them. It covers rendered copy only, not code comments.

`QuickGuideModal.svelte` needed no change: its four cards were already clear of both.

---

## 6. Design choices worth your sign-off

1. **No probabilities are published.** The rules state *thresholds* (hits needed), which the meters
   themselves show, and never odds. The measured rates in section 1 are deliberately not in the copy:
   `FREE_SPIN_WEIGHTS` and `BONUS_WHEEL_WEIGHTS` are display mirrors, and publishing a percentage off
   a mirror risks stating odds the server does not honour. Say the word and I will add them.
2. **No per-tier average entry award either — cut on request.** A "Ball per Drop / typical award"
   table (~23 / ~44 / ~76 balls) briefly sat in the Bonus Round section, computed live from
   `BONUS_WHEEL_WEIGHTS`. It is gone, along with its derivation and the now-unused import, so the
   rules make the scaling claim in prose alone. That claim survives any re-weighting that keeps the
   skew, which the numbers would not have. The reasoning is recorded in a comment above `tierRows`
   in `InfoModal.svelte` in case it is ever wanted back — with the standing instruction to derive it
   rather than type it in.
3. **The full level 2–9 ladder is kept**, with "the deeper levels are very rare" added. Levels 5+ are
   effectively unreachable outside the injected deep books (see the table in section 1), so an
   argument exists for truncating the published ladder — but it is a real ceiling the math enforces,
   and hiding it would understate what a round can pay.
4. **`constants.ts` comment fixes.** Three figures in the `BONUS_WHEEL_WEIGHTS` doc block contradicted
   the table directly beneath them: mean entry 24.70 / 46.00 / 77.80 (actually 22.81 / 43.77 / 76.03),
   "100 lands 27.66 %" (25.44 %), "10-ball lands 20 on 68.01 %" (78.69 %). Corrected, with a note that
   they are computed from the table and must be recomputed with it. Comments only — no behaviour
   change; the `BONUS_WHEEL_WEIGHTS` block also now records that the rules deliberately publish no
   mean. The equivalent comments in `stake-math-sdk/plinko_data.py` were **not** touched; worth a
   look if the two repos are meant to read side by side.
5. **The rules body is not translated.** It is raw English, outside the i18n map (only the menu labels
   go through `t()`). Unchanged by this work, but it is what it is — worth knowing if a localised
   release is on the horizon.

---

## 7. Not changed

- No math, RTP, weights, meter values or payout tables were altered. This is copy and presentation
  only, plus three corrected comments.
- `stake-math-sdk` is untouched.
