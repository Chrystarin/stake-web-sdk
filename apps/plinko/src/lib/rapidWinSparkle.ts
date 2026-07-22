/**
 * Shared sizing config for the 1-ball rapid win sparkles (small shine-ray bursts with the win value +
 * tier label printed over them). Every sparkle spawns at the skull's mouth (see SKULL_MOUTH_CAVITY in
 * `frameArt.ts`) and floats upward — no random scatter.
 */

/** Base sparkle size as a fraction of the painted frame width, before the per-multiplier scale below. */
export const RAPID_SPARKLE_BASE_SIZE_RATIO = 0.155;

/** Bigger win → bigger burst. Tiers match the on-land coin burst (1 / 2 / 3 coins). */
export function rapidSparkleSizeScale(multiplier: number): number {
	const m = Number(multiplier) || 0;
	if (m >= 10) return 1.6;
	if (m >= 2) return 1.28;
	return 1;
}
