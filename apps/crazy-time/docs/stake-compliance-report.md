# Stake Engine compliance report: Crazy Time (working title)

Audit date: 2026-09-19, re-audited 2026-10-14 (read the update section first). Branch `crazy-time`. Front end `apps/crazy-time`, math
`stake-math-sdk/games/crazy_time` (published files dated 2026-09-16).

Source: every page under https://stake-engine.com/docs/approval-guidelines (general requirements,
bet replay, quality rankings, RGS communication, front end, math verification, tile assets,
disclaimer, jurisdiction) plus the RGS and wallet API pages, read on the audit date.

**Not covered:** the detailed "Submission Checklist" is behind the Stake Engine login, so I could
not read it. Open it while logged in and compare it against this report before submitting.

## Update 2026-10-14: re-audit against the current rules

Stake's approval pages were re-read in the Browser pane on 2026-10-14 and the game re-checked
against them (code, the published math, and the running game). Everything below supersedes the
2026-09-19 text where the two differ; that text is kept underneath as the record of what was
found then.

### What changed in Stake's rules since 2026-09-19

| Rule | Then | Now | This game |
| --- | --- | --- | --- |
| Modes per game | not stated on the pages read | **At most 20 modes.** "Exceptions are made for fantastic games: contact Support if yours needs more." The math page adds: "Files/modes exceeding this size will fail on publish." | **15 modes since 2026-10-14** (each spot alone, the four numbers, the four rooms, the whole board, and a buy per room; was 260). The free spot combinations and the Random Bonus buy are gone. |
| RTP band (critical) | 90.0% to 96.7% | **96.0% to 96.7%** | 96.694% to 96.697%: passes |
| Max win (critical) | 500,000x | 1,000,000x | 50,000x: passes |
| Max cost (critical) | 2,000x | 50,000x | 18x: passes |
| Cross-mode RTP spread | 0.5% (critical) | no longer listed | 0.003% |
| Non-zero hit rate 1 in 50 | critical | "other considerations" | worst 1 in 18: passes |
| New critical test | | At least one bet-level template must fit the 3-Star limits | passes (all 2-Star limits met on 2026-09-19, files unchanged since 2026-09-15) |
| Game tile | files to send in (`GameTitle-BG`, `-FG`, logo) | **Built in Studio's tile editor**: a 3:4 tile set as the cover and a 16:9 cover art, from a background image plus a transparent foreground PNG; no wording, prices or multipliers in the art. The submission form blocks without both. | Nothing prepared. `design-export/` holds only the wheel discs. |
| Submission form gates | | Published front + math version, every critical test passing, one open review at a time until the first game is live; you confirm the disclaimer is in the rules and social mode has no restricted phrases. | |
| Bet Replay checklist | | Added: show the bet cost **including the mode's cost multiplier and the real cost**; a loading state; must work in Popout S; no restricted phrases in social mode; no way into normal play; currency/lang/amount tolerated when missing or invalid. | Popout S verified today (400x225, a bought room). The replay rail now reads the Chip and the Total Bet (the real cost: `$13.50` for a 13.5x buy on a $1 chip; the Chip line was added today); the multiplier itself is in the rules. |
| Jurisdiction (stake.us) | wording only | **Mode names** must not contain "buy", "bet" or "pay", and must match across the game, the replay window and the math files. | Buy modes are `buy_any`, `buy_tc`, `buy_pp`, `buy_ov`, `buy_bw`. Only matters for stake.us, but mode names are frozen at publish. |
| Front end | | "Any bet mode costing more than 2x the base bet must ask the player to confirm before it is activated." "Double tap to zoom must be disabled on mobile." Reviewers launch with an invalid `rgs_url` and expect an error. | See below. |
| Quality bar | | Three reviewers, 0 to 3 stars each; at least 6 of 9 points to publish; "over-reliance on generic AI-generated assets" is a listed cause of low ratings. | |

The detailed "Approval Requirements" list on the Submission checklist page is still login-gated.
The public part of that page is now readable and is summarised above.

### Verdict today

| Area | Result |
| --- | --- |
| Math, critical tests | All pass (re-measured from the published lookup tables today) |
| Math, mode count | 15 of 20: passes (cut on 2026-10-14; regenerate and republish) |
| Front end, RGS and UI rules | 2 blockers fixed today (error display, double-tap zoom); identity still open |
| Assets, IP | PingFang removed today; commercial font licences still unverified |
| Submission material | Tile not built, blurb not written, replay event IDs not collected |

### Fixed today (front end only, no math touched)

