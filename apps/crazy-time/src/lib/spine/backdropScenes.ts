/**
 * The animated backdrops — the table's (main game), the Bonus Wheel's, Pirate Plinko's and the
 * Treasure Chest's rooms — as
 * the artist built them in Spine 4.3: each is a "scene" skeleton plus the pieces it was assembled from.
 *
 * The exports are split. The scene skeleton carries everything that MOVES over the picture (clouds,
 * mountains, the far ship, fog banks, rain, lightning), and keeps an EMPTY slot at every point in its
 * draw order where something else goes: the still art (sky, ocean, the ship's deck, the bonus
 * backdrop) and the smaller skeletons exported on their own (the ocean's frame sequence, the fog
 * over the rail, the two swinging lanterns). {@link SceneSpineRenderer} fills those slots back in, so
 * the layering is the artist's own.
 *
 * Every scene is authored in a fixed frame with the skeleton root at the frame's bottom centre,
 * y-up: 1920x1080 in landscape, 922x1761 in portrait. That is the box the renderer cover-fits.
 *
 * Positions the export does not carry — the still images were taken out of their slots, so their
 * placement went with them — were read off the artist's editor recordings ("Guide Video") and the
 * guide composites: in landscape everything sits at the root, unscaled; in portrait the 1920-wide
 * ocean strip is scaled up to span the sea behind the narrow frame (measured 2337 / 2284 units wide,
 * its foot 603 / 590 units up the main / bonus frame).
 */

import { type EmitterConfig, SAND } from './sandEmitter';

export type SpineBundle = {
	/** Paths under `static/`; Pixi's cache keys them as {@link spineAlias}. */
	skeleton: string;
	atlas: string;
	/** Atlas page files, for the preload drift alarm only — the atlas loader fetches them itself. */
	pages: readonly string[];
};

/** Something put into a scene slot. `x`/`y` are skeleton units (y-up) from the slot bone's origin. */
export type SceneLayer =
	| { kind: 'image'; path: string; x?: number; y?: number; scale?: number }
	/** A particle emitter (lib/spine/sandEmitter.ts) — drawn in code, so no files to load. */
	| { kind: 'particles'; config: EmitterConfig; x?: number; y?: number; scale?: number }
	| {
			kind: 'spine';
			bundle: SpineBundle;
			x?: number;
			y?: number;
			scale?: number;
			/** Loop on this length instead of the animation's own (see the bonus ocean). */
			loopSeconds?: number;
			/** Slots of THIS skeleton to leave empty. */
			hideSlots?: readonly string[];
	  };

export type SceneMount = {
	slot: string;
	layers: readonly SceneLayer[];
	/**
	 * Stays put when the scene lurches ({@link SceneSpineRenderer.lurch}): the deck and what stands on
	 * it. Everything else — sky, sea, the far ship — drops and bobs behind the rail.
	 */
	onDeck?: boolean;
};

export type BackdropScene = {
	id: string;
	frame: { width: number; height: number };
	/** The scene skeleton; it loops its one animation. Landscape and portrait share the atlas. */
	bundle: SpineBundle;
	mounts: readonly SceneMount[];
	/** Scene slots to leave empty — drawn instead by a mounted skeleton. */
	hideSlots?: readonly string[];
};

/** Pixi cache alias for a skeleton or atlas file. Landscape and portrait share an atlas, so one alias. */
export const spineAlias = (path: string): string => `backdrop:${path}`;

const bundle = (dir: string, skeleton: string, pages: readonly string[]): SpineBundle => ({
	skeleton: `${dir}/${skeleton}`,
	atlas: `${dir}/skeleton.atlas`,
	pages: pages.map((page) => `${dir}/${page}`),
});

const MAIN = 'spine/background_main';
const BONUS = 'spine/background_bonus_wheel';
const PLINKO = 'spine/pirate_plinko';
const CHEST = 'spine/treasure_chest';

