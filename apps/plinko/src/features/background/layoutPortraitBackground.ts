import type * as PIXI from 'pixi.js';
import type * as SPINE_PIXI from '@esotericsoftware/spine-pixi-v8';

import {
	BACKGROUND_PORTRAIT_DESIGN_BOUNDS,
	BACKGROUND_PORTRAIT_DESIGN_HEIGHT,
	BACKGROUND_PORTRAIT_DESIGN_WIDTH,
} from './backgroundPortraitDesign';

/** object-fit: cover, top-center (992×1761 design frame). */
export const layoutPortraitPlateSprite = (
	sprite: PIXI.Sprite,
	_texture: PIXI.Texture,
	viewportWidth: number,
	viewportHeight: number,
	padding = 1.05,
) => {
	const scale =
		Math.max(
			viewportWidth / BACKGROUND_PORTRAIT_DESIGN_WIDTH,
			viewportHeight / BACKGROUND_PORTRAIT_DESIGN_HEIGHT,
		) * padding;
	sprite.scale.set(scale);
	sprite.anchor.set(0.5, 0);
	sprite.position.set(viewportWidth / 2, 0);
};

/** Cover-fit portrait spine; top-center on the 992×1761 frame. */
export const layoutPortraitSpine = (
	spine: SPINE_PIXI.Spine,
	viewportWidth: number,
	viewportHeight: number,
	padding = 1.05,
) => {
	const bounds = BACKGROUND_PORTRAIT_DESIGN_BOUNDS;
	const scale =
		Math.max(viewportWidth / bounds.width, viewportHeight / bounds.height) * padding;

	spine.scale.set(1);
	spine.position.set(0, 0);
	spine.skeleton.setToSetupPose();
	spine.update(0);

	spine.scale.set(scale);
	spine.skeleton.setToSetupPose();
	spine.update(0);

	spine.position.set(
		viewportWidth / 2 - (bounds.x + bounds.width / 2) * scale,
		-bounds.y * scale,
	);
};
