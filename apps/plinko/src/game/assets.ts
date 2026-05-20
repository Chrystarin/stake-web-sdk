import '@esotericsoftware/spine-pixi-v8';

const backgroundLandscapeDir = new URL(
	'../assets/spines/background_landscape/',
	import.meta.url,
).href;

export default {
	backgroundLandscape: {
		type: 'spine',
		src: {
			atlas: new URL('landscape.atlas', backgroundLandscapeDir).href,
			skeleton: new URL('landscape.json', backgroundLandscapeDir).href,
			scale: 1,
			/** Required for multi-page atlases (landscape.png + landscape2.png), especially on Windows. */
			images: {
				'landscape.png': new URL('landscape.png', backgroundLandscapeDir).href,
				'landscape2.png': new URL('landscape2.png', backgroundLandscapeDir).href,
			},
		},
		preload: true,
	},
};
