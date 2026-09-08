import {
	AtlasAttachmentLoader,
	SkeletonBinary,
	SkeletonData,
	SkeletonJson,
	TextureAtlas,
} from '@esotericsoftware/spine-pixi-v8';

import type { SpineAssetDef } from './types';

export const readSkeletonData = (
	asset: Pick<SpineAssetDef, 'format' | 'skeletonScale'>,
	atlas: unknown,
	skeletonSource: unknown,
): SkeletonData => {
	const attachmentLoader = new AtlasAttachmentLoader(atlas as TextureAtlas);

	if (asset.format === 'skel') {
		return new SkeletonBinary(attachmentLoader).readSkeletonData(skeletonSource as ArrayBuffer);
	}

	const parser = new SkeletonJson(attachmentLoader);
	parser.scale = asset.skeletonScale ?? 1;
	return parser.readSkeletonData(skeletonSource);
};
