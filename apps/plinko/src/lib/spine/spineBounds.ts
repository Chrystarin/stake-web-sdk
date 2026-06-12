import { Skeleton, Vector2 } from '@esotericsoftware/spine-pixi-v8';

import type { SpineAssetDef } from './types';

const BOUNDS_TEMP: number[] = [];

export type WorldBounds = {
	offset: Vector2;
	size: Vector2;
};

export const createWorldBounds = (): WorldBounds => ({
	offset: new Vector2(),
	size: new Vector2(),
});

export const updateWorldBounds = (
	skeleton: Skeleton,
	asset: SpineAssetDef,
	bounds: WorldBounds,
): void => {
	const { offset, size } = bounds;

	if (asset.boundsMode === 'content') {
		skeleton.getBounds(offset, size, BOUNDS_TEMP);
		const hasContentBounds =
			Number.isFinite(size.x) &&
			Number.isFinite(size.y) &&
			size.x > 0 &&
			size.y > 0;

		if (hasContentBounds) {
			const paddingRatio = asset.boundsPadding ?? 0;
			if (paddingRatio > 0) {
				const padding = Math.max(size.x, size.y) * paddingRatio;
				offset.x -= padding;
				offset.y -= padding;
				size.x += padding * 2;
				size.y += padding * 2;
			}
			return;
		}
	}

	const skeletonScale = asset.skeletonScale ?? 1;
	const { x, y, width, height } = skeleton.data;
	offset.set(x * skeletonScale, y * skeletonScale);
	size.set(width * skeletonScale, height * skeletonScale);
};
