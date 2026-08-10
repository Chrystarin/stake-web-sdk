This folder is reserved for optional `@3d-dice/dice-box-threejs` static assets (textures/sounds).

In the current integration, the dice component disables sounds and does not use surface/dice textures,
so no assets are required at runtime.

If you later want textured dice or surface materials, copy the upstream `public/` folder contents
from the `@3d-dice/dice-box-threejs` repository into this directory and adjust the dice config to
load those assets.

