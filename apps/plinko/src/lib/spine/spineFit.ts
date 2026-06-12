import type { Texture } from 'pixi.js';

import type { FitAnchor, SpineBackdropDef, SpineAssetDef } from './types';
import type { WorldBounds } from './spineBounds';

export type FitTransform = {
	scale: number;
	x: number;
	y: number;
};

export type FitConfig = {
	widthFillScale?: number;
	offsetXVw?: number;
	offsetYVh?: number;
	fitAnchor?: FitAnchor;
};

export const computeFitTransform = (
	viewportWidth: number,
	viewportHeight: number,
	bounds: WorldBounds,
	config: FitConfig,
): FitTransform => {
	const { offset, size } = bounds;
	const centerX = offset.x + size.x / 2;
	const centerY = offset.y + size.y / 2;

	const scale =
		config.widthFillScale != null
			? (viewportWidth / size.x) * config.widthFillScale
			: Math.max(viewportWidth / size.x, viewportHeight / size.y);

	const offsetX = (config.offsetXVw ?? 0) * viewportWidth;
	const offsetY = (config.offsetYVh ?? 0) * viewportHeight;

	if (config.widthFillScale != null || config.fitAnchor === 'bottom') {
		return {
			scale,
			x: viewportWidth / 2 - centerX * scale + offsetX,
			y: viewportHeight - (offset.y + size.y) * scale + offsetY,
		};
	}

	return {
		scale,
		x: viewportWidth / 2 - centerX * scale + offsetX,
		y: viewportHeight / 2 - centerY * scale + offsetY,
	};
};

export const spineFitConfig = (asset: SpineAssetDef): FitConfig => ({
	widthFillScale: asset.widthFillScale,
	offsetXVw: asset.offsetXVw,
	offsetYVh: asset.offsetYVh,
	fitAnchor: asset.fitAnchor,
});

/** Viewport width-fill + bottom-center anchor using texture pixel dimensions. */
export const computeBackdropTransform = (
	viewportWidth: number,
	viewportHeight: number,
	texture: Texture,
	backdrop: SpineBackdropDef,
): FitTransform => {
	const textureWidth = texture.width;
	if (!textureWidth) return { scale: 1, x: 0, y: 0 };

	const scale = (viewportWidth / textureWidth) * backdrop.widthFillScale;
	const offsetX = backdrop.offsetXVw * viewportWidth;
	const offsetY = backdrop.offsetYVh * viewportHeight;

	return {
		scale,
		x: viewportWidth / 2 + offsetX,
		y: viewportHeight + offsetY,
	};
};

/**
 * Positions the Spine layer over the backdrop: shared bottom-center anchor and
 * scale linked to the JPG texture width vs skeleton authored bounds.
 */
export const computeSpineOverlayTransform = (
	viewportWidth: number,
	viewportHeight: number,
	bounds: WorldBounds,
	backdropTransform: FitTransform,
	texture: Texture,
	spine: FitConfig,
	backdrop: SpineBackdropDef,
): FitTransform => {
	const textureWidth = bounds.size.x > 0 ? texture.width : 0;
	if (!textureWidth) {
		return computeFitTransform(viewportWidth, viewportHeight, bounds, spine);
	}

	const spineFill = spine.widthFillScale ?? 1;
	const imageFill = backdrop.widthFillScale;
	const scale =
		backdropTransform.scale * (textureWidth / bounds.size.x) * (spineFill / imageFill);

	const offsetX = (spine.offsetXVw ?? 0) * viewportWidth;
	const offsetY = (spine.offsetYVh ?? 0) * viewportHeight;
	const centerX = bounds.offset.x + bounds.size.x / 2;

	return {
		scale,
		x: backdropTransform.x + offsetX - centerX * scale,
		y: backdropTransform.y + offsetY + bounds.offset.y * scale,
	};
};
