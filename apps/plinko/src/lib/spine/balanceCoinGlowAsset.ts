import { staticAssetPath } from '../staticUrl';
import type { SpineAssetDef } from './types';

/**
 * Balance-coin glow — the light burst behind the coin in the BalanceCard, shown only while win coins
 * are merging into it (see CoinFountain's per-arrival gating). Replaces the old static
 * `img/balance_coin_light.png`.
 *
 * Two skeletons are layered, back to front: `glow` (a big soft ray burst) under `sparkle` (sharper
 * rays over a soft disc). Both are white premultiplied-alpha starbursts on the same rig
 * (shine + sparkle×3 slots) and each exposes a single looping animation, `animation`.
 *
 * Rendered by BalanceCoinGlowRenderer into its own small Pixi canvas inside the coin, NOT via
 * SpineBackgroundRenderer, so the fit/bounds fields below are unused — only the loader paths +
 * animation name matter.
 */
const glowAsset = (id: string, folder: string): SpineAssetDef => ({
	id,
	format: 'json',
	skeleton: staticAssetPath(`spine/${folder}/skeleton.json`),
	atlas: staticAssetPath(`spine/${folder}/skeleton.atlas`),
	images: {
		'skeleton.png': staticAssetPath(`spine/${folder}/skeleton.png`),
	},
	animation: 'animation',
	boundsMode: 'authored',
});

/**
 * Order matters — index 0 is drawn first (furthest back). The renderer also scales the whole set by
 * ONE factor derived from the largest skeleton, so the two keep the relative sizes they were
 * authored at (glow ~232u wide vs sparkle ~139u) instead of both stretching to fill the host.
 */
export const getBalanceCoinGlowAssets = (): SpineAssetDef[] => [
	glowAsset('balance_coin_glow', 'glow'),
	glowAsset('balance_coin_sparkle', 'sparkle'),
];
