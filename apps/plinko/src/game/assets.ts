import { staticUrl } from '../lib/staticUrl';

export default {
	backgroundLandscape: {
		type: 'spine',
		src: {
			atlas: staticUrl('spines/landscape/landscape.atlas'),
			skeleton: staticUrl('spines/landscape/landscape.json'),
			images: {
				'landscape.png': staticUrl('spines/landscape/landscape.png'),
				'landscape2.png': staticUrl('spines/landscape/landscape2.png'),
			},
		},
		preload: true,
	},
	backgroundLamp: {
		type: 'spine',
		src: {
			atlas: staticUrl('spines/lamp/lamp.atlas'),
			skeleton: staticUrl('spines/lamp/lamp.json'),
			images: {
				'lamp.png': staticUrl('spines/lamp/lamp.png'),
			},
		},
		preload: true,
	},
	backgroundWaterfall: {
		type: 'spine',
		src: {
			atlas: staticUrl('spines/waterfall/waterfall.atlas'),
			skeleton: staticUrl('spines/waterfall/waterfall.json'),
			images: {
				'waterfall.png': staticUrl('spines/waterfall/waterfall.png'),
				'waterfall2.png': staticUrl('spines/waterfall/waterfall2.png'),
				'waterfall3.png': staticUrl('spines/waterfall/waterfall3.png'),
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
