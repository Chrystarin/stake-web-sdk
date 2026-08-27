import { Assets, type Texture } from 'pixi.js';

import type { SpineAssetDef } from './types';

/**
 * Structural subset shared by the base assets, the bonus overlays and the standalone spines (coins,
 * balance glow, glow numbers) — everything needed to REGISTER and LOAD a spine, with none of the
 * fit/placement fields. The preloader and every renderer work off this.
 */
export type SpineLoadable = Pick<
	SpineAssetDef,
	'id' | 'format' | 'skeleton' | 'atlas' | 'images' | 'skeletonScale'
>;

export type SpineAliases = { atlasAlias: string; skeletonAlias: string };

/** Cache keys a spine bundle is registered under. Derived from the def id, so the intro preload and
 * the renderer that later mounts the same def resolve to the SAME entries (a pure cache hit). */
export const spineAliases = (asset: Pick<SpineLoadable, 'id'>): SpineAliases => ({
	atlasAlias: `${asset.id}-atlas`,
	skeletonAlias: `${asset.id}-skeleton`,
});

/**
 * Every alias this module has handed to Pixi's global resolver, mapped to the `src` it was registered
 * for. Pixi's `Assets.add` warns ("[Resolver] already has key: … overwriting") and re-writes the entry
 * on a repeat call, which used to fire on every renderer remount — and, now that the intro loader
 * preloads the same bundles the renderers mount, would fire for EVERY spine in the game.
 *
 * Keyed by src (not a bare "seen" set) so that an alias which legitimately points at different files in
 * different situations still re-registers instead of being skipped as already-seen — otherwise the
 * resolver would keep serving whichever file was registered first. (`bonus_rain` was exactly that until
 * both orientations moved onto the one tiled rain skeleton.)
 */
const registeredSrc = new Map<string, string>();

function addOnce(alias: string, src: string, data?: Record<string, unknown>): void {
	if (registeredSrc.get(alias) === src) return;
	Assets.add({ alias, src, ...(data ? { data } : {}) });
	registeredSrc.set(alias, src);
}

/** Register a spine bundle's atlas + skeleton aliases (idempotent). Does not load anything. */
export function registerSpineAsset(asset: SpineLoadable): SpineAliases {
	const aliases = spineAliases(asset);
	addOnce(aliases.atlasAlias, asset.atlas, { images: asset.images });
	addOnce(aliases.skeletonAlias, asset.skeleton);
	return aliases;
}

/**
 * Register + load a spine bundle into Pixi's global asset cache. Loading the same bundle again (from a
 * renderer, after the intro preload) resolves from the cache with no fetch and no re-decode.
 *
 * NOTE: the atlas PAGE images (skeleton.png, skeleton_2.png, …) are loaded by the spine atlas loader
 * through its own low-level loader and live on the returned `TextureAtlas` — they are never `Assets`
 * entries under their own URLs, so they must never be preloaded separately (that would fetch and
 * decode every page twice). Loading the atlas alias covers them.
 */
export async function loadSpineAsset(asset: SpineLoadable): Promise<SpineAliases> {
	const aliases = registerSpineAsset(asset);
	await Assets.load([aliases.atlasAlias, aliases.skeletonAlias]);
	return aliases;
}

/** Register a plain texture under an explicit alias (idempotent), for the same reason as above. */
export function registerTextureAsset(alias: string, src: string): string {
	addOnce(alias, src);
	return alias;
}

/** Register + load a plain texture under an explicit alias. */
export function loadTextureAsset(alias: string, src: string): Promise<Texture> {
	registerTextureAsset(alias, src);
	return Assets.load(alias);
}

/* ── Alias conventions for the non-spine textures a background asset pulls in ────────────────────
 * Shared by `SpineBackgroundRenderer` and the intro preloader so both name the same cache entry —
 * otherwise the preload would warm one key and the renderer would fetch + decode a second copy under
 * another. Never inline these strings. */

/** Static JPG drawn behind the base scene (`SpineAssetDef.backdrop`). */
export const backdropAlias = (assetId: string): string => `${assetId}-backdrop`;
/** Static JPG swapped in behind the scene during the free game (`SpineAssetDef.bonusBackdropSrc`). */
export const bonusBackdropAlias = (assetId: string): string => `${assetId}-bonus-backdrop`;
/** Plain-image layer (moon, lightning) — `SpineAssetDef.imageOverlays` / `bonusImageOverlays`. */
export const imageOverlayAlias = (defId: string): string => `${defId}-image-overlay`;

/**
 * Every load a background asset needs before it can render BOTH the base scene and the free game,
 * as individual thunks so the caller can count them towards a progress readout.
 *
 * This mirrors, exactly, what `SpineBackgroundRenderer` loads across `loadAsset` (base bundle,
 * backdrop, base image overlays) and `loadBonusAssets` (bonus backdrop, overlay bundles, bonus image
 * overlays) — same aliases, same srcs — so running it from the intro loader means the renderer's own
 * loads all resolve straight from the cache instead of fetching mid-game.
 *
 * ⚠️ Orientation-scoped: a def's overlay ids are stable across orientations but their srcs are not
 * (`bonus_rain` is the landscape rain skeleton in landscape and the portrait one in portrait), so
 * only ONE orientation's tree can be resident at a time. Preload the tree for the layout the game is
 * actually about to mount.
 */
export function spineAssetTreeTasks(asset: SpineAssetDef): (() => Promise<unknown>)[] {
	const tasks: (() => Promise<unknown>)[] = [() => loadSpineAsset(asset)];

	if (asset.backdrop) {
		const { src } = asset.backdrop;
		tasks.push(() => loadTextureAsset(backdropAlias(asset.id), src));
	}
	if (asset.bonusBackdropSrc) {
		const src = asset.bonusBackdropSrc;
		tasks.push(() => loadTextureAsset(bonusBackdropAlias(asset.id), src));
	}
	for (const def of [...(asset.imageOverlays ?? []), ...(asset.bonusImageOverlays ?? [])]) {
		tasks.push(() => loadTextureAsset(imageOverlayAlias(def.id), def.src));
	}
	for (const def of asset.bonusOverlays ?? []) {
		tasks.push(() => loadSpineAsset(def));
	}

	return tasks;
}
