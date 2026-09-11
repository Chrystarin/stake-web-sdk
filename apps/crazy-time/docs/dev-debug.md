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
`?force=plinko:400`, `?force=voyage:250`, `?force=chest:2`. If no sampled book matches, the
nearest kind without the value is used and a warning is logged.

### Straight into the room

Forcing a ROOM (`plinko`, `wheel`, `chest`, `voyage`, or `bonus` for any of them) also starts the
round for you: on load the whole board goes down and the wheel is sent off, so the page arrives in
the bonus without a click. The full board is what makes a published ticket out of any single room
and covers whichever one the book holds, so the room plays its real interactive version.

It happens once per load. After that the board is yours again, bet and spun by hand like any other
round. The other kinds — `win`, `loss`, `number`, `topslot`, `maxwin` — do not auto-start, because
what you want to look at there is usually a board you chose yourself.

### A shorter wind-up

Any forced round — every kind, not just the rooms — also skips most of its own build-up. The reels
turn, the wheel turns and the multiplier flies exactly as they always do, in the same order, but at
a fraction of the length: a forced round is being looked at rather than played, and twelve seconds
of ceremony between a reload and the thing you are checking is twelve seconds in the way. Loading
`?force=plinko` puts you in the room about three and a half seconds after the page does.

Drop the parameter and the round plays at full length again.

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
