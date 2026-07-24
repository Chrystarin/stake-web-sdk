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
	/**
	 * Cover the viewport HEIGHT as well as the width (scale = max of the two fits) so a bottom-anchored
	 * backdrop never leaves an empty strip at the top on tall viewports. A no-op on normal/short
	 * viewports where the width fill already exceeds the height fill. Off by default.
	 */
	coverHeight?: boolean;
};

/**
 * A Spine layer painted on top of the base background *only while bonus mode is active*. It is
 * authored in the SAME editor scene / coordinate space as the base background skeleton, so it is
 * placed by piggybacking the base spine's computed fit transform (identical scale + position) rather
 * than fitting independently — that keeps it pixel-aligned with the base scene. See
 * `SpineBackgroundRenderer.applyOverlayFit`.
 */
export type SpineOverlayDef = {
	id: string;
	format: SkeletonFormat;
	skeleton: string;
	atlas: string;
	images: Record<string, string>;
	animation: string;
	/** Whether the animation loops. Defaults to true (ambient loop). */
	loop?: boolean;
	/** Skeleton JSON/binary scale — must match the base skeleton's scale so world coords line up. */
	skeletonScale?: number;
	/** Extra fine-tune nudge on top of the base transform, as a viewport-width fraction (0.05 = 5vw). */
	offsetXVw?: number;
	/** Extra fine-tune nudge on top of the base transform, as a viewport-height fraction. */
	offsetYVh?: number;
	/**
	 * Flip the overlay horizontally and reflect it across the scene's centre, so an asset authored on
	 * one side (e.g. the right-hand splash) also appears mirrored on the other. Uses the base fit
	 * bounds' centre, so the reflection lands on the symmetric feature (the opposite waterfall).
	 */
	mirror?: boolean;
	/**
	 * Render this overlay UNDER the base background spine instead of on top, so base-scene elements
	 * (the waterfalls, ship, dock) occlude it — giving the layer depth rather than pasting it in front.
	 */
	behindBase?: boolean;
	/**
	 * Play the animation on a duty cycle instead of looping back-to-back: run it once, then hide the
	 * layer for `cycleGapSeconds` before replaying. Driven manually from the ticker (the overlay's
	 * `autoUpdate` is turned off), so the phase is exact and frame-rate independent.
	 */
	cycleGapSeconds?: number;
	/**
	 * Stagger for the duty cycle, in seconds after the un-delayed copy starts. Lets a mirrored pair
	 * fire one after the other instead of together.
	 */
	cycleStartDelaySeconds?: number;
};

export type SpineAssetDef = {
	id: string;
	format: SkeletonFormat;
	skeleton: string;
	atlas: string;
	images: Record<string, string>;
	animation: string;
	/** Whether the animation loops. Defaults to true (background ambience). */
	loop?: boolean;
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
	/**
	 * Backdrop image swapped in while bonus mode is active (free game). Same fit rules as `backdrop`,
	 * so it should share the base backdrop's pixel dimensions. When absent the base backdrop stays.
	 */
	bonusBackdropSrc?: string;
	/**
	 * Base-skeleton slots hidden while bonus mode is active — e.g. the ambient clouds, which the free
	 * game replaces with the dedicated `bonusOverlays` cloud layer. Restored on bonus exit.
	 */
	bonusHiddenSlots?: string[];
	/** Spine layers painted on top only while bonus mode is active (see `SpineOverlayDef`). */
	bonusOverlays?: SpineOverlayDef[];
	/**
	 * Base-skeleton slots "lifted" out of the base spine during bonus and re-drawn in a synced copy
	 * placed BENEATH the bonus overlays, while the rest of the base scene stays above them.
	 *
	 * This exists because a separate overlay can only sit entirely below or entirely above the base
	 * spine, yet the art needs the splash to be *in front of the distant ship* but *behind the
	 * waterfall* — and `ship` is the LAST (topmost) slot of the landscape skeleton, above the
	 * waterfall. Lifting `ship` into the underlay re-depths it as a true background element and makes
	 * that ordering possible. The lifted slots are hidden on the main spine while bonus is active.
	 */
	bonusUnderlaySlots?: string[];
	/**
	 * Content is authored above the skeleton root (y-up) rather than below it. Flips the vertical
	 * fit term so the spine lands in the viewport instead of parking above it. Only affects the
	 * centered fit path (no `widthFillScale`/`fitAnchor`).
	 */
	yUp?: boolean;
	/**
	 * Only affects the centered fit path (no `widthFillScale`/`fitAnchor`). When the viewport is
	 * portrait (taller than wide), fit the whole skeleton *inside* the viewport (contain) instead
	 * of cropping to fill it (cover), so a wide/landscape asset like the intro logo stays fully
	 * visible and centered rather than clipped on both sides.
	 */
	containInPortrait?: boolean;
	/**
	 * Extra inset applied to the `containInPortrait` fit so the asset isn't edge-to-edge
	 * (0.9 = leave a 10% margin). Defaults to 1 (touches the viewport width).
	 */
	portraitContainScale?: number;
};
