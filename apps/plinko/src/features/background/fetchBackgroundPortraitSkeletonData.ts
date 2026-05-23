import * as PIXI from 'pixi.js';
import * as SPINE_PIXI from '@esotericsoftware/spine-pixi-v8';
import '@esotericsoftware/spine-pixi-v8';

import { BACKGROUND_PORTRAIT_SPINE_BASE } from '../../game/assets';
import { staticUrl } from '../../lib/staticUrl';

const resolveSrc = () => ({
	atlas: staticUrl(`${BACKGROUND_PORTRAIT_SPINE_BASE}/portrait.atlas`),
	skeleton: staticUrl(`${BACKGROUND_PORTRAIT_SPINE_BASE}/portrait.json`),
	images: {
		'portrait.png': staticUrl(`${BACKGROUND_PORTRAIT_SPINE_BASE}/portrait.png`),
		'portrait2.png': staticUrl(`${BACKGROUND_PORTRAIT_SPINE_BASE}/portrait2.png`),
	},
});

const loadTextureAtlas = async (
	atlasUrl: string,
	images: Record<string, string>,
): Promise<SPINE_PIXI.TextureAtlas> => {
	const atlasResponse = await fetch(atlasUrl);
	if (!atlasResponse.ok) {
		throw new Error(`Failed to fetch spine atlas (${atlasResponse.status}): ${atlasUrl}`);
	}

	const atlas = new SPINE_PIXI.TextureAtlas(await atlasResponse.text());

	await Promise.all(
		atlas.pages.map(async (page) => {
			const imageUrl = images[page.name];
			if (!imageUrl) {
				throw new Error(`Missing atlas page texture for "${page.name}"`);
			}
			const texture = await PIXI.Assets.load(imageUrl);
			page.setTexture(SPINE_PIXI.SpineTexture.from(texture.source));
		}),
	);

	return atlas;
};

/** Loads portrait spine skeleton data from static assets. */
export async function fetchBackgroundPortraitSkeletonData(): Promise<SPINE_PIXI.SkeletonData> {
	const src = resolveSrc();
	const atlas = await loadTextureAtlas(src.atlas, src.images);

	const skeletonResponse = await fetch(src.skeleton);
	if (!skeletonResponse.ok) {
		throw new Error(
			`Failed to fetch spine skeleton (${skeletonResponse.status}): ${src.skeleton}`,
		);
	}

	const attachmentLoader = new SPINE_PIXI.AtlasAttachmentLoader(atlas);
	const parser = new SPINE_PIXI.SkeletonJson(attachmentLoader);
	return parser.readSkeletonData(await skeletonResponse.json());
}
