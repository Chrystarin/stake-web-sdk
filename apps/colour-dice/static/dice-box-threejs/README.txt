Upstream `@3d-dice/dice-box-threejs` static assets, served from `assetPath: '/dice-box-threejs/'`.

`sounds/` is in use: the dice component runs with `sounds: true`, so the library loads its hit
clips from here at init and plays them off the physics. With the current dice config
(`theme_surface: 'green-felt'`, `theme_material: 'plastic'`) it asks for `sounds/surfaces/
surface_felt1..7.mp3`, `sounds/dicehit/dicehit_plastic1..15.mp3` and `sounds/dicehit/
dicehit_coin1..6.mp3` — the coin set is loaded whatever the dice are made of. The rest of the
folder is upstream's other surfaces and materials, kept so those settings can be changed without
going back to the package.

`textures/` is present but unused: the dice are given plain white faces with a colour circle
drawn on them (see `applyD6FaceColorPatches`), not a texture.

Both folders are copies of the upstream `public/` directory. Refresh them from the package if it
is ever upgraded.
