import { staticAssetPath } from '../staticUrl';
import type { SpineAssetDef } from './types';

/** Which half of the meter-full celebration a bundle draws. */
export type FreeSpinMeterFullLayer = 'barHighlight' | 'wheelGlow';

export type FreeSpinMeterFullAssetDef = SpineAssetDef & { layer: FreeSpinMeterFullLayer };

/**
 * The two spines the FREE SPIN meter celebrates with once its bar is full: a gold shine that sweeps
 * along the completed bar, and a cyan glow + expanding ring on the helm at its right end.
 *
 * ONE RIG, EXPORTED TWICE. Both skeletons carry the SAME slot list — `box2`,
 * `free-spin-component-meter 1`, `highlightbar`, `helm2`, `glowWheel`, `ring` — and each export
 * simply drops the other's attachments (plus the two reference slots that were only ever there to
 * position against). Two consequences the renderer leans on:
 *   • they share one authoring space, so scaling them together preserves the sizes they were drawn
 *     at relative to each other (see `FreeSpinMeterEngine.layoutFullEffect`);
 *   • the slot ORDER is the authored depth order, and it puts the shine under `helm2` and the glow
 *     and ring over it — which is why the effect straddles the wheel sprite rather than sitting
 *     wholly in front of or behind it.
 *
 * They also share one 2s cycle, which the split hides: the bar export's `barFullHighlight` runs a
 * 45-frame flipbook over 1.5s and then holds to 2s, while the wheel export's `wheelGlow` is a 1.13s
 * burst — the tail of the shared cycle simply has nothing keyed in it. Playing each on its own
 * duration would drift them apart within seconds; `syncFullEffect` wraps the shorter one on the
 * longer one's beat instead.
 *
 * Rendered straight into the meter's own Pixi canvas by `FreeSpinMeterEngine` (like the coin
 * fountain and the balance-coin burst, and unlike the backgrounds), so the fit/bounds fields below
 * are unused — only the loader paths and the animation names matter.
 */
const layerAsset = (
	layer: FreeSpinMeterFullLayer,
	folder: string,
	animation: string,
): FreeSpinMeterFullAssetDef => ({
	layer,
	id: folder,
	format: 'json',
	skeleton: staticAssetPath(`spine/${folder}/skeleton.json`),
	atlas: staticAssetPath(`spine/${folder}/skeleton.atlas`),
	images: {
		'skeleton.png': staticAssetPath(`spine/${folder}/skeleton.webp`),
	},
	animation,
	boundsMode: 'authored',
});

/**
 * ⚠️ Order matters to `FreeSpinMeterEngine.loadFullEffect`: the bar highlight is loaded first
 * because its authored box is the scale basis both layers are placed from.
 *
 * Each export also carries a generic `animation` track holding the same content, but the named ones
 * are used so a re-export that adds a second animation can't silently change which one plays.
 */
export const getFreeSpinMeterFullAssets = (): FreeSpinMeterFullAssetDef[] => [
	layerAsset('barHighlight', 'free_spin_meter_bar_highlight', 'barFullHighlight'),
	layerAsset('wheelGlow', 'free_spin_meter_wheel_glow', 'wheelGlow'),
];
