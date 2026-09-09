/**
 * Pocket art, lifted whole from One-Eyed Willy's plinko board.
 *
 * The source is that game's `glow_numbers` Spine skeleton (apps/plinko/static/spine/glow_numbers),
 * copied here as `static/img/plinko/pocket_slots.webp` — the same atlas image, byte for byte. Its
 * `.atlas` sits next to this file rather than in `static/`: it is what the region tables below were
 * read off, and it is worth keeping for the next person who has to change them, but nothing loads
 * it at runtime and there is no reason to ship it. Each pocket is two of its regions: a solid CARD,
 * and a taller GLOW that rises out of it.
 *
 * The animation comes over too. Its whole skeleton animation is fifteen slot-colour timelines that
 * are identical and in phase — alpha 1.0 at 0s, 0x4a/255 at 1s, back to 1.0 at 2s — with no bone
 * movement at all, so it is reproduced exactly by the CSS keyframes on `.pb-pocket-glow` rather
 * than by pulling Pixi and a Spine runtime into a game that is otherwise DOM and CSS. If the art
 * is ever re-authored with real motion, that is the point at which the runtime earns its place.
 *
 * Every region in this atlas is packed ROTATED (the `.atlas` says `rotate:90` on all of them), so
 * `regionStyle` draws the element at the packed size and turns it a quarter clockwise — which is
 * why its width and height read swapped.
 */

export const SLOT_ATLAS = { src: 'img/plinko/pocket_slots.webp', width: 186, height: 944 };

/** `x`/`y` locate the packed area; `width`/`height` are the region's ORIGINAL, upright size. */
export type SlotRegion = { x: number; y: number; width: number; height: number };

/**
 * One tier per step out from the middle of the board, coolest first.
 *
 * The order is the source board's own value ladder (0.2 → 0.5 → 2 → 10 → 20 → 50 → 100), which
 * already runs cool green in the middle to hot amber at the edges — the same direction a jackpot
 * ladder climbs, so the ramp transfers without being recoloured.
 */
export const SLOT_CARDS: SlotRegion[] = [
	{ x: 129, y: 579, width: 74, height: 55 },
	{ x: 129, y: 503, width: 74, height: 55 },
	{ x: 129, y: 199, width: 74, height: 55 },
	{ x: 129, y: 351, width: 74, height: 55 },
	{ x: 129, y: 275, width: 74, height: 55 },
	{ x: 129, y: 123, width: 74, height: 55 },
	{ x: 129, y: 427, width: 74, height: 55 },
];

export const SLOT_GLOWS: SlotRegion[] = [
	{ x: 2, y: 694, width: 82, height: 125 },
	{ x: 2, y: 610, width: 82, height: 125 },
	{ x: 2, y: 274, width: 82, height: 125 },
	{ x: 2, y: 442, width: 82, height: 125 },
	{ x: 2, y: 358, width: 82, height: 125 },
	{ x: 2, y: 190, width: 82, height: 125 },
	{ x: 2, y: 526, width: 82, height: 125 },
];

/** The glow's authored proportion: this much taller than it is wide. */
const GLOW_ASPECT = SLOT_GLOWS[0].height / SLOT_GLOWS[0].width;

/**
 * How much further the glow is drawn than it was authored.
 *
 * Stretching it is safe in a way stretching the card is not: the glow is a soft vertical gradient,
 * so a taller one is just a longer fade rather than distorted art. Raise this to send the columns
 * further up the field, lower it to keep them close to the pockets.
 */
const GLOW_STRETCH = 1.6;

/** How tall a glow column stands for a pocket of `width`. Anchored at the pocket, rising from it. */
export const glowHeight = (width: number): number => width * GLOW_ASPECT * GLOW_STRETCH;

/** Pick a tier for a pocket, `heat` running 0 in the middle of the ladder to 1 at its edges. */
export const slotTier = (heat: number): number =>
	Math.round(Math.max(0, Math.min(1, heat)) * (SLOT_CARDS.length - 1));

/**
 * Inline style that crops one region out of the atlas at a given display size.
 *
 * The element is drawn at the PACKED size and rotated a quarter turn clockwise by the stylesheet,
 * so its width shows the region's height and vice versa — hence the crossed-over scales. Width and
 * height scale independently, so a pocket can be a little wider or shorter than the art was drawn
 * without the caller having to preserve its aspect.
 */
export const regionStyle = (
	region: SlotRegion,
	displayWidth: number,
	displayHeight: number,
): string => {
	const alongX = displayHeight / region.height;
	const alongY = displayWidth / region.width;
	return [
		`width:${displayHeight}px`,
		`height:${displayWidth}px`,
		`background-image:url('${SLOT_ATLAS.src}')`,
		`background-size:${SLOT_ATLAS.width * alongX}px ${SLOT_ATLAS.height * alongY}px`,
		`background-position:${-region.x * alongX}px ${-region.y * alongY}px`,
	].join(';');
};
