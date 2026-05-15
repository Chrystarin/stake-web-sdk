import { createLayout } from 'utils-layout';

export const { stateLayout, stateLayoutDerived } = createLayout({
	backgroundRatio: {
		normal: 16 / 9,
		portrait: 9 / 16,
	},
	mainSizesMap: {
		desktop: { width: 1920, height: 1080 },
		tablet: { width: 1024, height: 768 },
		landscape: { width: 1600, height: 900 },
		portrait: { width: 390, height: 844 },
	},
});
