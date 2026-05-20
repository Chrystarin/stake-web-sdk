import * as PIXI from 'pixi.js';
import * as SPINE_PIXI from '@esotericsoftware/spine-pixi-v8';
import '@esotericsoftware/spine-pixi-v8';

import type { App, RawSpine, SpineSrc } from 'pixi-svelte';

const parseSpineAsset = ({
	key,
	rawAsset,
	src,
}: {
	key: string;
	rawAsset: RawSpine;
	src: SpineSrc;
}) => {
	const atlasAsset = rawAsset[src.atlas] as SPINE_PIXI.TextureAtlas;
	const skeletonAsset = rawAsset[src.skeleton] as Uint8Array;
	const attachmentLoader = new SPINE_PIXI.AtlasAttachmentLoader(atlasAsset);
	const parser =
		skeletonAsset instanceof Uint8Array
			? new SPINE_PIXI.SkeletonBinary(attachmentLoader)
			: new SPINE_PIXI.SkeletonJson(attachmentLoader);
	parser.scale = src.scale ?? 1;
	return { [key]: parser.readSkeletonData(skeletonAsset) };
};

export async function loadBackgroundLandscape(stateApp: App['stateApp']) {
	if (stateApp.loadedAssets.backgroundLandscape) return;

	const key = 'backgroundLandscape';
	const asset = stateApp.assets[key];
	if (!asset || asset.type !== 'spine' || typeof asset.src !== 'object') {
		throw new Error('backgroundLandscape spine asset is not configured');
	}

	const spineSrc = asset.src as SpineSrc;
	const atlasAsset = spineSrc.images
		? { src: spineSrc.atlas, data: { images: spineSrc.images } }
		: spineSrc.atlas;

	const [atlas, skeleton] = await Promise.all([
		PIXI.Assets.load(atlasAsset),
		PIXI.Assets.load(spineSrc.skeleton),
	]);

	const rawAsset = {
		[spineSrc.atlas]: atlas,
		[spineSrc.skeleton]: skeleton,
	} as RawSpine;

	stateApp.loadedAssets = {
		...stateApp.loadedAssets,
		...parseSpineAsset({ key, rawAsset, src: spineSrc }),
	};
	stateApp.loaded = true;
}
