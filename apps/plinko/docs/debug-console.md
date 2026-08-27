# Debug console guide

Every `window.plinko*` hook the client publishes, what it does, and what it cannot show you.

Almost all of them are **dev-only** — `installPlinkoDevDebug` returns early behind `import.meta.env.DEV`,
so in a production build the names simply do not exist. The two exceptions are called out below.

Type them straight into the browser console with the game open. Most return a snapshot object rather
than logging, so the console prints the state they left behind.

| Command | Registered in |
| --- | --- |
| Ball speed | [`devDebug.ts`](../src/game/devDebug.ts) |
| Win celebrations | [`devDebug.ts`](../src/game/devDebug.ts) |
| Meters | [`devDebug.ts`](../src/game/devDebug.ts), [`Game.svelte`](../src/components/Game.svelte) |
| Locks / diagnostics | [`devDebug.ts`](../src/game/devDebug.ts), [`plinkoMeterTrace.ts`](../src/game/plinkoMeterTrace.ts) |
| Bet payload | [`plinkoPlayDebug.ts`](../src/game/plinkoPlayDebug.ts) |
| Preload black box | [`preloadAssets.ts`](../src/lib/preloadAssets.ts) |
| Board geometry / pocket bounce | [`PlinkoBoard.svelte`](../src/components/PlinkoBoard.svelte) |

## Ball speed

```js
plinkoSetSpeed(0.2)   // a fifth of normal — study a single peg hit
plinkoSetSpeed(6)     // six times normal — blow through a deep bonus round
plinkoSetSpeed()      // clear the override, back to the Fast Game toggle
plinkoSpeed()         // read what is in force without changing it
```

The argument is a multiple of **normal** play, not of the current speed:

| Value | Meaning |
| --- | --- |
| `1` | Normal play. |
| `2` | Exactly what the Fast Game toggle gives. |
| `0.25` | Quarter speed. |
| `null` / omitted / `'reset'` | Clears the override. |

Range is `0.001`–`20`; anything outside is clamped with a console warning. The low end is a sanity
rail, not a taste call — the speed is genuinely proportional, so `0.001` is already minutes per row.

Both commands return `{ debugSpeedMultiplier, fastGameEnabled, simSpeed, effectiveMultiplier }`.
`simSpeed` is the raw engine `animationSpeed`; `effectiveMultiplier` is the same thing expressed
against normal play, so it is what you passed in (post-clamp) whenever an override is set.

### What it covers

The override supersedes the Fast Game toggle and everything paced off ball speed follows it live,
including balls already in the air:

- the fall itself,
- the spawn spread inside a multi-ball drop,
- the cadence of a held free-ball stream in a bonus round,
- the bounce arc and its cooldown, which stretch or compress so a hop still spans about one row at any
  speed.

Spawn *pacing* — the gaps between balls, not the fall — is capped at 3x its normal stretch
(`MAX_SPAWN_PACING_STRETCH` in [`stateGame.svelte.ts`](../src/game/stateGame.svelte.ts)). Uncapped, a
ten-ball drop at `0.005` would spread its spawns over about six minutes and you would sit watching an
empty board. Capped, the balls still arrive promptly and each one falls as slowly as asked.

### What it does not cover

- **The Fast Game toggle looks inert while an override is set.** It still flips its own state and the
  button still lights up; it just loses to the override. Clear with `plinkoSetSpeed()` to get it back.
- **The peg flash is a fixed 200 ms pulse** (`bounceEffectDuration`) at every speed, as it already was
  in Fast Game. At a deep slow-down the pegs light and fade while the ball is still on its way past.
- **Wheels, overlays and celebrations run at their own timings.** Speed only touches the balls.

### Why a slow setting used to do nothing below ~0.2x

Worth knowing, because the symptom is easy to re-introduce. `animationSpeed` scales exactly one term in
the engine's speed model — `normalSpeed`. The `minSpeed` floor, the gravity ramp, `bounceSlowdown`, the
acceleration and the spawn cruise speed are raw per-step constants, and between them they pinned the
ball at about a fifth of normal however small `animationSpeed` got.