const MAIN_LANDSCAPE = bundle(`${MAIN}/scene`, 'landscape.json', ['skeleton.webp']);
const MAIN_PORTRAIT = bundle(`${MAIN}/scene`, 'portrait.json', ['skeleton.webp']);
const MAIN_OCEAN = bundle(`${MAIN}/ocean`, 'skeleton.json', ['skeleton.webp', 'skeleton_2.webp']);
const SHIP_FOG = bundle(`${MAIN}/ship_fog`, 'skeleton.json', ['skeleton.webp']);
const SHIP_LAMP = bundle(`${MAIN}/ship_lamp`, 'skeleton.json', ['skeleton.webp']);
const BONUS_LANDSCAPE = bundle(`${BONUS}/scene`, 'landscape.json', ['skeleton.webp', 'skeleton_2.webp']);
const BONUS_PORTRAIT = bundle(`${BONUS}/scene`, 'portrait.json', ['skeleton.webp', 'skeleton_2.webp']);
const BONUS_OCEAN = bundle(`${BONUS}/ocean`, 'skeleton.json', ['skeleton.webp', 'skeleton_2.webp']);
// The plinko cuts were packed apart (the landscape one carries the wreck and a second palm), so
// unlike the other scenes each has its own atlas.
const PLINKO_LANDSCAPE = bundle(`${PLINKO}/landscape`, 'skeleton.json', ['skeleton.webp']);
const PLINKO_PORTRAIT = bundle(`${PLINKO}/portrait`, 'skeleton.json', ['skeleton.webp']);
const PLINKO_OCEAN = bundle(`${PLINKO}/ocean`, 'skeleton.json', ['skeleton.webp']);
// The Treasure Chest's two cuts were packed together, like the table's: one atlas, two skeletons.
const CHEST_LANDSCAPE = bundle(`${CHEST}/scene`, 'landscape.json', ['skeleton.webp']);
const CHEST_PORTRAIT = bundle(`${CHEST}/scene`, 'portrait.json', ['skeleton.webp']);

const IMG = {
	skyLandscape: 'img/background_main/sky_landscape.webp',
	skyPortrait: 'img/background_main/sky_portrait.webp',
	ocean: 'img/background_main/ocean.webp',
	shipLandscape: 'img/background_main/ship_landscape.webp',
	shipPortrait: 'img/background_main/ship_portrait.webp',
	bonusLandscape: 'img/bonus-wheel/backdrop_landscape.webp',
	bonusPortrait: 'img/bonus-wheel/backdrop_portrait.webp',
	plinkoBackdropLandscape: 'img/pirate-plinko/backdrop_landscape.webp',
	plinkoForegroundLandscape: 'img/pirate-plinko/foreground_landscape.webp',
	plinkoBackdropPortrait: 'img/pirate-plinko/backdrop_portrait.webp',
	plinkoForegroundPortrait: 'img/pirate-plinko/foreground_portrait.webp',
	chestBackdropLandscape: 'img/treasure_chest/backdrop_landscape.webp',
	chestForegroundLandscape: 'img/treasure_chest/foreground_landscape.webp',
	chestBackdropPortrait: 'img/treasure_chest/backdrop_portrait.webp',
	chestForegroundPortrait: 'img/treasure_chest/foreground_portrait.webp',
} as const;

/**
 * The fog over the rail and the lanterns. The scene skeleton carries only HALF the rail fog
 * (`fogSHIP2`, which fades out at 4 s and back in at 26 s) and none of the lanterns; the Ship Fog
 * skeleton carries both fog banks on the same 30 s timeline — `fogSHIP` drifting in as `fogSHIP2`
 * fades — so in landscape the scene's own `fogSHIP2` is hidden and the pair drawn from Ship Fog,
 * once. Portrait does NOT: its editor recording shows the deck clear of fog between those marks, so
 * the portrait scene keeps its own `fogSHIP2` and nothing more.
 */
const RAIL_FOG: SceneLayer = { kind: 'spine', bundle: SHIP_FOG };
const LANTERNS: SceneLayer = { kind: 'spine', bundle: SHIP_LAMP };

/**
 * The bonus ocean's 90 frames run at 1/30 s, so the sequence is 3 s round — but the animation is
 * 4.63 s long (a stray draw-order key), and looping on that would jump from frame 49 back to 0.
 */
const BONUS_OCEAN_LOOP = 90 / 30;
/** Pirate Plinko's sea: 90 frames at 1/30 s too, its last key at 2.967 s — so loop on the full 3 s. */
const PLINKO_OCEAN_LOOP = 90 / 30;
/**
 * The artist's `Sand.json`, blowing left to right along the beach. The export carries no position,
 * so the emitter stands on the root (the frame's bottom centre): its spawn circle, 320 units left of
 * that, is half under the frame's foot, and the grains fan out up to 47° either side of the wind.
 * Over the sand and the treasure, under the wreck, the palms and the near leaves.
 */
