import { staticAssetPath } from '../staticUrl';
import type { SpineAssetDef } from './types';

/** Which of the BalanceCard's two burst canvases a layer is drawn into. */
export type GlowDepth = 'back' | 'front';

export type BalanceCoinGlowLayerDef = SpineAssetDef & {
	/** `back` = behind the coin; `front` = over it. See BalanceCoinGlowRenderer's two hosts. */
	depth: GlowDepth;
	/**
	 * Size multiplier on top of the shared fit scale — 1 keeps the skeleton at the size it was
	 * authored at relative to the others, >1 blows it up past them.
	 */
	emphasis: number;
	/**
	 * Setup-pose scale folded into these bones before the skeleton is built, growing what each bone
	 * CARRIES without moving where it SITS: a bone's offset from its parent and its keyed drift both
	 * live in the parent's space, so its own scale doesn't touch them. Spine's scale timelines
	 * multiply the setup pose (`x *= setup.scaleX` in ScaleTimeline), so the authored pop-in curve
	 * survives — it just peaks bigger.
	 *
	 * `emphasis` cannot do this: it scales the whole skeleton, so the stars fly outward off the coin
	 * as they grow (measured — at emphasis 1.5 their centres pass the coin's rim).
	 */
	boneScale?: { bones: readonly string[]; scale: number };
	/**
	 * Loop only this slice of the timeline (seconds) instead of the whole animation. Spine wraps a
	 * looping track inside [animationStart, animationEnd], so this repeats the interesting part for as
	 * long as the layer is on screen rather than playing it once and then sitting on a dead tail.
	 */
	loopRange?: { start: number; end: number };
};

/**
 * The slice of the sparkle timeline where its stars actually exist: the first ramps up from alpha 0
 * at 0.333s and the second is fully out again by 1.567s — the remaining ~2.8s of the 4.33s loop paints
 * NOTHING. Looping this window instead keeps the stars popping for as long as the layer is lit.
 *
 * 🔑 Both ends are seamless BECAUSE both stars sit at alpha 0 there: 0.333 is star 1's fade-in key
 * (star 2 still stepped at 0) and 1.567 is star 2's fade-out key (star 1 out since 1.267). Their bones
 * do snap back (scale 1→0.51, drift y 33→0) across the wrap, but at zero alpha, so nothing shows.
 * Move either end off those keys and the wrap becomes a visible pop.
 */
const SPARKLE_STAR_WINDOW = { start: 0.3333333, end: 1.5666667 };

/**
 * The star bones — the ONLY slots the `sparkle` export attaches an image to, so this is its whole
 * visible content. (The rig also carries a `shine` bone, which is what the `glow` export attaches its
 * ray burst to, and a fully-keyed third star `sparkle3` that has NO attachment in EITHER export and
 * therefore never renders — which is why the sparkle dies at 1.57s while the glow runs to 2.33s.)
 */
const SPARKLE_STAR_BONES = ['sparkle', 'sparkle2'] as const;

/**
 * Balance-coin glow — the light burst around the coin in the BalanceCard, shown only while win coins
 * are merging into it (see CoinFountain's per-arrival gating). Replaces the static
 * `balance_coin_light` image it used to draw (since deleted along with the rest of the unused art).
 *
 * `glow` and `sparkle` are the SAME RIG exported twice with different attachment subsets — identical
 * bones and identical animation timelines, so they stay in step by construction. `glow` attaches its
 * ray burst to the central `shine` bone (which rotates a full turn over the loop) and goes BEHIND the
 * coin, since a white burst drawn over the gold washes it out. `sparkle` attaches a star mesh to two
 * offset bones that pop in and drift up, and goes OVER the coin. Both are white premultiplied-alpha
 * art, and each exposes a single looping animation, `animation`.
 *
 * Rendered by BalanceCoinGlowRenderer into small Pixi canvases inside the coin, NOT via
 * SpineBackgroundRenderer, so the fit/bounds fields below are unused — only the loader paths +
 * animation name matter.
 */
const glowAsset = (id: string, folder: string): SpineAssetDef => ({
	id,
	format: 'json',
	skeleton: staticAssetPath(`spine/${folder}/skeleton.json`),
	atlas: staticAssetPath(`spine/${folder}/skeleton.atlas`),
	images: {
		'skeleton.png': staticAssetPath(`spine/${folder}/skeleton.webp`),
	},
	animation: 'animation',
	boundsMode: 'authored',
});

/**
 * `glow` is emphasised whole: it reads as the light the coin gives off, so the skeleton is scaled past
 * the size it was authored at relative to `sparkle` (232u vs 136u wide) — the renderer's shared fit
 * scale holds that authored relationship otherwise.
 *
 * `sparkle` stays at emphasis 1 and grows via its STARS instead. Scaling the skeleton would fling them
 * off the coin (their bones sit ±32u out and drift 33u further), which is the opposite of what they
 * are for: they belong ON the coin face. At `boneScale` 2 each star peaks at ~50px against the ~40px
 * coin, so it overlaps the gold rather than orbiting it. It also loops just its star window, since it
 * is lit for longer than the glow (CoinFountain brackets one with the other) and would otherwise spend
 * most of that time blank.
 */
export const getBalanceCoinGlowAssets = (): BalanceCoinGlowLayerDef[] => [
	{ ...glowAsset('balance_coin_glow', 'glow'), depth: 'back', emphasis: 1.5 },
	{
		...glowAsset('balance_coin_sparkle', 'sparkle'),
		depth: 'front',
		emphasis: 1,
		boneScale: { bones: SPARKLE_STAR_BONES, scale: 2 },
		loopRange: SPARKLE_STAR_WINDOW,
	},
];
