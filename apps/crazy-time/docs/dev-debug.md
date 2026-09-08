# Dev debug: forcing outcomes offline

When the app runs without an RGS session (`pnpm --filter crazy-time dev`, no `rgs_url` in the
URL), the dev harness plays sample books from `src/stories/data/base_books.ts`. A query
parameter picks which kind of book is played, so any room or result can be reached on demand.

Nothing here touches a live session: with an `rgs_url` the parameters are ignored and the RGS
decides every outcome.

## `?force=<kind>`

| Value | Plays a book where… |
| --- | --- |
| `plinko` | the wheel lands on the Plinko room |
| `wheel` | the wheel lands on the Jackpot Wheel room |
| `chest` | the wheel lands on the Treasure Chest room |
| `tower` | the wheel lands on the Dragon Tower room |
| `bonus` | the wheel lands on any room |
| `number` | the wheel lands on a number |
| `topslot` | the Top Slot multiplier applied to the spot the wheel landed on |
| `win` | the ticket paid (any amount) |
| `loss` | the ticket paid nothing |
| `maxwin` | the biggest payout in the sampled set for the current ticket |

`?bonus=<room>` is an alias for `?force=<room>`.

### Narrowing to a value

Append `:<value>` to a room to ask for a specific room multiplier (before the Top Slot), e.g.
`?force=plinko:400`, `?force=tower:250`, `?force=chest:2`. If no sampled book matches, the
nearest kind without the value is used and a warning is logged.

### Coverage

Whether the room PAYS depends on the ticket on the board, not on the parameter. To see a room pay,
put a chip on it (or use ALL BONUS / FULL BOARD); to see the "you were not in this bonus" preview,
bet a number and force a room.

## Examples

```
http://localhost:3021/?force=plinko          # Plinko room, whatever it pays
http://localhost:3021/?force=chest:250       # Treasure Chest paying its top value
http://localhost:3021/?force=topslot         # a Top Slot hit on the landed spot
http://localhost:3021/?force=maxwin          # the biggest sampled book for the ticket
```

## Where the books come from

`pnpm --filter crazy-time sync-math-books` regenerates `base_books.ts` from the math publish
(`stake-math-sdk/games/crazy_time/library/publish_files`). The sampler keeps at least one book
per room, one Top Slot hit and the max-win book per mode, then a weighted spread of ordinary
rounds, so every `force` value has something to play. If a forced kind is missing for the current
ticket, raise `--limit` and re-run the sync.

## Balance

The offline balance starts at 1,000 and is debited `cost x chip` per spin; wins are credited from
the book's `finalWin`. It is not persisted; reload to reset.
