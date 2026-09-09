# Crazy Time (working title) — web client prototype

A single-player RNG money-wheel show for Stake Engine, modelled on Evolution's Crazy Time:
a 54-segment wheel with four number spots (X1 X2 X5 X10) and four bonus rooms (Plinko, Jackpot
Wheel, Treasure Chest, Dragon Tower), a Top Slot that may attach a multiplier to one spot before
each spin, and a chip board in the LuckyWheel reference layout. Betting, chips and animations are
cloned from `apps/colour-dice`.

**The title is a placeholder.** "Crazy Time" is Evolution's trademark; rename the game, the
`gameID` and the math package before anything leaves the dev environment.

The math lives in the sibling repo at `stake-math-sdk/games/crazy_time` (see its README for the
outcome model and the RTP derivation). Every number in `src/game/constants.ts` mirrors
`crazy_time_data.py`; keep them in sync.

## Run

```sh
pnpm --filter crazy-time dev          # http://localhost:3021 (offline, plays sample books)
pnpm --filter crazy-time sync-math-books   # refresh src/stories/data/base_books.ts from the math
pnpm --filter crazy-time build
```

Offline, the dev harness fakes a session and plays books from `src/stories/data/base_books.ts`.
Add `?force=<kind>` to the URL to pick a book of that kind (rooms, `topslot`, `number`, `win`, `loss`,
`maxwin`, or `plinko:400` for a specific room value): see [docs/dev-debug.md](docs/dev-debug.md).

## Bet modes (252): any combination of spots

A bet is any set of spots at one chip each. `amount` is the chip, `cost` is the number of spots
covered, the RGS charges `cost x amount`, and payouts are in units of the chip. Every combination
of the eight spots is its own mode, named by the covered spots' short codes in board order
(`x1`, `pk_jw_tc_dt` for all four rooms, `x1_x2_x5_x10_pk_jw_tc_dt` for the full board): the
board derives the name the same way the math does (`SPOT_CODE`, `modeName`).

| Spot | x1 | x2 | x5 | x10 | Plinko | Jackpot Wheel | Treasure Chest | Dragon Tower |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| code | `x1` | `x2` | `x5` | `x10` | `pk` | `jw` | `tc` | `dt` |

252 of the 255 combinations are published. The three that are not are the one-spot bets on
Plinko, Dragon Tower and the Jackpot Wheel: with 2, 2 and 1 segments of 54 they pay less than
once in 20 spins, under Stake's hit-rate floor for a base mode. The board shows a hint and
disables Spin until another spot is added; those rooms in any company are fine. ALL BONUS and
FULL BOARD remain as one-tap shortcuts.

Every spot is tuned to 96.5% on its own, so every combination is 96.5% with zero spread.

## Round flow

Book events, in order: `topSlot` → `wheelSpin` → (`plinkoBonus` | `wheelBonus` | `chestBonus` |
`towerBonus`, only when the wheel lands on a room, and even when the player was not in it) →
`winInfo` → `setTotalWin` → `finalWin`. `src/game/bookEventHandlerMap.ts` maps them to awaited
emitter events; `Game.svelte`, `TopSlot.svelte`, `Wheel.svelte` and `BonusRound.svelte` animate
them.

**No outcome is decided on the client.** The wheel and the Top Slot travel to the book's segment
and pair; every room draws the book's result. The Treasure Chest is a pick room: whichever chest
the player opens reveals the book's awarded value and the rest reveal the book's decoys, so the
pick has no effect on expected value (the rules page must say so). If no pick is made within
`PICK_SECONDS`, the book's own chest is opened.

## Structure

```
src/components/Game.svelte        table: chips, tiles, HUD, flights, stage, controls
src/components/Wheel.svelte       generic SVG wheel, spun to an authored index; optional art frame + hub
docs/dev-debug.md                 offline outcome forcing (?force=...)
src/components/TopSlot.svelte     two reels, landed on the authored pair
src/components/BonusRound.svelte  the bonus screen; hosts one of:
src/components/rooms/Room*.svelte Plinko, Wheel, Chest, Tower (prototype presentation)
src/game/constants.ts             mirror of crazy_time_data.py (wheel, tables, modes)
src/game/stateGame.svelte.ts      board state, spots → mode, commit/resume
src/game/bookEventHandlerMap.ts   book → emitter events
src/game/activeRound.ts           open-round handling and resume board reconstruction
scripts/import-math-books.mjs     samples published books into base_books.ts
```

## Not done (prototype)

- Portrait / mobile layout (fixed 16:9 stage like colour-dice), autoplay, turbo, rules page,
  translations beyond `en`, sound design (placeholders from colour-dice), real art.
- Rooms are placeholders for the three still being brainstormed; the Plinko room is a CSS board,
  not the One-Eyed Willy engine.
- The Plinko room's 400x top slot under a 50x Top Slot puts its 20,000x max win at about
  1 in 113 million, below Stake's 1-in-20-million achievability floor. Cap or re-weight before
  publishing. (The game's 25,000x max, the Jackpot Wheel's 500x wedge under a 50x Top Slot, is
  about 1 in 6.4 million, above the floor.)
