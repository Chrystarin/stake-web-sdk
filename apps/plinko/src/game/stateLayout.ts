import { createLayout } from 'utils-layout';

/** Landscape design frame aspect (1920×1080). */
const LANDSCAPE_FRAME_RATIO = 1920 / 1080;

/** Portrait design frame aspect (992×1761). */
const PORTRAIT_FRAME_RATIO = 992 / 1761;

export const { stateLayout, stateLayoutDerived } = createLayout({
	backgroundRatio: {
		normal: LANDSCAPE_FRAME_RATIO,
		portrait: PORTRAIT_FRAME_RATIO,
	},
	mainSizesMap: {
		desktop: { width: 1920, height: 1080 },
		tablet: { width: 1024, height: 768 },
		landscape: { width: 1600, height: 900 },
		portrait: { width: 390, height: 844 },
	},
});