`slowMotionScale` in [`PlinkoEngine.ts`](../src/plinko-engine/PlinkoEngine.ts) now scales those terms
too. It is `min(1, factor)` — exactly `1` at normal speed and in Fast Game, so every multiplication is a
no-op and production runs the tuned numbers it always has. **Only the dev slow-down takes the scaled
path.** Any new per-step constant added to the speed model needs the same treatment, or it becomes a
new floor.

## Win celebrations

```js
plinkoTestCaptainsJackpot()              // the top banner, at the current bet
plinkoTestEpicBounty(5000, 50)           // chosen win amount, on the 50-ball tier
plinkoTestMassivePlunder({ seconds: 20 }) // park it on screen to study the art
```

Each fires the full-screen celebration at a **chosen tier** without having to win a round, working out
the multiplier that lands mid-band for you. Arguments are `(amount?, balls?, seconds?)`, or a single
`{ amount, balls, seconds }` object when you only care about one of them.

| Argument | Default |
| --- | --- |
| `amount` | What the trigger multiplier really pays at the current bet per ball. |
| `balls` | `10`. The tier picks the bet mode, hence the max win the tier is scored against. |
| `seconds` | Production timing (~2.3 s). Values below the count-up length are clamped up to it. |

Related:

- `plinkoTestWinTier(tier, ...)` — the same thing with the tier as an argument (`'massive'`, `'epic'`,
  `'captain'`).
- `plinkoTestWin(amount, multiplier, balls)` — the raw form. You pick the multiplier and it decides the
  tier from its fraction of the tier's max win.
- `plinkoTestRapidSparkle(amount, multiplier, count)` — the small 1-ball rapid-mode sparkles instead of
  the full-screen reveal. Switches to the 1-ball tier first. Max 3 are shown.

These are multi-ball features; the celebration commands force `ballPerDrop` away from 1 for you.

## Coin streams

```js
plinkoTestBonusEndCollect(250)        // post-bonus collect out of the skull's mouth
plinkoTestFreeSpinWinCoins(20, 12.34) // in-bonus free-spin coins toward the Win readout
```

Both mirror the real flow — the credit lands first and only the *display* is held back, which is what
the coins then release into a count-up. For the free-spin stream the first argument is the wheel's
landed segment and sets the **coin count** (one per multiple won), so `(1)` throws a single coin and
`(20)` throws twenty; the second is the credit the Win field counts up by.

## Meters

```js
plinkoSetSpinMeter(7, 10)   // 70%-full free-spin bar
plinkoSetSpinMeter(10)      // land exactly on the wheel trigger, keeping the tier's max
plinkoSetBonusMeter(0.5)    // bonus bar drawn half full (cosmetic)
plinkoSetBonusMeter(null)   // restore the live value
```

`plinkoSetSpinMeter` writes through the RGS session cache as well as the display. That matters: a
display-only write gets snapped back to the cached session value on the next balance change, which
looks like the bar spontaneously resurrecting.

`plinkoSetBonusMeter` is the opposite — a purely cosmetic override of the drawn fill, for looking at the
bar. It does not move the value any game logic reads.

## Locks and diagnostics

```js
plinkoDebugLocks()   // ~40-field snapshot: why are the controls still locked?
plinkoForceUnlock()  // force the betting controls open, then snapshot
```

`plinkoDebugLocks()` is the first thing to reach for on a soft-lock. It covers the drop pipeline
(in-flight balls, pending spawn timers), the bonus round (level, queue, outcome index), both meters
including what the bonus bar is actually *drawing* versus its value, the overlay flags, and the roulette
flow. Each field is documented at its declaration in [`devDebug.ts`](../src/game/devDebug.ts) with what
a stuck value means.

For the bonus meter specifically, when the bar shows a value no book justifies:

