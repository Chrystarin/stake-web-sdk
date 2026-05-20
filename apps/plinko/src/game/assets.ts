import '@esotericsoftware/spine-pixi-v8';

export default {
	backgroundLandscape: {
		type: 'spine',
		src: {
			atlas: new URL(
				'../assets/spines/background_landscape/landscape.atlas',
				import.meta.url,
			).href,
			skeleton: new URL(
				'../assets/spines/background_landscape/landscape.json',
				import.meta.url,
			).href,
			scale: 1,
		},
		preload: true,
	},
};
