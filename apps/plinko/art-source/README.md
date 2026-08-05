# Source art masters

Delivered art, kept **outside `static/`** on purpose: everything under `static/` is copied verbatim
into the build and published, so a source drop left there ships its uncompressed PNGs to the CDN
alongside the WebP the game actually loads (the V3 drop was 22 MB of exactly that).

Nothing here is referenced by the app. It exists so a future re-encode can start from the masters
rather than from an already-lossy WebP.

## V3 (2026-08-05)

| master | installed as | encode |
|---|---|---|
| `PlinkoFrame.png` | `static/img/game_area_background.webp` | lossy q90 |
| `BASE GAME/Landscape/v3/skeleton.{atlas,json,png}` + `skeleton_2.png` | `static/spine/background_landscape/` | lossless |
| `BASE GAME/portrait/v3/portrait.{atlas,json,png}` + `portrait_2.png` | `static/spine/background_portrait/` | lossless |
| `FREE GAME/SHIP/v3/portrait.{atlas,json,png}` | `static/spine/ship/` | lossless |

⚠️ **Spine pages must be encoded lossless with libwebp `exact=True`.** Every atlas in this game
declares `pma:true`, so Pixi uploads the page RGB verbatim; Pillow's default `exact=False` rewrites
the RGB of fully-transparent pixels, and those invented colours get *added* into the frame as light.
Alpha survives either way, so a naive check passes — compare full RGBA.

`img/` art has no such constraint (Pixi and the DOM both premultiply on upload, so RGB under
alpha=0 never reaches the screen); lossy is used there when it beats lossless by a worthwhile margin.
