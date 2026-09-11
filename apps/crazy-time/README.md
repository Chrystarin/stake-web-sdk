# Crazy Time (working title) — web client prototype

A single-player RNG money-wheel show for Stake Engine, modelled on Evolution's Crazy Time:
a 54-segment wheel with four number spots (X1 X2 X5 X10) and four bonus rooms (Pirate Plinko,
Bonus Wheel, Treasure Chest, Ocean Voyage), a Top Slot that may attach a multiplier to one spot before
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
(`x1`, `pp_bw_tc_ov` for all four rooms, `x1_x2_x5_x10_pp_bw_tc_ov` for the full board): the
board derives the name the same way the math does (`SPOT_CODE`, `modeName`).

| Spot | x1 | x2 | x5 | x10 | Pirate Plinko | Bonus Wheel | Treasure Chest | Ocean Voyage |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| key | `x1` | `x2` | `x5` | `x10` | `piratePlinko` | `bonusWheel` | `chest` | `oceanVoyage` |
| code | `x1` | `x2` | `x5` | `x10` | `pp` | `bw` | `tc` | `ov` |

252 of the 255 combinations are published. The three that are not are the one-spot bets on
Pirate Plinko, Ocean Voyage and the Bonus Wheel: with 2, 2 and 1 segments of 54 they pay less than
once in 20 spins, under Stake's hit-rate floor for a base mode. The board shows a hint and
disables Spin until another spot is added; those rooms in any company are fine. ALL BONUS and
FULL BOARD remain as one-tap shortcuts.

Every spot is tuned to 96.7% on its own, so every combination is 96.7% with zero spread.

### Buy Bonus (5 more modes)

The Buy Bonus badge (top-left; button and screen ported from the One-Eyed Willy Plinko) opens a
screen with five cards: ANY BONUS and the four rooms. A buy skips the wait for the wheel and goes
straight into a room, keeping the room's natural odds of also carrying a Top Slot multiplier.
Prices are in chips and mirror the math (`buyPrice`): Any Bonus 24, Treasure Chest 13.5, Pirate
Plinko 27, Ocean Voyage 27, Bonus Wheel 54; the chip can be stepped on the screen itself, and every
card re-prices live. Activate raises a Yes/No prompt; Yes commits the buy mode (`buy_any`, `buy_tc`,
`buy_pp`, `buy_ov`, `buy_bw`) with the chip as `amount`, so the RGS charges price x chip.

A bought round is staged in this order: the equivalent chips go down on the rooms the buy can
open (the price split across them: one 135-chip on Pirate Plinko for `buy_pp`, four 30-chips for
`buy_any` at a 5 chip), the wheel washes white and comes back as a four-segment disc showing only
the rooms (crest and name set across each quarter in two big lines), the Top Slot reels roll, then
the wheel spins to the room the book authored, and the room plays its interactive version. The
white wash covers the swap back to the full wheel when the round is cleared, too. `stateGame.buying` names the mode; its rooms are the backed spots, so the
landed room reads as covered and is collected like any winner. The quarter wedges keep the main
wheel's lettering scale through the wheel's `sizeStep` prop.

## Round flow

Book events, in order: `topSlot` → `wheelSpin` → (`piratePlinkoRoom` | `bonusWheelRoom` |
`chestRoom` | `oceanVoyageRoom`, only when the wheel lands on a room, and even when the player was
not in it) →
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
src/components/rooms/Room*.svelte PiratePlinko, BonusWheel, Chest, OceanVoyage (presentation)
src/game/constants.ts             mirror of crazy_time_data.py (wheel, tables, modes)
src/game/stateGame.svelte.ts      board state, spots → mode, commit/resume
src/game/bookEventHandlerMap.ts   book → emitter events
src/game/activeRound.ts           open-round handling and resume board reconstruction
scripts/import-math-books.mjs     samples published books into base_books.ts
```

## Not done (prototype)

- Portrait / mobile layout (fixed 16:9 stage like colour-dice), autoplay, turbo, rules page,
  translations beyond `en`, sound design (placeholders from colour-dice), real art.
- Rooms are placeholders for the three still being brainstormed; the Pirate Plinko room is a CSS
  board, not the One-Eyed Willy engine.
- Max-win achievability is handled in the math: Pirate Plinko's 400x edge slots and Ocean
  Voyage's 400x deepest depth each make a 20,000x under a 50x Top Slot, and the rarest of them
  (a one-number-plus-Plinko bet) lands about 1 in 14.5 million; the game's 50,000x, the Bonus
  Wheel's 1,000x wedge under a 50x Top Slot, about 1 in 11.9 million. Both clear Stake's
  1-in-20-million floor; `verify_luts` in the math repo re-checks every published mode.
