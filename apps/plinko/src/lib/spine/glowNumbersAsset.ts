import { staticAssetPath } from '../staticUrl';
import type { SpineAssetDef } from './types';

const SPINE_BASE = 'spine/glow_numbers';

/**
 * Glow-number slot decoration spine. Rendered INSIDE the PlinkoEngine world (not via
 * SpineBackgroundRenderer) and positioned per-slot, so this def only carries the loader paths
 * + animation name — the fit/bounds fields used by the background renderer are unused here.
 *
 * NOTE: the baked glyphs in this skeleton (…,10,2,0.5,3,…) do NOT match the compliant board
 * values (…,5,1.5,0.4,…). The math is untouched; the real multiplier is printed on top by the
 * engine, so this layer is purely the animated glow behind the authoritative numbers.
 */
export const getGlowNumbersAsset = (): SpineAssetDef => ({
	id: 'glow_numbers',
	format: 'json',
	skeleton: staticAssetPath(`${SPINE_BASE}/skeleton.json`),
	atlas: staticAssetPath(`${SPINE_BASE}/skeleton.atlas`),
	images: {
		'skeleton.png': staticAssetPath(`${SPINE_BASE}/skeleton.png`),
	},
	animation: 'animation',
	boundsMode: 'authored',
});
