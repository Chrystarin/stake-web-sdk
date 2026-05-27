import { staticUrl } from '../lib/staticUrl';

export default {
	backgroundLandscape: {
		type: 'spine',
		src: {
			atlas: staticUrl('spines/background_landscape/landscape.atlas'),
			skeleton: staticUrl('spines/background_landscape/landscape.json'),
			images: {
				'landscape.png': staticUrl('spines/background_landscape/landscape.png'),
				'landscape2.png': staticUrl('spines/background_landscape/landscape2.png'),
			},
		},
		preload: true,
	},
	backgroundPortrait: {
		type: 'spine',
		src: {
			atlas: staticUrl('spines/background_portrait/portrait.atlas'),
			skeleton: staticUrl('spines/background_portrait/portrait.json'),
			images: {
				'portrait.png': staticUrl('spines/background_portrait/portrait.png'),
				'portrait2.png': staticUrl('spines/background_portrait/portrait2.png'),
			},
		},
		preload: true,
	},
} as const;
