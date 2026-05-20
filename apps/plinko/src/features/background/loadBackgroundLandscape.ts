import type { App } from 'pixi-svelte';

import { fetchBackgroundLandscapeSkeletonData } from './fetchBackgroundLandscapeSkeletonData';

/** @deprecated Use fetchBackgroundLandscapeSkeletonData via AnimatedLandscapeBackground. */
export async function loadBackgroundLandscape(stateApp: App['stateApp']) {
	if (stateApp.loadedAssets.backgroundLandscape) return;

	const asset = stateApp.assets.backgroundLandscape;
	if (!asset || asset.type !== 'spine') {
		throw new Error('backgroundLandscape spine asset is not configured');
	}

	const skeletonData = await fetchBackgroundLandscapeSkeletonData();

	stateApp.loadedAssets = {
		...stateApp.loadedAssets,
		backgroundLandscape: skeletonData,
	};
	stateApp.loaded = true;
}
