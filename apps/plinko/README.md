# One-Eyed Willy's Plinko (frontend)

Svelte 5 + PixiJS client for **One-Eyed Willy's Plinko** (`one_eyed_willys_plinko`). The game is **book-driven**: the Remote Game Server (RGS) and math SDK produce a ordered list of book events per round; the client replays those events for animation and UI only. It does not simulate outcomes or change the wallet outside RGS APIs.

Monorepo context: [stake-web-sdk README](../../README.md). Authoritative math: [`stake-math-sdk/games/crimson_plinko`](../../../stake-math-sdk/games/crimson_plinko).

---

## Prerequisites

| Tool | Version |
|------|---------|
| Node | `>=22.16.0` |
| pnpm | `10.5.0` (repo root) |

From repo root: `pnpm install`.

For Storybook / local books without RGS, generate math books in `stake-math-sdk` (see [Math books](#math-books--storybook) below).

---

## Quick start

```bash
# From stake-web-sdk root
pnpm run dev --filter=plinko          # http://localhost:3003
pnpm run storybook --filter=plinko    # http://localhost:6005 (syncs books first)

# From apps/plinko
pnpm run dev
pnpm run sync-math-books
```

| Mode | Port |
|------|------|
| Dev | 3003 |
| Storybook | 6005 |

---

## How the game works (high level)

```mermaid
sequenceDiagram
  participant UI as HUD / Game.svelte
  participant Actor as gameActor (XState)
  participant RGS as Stake RGS
  participant Book as bookEventHandlerMap
  participant Board as PlinkoEngine

  UI->>Actor: BET
  Actor->>RGS: /wallet/play (+ meta: meters, row count)
  RGS-->>Actor: Bet with book events[]
  Actor->>Book: playBet → recordBookEvent per event
  Book->>Board: plinkoDrop outcomes → drop balls
  Book->>Book: spinMeter / bonusMeter / features
  Actor->>RGS: /wallet/end-round (after animations)
  RGS-->>UI: Updated balance
```

1. **Authenticate** — `PlinkoAuthenticate.svelte` loads session, balance, and config from RGS (`state-shared`).
2. **Place bet** — `EnableGameActor.svelte` wires the HUD to `gameActor` (XState from `utils-xstate`).
3. **Play book** — `actor.ts` calls `playBet()` which walks `bet.state` through `bookEventHandlerMap.ts`.
4. **Animate** — `plinkoDrop` drives `PlinkoBoard` / `PlinkoEngine`; meter and feature events update UI and open roulettes.
5. **Settle** — Wins and feature payouts are applied via RGS; free-spin edge cases may defer wallet credit until before `end-round` (see [Free spin & wallet](#free-spin--wallet)).

**Local dev without RGS:** synced fixtures in `src/stories/data/base_books.ts` plus `devLocalBet.ts` can play books directly.

---

## Source layout

```
apps/plinko/
├── src/
│   ├── routes/              # SvelteKit shell (static adapter, SSR off)
│   ├── components/          # Main UI: Game, HUD, board, overlays
│   ├── features/
│   │   ├── bonus/           # Bonus meter, bonus roulette, bonus level UI
│   │   └── freeSpin/        # Free-spin meter, wheel, RGS payout helpers
│   ├── game/                # Book pipeline, state, RGS session, orchestration
│   ├── game-logic/          # Pure rules: constants, meters, spin slot helpers
│   ├── plinko-engine/       # Pixi physics board (ported from legacy Angular)
│   ├── lib/                 # staticUrl, format helpers
│   ├── i18n/                # Message maps (en, zh + shared UI packages)
│   └── stories/             # Storybook + synced math fixtures
├── static/                  # img/, i18n JSON (copied to build/)
├── scripts/                 # Math sync, engine port, Storybook helper
└── build/                   # Production upload folder (gitignored)
```

### `src/game/` — core runtime

| Module | Responsibility |
|--------|----------------|
| `config.ts` | Provider/game IDs, RTP, coefficient tiers, default meter maxima |
| `typesBookEvent.ts` | Typed book events (`plinkoDrop`, `spinMeter`, `freeSpinTrigger`, …) |
| `bookEventHandlerMap.ts` | **Central dispatcher** — maps each event type to async handlers; exports `playBet` |
| `actor.ts` | XState machine: play, resume, bet meta, deferred settlement, wallet sync |
| `stateGame.svelte.ts` | Reactive game state (meters, roulettes, drops, bonus round, UI flags) |
| `gameOrchestrator.ts` | Drop batches, bonus balls, overlays, autoplay locks, win display |
| `meterFlow.ts` | Shared roulette open/close (spin + bonus); peg/slot meter bumps (non-authoritative path) |
| `plinkoSessionMeters.ts` | RGS spin/bonus meter carry-over, `buildBetMetaPlayConditions()` |
| `plinkoWalletSync.ts` | Bet type for end-round, balance snapshot, post-round refresh |
| `plinkoRoundSettlement.ts` | When to defer end-round (feature wins, meter full) |
| `devLocalBet.ts` | Play fixture books in dev (injects free-spin trigger when needed) |
| `context.ts` | Svelte context: layout, app, xstate, game, i18n, event emitter |
| `eventEmitter.ts` | Typed pub/sub for UI (`bet`, `freeSpinShow`, …) |

### `src/features/bonus/` & `src/features/freeSpin/`

Feature folders own **UI + feature-specific logic** (roulettes, meters, wallet actions). Shared round flow stays in `game/`.

- **Bonus:** `BonusMeter`, `BonusRoulette`, `BonusLevel`, Pixi `BonusMeterEngine`
- **Free spin:** `FreeSpinMeter`, `FreeSpinRoulette`, trigger flow, payout resolution, RGS wallet credit, dev book injection

Import from barrels:

```ts
import { BonusMeter, BonusRoulette } from '../features/bonus';
import { FreeSpinMeter, runFreeSpinTriggerFlow } from '../features/freeSpin';
```

### `src/game-logic/`

Stateless helpers used by game and features:

- `constants.ts` — row tiers, wheel segments, meter tier config, presets
- `meterController.ts` — client-side meter simulation when books lack per-ball flags
- `spinSlot.ts` — center-pocket detection
- `slotColors.ts` — pocket colors from multipliers

### `src/plinko-engine/`

`PlinkoEngine.ts` — Matter.js board: ball spawn, peg collisions, slot landing, callbacks to `PlinkoBoard.svelte`. Regenerate from legacy source via `scripts/port-plinko-engine.mjs` if needed.

### `src/components/`

| Component | Role |
|-----------|------|
| `Game.svelte` | Root layout: background, board, HUD, feature overlays |
| `GameHud.svelte` | Bet controls, balance, meters (desktop + mobile) |
| `PlinkoBoard.svelte` | Canvas host for `PlinkoEngine` |
| `PlinkoAuthenticate.svelte` | RGS auth gate before game |
| `EnableGameActor.svelte` | Starts XState actor, forwards `bet` events |
| `Background.svelte` | Static landscape/portrait JPG backgrounds |

---

## Book events (math contract)

Each round is an array of events (see `typesBookEvent.ts`). Typical base round:

| Event | Client behavior |
|-------|-----------------|
| `plinkoDrop` | Configure board; spawn balls from `outcomes` (slot index, peg/slot flags) |
| `spinMeter` | Update free-spin meter (authoritative when from math) |
| `bonusMeter` | Update bonus meter / level |
| `bonusRoulette` | Open bonus wheel; grants the level-1 entry free balls |
| `freeSpinTrigger` | Open free-spin wheel; `NX` multiplies the round win, `BONUS` chains into a bonus round |
| `bonusRound` | One bonus level's free balls, **animated from the book's exact `outcomes`** (no client RNG). Higher-`level` events drive level-ups |
| `setTotalWin` / `finalWin` | Accumulate displayed win; `finalWin` = wallet payout |

When the book contains any feature event (`spinMeter` / `bonusMeter` / `freeSpinTrigger` / `bonusRoulette` / `bonusRound`), `playBet` enables **`authoritativeMeterFlow`**: meters, wheels, and bonus balls all follow the book, never client RNG. The `*MeterFull` session-meter fallbacks in `features/` are dev/local-book only.

---

## Bonus & free-spin features

Both features are **server-authoritative**: every trigger chance, wheel result, free ball, and level-up is authored by the math (`stake-math-sdk/games/crimson_plinko`). The client only animates and presents. This is what keeps the on-screen total equal to the wallet payout.

**Free spin (spin meter).** A ball landing in the **center 0× pocket** fills the spin meter (`onSpinSlotLand`). When full, the book emits `freeSpinTrigger` and the client opens the wheel (`runFreeSpinTriggerFlow`). An `NX` segment multiplies that round's drop win; a `BONUS` segment chains into a bonus round. Wallet credit is the book `finalWin` / `payoutMultiplier`, settled by RGS `/wallet/end-round`.

**Bonus (bonus meter).** A ball that contacts a **bonus (coin) peg** (`hitBonusPeg`, `onCoinPegHit`) fills the bonus meter. When full, the book emits `bonusRoulette` (entry free balls) then one `bonusRound` per level. Free balls drop one at a time (`playOneBonusBall` → `bonusBallDrop`), each landing on its **book-authored** slot (`takeAuthoritativeBonusOutcome`), accumulating into `bonusSessionWinAmount`.

**Level-up.** If the bonus meter re-fills *during* a bonus round, it levels up and awards more balls. The math precomputes this and emits an extra `bonusRound` with a higher `level`; the client plays the current level's balls, shows the level-up overlay (`BonusLevelUpOverlay`), then plays the next level — see `enqueueAuthoritativeBonusLevel` → `consumeAuthoritativeBonusLevel` in `gameOrchestrator.ts`. When no higher-level `bonusRound` remains, the accumulated balance is paid out.

**Free balls per level** — editable table, **must match** `stake-math-sdk/plinko_data.BONUS_LEVEL_BALLS`:

`game-logic/constants.ts` → `BONUS_LEVEL_BALLS`

| Level | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 |
|-------|---|---|---|---|---|---|---|---|
| +balls | 20 | 30 | 50 | 75 | 100 | 150 | 200 | 300 |

(Level 1 entry balls come from the bonus wheel, `BONUS_ROULETTE_SEGMENTS`.) Meter maxima and wheel/segment tables also live in `constants.ts` and are exported from the math FE config (`config.ts`).

**Meter persistence & triggering.** Meters accumulate across rounds (`game/plinkoSessionMeters.ts`: `applySpinMeterBookEvent` / `syncSpinMeterAfterBet`, carried via play `meta`). Because RGS selects books by `mode` (not `meta`), a **full meter auto-fires a dedicated trigger-mode bet** — `gameOrchestrator.ts:maybeAutoFireFeatureTrigger` → `plinkoBetMode.ts:plinkoActiveBetMode` picks `freespin*` / `bonus*` mode → RGS serves a book that always triggers the feature and computes the payout (no client-side trigger/payout). Trigger modes are published free (`cost 0`); see `crimson_plinko/INTEGRATION.md` for the `TRIGGER_MODE_COST` switch. Auto-fire is gated to live RGS sessions (dev-local has no trigger books).

**Core functions:** `bookEventHandlerMap.ts` (event handlers + `playBet`), `gameOrchestrator.ts` (`startAuthoritativeBonusRound`, bonus-ball + level-up flow, auto-fire trigger, settlement), `meterFlow.ts` (meter bumps, roulette open/close), `features/bonus` + `features/freeSpin` (wheels, payout helpers).

---

## State & context

- **`stateGame`** (`stateGame.svelte.ts`) — all plinko-specific UI/runtime flags.
- **`stateBet` / `stateUrlDerived`** (`state-shared`) — balance, wager, RGS URL, session, replay mode.
- **`gameActor`** — betting lifecycle (idle → play → end); do not call RGS play/end-round from random UI code.
- **`getContext()`** — access layout, pixi app, i18n, emitter from child components.

`utils.ts` re-exports `playBet` for Storybook (`ModeBaseBook` stories).

---

## Free spin & wallet

The **wallet only changes through RGS** (`/wallet/play`, `/wallet/end-round`). The client cannot safely credit wins in the browser.

- **Free-spin payout** is included in the math book `payoutMultiplier` and credited on **`/wallet/end-round`** (deferred until after the wheel animation).
- Session **spin/bonus meter carry-over** is sent on each bet via `buildBetMetaPlayConditions()` (`spin_meter_start`, `balls_per_drop`, …). RGS stores session meters server-side; the client reads them from served books and sends updated values on the next play. Math must publish strata with matching `spin_meter_start` and `freeSpinTrigger` so the LUT book payout includes the feature.
- If the served book omits `freeSpinTrigger`, the wheel may still run (presentation fallback) but **no extra wallet credit** occurs unless you republish math with the right strata.

If the wheel shows a prize but balance does not move:

1. Regenerate and **publish** math (`stake-math-sdk/games/crimson_plinko` — `INTEGRATION.md`, free-spin section).
2. Rebuild and re-upload `apps/plinko/build/`.
3. Confirm ACP game ID matches `config.ts` (`one_eyed_willys_plinko`).

---

## Math books & Storybook

**Generate books (math repo):**

```bash
cd ../../../stake-math-sdk
pip install -e .
python games/crimson_plinko/run.py
```

**Sync fixtures into this app:**

```bash
cd apps/plinko
pnpm run sync-math-books
# optional: node scripts/import-math-books.mjs --limit 20
```

Writes `src/stories/data/base_books.ts` only. Storybook `prestorybook` runs sync automatically.

**Helper script (verify + sync + URL):**

```bash
node apps/plinko/scripts/run-local-storybook.mjs
```

Useful stories: `MODE_BASE` / book playback, `COMPONENTS` / board, game, bonus meters.

---

## Production build & Stake Engine

```bash
pnpm run build --filter=plinko
```

Output: `apps/plinko/build/` (`index.html`, `_app/`, `img/`, `i18n/`). `paths.relative` in `svelte.config.js` supports CDN subpaths.

**Upload:**

1. Fresh build.
2. Stake Engine → game **Files** → import entire `build/`.
3. Publish **Front End**; test via Developer session → Launch.
4. Copy session query string into `http://localhost:3003?...` for local RGS testing.

---

## Maintenance scripts

| Script | Purpose |
|--------|---------|
| `scripts/import-math-books.mjs` | Copy sample books from math SDK → `base_books.ts` |
| `scripts/run-local-storybook.mjs` | Verify books exist, sync, print Storybook URL |
| `scripts/port-plinko-engine.mjs` | Regenerate `PlinkoEngine.ts` from legacy Angular |
| `scripts/port-meter-engines.mjs` | Port meter Pixi engines from legacy `crimson-plinko` |

---

## Config reference

| Setting | Location |
|---------|----------|
| Game / provider IDs | `src/game/config.ts` |
| Book handlers | `src/game/bookEventHandlerMap.ts` |
| RGS bet meta | `src/game/plinkoSessionMeters.ts` → `buildBetMetaPlayConditions()` |
| Default coefficients | `config.coefficientSets` (overridden per `plinkoDrop`) |

---

## Related repos

| Repo | Role |
|------|------|
| [`stake-math-sdk/games/crimson_plinko`](../../../stake-math-sdk/games/crimson_plinko) | Math, books, RTP, meter stratification |
| [`ThirdPartyClients/Crash/crimson-plinko`](../../../ThirdPartyClients/Crash/crimson-plinko) | Legacy Angular reference (port scripts only) |

---

## Tips for new developers

1. **Start with a book** — open `base_books.ts` or Storybook `MODE_BASE` and trace events through `bookEventHandlerMap.ts`.
2. **Do not add outcome RNG** — if behavior should change, fix math and republish books.
3. **Feature work** — put bonus UI/logic under `features/bonus/`, free spin under `features/freeSpin/`.
4. **Meters** — distinguish authoritative (`spinMeter` events) vs visual-only bumps in `meterFlow.ts` / `meterController.ts`.
5. **Chromatic / replay** — `PUBLIC_CHROMATIC` and replay URLs skip RGS wallet actions; use Storybook or fixtures.
6. **Backgrounds** — `static/img/BG_landscape.jpg` and `BG_portrait.jpg`; rendered by `Background.svelte`.
