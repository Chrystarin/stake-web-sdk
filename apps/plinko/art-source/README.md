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

### ⚠️ Installed `skeleton.json` is patched: the `ocean` mesh is moved down

The `ocean` slot's `oceanAnim/` mesh sits high enough that the animated sea rides over the horizon in
`img/BG_landscape.webp`. The installed file has that mesh **translated down 16 authored units**
(`y -= 16`, so 448.84..1191.37 → 432.84..1175.37). A translation, not a scale: the water keeps its
proportions and its texture, and `uvs` / `triangles` / `hull` / the 90-frame `sequence` are untouched.
The animation has no `deform` timeline, so mesh vertices are never animated and this cannot be fought
by playback.

**16 is the tuning value**, and it was arrived at by eye rather than solved — 52 (as a compression)
read too low, 26 still a touch low. ~7 screen px at 1280 wide; one authored unit ≈ `skeletonScale x
spineScale` = 0.5 x 0.8776 ≈ 0.44 px, scaling with viewport width. More negative = lower. Re-apply by
rewriting the `"vertices"` array of `"oceanAnim/"`, adding the shift to every odd (y) entry.

⚠️ **Only a load-time edit to this file works.** An equivalent adjustment applied to the parsed
`SkeletonData` at runtime (a `meshOffsetY` option on the asset def, applied in `readSkeletonData`) was
built, verified to reach the live attachment's vertices — and had no effect on the rendered frame at
all. That approach was reverted; don't rebuild it without first working out why. Related unknown: the
`ocean` slot resists inspection — every property looks healthy (90 non-null sequence regions, textures
resolved, alpha 0x76) yet its geometry appeared not to influence output under several test methods.
Note that runtime vertex mutation is NOT a valid way to test this: the renderer caches mesh geometry
after construction, so post-construction edits to `attachment.vertices` change nothing for ANY mesh.

### Related: the sea and the horizon drift apart with aspect ratio

Whatever value the shift above is tuned to is only right at ONE aspect. `spineFit.ts` gives the Spine
layer a vertical offset proportional to viewport HEIGHT (`offsetYVh: -0.21`) while the horizon it has
to meet is painted into a backdrop that scales with viewport WIDTH. Reduced from
`computeSpineOverlayTransform`, the gap between the delivered mesh top and the painted horizon is
`0.21 x VH - 0.100157 x VW` — zero only at aspect 2.0967, ~23 px at 16:9, ~40 px at 16:10, ~59 px at
4:3, and negative (sea short of the horizon) beyond 2.1:1.

The durable fix is to express that offset in viewport WIDTH: at the delivered mesh, `-0.118136 x VW`
is **exactly equivalent at 16:9** (both are -151.2 px at 1280x720) and holds the sea on the horizon at
every aspect. It needs an `offsetYVw` option on `FitConfig`, and it moves the whole Spine layer — not
just the sea — at non-16:9 aspects, so check it against the frame art before adopting.

Horizon row measured at y=467.5 of `BG_landscape.webp` (2879x1620) as the sharpest luminance edge in
the upper half: 135 -> 55 between rows 467 and 468. Note that edge is itself a hard seam where a
rectangular strip of sea texture is composited over the sky painting, not a soft painted horizon.

## Installed background skeletons are patched (re-apply after ANY re-export)

Both delivered background skeletons carry hand edits. A re-export silently drops them, so re-apply
this list — and re-read the ⚠️ above: for the sea meshes, a load-time edit to the file is the ONLY
approach known to work.

| file | what | value |
|---|---|---|
| `background_landscape/skeleton.json` | `ocean` mesh translated down | `y -= 16` (see the section above) |
| `background_landscape/skeleton.json` | `moon` attachment moved + resized | x -1086.5876, y 1438.5964, scale 2.23403319 |
| `background_landscape/skeleton.json` | `ship` bone moved + resized | x -870.6417, y 1101.2533, scale 0.96976015 |
| `background_portrait/portrait.json` | `Ocean` mesh translated down | `y -= 40` (see below) |
| `background_portrait/portrait.json` | `ship` bone moved + resized | x -315.94, y 1261.6728, scale 1.55030337 |

The `moon` and `ship` edits exist so the BASE game draws them at the same size and place the FREE game
does — the free game hides these slots and draws its own copies (`bonusOverlayAssets.ts`), and the two
sets did not agree. They are solved against that file's `scaleMul` / `offsetXVw` / `offsetYScene`
knobs, so re-derive them if those knobs change. ⚠️ `scaleMul` is applied by `applyOverlayFit` as
`spine.scale`, i.e. about the skeleton ROOT — NOT as a bone scale about the bone's own origin. Getting
that wrong is invisible in landscape (`scaleMul: 1`) and wrong by 129 authored units in portrait (0.9).

