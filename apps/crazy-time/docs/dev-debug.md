# Dev debug: forcing outcomes offline

When the app runs without an RGS session (`pnpm --filter crazy-time dev`, no `rgs_url` in the
URL), the dev harness plays sample books from `src/stories/data/base_books.ts`. A query
parameter picks which kind of book is played, so any room or result can be reached on demand.

Nothing here touches a live session: with an `rgs_url` the parameters are ignored and the RGS
decides every outcome.

## `?force=<kind>`

| Value     | Plays a book where…                                               |
| --------- | ----------------------------------------------------------------- |
| `plinko`  | the wheel lands on the Pirate Plinko room                         |
| `wheel`   | the wheel lands on the Bonus Wheel room                           |
| `chest`   | the wheel lands on the Treasure Chest room                        |
| `voyage`  | the wheel lands on the Ocean Voyage room                          |
| `bonus`   | the wheel lands on any room                                       |
| `number`  | the wheel lands on a number                                       |
| `topslot` | the Top Slot multiplier applied to the spot the wheel landed on   |
| `win`     | the bet paid (any amount)                                         |
| `loss`    | the bet paid nothing                                              |
| `maxwin`  | the biggest payout in the sampled set for the current combination |

`?bonus=<room>` is an alias for `?force=<room>`. The room words are dev shorthands (the value is
lowercased before it is matched), not the spots' own keys — those are `piratePlinko`,
`bonusWheel`, `chest` and `oceanVoyage`.

### Narrowing to a value

Append `:<value>` to a room to ask for a specific room multiplier (before the Top Slot), e.g.
`?force=plinko:400`, `?force=voyage:400`, `?force=chest:2`. If no sampled book matches, the
nearest kind without the value is used and a warning is logged.

### Straight into the room

Forcing a ROOM (`plinko`, `wheel`, `chest`, `voyage`, or `bonus` for any of them) also starts the
round for you: on load the whole board goes down and the wheel is sent off, so the page arrives in
the bonus without a click. The full board is what makes a published ticket out of any single room
and covers whichever one the book holds, so the room plays its real interactive version.

It happens once per load. After that the board is yours again, bet and spun by hand like any other
round. The other kinds — `win`, `loss`, `number`, `topslot`, `maxwin` — do not auto-start, because
what you want to look at there is usually a board you chose yourself.

### Same pace as a live round

A forced round plays at full length: the reels, the wheel, the multiplier flight and the chest
reveal all run exactly as they do in a normal game, so what you check is what a player sees. The
auto-start waits for the intro splash to finish before it bets and spins.

### Coverage

Whether the room PAYS depends on the spots on the board, not on the parameter. Left to the
auto-start every room is covered; bet by hand and it is the chips that decide. To see the "you were
not in this bonus" preview, bet a number and force a room.

## Examples

```
http://localhost:3021/?force=plinko          # Pirate Plinko room, whatever it pays
http://localhost:3021/?force=chest:250       # Treasure Chest paying its top value
http://localhost:3021/?force=topslot         # a Top Slot hit on the landed spot
http://localhost:3021/?force=maxwin          # the biggest sampled book for the combination
```

## Buy Bonus offline

The Buy Bonus screen works offline like any other bet: the harness plays a sampled book from the
buy mode (`buy_any`, `buy_tc`, `buy_pp`, `buy_ov`, `buy_bw`) and debits price x chip. `?force=`
narrows the pick within that mode the same way (`?force=wheel:1000` with a Bonus Wheel buy, or
`?force=maxwin`). The room forcing auto-start still bets the full board, not a buy.

## Where the books come from

`pnpm --filter crazy-time sync-math-books` regenerates `base_books.ts` from the math publish
(`stake-math-sdk/games/crazy_time/library/publish_files`). The sampler keeps at least one book
per room, one Top Slot hit and the max-win book per mode, then a weighted spread of ordinary
rounds, so every `force` value has something to play. If a forced kind is missing for the current
combination, raise `--limit` and re-run the sync (default 14 books per mode, 252 modes).

## Balance

The offline balance starts at 1,000 and is debited `cost x chip` per spin; wins are credited from
the book's `finalWin`. It is not persisted; reload to reset.

## The intro loader

Every load opens on the casino TV logo splash (`src/components/LoaderCasinoTvLogo.svelte`), which
holds until every asset in the manifest (`src/lib/preloadAssets.ts`) is resident and the game has
mounted, with a progress bar reading out how far it has got. Two dev-only knobs, both ignored in a
production build:

| Parameter           | Effect                                                                                  |
| ------------------- | --------------------------------------------------------------------------------------- |
| `?noLoader=1`       | Skip the splash: the game mounts at once, as before the loader existed. The preload still runs silently. For harnesses that step the game on a clock. |
| `?preloadDelay=<ms>` | Pad every preload task by that long, so the bar can be watched filling on a local server that would otherwise finish in a blink (`?preloadDelay=150` runs about ten seconds). |

After the splash, `window.crazyTimePreloadReport()` (evaluated in the game's own frame) says what the
preload did: tasks settled, time taken, anything that failed, and anything the browser fetched from
the network after the reveal. In dev, an asset fetched after the reveal that is not in the manifest
also warns in the console with the path to add.

## Bet Replay offline

Stake's replay mode (`?replay=true`) plays one recorded round with no session. Online the round
comes from `{rgs_url}/bet/replay/{game}/{version}/{mode}/{event}`; with no `rgs_url` the dev
harness stands in with a sampled book for `mode`: the one whose id is `event`, else one picked by
`?force=`, else any. `amount` is the chip in API units (1000000 = 1.00) and `currency` its code.

```
http://localhost:3021/?replay=true&mode=x1_x2_x5_x10&amount=2000000&currency=USD&force=win
http://localhost:3021/?replay=true&mode=bw&amount=1000000&currency=EUR&force=loss
http://localhost:3021/?replay=true&mode=buy_tc&amount=1000000       # a bought room
http://localhost:3021/?replay=true&mode=nonsense                    # the "could not be loaded" notice
```

The gem reads PLAY, then PLAY AGAIN; the board shows the recorded bet and takes no input; the
rail reads Win where the balance would be; bonus rooms play themselves (nobody is at the table).
See `src/game/replay.ts` and the replay block in `Game.svelte`.

## Another currency offline

`?currency=<code>` runs the offline table in that currency's form (symbol, decimals, symbol side:
see `src/game/currency.ts`), e.g. `?currency=JPY`, `?currency=PLN`, `?currency=KWD`, `?currency=XGC`.
Online the currency always comes from the RGS.
