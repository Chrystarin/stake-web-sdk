# Source art masters

Delivered art, kept **outside `static/`** on purpose: everything under `static/` is copied verbatim
into the build and published, so a source drop left there ships its uncompressed PNGs to the CDN
alongside the WebP the game actually loads (the V3 drop was 22 MB of exactly that).

Nothing here is referenced by the app. It exists so a future re-encode can start from the masters
rather than from an already-lossy WebP.

## V3 (2026-08-05)

| master | installed as | encode |
|---|---|---|
| `PlinkoFrame.png` | `static/img/game_area_background.webp` — **superseded, see below** | lossy q90 |
| `BASE GAME/Landscape/v3/skeleton.{atlas,json,png}` + `skeleton_2.png` | `static/spine/background_landscape/` | lossless |
| `BASE GAME/portrait/v3/portrait.{atlas,json,png}` + `portrait_2.png` | `static/spine/background_portrait/` | lossless |
| `FREE GAME/SHIP/v3/portrait.{atlas,json,png}` | `static/spine/ship/` | lossless |

⚠️ **Spine pages must be encoded lossless with libwebp `exact=True`.** Every atlas in this game
declares `pma:true`, so Pixi uploads the page RGB verbatim; Pillow's default `exact=False` rewrites
the RGB of fully-transparent pixels, and those invented colours get *added* into the frame as light.
Alpha survives either way, so a naive check passes — compare full RGBA.

`img/` art has no such constraint (Pixi and the DOM both premultiply on upload, so RGB under
alpha=0 never reaches the screen); lossy is used there when it beats lossless by a worthwhile margin.

## Game area frame (2026-08-06)

| master | installed as | encode |
|---|---|---|
| `game_area_frame.png` | `static/img/game_area_background.webp` | lossy q90 |

Replaces the V3 `PlinkoFrame.png` render of the row above. Same composition, same aspect, but
delivered at 1× — 1142×1009, exactly half of V3's 2284×2018 — so the installed WebP drops from
546 KB to 215 KB and from 2284 px wide to 1142 px. Desktop has room to spare — at 1280×720 the frame
`contain`-fits to 737 CSS px, still a 0.65× downscale. Mobile does not: at 375×812 the `cover` fit
paints it 539 CSS px wide, which on a DPR-3 phone asks for 1617 device px against a 1142 px asset —
a **1.4× upscale**, where V3 had headroom. Ask art for a 2× master if that softening shows.

Anchors were re-measured off the new file rather than assumed: the skull cavity spans x 468..697,
y 368..384, i.e. centre 0.51007 / 0.37265 and half-width 0.09983 of the art — within a pixel (in V3
space) of where V3 put it, so `src/lib/frameArt.ts` only had its numerators halved, not retuned.
Re-checked against the *encoded* WebP too: all five spawn offsets across ±1 half-width still land on
black, not on a tooth.

## Mobile Autobet stop icon (2026-08-05)

| master | installed as | encode |
|---|---|---|
| `autoplay_stop_btn_mobile.png` | `static/img/auto-bet-stop-btn-mobile.webp` | lossless |

93x90, same box as `auto-bet-btn-mobile.webp` — a drop-in swap, no layout knobs to re-tune. Encoded
lossless despite being a plain (non-atlas) image: it is a flat icon with a hard edge, where lossy's
usual win over PNG is smallest and least worth the risk of banding.
