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
| `BASE GAME/Landscape/v3/skeleton.{atlas,json,png}` + `skeleton_2.png` | `static/spine/background_landscape/` — **superseded, see below** | lossless |
| `BASE GAME/portrait/v3/portrait.{atlas,json,png}` + `portrait_2.png` | `static/spine/background_portrait/` | lossless |
| `FREE GAME/SHIP/v3/portrait.{atlas,json,png}` | `static/spine/ship/` | lossless |

⚠️ **Spine pages must be encoded lossless with libwebp `exact=True`.** Every atlas in this game
declares `pma:true`, so Pixi uploads the page RGB verbatim; Pillow's default `exact=False` rewrites
the RGB of fully-transparent pixels, and those invented colours get *added* into the frame as light.
Alpha survives either way, so a naive check passes — compare full RGBA.

`img/` art has no such constraint (Pixi and the DOM both premultiply on upload, so RGB under
alpha=0 never reaches the screen); lossy is used there when it beats lossless by a worthwhile margin.

## Landscape background spine, v4 (2026-08-06)

| master | installed as | encode |
|---|---|---|
| `v4/skeleton.{atlas,json,png}` + `skeleton_2.png` | `static/spine/background_landscape/` | lossless, `exact=True` |

Replaces the V3 landscape drop of the row above. A like-for-like re-export, not a re-rig: same Spine
4.3.23, same single `animation`, the same 37 slots and 62 bones under the same names — checked rather
than assumed, because `backgroundLandscapeAsset.ts` addresses `animation` and the `cloud1..7` / `moon`
/ `ship` slots by name, and `boundsMode: 'authored'` means the skeleton's own bounds drive the fit.
Authored height moved 2007.806 → 2009.9592 with `y` -3.170 → -5.323, i.e. 2.15 units more at the
bottom — under a thousandth of the height, so no re-tuning of the fit constants.

Both atlas pages were repacked, so the page sizes changed (2045x2032 → 2048x2046, 2032x1457 →
1967x1432) and the regions moved. The `.atlas` and `.json` must therefore be installed **together**
with the images — a v4 atlas against a v3 page samples garbage.

⚠️ The atlas keeps its `skeleton.png` / `skeleton_2.png` page names on purpose. Nothing rewrites the
file on disk; `backgroundLandscapeAsset.ts` maps those names to the `.webp` URLs in its `images`
block. Renaming them inside the atlas breaks that lookup.

Verified: both pages re-decode byte-identical to the masters across **full RGBA** (not alpha alone —
see the `pma:true` warning above), the atlas' declared page sizes match the encoded files, and the
served skeleton reports the v4 bounds. 8.8 MB of PNG → 5.5 MB of WebP.

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

## Landscape betting-panel backdrop (2026-08-06)

| master | installed as | encode |
|---|---|---|
| `betting_panel_bottom_overlay.png` | `static/img/betting_panel_bottom_overlay.webp` | lossless, **alpha renormalised** |

1955x307 RGBA, a pure vertical gradient (transparent for the top ~27%, then ramping down). Drawn
full-viewport-width behind the entire landscape betting panel — see `.bp-panel-scrim` in
`GameHud.scss` — where it replaced the CSS `backdrop-filter` bar that used to sit behind the total-bet
readout alone.

⚠️ **This is the one installed image that is not a straight re-encode of its master.** The master
tops out at **alpha 219** (86%), so the bottom of the panel stayed slightly see-through. The installed
WebP has its alpha channel linearly rescaled `min(255, round(a * 255 / 219))`, which lands the bottom
edge on a true 255 and leaves 0 at 0 — so the fade keeps its shape and the transparent top edge is
untouched, only the ramp's range is stretched to full. Re-derive that divisor from the master's actual
peak alpha if art redelivers this file; don't re-apply it to an already-renormalised WebP.

Lossless despite being `img/` art: at 28 KB it is only ~2 KB above lossy q90, and a smooth gradient
stretched across the full viewport is the worst case for lossy banding. Not worth 2 KB.
