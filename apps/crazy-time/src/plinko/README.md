# Jackpot plinko

A one-ball plinko round: the player chooses where to drop from; the award is whatever the RGS
already settled on.

Lifted from Colour Dice (`apps/colour-dice/src/plinko`), where it also ships that game's
`JackpotPlinko` screen — the panel that slides down over the table with its own title, HUD and
balance. That part did NOT come over: Crazy Time already has `BonusRound` for exactly that, so only
the board is here. Keep the two copies in step — `index.ts`, `types.ts` and this file are the only
ones that differ, and they differ only by what the missing screen took with it. Everything that
runs (`PlinkoBoard.svelte`, `board.ts`, `pockets.ts`, `slots.ts`, `colour.ts`) is byte-identical,
so a fix in either game is a straight copy across.

Nothing here imports from the game around it. To remove the feature, delete this folder, the art
under `static/img/plinko/`, and put `RoomPlinko.svelte` back to a board of its own.

## Plugging it in

```svelte
<script lang="ts">
  import { PlinkoBoard, buildPocketLadder, pocketForAward, shapeForPockets } from '../../plinko';
  import type { PlinkoBoardApi } from '../../plinko';

  const ladder = $derived(buildPocketLadder(room.board));
  const shape = $derived(shapeForPockets(ladder.count));
  let board = $state<PlinkoBoardApi>();

  // Awaited, so the book waits for the player:
  const startStep = await board.arm();
  await board.drop(pocketForAward(ladder, room.total, startStep));
</script>

<PlinkoBoard bind:this={board} {shape} {ladder} accent="#2b8fd6" prefix="x" sounds={{ … }} />
```

`PlinkoBoard` is `position: absolute; inset: 0`, so it wants a sized, positioned parent — see
`RoomPlinko.svelte`.

### Props

| Prop              | Default          | Notes                                                                                                                                                                                                                                                   |
| ----------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shape`           | —                | From `shapeForPockets(ladder.count)`.                                                                                                                                                                                                                   |
| `ladder`          | —                | From `buildPocketLadder(awards)`.                                                                                                                                                                                                                       |
| `accent`          | `#ffe14d`        | Paints the ball.                                                                                                                                                                                                                                        |
| `prefix`          | `x`              | Written before a pocket's value — `x200`.                                                                                                                                                                                                               |
| `format`          | `prefix + value` | Whole label, for awards too long to write out — `x1.5k`.                                                                                                                                                                                                |
| `art`             | —                | `{ src, cx, cy, d, scale? }` — a picture to fall instead of the painted ball. `cx`/`cy`/`d` are the round part of the image, as fractions of its width; `scale` draws it bigger than the ball without moving it. The ball stays underneath as the glow. |
| `fieldOpacity`    | `1`              | Below 1 the screen behind reads through the playfield.                                                                                                                                                                                                  |
| `sounds`          | —                | `{ drop, peg, land }` — the host owns its own audio.                                                                                                                                                                                                    |
| `autoDropAfterMs` | `20000`          | Lets go for an absent player. `0` disables.                                                                                                                                                                                                             |

## How a fixed result stays honest

`awards` becomes a **ladder** of `2n - 1` pockets: the cheapest award alone in the middle, the
dearest at both edges, mirrored (`pockets.ts`). Every award except the cheapest therefore sits in
two pockets, and the round sends the ball to whichever of the pair is on the side it was dropped
from — so the path is always the shorter, more plausible one.

The fall is a real Galton walk: the ball strikes exactly one peg per row and leaves it half a peg
pitch to one side, so every position it occupies is a peg it could actually have hit. What is
planned is only the sequence of turns (`planDrop` in `board.ts`), and it is planned by taking each
turn at random from the ones that (a) keep the ball on the board and (b) still leave enough rows to
reach the target. Nothing is corrected afterwards, so the ball never slides sideways to make up
ground — and two drops to the same pocket do not trace the same line.

The field is a **box**, not a pyramid: every row runs the full width, alternating `pockets + 1` and
`pockets` pegs so the zig-zag always lands on one, with the wide row at both the top and the
bottom. That is what buys the drop zone — a pyramid ties the row count to the pocket count and
leaves no slack to start off-centre with, while a box can have as many rows as it likes. So the
drop zone spans the whole width: there is a start position above every gap in the top row, and
`shapeForPockets` gives the board `2 x (maxStep + startSteps) + 1` rows, enough for the longest
trip (corner to opposite corner) with a spare pair on top. Because the top row is the wide one, its
pegs — and so the start positions — sit on half-pitches, which is also the parity an odd number of
half-pitch steps needs to land on a whole-offset pocket centre.

`layoutBoard` then fills its container in both directions — pitch from the width, row gap from the
height — clamped only by the band that keeps the fall looking like a fall. The row-gap-to-pitch
ratio _is_ the angle the ball falls at: half a pitch sideways per row, so 0.5 is a 45° zig-zag.

## Files

| File                 | What it is                                                |
| -------------------- | --------------------------------------------------------- |
| `PlinkoBoard.svelte` | Pegs, pockets, the ball, the drag, and the fall.          |
| `board.ts`           | Geometry and drop planning. Pure — no DOM, no framework.  |
| `pockets.ts`         | The award ladder and which pocket an award maps to.       |
| `slots.ts`           | Pocket art: atlas regions, tiers, and the CSS crop.       |
| `colour.ts`          | Turns the accent hex into the ball's four gradient stops. |

## Pocket art

The pockets are the `glow_numbers` Spine skeleton from One-Eyed Willy's plinko board
(`apps/plinko/static/spine/glow_numbers`), copied in as `static/img/plinko/pocket_slots.webp` —
the same atlas image byte for byte. Its `.atlas` is kept next to `slots.ts` rather than in
`static/` — it is what the region tables were read off, but nothing loads it, so it does not ship.
Each pocket is two of its regions: a
solid card, and a taller glow rising out of it, picked from the source's own seven-tier value
ladder so the cool-centre / hot-edges ramp transfers without recolouring.

The animation comes over as CSS rather than as a Spine runtime, because that skeleton's entire
animation is fifteen identical, in-phase slot-alpha timelines — 1.0 at 0s, 0x4a/255 at 1s, 1.0 at
2s — with no bone movement at all. `@keyframes pocket-glow` is that, keyframe for keyframe, which
avoids pulling Pixi and a Spine runtime into a game that is otherwise DOM and CSS. If the art is
ever re-authored with real motion, that is the point at which the runtime earns its place.
| `types.ts` | The imperative handles (`bind:this`). |

## Integration points in Crazy Time

One, and it is the room itself:

`src/components/rooms/RoomPlinko.svelte` — builds the ladder from `room.board`, arms the board, and
drops to `pocketForAward(ladder, room.total, startStep)`. `BonusRound.svelte` mounts it and awaits
its `play()` like any other room, passing `interactive={covered}` so a room the player was not in
lets the ball go on its own.

Two consequences of the swap worth knowing:

- **`room.dropZone` is no longer read.** Where the ball starts is the player's choice now. The
  book's `slot` is not read either — the pocket comes from `room.total`, which lands on the same
  value in the mirrored half of the ladder at worst. The payout is `room.total` either way.
- **The row count is the board's, not `PLINKO_ROWS`.** `shapeForPockets` derives it from the pocket
  count (13 pockets → 25 rows), because a box-shaped field is what buys the drop zone. The math's
  own row count is still whatever the book says it is; nothing on screen was ever the math.
