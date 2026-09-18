# Stake Engine compliance report: Crazy Time (working title)

Audit date: 2026-09-19. Branch `crazy-time`. Front end `apps/crazy-time`, math
`stake-math-sdk/games/crazy_time` (published files dated 2026-09-16).

Source: every page under https://stake-engine.com/docs/approval-guidelines (general requirements,
bet replay, quality rankings, RGS communication, front end, math verification, tile assets,
disclaimer, jurisdiction) plus the RGS and wallet API pages, read on the audit date.

**Not covered:** the detailed "Submission Checklist" is behind the Stake Engine login, so I could
not read it. Open it while logged in and compare it against this report before submitting.

## Verdict

The math is ready. The front end is not yet: the audit found five items that block approval. Two
are fixed since (Bet Replay, money display). Three remain, and the largest of them (the game's
identity) is a product decision, not a code fix.

| Area | Result |
| --- | --- |
| Math, critical tests (8) | All pass |
| Math, 2-Star and 3-Star risk limits | All pass, three sit close to the line |
| Front end, RGS and UI rules | 3 blockers left (Bet Replay and money display since done), 6 risks |
| Assets, IP and originality | 1 blocker, 3 risks |
| Submission material (tile art, blurb) | Not prepared |

## Blockers

### 1. Bet Replay: implemented 2026-09-19 (was missing)

Ported from the Plinko. `?replay=true` loads the round without authenticating, the gem reads PLAY
and then PLAY AGAIN, the board shows the recorded bet and takes no input, Buy Bonus and the chip
tray are gone, the rail reads Win in place of the balance, bonus rooms play themselves, and a round
that cannot be loaded says so. Verified offline (win, loss, bought room, bad link, portrait) and
against a mocked `/bet/replay` through the real resume machine: the replay GET was the only
request made, across two playbacks. Not yet run against Stake's RGS: do that with real event IDs
(normal win, big win, max win, loss, each room, each buy) once the math is published.
See `src/game/replay.ts` and `docs/dev-debug.md`.

### 2. The game's identity: name, "Top Slot", and the format itself

- "Crazy Time" is Evolution's trademark. It is still the `gameName`, the `gameID` (`crazy_time`),
  the package name and the math folder. On screen it appears only in the How to Play pill
  (`InfoModal.svelte:509`), a tab nothing opens at the moment. The README already says to rename.
- "Top Slot" is Evolution's own feature name and it is all over the rules, the quick guide and the
  bet history pills.
- Stake's rule is "games must be original designs". A 54-segment wheel with 1/2/5/10, four bonus
  rooms and a two-reel multiplier slot above it is recognisably Crazy Time's format even under a
  pirate theme and new room names. This is reviewer discretion and I cannot clear it from code.
  The rooms being your own (Pirate Plinko, Treasure Chest, Ocean Voyage) helps. Renaming the
  game and the Top Slot is the minimum; consider asking Stake before investing in the rest.

### 3. RGS errors never reach the player

The shared packages report every failure by setting `stateModal.modal = { name: 'error' }`, but
this app mounts no component that reads it. A failed authenticate, an expired session (`ERR_IS`),
maintenance (`ERR_MAINTENANCE`), a gambling limit (`ERR_GLE`) or a failed replay load all leave
the player looking at a table that silently does nothing. Only "insufficient balance" and the
stuck-round case have their own notice.

### 4. Money display: fixed 2026-09-19 (was off Stake's spec)

Every sum now goes through one formatter, `src/game/currency.ts`, built from Stake's currency
table: the symbol, the decimal count and the symbol's side per currency (`¥5,000`, `Rp5,000,000,000`,
`10.00 zł`, `KD10.000`, `10.00 GC`), a currency Stake adds later falling back to its code after the
figure. Wins, Total Bet, prices, limits and history are written in full, never as `1.2k`, and keep
extra decimals when the sum needs them (a 13.5x buy on a 0.01 chip reads `$0.135`). The balance
stays at the currency's own decimals, cut rather than rounded. Digits are Western whatever `lang`
is. Chip faces and the Buy Bonus chip stepper still abbreviate: they name a denomination.