```js
plinkoTraceMeter(true)      // arm the write tracer (zero cost until armed)
plinkoTraceMeterDump()      // every write, with a trimmed stack
plinkoTraceMeterDump(true)  // only the writes that landed at max
```

The bar has many writers — book events, the provisional peg-hit fill, the per-tier re-seed, the session
restore, the in-bonus level meter, the award snap — so recording every write with its stack is the only
reliable way to find the culprit. Capped at 400 entries.

## Bet payload

```js
plinkoPlayMeta()
```

**Available in production builds.** Returns what the client would send for a play: mode, stake per ball,
balls per drop, mode cost, play amount in both display and API units, the total debit, the bet levels
and the `meta` play conditions. Use it when a bet is rejected or debits an unexpected amount.

## Preload black box

```js
plinkoPreloadReport()
```

**Available in production builds.** Returns what the preload actually did — elapsed time, whether it hit
its safety cap, when the splash was revealed, assets that loaded *after* reveal, and failures. Published
once the splash is gone.

It exists because a live "assets load when the screen opens" report is otherwise unfalsifiable: every
candidate cause looks identical from the outside. In dev, an asset that loads late and is not in the
manifest also warns with the path to add.

## On-load dev flags

Some states are awkward to reach from the console because they want to be on screen at first paint.
Those are compile-time constants in [`Game.svelte`](../src/components/Game.svelte) — `DEV_SHOW_BONUS_LEVEL_UP_ON_LOAD`,
`DEV_SHOW_BONUS_ROULETTE_ON_LOAD` and friends. Flip one, save, and the overlay is up when the page
reloads. Do not commit them flipped.

## A caveat on verifying by eye

The in-app browser cannot run this game, so anything you are checking here you are checking by hand. For
anything that has to agree with the math — outcomes, meter maxima, level ladders, ball awards — the book
library is the reference, not the screen. See [README.md](README.md) for where each number actually
lives.

## Pocket bounce

```js
plinkoBouncePockets()     // fire the landing bounce on all 15 pockets at once
plinkoBouncePockets(3)    // just pocket 3 (the left 5x)
```

**DEV only.** No ball can be made to land in every pocket, and the outer ones come up rarely enough
in organic play that "does that pocket react?" is not answerable by playing — so ask the pockets
directly. Works with the board idle; it drives its own frames when no drop is in flight.

Returns the wiring alongside the trigger, which is what tells a dead pocket apart from a dead
*bounce*:

| Field | Means |
| --- | --- |
| `glowSpineActive` | The glow spine is driving the pockets (it needs a 15-pocket board). False means the flat slot sprites are, and the bounce moves those instead. |
| `glowBone` | This pocket has its bone on the spine. `false` on any pocket is an asset/name mismatch — that pocket's card can never move. |
| `bounceHeightPx` | Peak travel of the arc at the current viewport. |

Every pocket moving here but only some moving in play means the trigger is picking the wrong pocket,
not that the pocket is broken — see `triggerSlotAnimation`, which keys off the ball's own
`targetIndex` for exactly that reason.

## Board geometry (ball vs coin)

```js
plinkoDebugBoard()
```

**DEV only.** Live ball and coin positions, plus the two numbers that matter for coin contact:
`worstCoinOverlap` (px the ball is drawn *inside* a coin — must always be 0) and `nearestCoinGap`
(0 means resting on a coin's surface). Sample it on an interval to get a drop's trajectory as
numbers:

```js
const S = [];
const id = setInterval(() => {
  const s = plinkoDebugBoard();
  if (s.balls.length) S.push({ t: performance.now(), b: s.balls.map(b => ({ ...b })) });
}, 8);
// ... run some drops, then clearInterval(id) and read S
```

Ball motion is what this board is judged on and a screenshot costs about a second, which is far too
coarse to tell a bounce from a slide or to measure how close a ball ran to a coin. Sample at 8ms,
not 16ms — a 60fps render repeats each position twice, and dedupe on changed `x`/`y` to recover the
real frames.
