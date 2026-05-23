/**
 * Portrait mobile layout — design canvas 992×1761 (reference: Portrait_animationGuide).
 * CSS scales horizontal spacing via `calc(100vw * N / DESIGN_WIDTH)`.
 */
export const PORTRAIT_LAYOUT_DESIGN_WIDTH = 992;
export const PORTRAIT_LAYOUT_DESIGN_HEIGHT = 1761;

/** Design px → width-proportional length (use in CSS custom properties). */
export const portraitLayoutPx = (px: number): string =>
	`calc(100vw * ${px} / ${PORTRAIT_LAYOUT_DESIGN_WIDTH})`;
