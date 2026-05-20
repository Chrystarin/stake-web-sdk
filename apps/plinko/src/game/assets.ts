import '@esotericsoftware/spine-pixi-v8';

/** Static base plate behind the landscape spine (stormy sea + lower fill). */
export const BACKGROUND_LANDSCAPE_IMAGE =
	'img/assets/spines/background_landscape_v2/BG_landscape.jpg';

/** Served from `/static/img/assets/spines/background_landscape_v2/landscape/`. */
export const BACKGROUND_LANDSCAPE_SPINE_BASE =
	'img/assets/spines/background_landscape_v2/landscape';

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
