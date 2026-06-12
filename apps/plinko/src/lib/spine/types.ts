export type BoundsMode = 'authored' | 'content';
export type FitAnchor = 'center' | 'bottom';
export type SkeletonFormat = 'json' | 'skel';

export type SpineBackdropDef = {
	src: string;
	/** Width fill multiplier (1 = viewport width). Uses the same bounds as the spine layer. */
	widthFillScale: number;
	/** Horizontal nudge as viewport-width fraction (0.05 = 5vw). Positive = right. */
	offsetXVw: number;
	/** Vertical nudge as viewport-height fraction (0.05 = 5vh). Positive = down. */
	offsetYVh: number;
};

export type SpineAssetDef = {
	id: string;
	format: SkeletonFormat;
	skeleton: string;
	atlas: string;
	images: Record<string, string>;
	animation: string;
	boundsMode: BoundsMode;
	/** Skeleton JSON/binary scale — must match the atlas page `scale` value. */
	skeletonScale?: number;
	/** Extra padding ratio applied around content bounds (0 = tight fit). */
	boundsPadding?: number;
	/** How the fitted spine is anchored inside the viewport. */
	fitAnchor?: FitAnchor;
	/**
	 * When set, scale to fill viewport width (× this multiplier) and crop height.
	 * 1 = exact viewport width; 1.12 = 12% wider than the viewport.
	 */
	widthFillScale?: number;
	/** Horizontal nudge as a viewport-width fraction (0.05 = 5vw). Positive = right. */
	offsetXVw?: number;
	/** Vertical nudge as a viewport-height fraction (0.05 = 5vh). Positive = down. */
	offsetYVh?: number;
	/** Static image rendered behind the spine using the same fit bounds. */
	backdrop?: SpineBackdropDef;
};
