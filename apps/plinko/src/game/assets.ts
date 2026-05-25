import '@esotericsoftware/spine-pixi-v8';

/** Static base plate behind the landscape spine (stormy sea + lower fill). */
export const BACKGROUND_LANDSCAPE_IMAGE =
	'img/assets/spines/background_landscape/BG_landscape.jpg';

/** Served from `/static/img/assets/spines/background_landscape/landscape/`. */
export const BACKGROUND_LANDSCAPE_SPINE_BASE =
	'img/assets/spines/background_landscape/landscape';

/** Static plate behind portrait spine (922×1761). */
export const BACKGROUND_PORTRAIT_IMAGE = 'img/background-mobile.png';

/** Served from `/static/img/assets/spines/background_portrait/`. */
export const BACKGROUND_PORTRAIT_SPINE_BASE = 'img/assets/spines/background_portrait';

export default {
	backgroundLandscape: {
		type: 'spine',
		src: {
			atlas: `${BACKGROUND_LANDSCAPE_SPINE_BASE}/landscape.atlas`,
			skeleton: `${BACKGROUND_LANDSCAPE_SPINE_BASE}/landscape.json`,
			scale: 1,
			images: {
				'landscape.png': `${BACKGROUND_LANDSCAPE_SPINE_BASE}/landscape.png`,
				'landscape2.png': `${BACKGROUND_LANDSCAPE_SPINE_BASE}/landscape2.png`,
			},
		},
		preload: true,
	},
};
