import { staticAssetPath } from '../staticUrl';
import type { SpineAssetDef } from './types';

/**
 * Coin-fountain spine coins. Two skeletons (`coin_act_1`, `coin_act_2`) drive the on-win burst
 * that streams gold coins from the win modal into the balance coin (see CoinFountainRenderer).
 *
 * The two folders currently ship byte-identical art + rig (same md5 for atlas, skeleton and page).
 * Both IDs stay in play — a spawned coin is randomly assigned one, so the effect uses both as
 * designed — but until the art actually diverges both defs point at the `coin_act_1` FILES. Pixi's
 * loader caches by URL, so that is one decoded 1.4 MB webp page (6.5 MB RGBA) fetched, decoded and
 * uploaded once instead of twice: the fountain used to hold two identical 6.5 MB textures on the
 * GPU for the session, on a device class where GPU memory pressure reaps WebGL contexts. To give
 * `coin_act_2` its own look later, point its def back at its own folder — nothing else changes.
 * Each skeleton exposes two 1s flip loops, `horizon` and `vertical`, spun as the coin travels.
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
	coinAsset('coin_act_2', 'coin_act_1'),
];
