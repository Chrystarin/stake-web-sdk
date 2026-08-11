# Colour Dice — Web Client

Single-player front end for **Colour Dice**, a Stake Engine port of the Filipino *Perya*
"Colour Game": three six-sided dice, six colours (`yellow`, `blue`, `white`, `green`,
`pink`, `red`). This is a SvelteKit app in the `twist-turbo` monorepo (Svelte 5 + Vite +
TurboRepo, pnpm workspaces).

The visual layout and 3D dice are ported from the original ColourDice Angular live-dealer
client; the math/RTP is produced by the separate `stake-math-sdk` repo at
`games/colour_dice/` (see its README and `colour_dice_data.py`).

---

## How the game works

You back **1 to 6 colours, all at the same stake**, then roll three dice. **Every backed
colour pays independently** on how many dice show it:

| Dice matching a backed colour | That colour pays        |
| ----------------------------- | ----------------------- |
| 1 (single)                    | 2×                      |
| 2 (double)                    | 3×                      |
| 3 (triple)                    | Lucky Wheel 4×…200×     |

Back red, blue and green at $5 each ($15 total); if red lands twice and blue once, **both
pay** — red at 3× and blue at 2×, for $25 back. That is the perya behaviour, not an
approximation of it.

### Why equal stakes

The RGS settles a round from a **precomputed book** with one hashed `payoutMultiplier`,
selected by `mode` — so the shape of the bet has to be known before the book is drawn. A
free-form stake split (100 on red, 50 on blue, 10 on green) would need a precomputed book
for every possible ratio, which is not a finite set.

With the stake equal on every backed colour, and all six colours statistically identical, a
round is fully described by **how many colours were backed**. Which ones is irrelevant. That
gives exactly one mode per count:

```
mode   = '3_colours'       three colours backed
cost   = 3                 total stake = cost × amount
amount = stake per colour  (sent verbatim, so always a tray denomination)
```

Same `cost`/`amount` shape as the sibling `crimson_plinko` game, where `cost` = balls per drop.

Because `amount` is submitted unscaled, every reachable bet is exactly one of the tray
denominations — so the RGS `betLevels` grid is satisfied by construction.

### RTP and max win

RTP is **96.49%** and is *identical for every mode* — the mean multiplier is `k × 0.964907`
for k backed colours, and dividing by `cost = k` returns the same figure. All 6 modes
certify at one number, inside Stake's 90.00%–96.70% band.

Max win is **200× `amount`** in every mode (one colour taking a triple with the wheel on
200×; a triple uses all three dice, so nothing else can also pay). Against the *total* wager
that is `200 / colours backed` — 200× on one colour, down to 33.33× across all six.

| colours | max win vs total stake | reached |
| ------- | ---------------------- | ------- |
| 1       | 200.00×                | 1/21,600 |
| 2       | 100.00×                | 1/10,800 |
| 3       | 66.67×                 | 1/7,200  |
| 4       | 50.00×                 | 1/5,400  |
| 5       | 40.00×                 | 1/4,320  |
| 6       | 33.33×                 | 1/3,600  |

Run the math repo's `compliance_report.py` to verify both rules per mode.

### Data flow

```
ROLL ──▶ beginRoll() picks mode + amount from the selection
          ├─ online  (?rgs_url=…) → xstate actor → RGS /wallet/play (amount, mode) → book
          └─ offline (no rgs_url) → DevHarness plays a local book FROM THE SAME MODE
                                   │
       book.events ──▶ playBookEvents() ──▶ bookEventHandlerMap
                       reveal / wheelSpin / winInfo / setTotalWin / finalWin
                                   ▼
                        eventEmitter emitterEvents ──▶ components animate
                        (DiceBox 3D roll · WheelBonus · win overlay · balance)
```

Books never name literal colours. Dice are **selection-relative slots** — `B1`…`Bk` are the
backed colours in selection order, `O1`… the unbacked ones — so one book set serves every
possible colour choice. The client substitutes its own picks at playback via
`resolveDiceColours`, against an ordering frozen at roll time.

