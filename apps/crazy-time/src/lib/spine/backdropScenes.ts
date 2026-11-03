/**
 * The two animated backdrops — the table's (main game) and the Bonus Wheel room's — as the artist
 * built them in Spine 4.3: each is a "scene" skeleton plus the pieces it was assembled from.
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

const MAIN_LANDSCAPE = bundle(`${MAIN}/scene`, 'landscape.json', ['skeleton.webp']);
const MAIN_PORTRAIT = bundle(`${MAIN}/scene`, 'portrait.json', ['skeleton.webp']);
const MAIN_OCEAN = bundle(`${MAIN}/ocean`, 'skeleton.json', ['skeleton.webp', 'skeleton_2.webp']);
const SHIP_FOG = bundle(`${MAIN}/ship_fog`, 'skeleton.json', ['skeleton.webp']);
const SHIP_LAMP = bundle(`${MAIN}/ship_lamp`, 'skeleton.json', ['skeleton.webp']);
const BONUS_LANDSCAPE = bundle(`${BONUS}/scene`, 'landscape.json', ['skeleton.webp', 'skeleton_2.webp']);
const BONUS_PORTRAIT = bundle(`${BONUS}/scene`, 'portrait.json', ['skeleton.webp', 'skeleton_2.webp']);
const BONUS_OCEAN = bundle(`${BONUS}/ocean`, 'skeleton.json', ['skeleton.webp', 'skeleton_2.webp']);

const IMG = {
	skyLandscape: 'img/background_main/sky_landscape.webp',
	skyPortrait: 'img/background_main/sky_portrait.webp',
	ocean: 'img/background_main/ocean.webp',
	shipLandscape: 'img/background_main/ship_landscape.webp',
	shipPortrait: 'img/background_main/ship_portrait.webp',
	bonusLandscape: 'img/bonus-wheel/backdrop_landscape.webp',
	bonusPortrait: 'img/bonus-wheel/backdrop_portrait.webp',
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
				else bundles.set(layer.bundle.skeleton, layer.bundle);
			}
		}
	}
	return { bundles: [...bundles.values()], images: [...images] };
};
