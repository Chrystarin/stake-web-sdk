/**
 * Anchors on the pirate-frame art (`img/game_area_background.webp`) — the PNG behind the board that
 * carries the skull, the archway and the gold pile.
 *
 * Anything that has to line up with a feature painted into that art measures through here, so the
 * anchors stay glued to the picture at any size and in either fit mode, and the two callers can't
 * drift apart.
 */

export type FramePoint = { x: number; y: number };

/**
 * Intrinsic size of the art — only a fallback for before the image reports its own.
 *
 * The V3 art re-renders the same composition at 2× (was 1142×1010), so every anchor below is simply
 * its old numerator doubled. Verified by re-measuring both files with one method: the cavity lands at
 * x 0.51007 / halfW 0.10114 of the width in BOTH, and y 0.37277 → 0.37265 of the height (a quarter of
 * a pixel). Height is 2018, not 2×1010 — a 0.1% aspect change the layout absorbs (see the
 * `.game-area-foot` clone in Game.svelte).
 */
const FRAME_NATURAL_W = 2284;
const FRAME_NATURAL_H = 2018;

/**
 * The black void behind the skull's teeth, where balls are thrown up out of. Measured off the art
 * as the contiguous run of near-black pixels between the teeth and the gold pile: it spans
 * x 942..1394, y 738..766 of the source image, so its centre is (1166, 754).
 */
export const SKULL_MOUTH_CAVITY: FramePoint = {
	x: 1166 / FRAME_NATURAL_W,
	y: 754 / FRAME_NATURAL_H,
};

/**
 * Half the cavity's width (of the x 942..1394 run above), as a fraction of the art. Balls are thrown
 * from a point offset to one side of `SKULL_MOUTH_CAVITY` rather than from its centre; this bounds
 * that offset so the spawn stays on black instead of creeping onto a tooth.
 */
export const SKULL_MOUTH_CAVITY_HALF_W = 226 / FRAME_NATURAL_W;

/** The gold pile heaped in the mouth, just below the cavity — origin of the win coin fountain. */
export const SKULL_GOLD_PILE: FramePoint = { x: 0.508, y: 0.39 };

/**
 * Map a point given as a fraction of the frame art (0..1) to client (screen) px, accounting for the
 * frame's `object-fit` letterboxing (contain on desktop, cover on mobile) with `object-position: top
 * center`. Read live from `getBoundingClientRect` + `naturalWidth`, so the result tracks the current
 * layout and re-resolves correctly on every resize / orientation change.
 */
export function frameImagePoint(ratioX: number, ratioY: number): FramePoint | undefined {
	if (typeof document === 'undefined') return undefined;
	const img = document.querySelector<HTMLImageElement>('.game-area-frame');
	if (!img) return undefined;
	const rect = img.getBoundingClientRect();
	if (rect.width <= 0 || rect.height <= 0) return undefined;
	const natW = img.naturalWidth || FRAME_NATURAL_W;
	const natH = img.naturalHeight || FRAME_NATURAL_H;
	const cover = getComputedStyle(img).objectFit === 'cover';
	const scale = cover
		? Math.max(rect.width / natW, rect.height / natH)
		: Math.min(rect.width / natW, rect.height / natH);
	const paintedW = natW * scale;
	const paintedH = natH * scale;
	// object-position: top center → horizontally centred, top-aligned.
	const paintedLeft = rect.left + (rect.width - paintedW) / 2;
	const paintedTop = rect.top;
	return { x: paintedLeft + ratioX * paintedW, y: paintedTop + ratioY * paintedH };
}

/**
 * Painted width (client px) of the frame art in its current layout, or `undefined` if it isn't laid out
 * yet. Same letterboxing maths as `frameImagePoint`; used to size art relative to the board so it stays
 * proportional at any viewport size / orientation.
 */
export function framePaintedWidth(): number | undefined {
	if (typeof document === 'undefined') return undefined;
	const img = document.querySelector<HTMLImageElement>('.game-area-frame');
	if (!img) return undefined;
	const rect = img.getBoundingClientRect();
	if (rect.width <= 0 || rect.height <= 0) return undefined;
	const natW = img.naturalWidth || FRAME_NATURAL_W;
	const natH = img.naturalHeight || FRAME_NATURAL_H;
	const cover = getComputedStyle(img).objectFit === 'cover';
	const scale = cover
		? Math.max(rect.width / natW, rect.height / natH)
		: Math.min(rect.width / natW, rect.height / natH);
	return natW * scale;
}