---

## File structure

```
apps/colour-dice/
├── src/
│   ├── components/
│   │   ├── Game.svelte           # Colour board, stake tray, controls, win overlay
│   │   ├── DiceBox.svelte        # Real 3D dice (@3d-dice/dice-box-threejs)
│   │   ├── WheelBonus.svelte     # Lucky Wheel (triple bonus)
│   │   ├── EnableGameActor.svelte# Online path: starts the xstate game actor
│   │   └── DevHarness.svelte     # Offline path: fake session + local book playback
│   ├── game/
│   │   ├── constants.ts          # Colours, wheel, the 6 modes, max win
│   │   ├── stateGame.svelte.ts   # Colour selection, stake, mode choice, undo/clear/repeat
│   │   ├── types.ts              # Slot (B1/O1) → colour resolution
│   │   ├── config.ts / context.ts# Game config (mirrors math) + Svelte context wiring
│   │   ├── actor.ts / stateXstate.ts  # xstate machines (online bet lifecycle)
│   │   ├── bookEventHandlerMap.ts# Math book events → emitter events (per-colour wins)
│   │   ├── eventEmitter.ts / types*.ts / utils.ts
│   │   └── devLocalBet.ts        # Offline: deduct stake, play a same-mode book, credit win
│   ├── stories/data/base_books.ts# AUTO-GENERATED offline sample books, keyed by mode
│   ├── styles/                   # global.scss + table.scss (ported from ColourDice Angular)
│   └── routes/                   # SvelteKit +page / +layout
└── static/                       # img, fonts, sound, dice-box-threejs assets
```

---

## Prerequisites

- **Node** (per the monorepo) and **pnpm 10.5.0** (`packageManager` in the root
  `package.json`).
- Install dependencies once from the **monorepo root** (`stake-web-sdk/`):

  ```sh
  pnpm install
  ```

---

## Running (dev)

```sh
pnpm --filter colour-dice dev
```

Then open **http://localhost:3010**. With no RGS session in the URL the app runs
**offline**: `DevHarness` fakes an authenticated session (balance 1000) and plays a local
book matching however many colours you backed.

To run **online** against a real RGS, open the app with the Stake session query params,
e.g. `http://localhost:3010/?sessionID=…&rgs_url=…&lang=en&device=desktop`.

---

## Build

```sh
pnpm --filter colour-dice build
```

Other scripts: `pnpm --filter colour-dice lint`, `pnpm --filter colour-dice format`,
`pnpm --filter colour-dice preview`.

---

## Refreshing offline sample books

`src/stories/data/base_books.ts` is generated from the math SDK's published books, keyed by
mode. After you (re)run the math, regenerate it:

```sh
pnpm --filter colour-dice sync-math-books
```

Takes `--limit N` for the number of books sampled **per mode** (default 60 → 360 total).
Requires the sibling `stake-math-sdk` repo to have been run so
`games/colour_dice/library/publish_files/books_*_colours.jsonl.zst` exist, and its Python
venv (`env/`, which has `zstandard`) to be set up — the script shells out to it.

To regenerate the math itself, from `stake-math-sdk/`:

```sh
PYTHONPATH=. env/Scripts/python.exe games/colour_dice/run.py
```

---

## Open items

- **Mobile layout.** The Angular original ships a separate mobile component; this app
  currently has one layout.
- **Dice throw feel.** The dice enter from above the frame and are thrown at the middle of
  the table; the five constants at the top of `DiceBox.svelte` are the tuning knobs. The
  motion has not been eyeballed in a real browser yet.

### If weighted betting is ever wanted

Backing colours at *different* stakes is possible, but it needs a mode per distinct chip
layout rather than per colour count: 20 modes for up to 6 chips, 48 for 8, 98 for 10 (the
lowest-terms integer partitions). The math and client were both built that way at one point
and it works — it is purely a question of whether Stake accepts that many modes.
