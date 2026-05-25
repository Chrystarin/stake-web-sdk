import { createLayout } from 'utils-layout';

/** Matches `background_landscape` skeleton bounds in landscape.json. */
const BACKGROUND_LANDSCAPE_RATIO = 3731.67 / 2007.81;

/** Mobile portrait background design frame (992×1761). */
const BACKGROUND_PORTRAIT_RATIO = 992 / 1761;

export const { stateLayout, stateLayoutDerived } = createLayout({
	backgroundRatio: {
		normal: BACKGROUND_LANDSCAPE_RATIO,
		portrait: BACKGROUND_PORTRAIT_RATIO,
	},
	mainSizesMap: {
		desktop: { width: 1920, height: 1080 },
		tablet: { width: 1024, height: 768 },
		landscape: { width: 1600, height: 900 },
		portrait: { width: 390, height: 844 },
	},
});
