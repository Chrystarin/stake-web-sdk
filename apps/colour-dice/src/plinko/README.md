# Jackpot plinko

A one-ball plinko round on a screen that slides down over the game. The player chooses where to
drop from; the award is whatever the RGS already settled on.

Nothing here imports from the game around it. To remove the feature, delete this folder and the
three integration points listed at the bottom.

## Plugging it in

```svelte
<script lang="ts">
  import { JackpotPlinko, type JackpotPlinkoApi } from '../plinko';

  let jackpot = $state<JackpotPlinkoApi>();

  // …somewhere in the round sequence, awaited so the book waits for the player:
  await jackpot?.play(multiplier, { accent: '#43b047' });
</script>

<JackpotPlinko
  bind:this={jackpot}
  awards={[4, 10, 20, 50, 100, 200]}
  balance="$1,240.00"
  sounds={{ drop: () => playSound('whoosh'), peg: () => playSound('pop'), land: () => playSound('merge') }}
/>
```

The component renders nothing between rounds — it is not on the DOM at all — so it can sit at the
end of a game's markup without taking a tap meant for the table. Mount it inside the element the
screen should cover; it positions itself absolutely against the nearest positioned ancestor.

### Props

| Prop               | Default                              | Notes                                                    |
| ------------------ | ------------------------------------ | -------------------------------------------------------- |
| `awards`           | —                                    | The multipliers this round can pay, in any order.          |
| `balance`          | —                                    | Already formatted and signed by the host.                  |
| `balanceLabel`     | `Balance`                            |                                                            |
| `title`            | `JACKPOT`                            | Top centre.                                                |
| `background`       | `/img/background.png`                | Panel backdrop.                                            |
| `accent`           | `#ffe14d`                            | Paints the ball and the title glow. `play()` overrides per round. |
| `prefix`           | `x`                                  | Written before a pocket's value — `x200`.                  |
| `hint`             | "Hold ball then slide…"              | Caption under the title, while the ball is held.           |
| `sounds`           | —                                    | `{ drop, peg, land, screenIn, screenOut }` — the host owns its own audio. |
| `autoDropAfterMs`  | `20000`                              | Lets go for an absent player. `0` disables.                |
| `onMenu`           | —                                    | Menu button.                                               |

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
ratio *is* the angle the ball falls at: half a pitch sideways per row, so 0.5 is a 45° zig-zag.

## Files

| File                  | What it is                                                |
| --------------------- | --------------------------------------------------------- |
| `JackpotPlinko.svelte` | The screen: slide, HUD, title, and the round sequence.    |
| `PlinkoBoard.svelte`   | Pegs, pockets, the ball, the drag, and the fall.           |
| `board.ts`             | Geometry and drop planning. Pure — no DOM, no framework.   |
| `pockets.ts`           | The award ladder and which pocket an award maps to.        |
| `slots.ts`             | Pocket art: atlas regions, tiers, and the CSS crop.        |
| `colour.ts`            | Turns the accent hex into the ball's four gradient stops.  |

## Pocket art

The pockets are the `glow_numbers` Spine skeleton from One-Eyed Willy's plinko board
(`apps/plinko/static/spine/glow_numbers`), copied in as `static/img/plinko/pocket_slots.webp` —
the same atlas image byte for byte, `.atlas` alongside it. Each pocket is two of its regions: a
solid card, and a taller glow rising out of it, picked from the source's own seven-tier value
ladder so the cool-centre / hot-edges ramp transfers without recolouring.

The animation comes over as CSS rather than as a Spine runtime, because that skeleton's entire
animation is fifteen identical, in-phase slot-alpha timelines — 1.0 at 0s, 0x4a/255 at 1s, 1.0 at
2s — with no bone movement at all. `@keyframes pocket-glow` is that, keyframe for keyframe, which
avoids pulling Pixi and a Spine runtime into a game that is otherwise DOM and CSS. If the art is
ever re-authored with real motion, that is the point at which the runtime earns its place.
| `types.ts`             | The imperative handles (`bind:this`).                      |

## Integration points in Colour Dice

Three, all of them small:

1. `src/game/typesEmitterEvent.ts` — the `jackpotRound` emitter event.
2. `src/game/bookEventHandlerMap.ts` — the book's `wheelSpin` event broadcasts it.
3. `src/components/Game.svelte` — mounts `<JackpotPlinko>` and awaits `play()` on that event.
