import { createLayout } from 'utils-layout';

/** Landscape layout reference (desktop 1920×1080). */
const LAYOUT_LANDSCAPE_RATIO = 1920 / 1080;

/** Mobile portrait layout reference (992×1761). */
const LAYOUT_PORTRAIT_RATIO = 992 / 1761;

export const { stateLayout, stateLayoutDerived } = createLayout({
	backgroundRatio: {
		normal: LAYOUT_LANDSCAPE_RATIO,
		portrait: LAYOUT_PORTRAIT_RATIO,
	},
	mainSizesMap: {
		desktop: { width: 1920, height: 1080 },
		tablet: { width: 1024, height: 768 },
		landscape: { width: 1600, height: 900 },
		portrait: { width: 390, height: 844 },
	},
});
