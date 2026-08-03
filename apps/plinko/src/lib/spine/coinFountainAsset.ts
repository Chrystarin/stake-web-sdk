import { staticAssetPath } from '../staticUrl';
import type { SpineAssetDef } from './types';

/**
 * Coin-fountain spine coins. Two skeletons (`coin_act_1`, `coin_act_2`) drive the on-win burst
 * that streams gold coins from the win modal into the balance coin (see CoinFountainRenderer).
 *
 * The two folders currently ship byte-identical art + rig — both are loaded (and randomly assigned
 * per spawned coin) so the effect literally uses both as designed, and so the two can diverge into
 * distinct coin looks later with no code change. Each skeleton exposes two 1s flip loops,
 * `horizon` and `vertical`, spun as the coin travels.
 *
 * Rendered by CoinFountainRenderer (its own transparent full-viewport Pixi overlay), NOT via
 * SpineBackgroundRenderer, so the fit/bounds fields below are unused — only the loader paths +
 * animation names matter.
 */
const coinAsset = (id: string, folder: string): SpineAssetDef => ({
	id,
	format: 'json',
	skeleton: staticAssetPath(`spine/${folder}/skeleton.json`),
	atlas: staticAssetPath(`spine/${folder}/skeleton.atlas`),
	images: {
		'skeleton.png': staticAssetPath(`spine/${folder}/skeleton.webp`),
	},
	animation: 'horizon',
	boundsMode: 'authored',
});

export const COIN_FOUNTAIN_ANIMATIONS = ['horizon', 'vertical'] as const;

export const getCoinFountainAssets = (): SpineAssetDef[] => [
	coinAsset('coin_act_1', 'coin_act_1'),
	coinAsset('coin_act_2', 'coin_act_2'),
];