const BLOWING_SAND: SceneLayer = { kind: 'particles', config: SAND };

export const SCENES = {
	mainLandscape: {
		id: 'main-landscape',
		frame: { width: 1920, height: 1080 },
		bundle: MAIN_LANDSCAPE,
		hideSlots: ['fogSHIP2'],
		mounts: [
			{ slot: 'skyBG', layers: [{ kind: 'image', path: IMG.skyLandscape }] },
			{
				slot: 'ocean',
				layers: [
					{ kind: 'image', path: IMG.ocean },
					{ kind: 'spine', bundle: MAIN_OCEAN },
				],
			},
			{
				slot: 'shipLandscape',
				onDeck: true,
				layers: [{ kind: 'image', path: IMG.shipLandscape }, RAIL_FOG, LANTERNS],
			},
		],
	},
	mainPortrait: {
		id: 'main-portrait',
		frame: { width: 922, height: 1761 },
		bundle: MAIN_PORTRAIT,
		mounts: [
			{ slot: 'Sky_portrait', layers: [{ kind: 'image', path: IMG.skyPortrait }] },
			{
				slot: 'ocean',
				layers: [
					{ kind: 'image', path: IMG.ocean, y: 603, scale: 1.217 },
					{ kind: 'spine', bundle: MAIN_OCEAN, y: 603, scale: 1.217 },
				],
			},
			{
				slot: 'shipPortrait',
				onDeck: true,
				layers: [{ kind: 'image', path: IMG.shipPortrait }],
			},
		],
	},
	bonusLandscape: {
		id: 'bonus-landscape',
		frame: { width: 1920, height: 1080 },
		bundle: BONUS_LANDSCAPE,
		mounts: [
			{ slot: 'backdrop', layers: [{ kind: 'image', path: IMG.bonusLandscape }] },
			{ slot: '0', layers: [{ kind: 'spine', bundle: BONUS_OCEAN, loopSeconds: BONUS_OCEAN_LOOP }] },
			// The same deck as the table's, lanterns and all (the guide shows them lit through the storm).
			{
				slot: 'Guide_SHIPforeground',
				onDeck: true,
				layers: [{ kind: 'image', path: IMG.shipLandscape }, LANTERNS],
			},
		],
	},
	bonusPortrait: {
		id: 'bonus-portrait',
		frame: { width: 922, height: 1761 },
		bundle: BONUS_PORTRAIT,
		mounts: [
			{ slot: 'backdrop_port', layers: [{ kind: 'image', path: IMG.bonusPortrait }] },
			{
				slot: '0',
				layers: [
					{ kind: 'spine', bundle: BONUS_OCEAN, y: 615, scale: 1.185, loopSeconds: BONUS_OCEAN_LOOP },
				],
			},
			{ slot: 'shipPortrait', onDeck: true, layers: [{ kind: 'image', path: IMG.shipPortrait }] },
		],
	},
	/*
	 * Pirate Plinko's beach at sunset (BonusRound.svelte, under the board). The scene skeleton is the
	 * palm, flag, lantern, wreck, smoke and the leaves in the foreground; the beach is two stills, the
	 * sky-and-sea behind (`backdrop` / `boneGuide`) and the sand and treasure in front (`FG` /
	 * `foregroundPortrait`), with the rolling waves drawn between them. The artist's "with BG" exports
	 * place the stills: centred on the root, the landscape sand's foot 1.4 units under it and the
	 * portrait sand's 0.2 over. (The portrait sky's export drops it 1.7, which bares the top of the
	 * frame, so it sits on the root.) The waves sit at the root unscaled in both cuts — in portrait the strip runs out past
	 * the narrow frame on both sides, as in the editor recording.
	 */
	plinkoLandscape: {
		id: 'plinko-landscape',
		frame: { width: 1920, height: 1080 },
		bundle: PLINKO_LANDSCAPE,
		mounts: [
			{ slot: 'backdrop', layers: [{ kind: 'image', path: IMG.plinkoBackdropLandscape }] },
			{ slot: 'ocean', layers: [{ kind: 'spine', bundle: PLINKO_OCEAN, loopSeconds: PLINKO_OCEAN_LOOP }] },
			{
				slot: 'FG',
				layers: [{ kind: 'image', path: IMG.plinkoForegroundLandscape, y: -1.4 }, BLOWING_SAND],
			},
		],
	},
	plinkoPortrait: {
		id: 'plinko-portrait',
		frame: { width: 922, height: 1761 },
		bundle: PLINKO_PORTRAIT,
		mounts: [
			{ slot: 'boneGuide', layers: [{ kind: 'image', path: IMG.plinkoBackdropPortrait }] },
			{ slot: 'ocean', layers: [{ kind: 'spine', bundle: PLINKO_OCEAN, loopSeconds: PLINKO_OCEAN_LOOP }] },
			{
				slot: 'foregroundPortrait',
				layers: [{ kind: 'image', path: IMG.plinkoForegroundPortrait, y: 0.2 }, BLOWING_SAND],
			},
		],
	},
	/*
	 * The Treasure Chest's dragon lair (BonusRound.svelte, under the chests): the old flat still
	 * brought to life. The scene skeleton is the brazier fires and their embers (19- and 20-frame
	 * sequences at 30 fps; landscape has all four braziers, portrait only the inner two), the
	 * dragon's ghost face pulsing in the sky, and the smoke banks drifting across, all on one 30 s
	 * loop that starts and ends with most of the smoke faded out. The lair is two stills: the sky,
	 * peaks and lava behind (`background` / `portraitDragonLore`), and the cave mouth, chains,
	 * statues and floor in front (`foreground_DragonLore` / `foregroundPortrait`). The far cloud draws
	 * between them; the face, the fires and the near smoke over the front. The "with BG" exports
	 * centre both stills on the root, 1.36 (landscape) and 0.46 (portrait) units up, which would
	 * bare that strip at the frame's foot, so they stand on the root.
	 */
	chestLandscape: {
		id: 'chest-landscape',
		frame: { width: 1920, height: 1080 },
		bundle: CHEST_LANDSCAPE,
		mounts: [
			{ slot: 'background', layers: [{ kind: 'image', path: IMG.chestBackdropLandscape }] },
			{ slot: 'foreground_DragonLore', layers: [{ kind: 'image', path: IMG.chestForegroundLandscape }] },
		],
	},
	chestPortrait: {
		id: 'chest-portrait',
		frame: { width: 922, height: 1761 },
		bundle: CHEST_PORTRAIT,
		mounts: [
			{ slot: 'portraitDragonLore', layers: [{ kind: 'image', path: IMG.chestBackdropPortrait }] },
			{ slot: 'foregroundPortrait', layers: [{ kind: 'image', path: IMG.chestForegroundPortrait }] },
		],
	},
} as const satisfies Record<string, BackdropScene>;