Checked in the browser in USD, JPY, PLN, IDR and ARS, landscape and portrait, up to the largest
case there is (a 50,000x win read `5,000,000,000.00 ARS` on the tile and the rail without
overflowing; the tile readout scales down past 15 characters). Offline, `?currency=PLN` tries any
currency (docs/dev-debug.md).

One open point: Stake's own pages disagree on Gold Coins (the guidelines table shows `10.00 GC`,
their sample code `GC10`). The table is followed.

### 5. Font licences

Stake requires assets to comply with copyright law. Shipped and loaded today:

| Font | Status |
| --- | --- |
| Inter, Alexandria | OFL, licence file present |
| Noto Sans, Poppins | OFL, no licence file shipped |
| **PingFang SC** (the body font) | Apple proprietary, not licensable for redistribution |
| D-DIN-PRO, Merge Pro, AustereBlackCaps | Commercial: need a web/app licence on file |
| PotatoSans, Pieces of Eight | Licence unverified |

PingFang has to go. The others need proof of licence or a replacement.

## Risks (may pass, may be sent back)

1. **Production console output.** Stake checks that "no errors or game information is being
   logged". Unguarded logs include bet-mode and book details (`Game.svelte`,
   `bookEventHandlerMap.ts:80`), the preload report printed 8 s after load
   (`preloadAssets.ts:650-782`), and the replay response (`Authenticate.svelte:159`). Shared
   packages log too (`rgsFetcher`, `LoadI18n`, `createPrimaryMachines`, `utils-book`).
2. **Two discs are not drawn to their odds.** The Bonus Wheel's 1,000x wedge is drawn full width
   but weighs a quarter (the rules page does say so). The Random Bonus buy disc shows four equal
   quarters while the odds are 22 / 26 / 26 / 26 %, and the rules do not mention it. Stake's math
   review looks for anything "misleading".
3. **Single-room bets lose 94% of the time.** Every mode clears the 1-in-50 hit-rate floor (worst
   is 1 in 18), but Stake also says roughly 90% non-paying results "may be grounds for
   rejection". Pirate Plinko, Bonus Wheel and Ocean Voyage alone are 94.4% zero, X10 and Treasure
   Chest 92.6%. Natural for a wheel bet, but be ready to explain it.
4. **Max win frequency.** Stake: "typically more frequent than 1 in 10,000,000". The math enforces
   1 in 20,000,000. 64 modes sit in between: 32 whose top win comes only from Ocean Voyage
   (1 in 14.2M) and 32 only from Pirate Plinko (1 in 10.7M).
5. **Bundle weight: 198 MB of static files.** A 3-star rating asks for an optimised bundle.
   154 MB is five background videos (one of them, 21 MB, unused). About 40 MB in total is unused
   (`animated_background.mp4`, `background_base_landscape.png`, `board.png`, `chest_open.png`,
   `chest_close.png`, autobet/high-bet art). Several large PNGs in use could be webp. The 2.2 MB of
   sample books is compiled into the production JS through `devLocalBet.ts`, and the offline dev
   harness runs in production whenever `rgs_url` is absent.
6. **stake.us (social mode) is not supported.** No `social=true` handling and no sweeps wording.
   Almost every string breaks the word list (bet, buy, pays, stake, wager, funds, Buy Bonus), and
   "BUY BONUS" is painted into the button art. This does not block stake.com, only stake.us.
7. **Placeholders still live:** `background_music_placeholder.mp3` (no licence or source on
   record), the quick guide stills, and the math README calls the room tables "first-pass".
   Stake allows only minor visual updates after approval: no math changes, no new modes.
8. **Leftover staging URLs in the build.** `packages/state-shared/src/constants.ts` hardcodes an
   S3 bucket and a staging host. Nothing requests them in this game, but the strings are in the
   built HTML 25 times and Stake enforces a strict no-external-sources policy.
9. **Reused art.** Nothing matches the SDK sample games (hash-checked), which is the rule. About
   60% of the files are shared with your own Plinko and Colour Dice (buy bonus screen, menu,
   chips, sounds), which a reviewer may read as a reskin when scoring design.

## Passing

