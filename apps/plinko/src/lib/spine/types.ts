export type BoundsMode = 'authored' | 'content';
export type FitAnchor = 'center' | 'bottom';
export type SkeletonFormat = 'json' | 'skel';

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
};