export type SceneKey = keyof typeof SCENES;

/**
 * The flat picture painted under each scene's canvas — what shows while the canvas comes up, on the
 * reduced drawing budget (lib/deviceTier.svelte.ts), and if the GPU takes the canvas away. They are
 * the artist's guide composites, so the still and the first painted frame are the same picture.
 */
export const SCENE_STILLS: Record<SceneKey, string> = {
	mainLandscape: 'img/background_main/still_landscape.webp',
	mainPortrait: 'img/background_main/still_portrait.webp',
	bonusLandscape: 'img/bonus-wheel/still_landscape.webp',
	bonusPortrait: 'img/bonus-wheel/still_portrait.webp',
	// No guide composite came with these, so they are the scenes' own first frame, rendered.
	plinkoLandscape: 'img/pirate-plinko/still_landscape.webp',
	plinkoPortrait: 'img/pirate-plinko/still_portrait.webp',
	// The landscape guide composite has no fires lit, so these are rendered first frames too.
	chestLandscape: 'img/treasure_chest/still_landscape.webp',
	chestPortrait: 'img/treasure_chest/still_portrait.webp',
};

/** Every skeleton bundle and image a scene uses, deduplicated. */
export const sceneAssets = (keys: readonly SceneKey[]) => {
	const bundles = new Map<string, SpineBundle>();
	const images = new Set<string>();
	for (const key of keys) {
		const scene: BackdropScene = SCENES[key];
		bundles.set(scene.bundle.skeleton, scene.bundle);
		for (const mount of scene.mounts) {
			for (const layer of mount.layers) {
				if (layer.kind === 'image') images.add(layer.path);
				else if (layer.kind === 'spine') bundles.set(layer.bundle.skeleton, layer.bundle);
			}
		}
	}
	return { bundles: [...bundles.values()], images: [...images] };
};