**Math, critical tests** (measured from the published lookup tables, all 260 modes)

| Test | Result |
| --- | --- |
| 1.0x base mode, and it is the cheapest | Pass: eight 1.0x modes, none cheaper |
| Base std dev ≥ 0.6 | Pass: 2.04 (X1) to 40.56 (Bonus Wheel) |
| RTP 90.0% to 96.7% | Pass: 96.6941% to 96.6973%, none above 96.70% |
| Cross-mode RTP spread ≤ 0.5% | Pass: 0.0032% |
| Max win ≤ 500,000x | Pass: 50,000x |
| Max cost ≤ 2,000x | Pass: 18x |
| Non-zero hit rate ≥ 1 in 50 | Pass: worst 1 in 18 |
| ≤ 10M events per mode, ≤ 4.2 GB per file | Pass: 14,175 events, largest file 0.25 MB |

**Math, risk limits:** all pass at 2-Star and 3-Star. Close to the line: max payout is exactly
50,000x (the 2-Star limit), Bonus Wheel per-stake CVaR 599 of 700, Bonus Wheel share of RTP from
wins over 40x is 0.745 of 0.8. Also: no zero-weight rows, no gaps in the win ladder, `index.json`
valid with all 520 files present, fully stateless (no jackpot pool, gamble, cashout or
continuation). `library/stats_summary.json` is stale (2026-09-12, 257 modes); regenerate it
before anyone reads it.

**Front end**

- Uses `rgs_url` from the query string, authenticates first, plays and ends rounds through the RGS.
- Chip tray is built from the RGS `betLevels`, honours `minBet` / `maxBet` and the default level.
- An open round found at load is finished before betting reopens.
- Balance, Total Bet and the final win are on screen. Sound and music can be switched off.
- No autoplay or turbo, so those rules do not apply. Buy Bonus asks for confirmation.
- Rules page covers how to play, every spot's odds and cap, every room's values, each buy's cost
  and max win, RTP, max win, a controls guide and the disclaimer.
- Pick rooms state plainly that choices do not change the result.
- English only, hardcoded, so other `lang` values cannot corrupt the text.
- No external requests: fonts, images and sounds are all local.
- Portrait phone (375x812) and the mini-player size (400x225) both render undistorted. The
  README's "portrait not done" note is out of date.
- Theme (pirates, kraken, dragon, chests) has nothing child-directed.

## Fixed during this audit

| Change | File |
| --- | --- |
| Spacebar now presses the SPIN / PLAY AGAIN gem (required by Stake). Ignored while a modal, the menu or a bonus room is up, while typing, and when the operator sets `disabledSpacebar`. Verified in the browser: a space press debited the bet and started the spin. | `src/components/Game.svelte` |
| Rules mention the spacebar. | `src/components/InfoModal.svelte` |
| Disclaimer ends "TM and © 2026 Engine", matching Stake's template. It read "Stake Engine", and Stake branding is not allowed in a game. | `src/components/InfoModal.svelte` |
| The 1,000x wedge is called "the top prize", not "a jackpot". Stake bans jackpots, and the word invites the question. | `src/components/InfoModal.svelte` |


## Still to prepare for submission

- Tile art: `GameTitle-BG.png/jpg`, `GameTitle-FG.png` (transparent), `ProviderName-Logo.png`,
  background plus foreground under 3 MB combined. `design-export/` holds only the wheel discs.
- A short blurb on theme and mechanics for the promo text.
- Replay event IDs for every mode type: normal win, big win, max win, loss, bonus round.

## Suggested order

1. Decide the name and get a read from Stake on the format (blocker 2). Everything else is wasted
   if the concept is refused, and the `gameID` rename touches the math publish.
2. Bet Replay, together with the error modal (blockers 1 and 3).
3. Currency formatter (blocker 4).
4. Fonts and the music track (blocker 5, risk 7).
5. Strip production logs, remove unused assets, move the dev harness behind a dev-only check
   (risks 1, 5, 8).
6. Decide on the two discs and the 1-in-10M max-win line before the math is frozen (risks 2, 4),
   since the math cannot change after approval.
7. Social wording, only if you want stake.us (risk 6).
