import type * as SPINE_PIXI from '@esotericsoftware/spine-pixi-v8';

export type SpineDesignBounds = {
	x: number;
	y: number;
	width: number;
	height: number;
};

/** Scale and position a spine so its bounds cover the viewport (object-fit: cover). */
export function fitSpineCover(
	spine: SPINE_PIXI.Spine,
	viewportWidth: number,
	viewportHeight: number,
	padding = 1.05,
	designBounds?: SpineDesignBounds,
) {
	spine.scale.set(1);
	spine.position.set(0, 0);
	spine.skeleton.setToSetupPose();
	spine.update(0);

	let bw: number;
	let bh: number;
	let bx: number;
	let by: number;

	if (designBounds) {
		bw = designBounds.width;
		bh = designBounds.height;
		bx = designBounds.x;
		by = designBounds.y;
	} else {
		const bounds = spine.getBounds();
		bw = bounds.width > 0 ? bounds.width : spine.skeleton.data.width;
		bh = bounds.height > 0 ? bounds.height : spine.skeleton.data.height;
		bx = bounds.width > 0 ? bounds.x : spine.skeleton.data.x;
		by = bounds.height > 0 ? bounds.y : spine.skeleton.data.y;
	}

	const scale = Math.max(viewportWidth / bw, viewportHeight / bh) * padding;
	spine.scale.set(scale);
	spine.position.set(
		viewportWidth / 2 - (bx + bw / 2) * scale,
		viewportHeight / 2 - (by + bh / 2) * scale,
	);
}
