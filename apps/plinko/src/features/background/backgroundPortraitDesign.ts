/** Target mobile background frame (object-fit: cover source). */
export const BACKGROUND_PORTRAIT_DESIGN_WIDTH = 992;
export const BACKGROUND_PORTRAIT_DESIGN_HEIGHT = 1761;

/** From `portrait.json` skeleton bounds — design frame is centered horizontally. */
const PORTRAIT_SKELETON_X = -1194.71;
const PORTRAIT_SKELETON_WIDTH = 3045.9;
const PORTRAIT_SKELETON_Y = -3.78;

export const BACKGROUND_PORTRAIT_DESIGN_BOUNDS = {
	x: PORTRAIT_SKELETON_X + (PORTRAIT_SKELETON_WIDTH - BACKGROUND_PORTRAIT_DESIGN_WIDTH) / 2,
	y: PORTRAIT_SKELETON_Y,
	width: BACKGROUND_PORTRAIT_DESIGN_WIDTH,
	height: BACKGROUND_PORTRAIT_DESIGN_HEIGHT,
} as const;
