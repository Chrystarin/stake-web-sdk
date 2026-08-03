/**
 * TypeScript mirror of the `--ui-px` custom property declared in `routes/+layout.svelte`.
 *
 * A handful of sizes can't be expressed in CSS because they're solved in JS against measured
 * geometry (the win counter's digit height, the coin-fountain coin size). Those carry px floors /
 * ceilings that behave exactly like a `clamp()`'s px bounds — they stop tracking the viewport once
 * they bind, which is what leaves them oversized on Stake's 400×225 "Popout S". Multiply such a
 * bound by `uiScale()` and it shrinks with the viewport the same way `--ui-px` does in CSS.
 *
 * ⚠️ Keep the reference size and the portrait carve-out identical to the CSS token — a divergence
 * shows up as JS-driven art sitting at a different scale from the CSS chrome around it.
 */

/** Reference landscape layout the desktop UI is tuned against (Stake's 1024×576 frame). */
export const UI_REF_WIDTH = 1024;
export const UI_REF_HEIGHT = 576;

/**
 * Uniform shrink factor for absolutely-sized UI: 1 at (and above) the 1024×576 reference, 0.390625
 * at 400×225, and always 1 in the portrait layout — which has its own 992×1761 reference and must
 * not be dragged along. The `w < h` test is the landscape branch of `isPortraitGameLayout()`
 * (lib/format.ts), and matches the CSS token's `min-aspect-ratio: 1/1` query.
 */
export const uiScale = (): number => {
	if (typeof window === 'undefined') return 1;
	const w = window.innerWidth;
	const h = window.innerHeight;
	if (w < h) return 1;
	return Math.min(1, w / UI_REF_WIDTH, h / UI_REF_HEIGHT);
};