### ⚠️ Installed `portrait.json` is patched: the `Ocean` mesh is moved down

Same failure as landscape: the animated sea rode over the painted horizon, here by enough that even
fully-opaque water sat ~2px above it. The installed file has the `Ocean` slot's `oceanAnim/` mesh
**translated down 40 authored units** (`y -= 40`, so 633.04..1374.04 -> 593.04..1334.04). A
translation only — `uvs` / `triangles` / `hull` / the 90-frame `sequence` are untouched, and x is
untouched. The animation has no `deform` timeline and no `Ocean` slot timeline, so mesh vertices are
never animated and playback cannot fight this.

**40 was solved, not eyeballed**, because the mesh edge is not the water edge. The mesh top maps to
`v = 0` and the sea texture fades out over roughly the first 8 of its 95 atlas rows, so ~31 authored
units of the mesh top is fully transparent padding. Measured at 375x812: the horizon sits at screen
y 201.04, the mesh top was at 170.75 (30.29px high), and one screen px is 2.2 authored units. 40 puts
the faint edge 2.0px BELOW the horizon and full-strength water 16px below, which keeps the animation
reaching the horizon; 66.78 would have made the mesh top flush and left a 14-28px dead band where only
the painted backdrop shows. More negative = lower.

Horizon row measured at y=436 of `BG_portrait.webp` (922x1761) as the sharpest luminance edge in the
upper 60%: mean row luminance 124.7 -> 69.3, a drop ~7x larger than any other candidate.
`BG_portrait_FREEGAME.webp` puts its horizon on the SAME row 436, so this one value serves both modes.

Unlike landscape, this alignment is stable across aspect ratios. The portrait backdrop sets
`coverHeight`, so on anything taller than its own 922x1761 (0.5236) both the horizon and the scene
scale with viewport HEIGHT and the gap is a pure ratio. Verified live: faint edge 2.01px below the
horizon at 375x812, 2.21px at 414x896, and still 2.65px at 360x640 — which is past the crossover and
therefore width-driven, so both regimes hold.

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

## Total-bet backdrop bar (2026-08-06)

| master | installed as | encode |
|---|---|---|
| `betting_panel_total_bet_bottom_overlay.png` | `static/img/betting_panel_total_bet_bottom_overlay.webp` | lossless |

1979x189 RGBA. A flat **black** bar at a uniform alpha 110 (43%), feathered to zero on all four edges
— 27 px in from the left and 26 px from the right, 21 px from top and bottom (11.1% of the height).
Drawn on `.bp-total-overlay::before`, stacked on top of the panel backdrop above so the readout gets a
darker plinth than the rest of the row.

⚠️ **Installed CROPPED to a top-feathered slab: 1979x189 → 1926x166** — master `x 27..1952`,
`y 0..165`. Three of the four feathered edges are cut off; only the top one is kept.

`.bp-total-overlay::before` stretches this to the full viewport with `background-size: 100% 100%`,
which stretches any soft edge along with everything else. Every edge except the top abuts a hard
boundary — the viewport sides and the viewport floor — so a feather there doesn't blend into
anything, it just reads as the bar failing to reach the screen edge (the master fell about 1% of the
viewport short on each side, and short of the bottom). The top feather is the one edge that borders
something to blend INTO, the panel backdrop above, so it stays.

Crop bounds were read off the alpha channel, taking the flat core as `peak - 2` to absorb the ±1
dither in it. Re-derive them the same way if art redelivers this file; don't reuse these numbers.

Replaced a hand-tuned CSS `rgba(3, 4, 19, …)` tint plus a `mask-image` fade. Both are gone: the fade
did the same job as the art's own top feather, so keeping it would fade an already-faded edge twice.
Note the colour change is the point — the old tint was a navy a shade *under* the panel art's own
`rgb(7, 33, 48)`, so it blended in and its entire alpha range moved the band only ~18/255; black has
somewhere to go.

Lossless is both smaller AND exact here (13 KB cropped, against 34 KB for the uncropped master at
lossy q90) — unusually, lossy *loses* on size, because the image is one flat colour and a soft edge,
which is what lossless WebP compresses best and what DCT handles worst.

It goes into a box roughly 10x wider than it is tall, so `background-size: 100% 100%` squashes it ~4x
vertically. That is safe only because it is a flat bar with no shape in it; the top feather squashes
with it (still 13% of the height, ~6 px at 1920w) and stays soft.
