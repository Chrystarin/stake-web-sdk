# Sound licences

Where every file in `static/sound/` comes from, and on what terms. Kept in `docs/` rather than next
to the files so it does not ship in the build. Update it in the same change as any file it lists.

**"Not on record"** means nobody has written down where the file came from. Each of those needs its
source and licence found (or the file replaced) before submission. Stake's review checks that the
game has rights to every asset.

## Cleared

| File | Source | Licence | Used for |
|---|---|---|---|
| `chip_return.mp3` | Kenney, *Casino Audio* 1.1, `chips-handle-4.ogg` ([kenney.nl](https://kenney.nl/assets/casino-audio)) | CC0 1.0 | A chip going home to the tray; Clear |
| `slam_plate.mp3` | Kenney, *Impact Sounds* 1.0, `impactPlate_heavy_000.ogg` ([kenney.nl](https://kenney.nl/assets/impact-sounds)) | CC0 1.0 | Top Slot cabinet and wheel slammed home |
| `reel_bell.mp3` | Kenney, *Impact Sounds* 1.0, `impactBell_heavy_002.ogg` ([kenney.nl](https://kenney.nl/assets/impact-sounds)) | CC0 1.0 | Each Top Slot reel stopping |
| `chip_felt.mp3` | `@3d-dice/dice-box-threejs` 0.0.12, `sounds/surfaces/surface_felt2.mp3` | MIT, © 2022 3D Dice | A chip landing on a bet tile |
| `chest_wood.mp3` | `@3d-dice/dice-box-threejs` 0.0.12, `sounds/surfaces/surface_wood_tray1.mp3` | MIT, © 2022 3D Dice | A chest picked |
| `boom.mp3` | Synthesised for this game (low-passed noise over a pitched-down thump) | Own work | Bombs, reveals, the Top Slot arriving |

The Kenney files were transcoded from the packs' OGG (which iOS cannot decode) to MP3 128 kb/s with
tags stripped. CC0 needs no credit. The MIT licence asks that its notice travel with copies of the
software. It is a sound file here, but crediting "3D Dice (MIT)" in the game's credits is the
safe reading.

## Shared with One-Eyed Willy's Plinko (`apps/plinko/static/sound`)

Copied byte-for-byte (or, for the doors, Plinko's MP3 transcodes of the same recordings). Their
original source and licence are **not on record** here: check Plinko's records.

`bonus_congratulations.mp3`, `bonus_level_up.mp3`, `clickingFail.mp3`, `coin_flip.mp3`,
`coin_shuffle.mp3`, `door_close.mp3`, `door_open.mp3`, `openPopup.mp3`, `pocket.mp3`,
`roulette_tick.mp3`, `startAutoPlay.mp3`, and also `clickUIButton.mp3` and `win.mp3`.

## Shared with Colour Dice (`apps/colour-dice/static/sound`)

Byte-identical copies, original source **not on record**: `chip_merge.mp3`, `pop.mp3`,
`whoosh.mp3`, `peg.wav`, `clickUIButton.mp3`, `win.mp3`, and the unused
`background_music_placeholder.mp3`.

## Made or bought for this game, source not on record

`cannon_sfx.mp3`, `dragon_sfx.mp3`, `treasure_sfx.mp3`, `kraken_sfx.mp3`, `ship_wheel_sfx.mp3`,
`notify.mp3`.

## Music, source not on record

`bgm_base.mp3`, `bgm_bonus_wheel.mp3`, `bgm_pirate_plinko.mp3`, `bgm_treasure_chest.mp3`,
`bgm_ocean_voyage.mp3`.

`background_music_placeholder.mp3` is referenced by no code and is flagged in the compliance report
as having no licence on record. It should be deleted before submission.
