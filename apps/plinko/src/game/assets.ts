export default {
	backgroundLandscape: {
		type: 'spine',
		src: {
			atlas: new URL('../assets/spines/background_landscape/landscape.atlas', import.meta.url).href,
			skeleton: new URL('../assets/spines/background_landscape/landscape.json', import.meta.url)
				.href,
		},
		preload: true,
	},
	backgroundPortrait: {
		type: 'spine',
		src: {
			atlas: new URL('../assets/spines/background_portrait/portrait.atlas', import.meta.url).href,
			skeleton: new URL('../assets/spines/background_portrait/portrait.json', import.meta.url).href,
		},
		preload: true,
	},
} as const;