| Change | Where | Verified |
| --- | --- | --- |
| RGS errors reach the player. A new dialog reads the shared `stateModal`: a failed authenticate or replay load, a refused play, insufficient balance, a gambling limit, a 429, bets paused (423), and the generic case. Fatal ones (no session, dead session, unreachable host) offer only RELOAD; the rest can be closed. Betting, SPIN, Buy Bonus and the spacebar wait behind it, and the quick guide does not open over it. | `src/components/RgsErrorModal.svelte`, `Game.svelte`, `QuickGuideModal.svelte` | Loaded with an invalid `rgs_url`: "Connection problem ... Failed to fetch" with RELOAD, chips hidden, no guide. Also at 400x225. |
| Double-tap zoom off on mobile: viewport `maximum-scale=1, user-scalable=no, viewport-fit=cover` plus `touch-action: manipulation` on `<body>` (Android honours the meta, iOS the touch-action), the same pair the Plinko ships. | `src/app.html` | Computed `touch-action: manipulation` on body. |
| Favicon inlined as a data URI. Stake's file API answers 403 for `favicon.svg`, so the old `<link>` logged a failed request on every load, and reviewers read the network tab. | `src/app.html` | |
| PingFang (Apple's, not redistributable) removed: the `@font-face`, the preload entry and the file. Nothing visible used it: every text element sets its own family, and a DOM scan found one script element resolving to it. The body default is Noto Sans now. | `src/styles/global.scss`, `src/lib/preloadAssets.ts`, `static/fonts/Pingfang/` | No PingFang in `document.fonts`; table renders as before. |
| The replay rail shows the Chip above the Total Bet, so a replay states the bet amount and the real cost without a chip tray (Bet Replay checklist: "display bet cost, cost multiplier, payout, and win amount"). | `Game.svelte`, `totalBet` snippet | Offline replay of a 13.5x buy: Chip `$1.00`, Total Bet `$13.50`. |
| Game information no longer logged in production: the book-segment mismatch, the covered-spot mismatch, the open-round closer, the three preload reports, and the replay response dump in the shared `Authenticate` are dev-build only (`import.meta.env.DEV`). Genuine failures still reach the player through the dialog. | `Game.svelte`, `bookEventHandlerMap.ts`, `activeRound.ts`, `preloadAssets.ts`, `packages/components-shared/.../Authenticate.svelte` | |

### Still open: decisions, not code

1. **Mode count: resolved 2026-10-14.** The math is cut to 15 modes (each spot alone, the four
   numbers, the four rooms, the whole board, and a buy per room; Random Bonus dropped), the board
   only accepts those tickets, and the library was regenerated. Republish before review.
2. **Identity.** `gameName` / `gameID` are still "Crazy Time" / `crazy_time` (package, math
   folder, How to Play pill); "Top Slot" is in the rules, the quick guide and the bet history. The
   format itself is reviewer discretion. The rename touches the math publish, so decide it with
   item 1.
3. **Font licences.** D-DIN-PRO, Merge Pro and Merge Pro Bold, AustereBlackCapsSSK, PotatoSans and
   Pieces of Eight need a web/app licence on file or a replacement. Noto Sans, Poppins, Inter and
   Alexandria are OFL.
4. **Social mode (stake.us only).** Mode names with "buy" in them, and nearly every string on
   screen, break the restricted list; no `social=true` handling exists. If stake.us is wanted, the
   buy modes need new names before the math is frozen (names cannot change after approval).
5. **Multi-spot bets and the 2x confirmation rule.** A board with three or more spots costs more
   than 2x the chip and is placed without a confirmation step. The Total Bet is on screen and the
   player builds it chip by chip, which is how every table game works, but the rule as written does
   not carve that out. Option: a one-time confirm when Total Bet exceeds 2x the chip, or raise it
   with Support alongside item 1.
6. **Two discs not drawn to their odds** (Bonus Wheel 1,000x sliver at full width; Random Bonus
   buy disc in equal quarters at 22/26/26/26%). Unchanged; the rules mention the first, not the
   second.
7. **Tile and blurb** in Studio; **replay event IDs** per scenario (normal win, big win, max win,
   loss, each room, each buy) once the math is published under its final name.

### Risks, re-checked

- **Bundle: 235 MB of static files** (was 198 MB). 110 MB is video. About 38 MB is unreferenced
  from any source file and can go: `videos/animated_background_pirate_plinko.mp4` (25.4 MB),
  `sound/background_music_placeholder.mp3` (3.0 MB, and the only track without a source on
  record), the Ocean Voyage v1 leftovers `sea_texture_night.png`, `kraken_head.png`,
  `kraken_tentacles.png`, `barrel2.png`, `barrel3.png` (7.7 MB), the autobet / high-bet
  confirmation art under `img/buy-bonus/confirmation_popup/` (0.5 MB) and the old wheel icons
  `img/wheel/ocean-voyage.png`, `bonus-wheel.png`, `pirate-plinko.png`, `pirate-ship.png`,
  `img/pirate-plinko/coin_v2.png`. The `*_phone.webp` cuts are referenced through `staticUrl` and
  are in use. Not deleted today: say the word and they go.
- **Staging URLs in the build.** `packages/state-shared/src/constants.ts` still carries the
  `test-fart-cdn-bucket` S3 host; it lands in `build/index.html`. Nothing requests it.
- **Max-win frequency.** Unchanged: 64 modes have their top win rarer than Stake's "typically
  more frequent than 1 in 10,000,000" (Ocean Voyage 1 in 14.2M, Pirate Plinko 1 in 10.7M), none
  rarer than 1 in 20M.
- **Single-spot modes above 90% non-paying.** x10 and Treasure Chest 92.6%, Pirate Plinko,
  Bonus Wheel and Ocean Voyage 94.4%. Stake's wording is "may be grounds for rejection".
- **`library/stats_summary.json` is still the 2026-09-12 file** (257 modes); the publish files are
  2026-09-15. Regenerate before anyone reads it.
- The app's `lint` script does not run: ESLint 9 finds no `eslint.config.js` in the app. Not a
  Stake item, but it means nothing lints this code.

### Math, re-measured from `library/publish_files` after the cut to 15 modes

| Test | Result |
| --- | --- |
| Modes | 15 of 20 (eight single spots, `x1_x2_x5_x10`, `pp_bw_tc_ov`, the full board, four room buys); every spot is unchanged, so every figure below is the same as before the cut |
| Cheapest mode is 1.0x | Pass: eight 1.0x modes (`x1` ... `ov`), none cheaper |
| RTP 96.0% to 96.7% | Pass: 96.694% to 96.697% |
| Max win | 50,000x (critical limit 1,000,000x; 2-Star 50,000x exactly) |
| Max cost | 18x |
| Events per mode | 14,175 |
| Non-zero hit rate | worst 1 in 18 (`pp`, `bw`, `ov`) |
| Max win rarer than 1 in 20M | none |


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
