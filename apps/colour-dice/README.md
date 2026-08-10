# Colour Dice — Web Client

Single-player front end for **Colour Dice**, a Stake Engine port of the Filipino *Perya*
"Colour Game": three six-sided dice, six colours (`yellow`, `blue`, `white`, `green`,
`pink`, `red`). This is a SvelteKit app in the `twist-turbo` monorepo (Svelte 5 + Vite +
TurboRepo, pnpm workspaces).

The visual layout and 3D dice are ported 1:1 from the original ColourDice Angular
live-dealer client; the math/RTP is produced by the separate `stake-math-sdk` repo at
`games/colour_dice/` (see its README).

---

## How the game works

The player places chips on colours, rolls three dice, and is paid on how many dice show
the backed colour:

| Dice matching backed colour | Payout          |
| --------------------------- | --------------- |
| 1 (single)                  | 2×              |
| 2 (double)                  | 3×              |
| 3 (triple)                  | Lucky Wheel 4×…200× |

### Betting board (multi-chip / multi-colour)

The board reproduces the ColourDice UX — a chip tray (`5 / 10 / 50 / 100 / 1k / 10k`),
six colour panels you tap to stack chips on, plus **Clear / Undo / Repeat / ROLL** —
but adapted to the Stake single-wager model:

- **Total wager = the sum of all chips** placed across colours (shown as *Total Bet*).
- The **most-staked colour** is your paying call, tagged **MAIN**; its match-count drives
  the round's single settled multiplier.
- After a roll, only the MAIN colour gets a `2× / 3× / JACKPOT` badge and win glow (it is
  the colour actually paid). Other backed colours that happen to land get a neutral dashed
  "you called it" glow — **no money is attached to them.**

> **Why chips on non-MAIN colours are cosmetic.** Stake Engine settles each round as one
> precomputed book with a single *hashed* `payoutMultiplier` (`amount × multiplier`); the
> RGS `/wallet/play` request only carries `amount` + `mode`, and there is no mechanism for
> the settled payout to depend on a runtime, per-colour chip distribution. RTP and win cap
> are provably invariant to how you split chips (all colours are identical and the weights
> sum to 1), so this "total win + highlights" model is compliant while keeping the
> multi-chip feel. A truly independent per-colour payout would require a different design
> (fixed equal-stake "k-of-6" bet modes and a math rework).

### Data flow

```
ROLL ──▶ eventEmitter 'bet'
          ├─ online  (?rgs_url=…) → xstate actor → RGS /wallet/play (amount, mode) → book
          └─ offline (no rgs_url) → DevHarness plays a random local sample book
                                   │
       book.events ──▶ playBookEvents() ──▶ bookEventHandlerMap
                                   │  reveal / wheelSpin / setTotalWin / finalWin
                                   ▼
                        eventEmitter emitterEvents ──▶ components animate
                        (DiceBox 3D roll · WheelBonus · win overlay · balance)
```

`bookEventHandlerMap` translates each math book event into `emitterEvent`s; components
subscribe to those and drive the 3D dice, the Lucky Wheel, and the win overlay.

---

## File structure

```
apps/colour-dice/
├── src/
│   ├── components/
│   │   ├── Game.svelte           # Betting board, chips, controls, win overlay
│   │   ├── DiceBox.svelte        # Real 3D dice (@3d-dice/dice-box-threejs)
│   │   ├── WheelBonus.svelte     # Lucky Wheel (triple bonus)
│   │   ├── EnableGameActor.svelte# Online path: starts the xstate game actor
│   │   └── DevHarness.svelte     # Offline path: fake session + local book playback
│   ├── game/
│   │   ├── stateGame.svelte.ts   # Board state (chip stacks, primary colour, history) + actions
│   │   ├── constants.ts          # Colours, hex, pip map, payouts, wheel values
│   │   ├── config.ts / context.ts# Game config + Svelte context wiring
│   │   ├── actor.ts / stateXstate.ts  # xstate machines (online bet lifecycle)
│   │   ├── bookEventHandlerMap.ts# Math book events → emitter events
│   │   ├── eventEmitter.ts / types*.ts / utils.ts
│   │   └── devLocalBet.ts        # Offline: deduct stake, play a book, credit win
│   ├── stories/data/base_books.ts# AUTO-GENERATED offline sample books (see sync below)
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

From anywhere in the repo:

```sh
pnpm --filter colour-dice dev
```

Then open **http://localhost:3010**. With no RGS session in the URL the app runs
**offline**: `DevHarness` fakes an authenticated session (balance 1000) and plays a random
book from `src/stories/data/base_books.ts` on every ROLL — the full betting board works.

To run **online** against a real RGS, open the app with the Stake session query params,
e.g. `http://localhost:3010/?sessionID=…&rgs_url=…&lang=en&device=desktop`.

---

## Build

```sh
pnpm --filter colour-dice build      # production build (SvelteKit) → build/
pnpm --filter colour-dice preview    # preview the production build
```

Other scripts: `pnpm --filter colour-dice lint`, `pnpm --filter colour-dice format`.

---

## Refreshing offline sample books

`src/stories/data/base_books.ts` is generated from the math SDK's published books. After
you (re)run the math (`stake-math-sdk`), regenerate the offline sample:

```sh
pnpm --filter colour-dice sync-math-books           # default: 200 books
pnpm --filter colour-dice sync-math-books -- --limit 400
```

This requires the sibling `stake-math-sdk` repo to have been run (so
`games/colour_dice/library/publish_files/books_base.jsonl.zst` exists) and its Python venv
(`env/`, which has `zstandard`) to be set up — the script shells out to it to decompress
and sample a varied set (every wheel tier plus a spread of ordinary rounds).
