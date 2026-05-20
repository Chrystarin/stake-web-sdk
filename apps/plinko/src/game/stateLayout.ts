import { createLayout } from 'utils-layout';

/** Matches `background_landscape_v2` skeleton bounds in landscape.json. */
const BACKGROUND_LANDSCAPE_RATIO = 3731.67 / 2007.81;

export const { stateLayout, stateLayoutDerived } = createLayout({
	backgroundRatio: {
		normal: BACKGROUND_LANDSCAPE_RATIO,
		portrait: 9 / 16,
	},
	mainSizesMap: {
		desktop: { width: 1920, height: 1080 },
		tablet: { width: 1024, height: 768 },
		landscape: { width: 1600, height: 900 },
		portrait: { width: 390, height: 844 },
	},
});
