<script lang="ts">
	import { onMount } from 'svelte';

	import { stateSoundDerived } from 'state-shared';
	import { waitForTimeout } from 'utils-shared/wait';

	import { getContext } from '../game/context';
	import { stateGame } from '../game/stateGame.svelte';
	import { COLOUR_TO_PIP, type Colour } from '../game/constants';
	import { staticUrl } from '../lib/staticUrl';

	const context = getContext();

	// Clearing the board slides the dice off the bottom of the screen rather than blinking them
	// out. The scene is only TAKEN AWAY once that has played — `clearDice` on a visible canvas
	// pops, so the dice have to be gone from view first. Mirrors the `transition` on `.dice-scene`.
	const EXIT_MS = 300;
	let diceExiting = $state(false);

	let sceneEl: HTMLDivElement;
	let trayEl: HTMLDivElement;
	let box: any = null;
	let rollInFlight = false;
	let d6FaceLabelsApplied = false;

	const sceneId = 'colour_dice_scene';

	// --- The tray -----------------------------------------------------------------------------
	// The dice are played inside a tray in the middle of the table rather than over the whole
	// felt: they are thrown in from off the top of the table, bounce off its rim, and all three
	// come to rest inside it. Nothing leaves once it is in, because the four walls
	// dice-box-threejs builds the world with are infinite planes — pull them in off the frame edge
	// onto the tray's rim and they hold the dice there at any height (see `installTrayWalls`).
	// Getting IN over a wall like that takes the gate below.
	//
	// The SHAPE of it is settled in CSS, by `.dice-tray`: a rectangle as wide as the betting panel
	// in landscape, a square in portrait. This side of it only measures what CSS drew and puts the
	// walls on that line (see `measureTray`), so there is one description of the tray rather than
	// two that have to be kept in step.

	/** How many dice fit across the narrow way. Sets the die size, so three always have room. */
	const DICE_ACROSS = 4.2;
	/**
	 * A d6 face, as a multiple of `baseScale`. The library normalises the unit cube's corners to
	 * `baseScale`, so a face spans 2/sqrt(3) of it, scaled by the 0.9 on the d6 itself.
	 */
	const D6_FACE = (2 * 0.9) / Math.sqrt(3);

	// --- Throw geometry -----------------------------------------------------------------------
	// The dice are thrown in from off the top of the table: they start out of frame north of the
	// tray, fanned across it, and are sent down into it at an angle. Once they are in, they stay
	// in — see the gate below, which is what lets them cross a rim that nothing can cross after.
	/** How far past the top of the frame the dice start, as a share of the visible half-height. */
	const SPAWN_CLEAR = 0.12;
	/** How wide they fan across the tray as they come in, as a share of the room they have. */
	const SPAWN_SPREAD = 0.6;
	/**
	 * Height the first die comes in at, as a share of the tray's NARROW half — so a throw carries
	 * the same way whatever shape the tray is, rather than being flung harder as it widens.
	 */
	const DROP_HEIGHT = 1.2;
	/**
	 * How much higher each die comes in than the one before, as a multiple of a die's reach.
	 *
	 * Measured against the DIE rather than the tray because of what it is for: the three are
	 * thrown across each other's paths, so what this has to buy is enough room for one to pass
	 * over another untouched. A die knocked out of its line up here is the one thing that can
	 * leave it stranded north of the tray, since the wall it came in over is not up yet.
	 */
	const DROP_STAGGER = 2.4;
	/** How far across the tray each die is aimed, as a share of its half-width. */
	const AIM_SPREAD = 0.5;
	/** How deep into the tray they are aimed, as a share of its half-height. */
	const AIM_DEPTH = 0.45;
	/**
	 * Slop in the lanes and in what each die is aimed at, so two throws never come in quite alike.
	 * Heights are deliberately left out of it: the gaps between them are what keeps the dice off
	 * each other on the way in, and that is not something to leave to chance.
	 */
	const THROW_JITTER = 0.16;

	// --- Reading the dice -----------------------------------------------------------------------
	// A die only counts if it comes to rest flat on the felt with one face up. Cocked against a
	// wall, leaning on a neighbour, sitting on top of one — none of those is a roll, so the throw
	// is taken again.
	//
	// Taken as a WHOLE throw rather than picking up the offending die, which is what the library's
	// own `checkForRethrow` would do. It settles every throw twice — once headless, to read the
	// faces off the dice, and then again on screen — and only the headless pass is ever offered
	// that hook. Re-throwing a die there would leave the two passes running different physics, and
	// the dice on screen would come to rest somewhere other than where the faces were read from.
	//
	// A throw is reproducible to the last decimal from its vectors alone, so one can be tried
	// headlessly instead and kept only if it lands clean. What the player sees is then a single
	// throw that happens to read, rather than a die picking itself up afterwards.

	/** How far off flat a die may rest and still read: the cosine of the angle, so 6deg. */
	const FLAT_ENOUGH = 0.9945;
	/** How high a die may rest, in its own half-widths, before it counts as on top of something. */
	const ON_THE_FELT = 1.3;
	/** Throws to try before going with the least bad of them. */
	const THROW_TRIES = 8;
	/**
	 * Launch speed as a multiple of the distance to what a die is aimed at, rather than a flat
	 * figure: every die then carries the same way whether it is crossing the tray or dropping
	 * straight into the near side of it, and the throw scales with the table.
	 */
	const THROW_SPEED = 2.4;

	// Face colours (index 0=pip1 .. 5=pip6), matching dice-box.component.ts mapping
	// 1=yellow, 2=blue, 3=white, 4=green, 5=pink, 6=red.
	const FACE_HEX = ['#F6C928', '#2D6BFF', '#FFFFFF', '#43B047', '#FF4DB8', '#E53935'];

	// --- The rattle -------------------------------------------------------------------------------
	// dice-box-threejs plays its own hit sounds off the physics: every collision hard enough to be
	// heard picks a clip at random and plays it at a volume taken from the impact. The clips it
	// wants are the upstream ones in `static/dice-box-threejs/sounds` — `surface_felt*` for the
	// tray (from `theme_surface: 'green-felt'`) and `dicehit_<material>*` for die on die. Both sets
	// have to be there before `initialize()`, which is where the library loads them, and which is
	// why `sounds` cannot be turned on later.
	//
	// The trial throws cost nothing here: the library skips the sound while `animstate` is
	// `simulate`, which is what `simulateThrow` runs the headless passes under.

	/**
	 * What the dice SOUND like they are made of, which is not what they look like.
	 *
	 * The library takes both from `theme_material`: it reads the material back off the loaded
	 * theme when it picks the hit clips, so asking for wood there would darken and roughen the
	 * dice as well as knock them together differently. The faces are the game — six flat colours
	 * on white plastic — so the look is left alone and only the clips are swapped.
	 */
	const DIE_SOUND_MATERIAL = 'wood';

	/**
	 * How loud the dice are against the rest of the table, matching `MIX` in `game/sound.ts`.
	 *
	 * Held under the chip sounds because there are so many more of them: three dice coming in over
	 * the rim is a run of hits, not the one-shot a chip landing is.
	 */
	const DICE_MIX = 0.55;

	/** The library's volume is 0-100, and is the ceiling on any one hit rather than a gain. */
	const diceVolume = () => stateSoundDerived.volumeSoundEffect() * DICE_MIX * 100;

	// Keep the dice on the same slider as everything else on the table. `volume` is read per hit,
	// so this takes effect on the next collision — including mid-roll.
	$effect(() => {
		const volume = diceVolume();
		if (box) box.volume = volume;
	});

	/**
	 * Give the dice a wooden knock while leaving them looking like plastic.
	 *
	 * `loadSounds` is the one place the material is turned into clips: it reads it off the loaded
	 * theme, keeps it on `sound_dieMaterial` for the collision handler to pick from, and loads the
	 * set that goes with it. Lending it a different material for that one call is what separates
	 * the two — the theme is already loaded and applied by then, so the swap is only ever seen by
	 * the sound, and it is put back before anything else can read it.
	 *
	 * Setting `sound_dieMaterial` afterwards instead would name a set that was never loaded, and
	 * the first die to hit another would fault in the physics callback.
	 *
	 * Must be installed BEFORE `initialize()`, which is what calls `loadSounds`.
	 */
	const installDieSound = () => {
		const loadSounds = box.loadSounds.bind(box);
		box.loadSounds = async () => {
			const texture = box.colorData?.texture;
			if (!texture) return loadSounds();
			const material = texture.material;
			texture.material = DIE_SOUND_MATERIAL;
			try {
				await loadSounds();
			} finally {
				texture.material = material;
			}
		};
	};

	/**
	 * The tray in world units: half its width and height, and how far its middle sits above the
	 * middle of the scene. Read off `.dice-tray` by `measureTray`, and the only description of the
	 * tray the physics and the throw ever work from.
	 */
	let arena = { halfX: 0, halfY: 0, centreY: 0 };

	// --- The gate -------------------------------------------------------------------------------
	// The dice come in from off the top of the table, which means coming in over the tray's north
	// wall — and a wall here is a half-space, so a die on the far side of one is shoved back rather
	// than left to fall past it. That wall is therefore taken off for the throw and brought back
	// down behind the dice, which is what "in over the rim, and never back out over it" takes. The
	// other three stand the whole time.
	//
	// It comes down as a LID, riding just above the topmost die, rather than dropping onto the rim
	// the moment they are all under it. Two things fall out of that, and both matter: it is never
	// less than a die's reach clear of anything, so it cannot come back through a die and throw it
	// out of the tray; and it only ever travels down, so a die rebounding off the far wall while
	// the others are still coming in meets it where it has got to instead of sailing out over the
	// top. Left alone it settles onto the rim, and that is the tray sealed.
	//
	// Which die is where drives it, rather than a clock: the library runs every throw twice — once
	// headless, to settle the dice and read the faces off them, and then again on screen — and the
	// two have to come out the same or the faces will not match what lands.

	/** Where the north wall is. Starts under the rim so the tray is sealed before the first roll. */
	let gateY = -Infinity;
	/** How fast the lid keeps closing on a die propping it open, per step, in die reaches. */
	const GATE_CREEP = 0.04;

	/** A die's reach from its own middle — corner to middle, so it covers any attitude. */
	const dieReach = () => box.DiceFactory.baseScale * 0.9;

	/**
	 * Whether a settled die is showing a face, flat on the felt.
	 *
	 * A d6's faces are its three axes, so how flat it lies is how nearly one of those axes points
	 * straight up — which is what catches a die cocked against a wall or leaning on a neighbour.
	 * Height catches the one that landed square but on TOP of another, which reads perfectly well
	 * and is still not a roll: `z` is a die's own half-width when it is on the felt, and a
	 * multiple of that when it is on something else.
	 */
	const readsFlat = (die: any) => {
		const { x, y, z, w } = die.body.quaternion;
		// The world-z of each of the die's three axes; the largest is whichever is nearest upright.
		const upright = Math.max(
			Math.abs(2 * (x * z - y * w)),
			Math.abs(2 * (y * z + x * w)),
			Math.abs(1 - 2 * (x * x + y * y)),
		);
		const halfWidth = (box.DiceFactory.baseScale * D6_FACE) / 2;
		return upright >= FLAT_ENOUGH && die.body.position.z <= halfWidth * ON_THE_FELT;
	};

	const makeCircularFaceImage = (hex: string): Promise<HTMLImageElement> => {
		const size = 256;
		const canvas = document.createElement('canvas');
		canvas.width = size;
		canvas.height = size;
		const ctx = canvas.getContext('2d');
		if (!ctx) return Promise.reject(new Error('Canvas 2D context not available'));

		ctx.fillStyle = '#FFFFFF';
		ctx.fillRect(0, 0, size, size);

		const radius = Math.floor(size * 0.33);
		const center = Math.floor(size / 2);
		ctx.beginPath();
		ctx.arc(center, center, radius, 0, Math.PI * 2);
		ctx.fillStyle = hex;
		ctx.fill();

		ctx.strokeStyle = 'rgba(0,0,0,0.35)';
		ctx.lineWidth = 8;
		ctx.stroke();

		ctx.strokeStyle = 'rgba(0,0,0,0.25)';
		ctx.lineWidth = 12;
		ctx.strokeRect(0, 0, size, size);

		const img = new Image();
		img.src = canvas.toDataURL('image/png');
		return new Promise((resolve, reject) => {
			img.onload = () => resolve(img);
			img.onerror = () => reject(new Error('Failed to load generated face image'));
		});
	};

	// Replace the built-in d6 number labels with six white faces, each showing a centered colour circle.
	const applyD6FaceColorPatches = async () => {
		if (!box || d6FaceLabelsApplied) return;
		const d6 = box.DiceFactory?.get?.('d6');
		if (!d6) return;

		const images: HTMLImageElement[] = [];
		for (const hex of FACE_HEX) images.push(await makeCircularFaceImage(hex));

		// dice-box-threejs expects two leading empty slots for most dice.
		d6.labels = ['', '', ...images];
		if (box.DiceFactory?.materials_cache) box.DiceFactory.materials_cache = {};
		d6FaceLabelsApplied = true;
	};

	const createDiceBox = async () => {
		const mod = await import('@3d-dice/dice-box-threejs');
		const DiceBox = mod.default;
		return new DiceBox(`#${sceneId}`, {
			// Absolute rather than document-relative: this one is handed to a third-party loader that
			// builds its own URLs from it, so it cannot be left to resolve against the page.
			assetPath: staticUrl('dice-box-threejs/'),
			sounds: true,
			volume: diceVolume(),
			theme_texture: '',
			theme_material: 'plastic',
			theme_surface: 'green-felt',
			shadows: true,
			light_intensity: 0.7,
			gravity_multiplier: 440,
			// baseScale is left at the library default and set from the tray instead — see
			// `fitDiceToTray`, which cannot run until the world has been measured.
			strength: 0.65,
			onRollComplete: () => {},
		});
	};

	/**
	 * Bring the four walls of the world in onto the tray's rim.
	 *
	 * The library already builds them as infinite half-space planes facing inwards, and rebuilds
	 * them on every resize, so this only has to move them — wrapping `makeWorldBox` rather than
	 * setting the positions once is what keeps the tray and the walls together when the viewport
	 * changes. Infinite planes are also why the dice cannot escape by bouncing high: the wall runs
	 * the full height of the world, not just the height of the rim that draws it.
	 *
	 * Must be installed BEFORE `initialize()`, which builds the world.
	 */
	const installTrayWalls = () => {
		const makeWorldBox = box.makeWorldBox.bind(box);
		box.makeWorldBox = () => {
			makeWorldBox();
			// Nothing measured yet (the world is built once during `initialize` before anything has
			// been read off the page) — leave the library's own walls up until there is a tray.
			if (!arena.halfX) return;
			const { halfX, halfY, centreY } = arena;
			// The library's "left" wall is the one at +x, and "right" the one at -x.
			box.box_body.bottomWall.position.set(0, centreY - halfY, 0);
			box.box_body.leftWall.position.set(halfX, 0, 0);
			box.box_body.rightWall.position.set(-halfX, 0, 0);
			// The north wall is the one the dice come in over, so it goes wherever the lid has got
			// to rather than straight onto the rim.
			placeGate();
		};

		// A resize re-scales the world before it rebuilds the walls, which leaves the measurement
		// they are placed from describing the old scale. Re-reading the tray straight afterwards is
		// what keeps the two on the same footing — `measureTray` puts the walls up itself, so the
		// rebuild above is left to run on whatever it has and is simply corrected here.
		const setDimensions = box.setDimensions.bind(box);
		box.setDimensions = (dimensions: any) => {
			setDimensions(dimensions);
			measureTray();
		};
	};

	/** The rim itself: where the lid comes to rest, and the tray's north wall proper. */
	const gateRim = () => arena.centreY + arena.halfY;

	/** Put the north wall wherever the lid has got to. */
	const placeGate = () => {
		const wall = box.box_body?.topWall;
		if (!wall || !arena.halfX) return;
		// Never below the rim — a resize can move the rim up from under it.
		gateY = Math.max(gateRim(), gateY);
		wall.position.set(0, gateY, 0);
	};

	/** Take the lid off, so a throw can be sent in over it. */
	const raiseGate = () => {
		// Above anything that can be thrown in, so it is out of the way without ever leaving the
		// world unbounded to the north.
		gateY = box.display.containerHeight * 3;
		placeGate();
	};

	/** Bring it down onto the topmost die, or onto the rim once they are all under it. */
	const lowerGate = () => {
		const dice = box.diceList;
		if (!dice.length || !arena.halfX) return;
		const rim = gateRim();
		const highest = Math.max(...dice.map((die: any) => die.body.position.y));
		// Ride down on the topmost die, keeping a reach clear of it so it is never come through.
		gateY = Math.min(gateY, Math.max(rim, highest + dieReach()));
		// Then keep closing regardless. Riding the dice alone leaves the lid propped open by one
		// that comes to rest against it short of the rim — inside the world, but poking out over
		// the edge that is meant to hold it. Creeping down walks that one back in instead, gently
		// enough to read as the die settling, and only ever bears on dice up at the rim: anything
		// further in is nowhere near the line the lid is on by then.
		gateY = Math.max(rim, gateY - GATE_CREEP * dieReach());
		placeGate();
	};

	/**
	 * Take the lid off for each throw, and ride it back down behind the dice.
	 *
	 * `spawnDice` is the one thing both passes of a throw start with, so it is what lifts it —
	 * and it only lifts, never lowers, because the dice are spawned one at a time and each is
	 * higher than the last. The world's own step is what brings it down, so the two passes are
	 * stepping to the same rule and settle the same way.
	 */
	const installTrayGate = () => {
		const spawnDice = box.spawnDice.bind(box);
		box.spawnDice = (vector: any, die: any = false) => {
			raiseGate();
			return spawnDice(vector, die);
		};

		const step = box.world.step.bind(box.world);
		box.world.step = (...args: unknown[]) => {
			step(...args);
			lowerGate();
		};
	};

	/**
	 * Size the dice off the tray rather than the viewport, so three of them always fit with room
	 * to scatter no matter how big the table is drawn.
	 *
	 * Measured the NARROW way: a tray that is wider than it is tall has no more room for a die
	 * than its height allows, and stretching the dice with the width would only crowd it.
	 *
	 * Both factory caches are keyed on the die type alone, so they hold geometry and materials
	 * built at the previous size and have to be dropped whenever it changes.
	 */
	const fitDiceToTray = (narrowSide: number) => {
		const factory = box.DiceFactory;
		if (!factory) return;
		const baseScale = Math.round(narrowSide / (DICE_ACROSS * D6_FACE));
		if (!baseScale || factory.baseScale === baseScale) return;
		factory.baseScale = baseScale;
		factory.geometries = {};
		factory.materials_cache = {};
	};

	/**
	 * Re-aim the library's throw, and take it again until it lands readable.
	 *
	 * Wraps `startClickThrow` (which `roll()` calls to build the per-die vectors) so the library
	 * still computes spin and axis — only the launch position and heading are replaced.
	 * `spawnDice` applies `pos`/`velocity` verbatim, so this fully determines entry.
	 *
	 * Every die starts inside the tray's footprint, which it has to: a wall is a half-space, so a
	 * die spawned on the far side of one would be shoved back in rather than fall past it.
	 */
	const installTrayThrow = () => {
		const original = box.startClickThrow.bind(box);

		/** Send one throw in off the top of the table and down into the tray. */
		const aim = (thrown: any) => {
			const vectors = thrown.vectors;
			const { halfX, halfY, centreY } = arena;
			const narrow = Math.min(halfX, halfY);
			// The side walls run the full height of the world, so they are as much in the way up
			// off the top of the table as they are down in the tray: this is the room a die
			// actually has to come in through without one of them catching it.
			const usableX = Math.max(0, halfX - dieReach());
			// Which way the fan runs, so the same three dice do not take the same three paths
			// every roll.
			const hand = Math.random() < 0.5 ? -1 : 1;
			const slop = () => (Math.random() * 2 - 1) * THROW_JITTER;

			vectors.forEach((vector: any, index: number) => {
				// -1 .. +1 across however many are rolled, so they come in abreast rather than
				// stacked, and down their own lanes.
				const lane = vectors.length > 1 ? (index / (vectors.length - 1)) * 2 - 1 : 0;
				const offset = hand * Math.max(-1, Math.min(1, lane + slop()));
				// Staggered in height rather than in y: y is pinned to whatever is just out of
				// frame, so height is what makes them arrive one after another — and the higher a
				// die is, the less of the world is in shot, so the less far out it has to start.
				const z = narrow * DROP_HEIGHT + index * DROP_STAGGER * dieReach();
				const from = { x: offset * usableX * SPAWN_SPREAD, y: offScreenNorth(z) };
				vector.pos = { ...from, z };

				// Aimed at the far half of the tray, and crossed over: a die coming in on the left
				// is thrown at the right, so the three cut across each other on the way down
				// instead of running straight down parallel lanes.
				const at = {
					x: -offset * halfX * AIM_SPREAD,
					y: centreY - halfY * (AIM_DEPTH + slop()),
				};
				const away = Math.hypot(at.x - from.x, at.y - from.y) || 1;
				const speed = away * THROW_SPEED;
				vector.velocity = {
					x: ((at.x - from.x) / away) * speed,
					y: ((at.y - from.y) / away) * speed,
					z: 0,
				};
			});
			return thrown;
		};

		/** Settle a throw headlessly, and say how many dice it left unreadable. */
		const cockedIn = (thrown: any) => {
			box.clearDice();
			for (const vector of thrown.vectors) box.spawnDice(vector);
			box.simulateThrow();
			return box.diceList.filter((die: any) => !readsFlat(die)).length;
		};

		box.startClickThrow = (notation: string) => {
			const first = original(notation);
			if (!first?.vectors?.length) return first;
			// No tray to throw into yet — a scene that has not been laid out has nothing to measure
			// one from, and re-aiming off it would only put the dice at NaN. The library's own
			// throw is a perfectly good thing to fall back on.
			if (!arena.halfX) return first;

			let best = aim(first);
			let fewest = cockedIn(best);
			// Take it again until every die reads. Each try is a fresh fan and a fresh set of
			// headings, so they are independent — and since a throw is settled from its vectors
			// alone, the one kept here is the one that plays out on screen.
			for (let tries = 1; fewest && tries < THROW_TRIES; tries++) {
				const next = aim(original(notation));
				const cocked = cockedIn(next);
				if (cocked < fewest) [best, fewest] = [next, cocked];
			}
			// Nothing of the trials left for the library to find: it settles this throw again from
			// the vectors, and expects to be starting from an empty table.
			box.clearDice();
			return best;
		};
	};

	// --- Measuring the tray ---------------------------------------------------------------------

	/**
	 * How much further out a die standing ON the tray floor is thrown than the floor itself.
	 *
	 * The camera looks straight down from `camera.position.z`, so anything a die's height off the
	 * felt is magnified by this much — about the middle of the scene, which is where the camera
	 * axis meets it. The rim is therefore drawn a little OUTSIDE the wall it represents: put the
	 * two on the same line and a die resting against the wall would hang over the edge that is
	 * holding it in.
	 */
	const dieSpread = () => {
		const cameraZ = box?.camera?.position.z;
		if (!cameraZ) return 1;
		return cameraZ / (cameraZ - box.DiceFactory.baseScale * D6_FACE);
	};

	/**
	 * How far north a die has to start to be out of frame above the table, given how high it is.
	 *
	 * At felt level the frame is `containerHeight` world units either side of the middle, but the
	 * camera is a perspective one: the higher a die is the nearer the camera it is, so the less of
	 * the world is in shot and the less far out it has to go to leave it. Reckoned off the die's
	 * leading edge rather than its middle, so the whole of it is out of sight.
	 */
	const offScreenNorth = (z: number) => {
		const nearer = box.camera.position.z / (box.camera.position.z - z);
		return (box.display.containerHeight * (1 + SPAWN_CLEAR)) / nearer + dieReach();
	};

	/**
	 * Take the tray's shape off the panel CSS drew, and stand the walls up along it.
	 *
	 * The scene's height in world units is `containerHeight` either side of the middle — that is
	 * how the library sets its camera up — which is the whole of the conversion between what is on
	 * screen and what the physics runs in.
	 *
	 * The die size is settled first, because how far the rim sits outside its wall depends on how
	 * tall a die is; sizing the dice off the drawn rim rather than the wall is a few percent out
	 * in the other direction, which no one can see and which keeps this from chasing its own tail.
	 */
	const measureTray = () => {
		if (!box?.display?.containerWidth || !trayEl) return;

		const scene = sceneEl.getBoundingClientRect();
		const rim = trayEl.getBoundingClientRect();
		if (!scene.width || !rim.width) return;
		const unitsPerPx = box.display.containerWidth / (scene.width / 2);

		// Held off mid-roll: the dice already in play were built at the old size.
		if (!rollInFlight) fitDiceToTray(Math.min(rim.width, rim.height) * unitsPerPx);

		const spread = dieSpread();
		const toWorld = (px: number) => (px * unitsPerPx) / spread;
		arena = {
			halfX: toWorld(rim.width / 2),
			halfY: toWorld(rim.height / 2),
			// Screen y runs down and the world's runs up, hence the scene's middle less the rim's.
			centreY: toWorld(scene.height / 2 - (rim.top - scene.top + rim.height / 2)),
		};
		box.makeWorldBox();
	};

	const rollColours = async (colours: Colour[]) => {
		if (!box || rollInFlight) return;
		rollInFlight = true;
		stateGame.rolling = true;
		try {
			// A resize that landed mid-roll left the dice at the size the ones in play were built
			// at, so this is where they catch up.
			measureTray();
			await applyD6FaceColorPatches();
			const pips = colours.map((colour) => COLOUR_TO_PIP[colour]);
			const notation = `3d6@${pips.join(',')}`;
			box.clearDice?.();
			await box.roll(notation);
		} catch (error) {
			console.error('[Colour Dice] dice roll failed', error);
		} finally {
			rollInFlight = false;
			stateGame.rolling = false;
		}
	};

	onMount(() => {
		let disposed = false;
		sceneEl.id = sceneId;

		// Both, because either can move without the other: the scene changes with the viewport,
		// and the tray changes shape on its own when the orientation flips.
		const observer = new ResizeObserver(() => measureTray());
		observer.observe(sceneEl);
		observer.observe(trayEl);

		(async () => {
			try {
				box = await createDiceBox();
				installTrayWalls();
				installTrayGate();
				installDieSound();
				await box.initialize();
				if (disposed) return;
				installTrayThrow();
				measureTray();
				await applyD6FaceColorPatches();
				// Dev handle for inspecting throw geometry (spawn positions, headings, walls)
				// without waiting on the physics animation. Stripped from production builds.
				if (import.meta.env.DEV) (window as any).__colourDiceBox = box;
			} catch (error) {
				console.error('[Colour Dice] DiceBox init failed', error);
			}
		})();

		return () => {
			disposed = true;
			observer.disconnect();
			box?.clearDice?.();
			box = null;
		};
	});

	context.eventEmitter.subscribeOnMount({
		diceReveal: async (emitterEvent) => {
			await rollColours(emitterEvent.colours);
		},

		diceClear: async () => {
			if (!box || diceExiting) return;
			diceExiting = true;
			await waitForTimeout(EXIT_MS);
			box?.clearDice?.();
			// Snapped back with the dice already gone, so the return trip is invisible.
			diceExiting = false;
		},
	});
</script>

<div class="dice-box">
	<!-- The rim the dice bounce off, and the one description of the tray there is: the walls in
	     the physics world are stood up along whatever this element works out to (see measureTray),
	     so its shape here settles the shape of the play area. -->
	<div bind:this={trayEl} class="dice-tray" aria-hidden="true"></div>
	<div bind:this={sceneEl} class="dice-scene" class:exiting={diceExiting}></div>
</div>

<style>
	.dice-box {
		width: 100%;
		height: 100%;
		position: relative;
		/* Contain the dim-overlay/scene z-indices below. `position: relative` alone leaves
		   `z-index: auto`, which is NOT a stacking context — the scene's `z-index: 1` would
		   then compete in the root context and paint the dice canvas over the betting panel,
		   swallowing every click on the colour boxes. */
		isolation: isolate;
		overflow: hidden;
		background-image: url('img/background.png');
		background-position: center;
		background-repeat: no-repeat;
		background-size: cover;
	}
	/* Dim the felt so the dice read against it. Sits above the background image but BELOW the
	   dice canvas, so the dice themselves stay at full brightness. */
	.dice-box::after {
		content: '';
		position: absolute;
		inset: 0;
		background: #000;
		opacity: 0.3;
		pointer-events: none;
		z-index: 0;
	}
	/* The tray the dice are played in: a lit panel inset into the dimmed felt, with a raised rim
	   round it. Sits above the dim overlay so the felt inside reads as brighter than the table,
	   and below the dice canvas so the dice are always ON it.

	   This is where the play area is DEFINED — the physics walls are stood up along whatever it
	   works out to, rather than the other way about (see `measureTray`), so the shape can be
	   settled here in the terms that actually matter: the felt the table has spare, and the panel
	   it has to sit above.

	   Height is a share of the scene's, and `top` lifts it clear of the betting panel below and
	   the HUD above; `.game` is a fixed 16:9, so those hold at any viewport. The default shape is
	   square, which is what portrait gets. */
	.dice-tray {
		position: absolute;
		top: 32.5%;
		left: 50%;
		height: 50%;
		aspect-ratio: 1;
		transform: translate(-50%, -50%);
		z-index: 1;
		pointer-events: none;
		border-radius: 1vw;
		/* Lifts the felt back out of the ::after dim, so the playing surface is the brightest part
		   of the table, with the corners falling away. */
		background:
			radial-gradient(115% 115% at 50% 35%, rgba(255, 255, 255, 0.16), rgba(255, 255, 255, 0)),
			rgba(255, 240, 210, 0.07);
		/* The rim is drawn OUTSIDE the element (spread-only shadows, no blur) rather than as a
		   border, so the element's own edge stays exactly on the wall — a border would push the
		   playing surface in by its own width and the dice would stop short of the line. */
		box-shadow:
			0 0 0 0.45vw #2b1d13,
			0 0 0 0.55vw rgba(255, 255, 255, 0.16),
			0 0 0 0.75vw rgba(0, 0, 0, 0.4),
			inset 0 0 2vw rgba(0, 0, 0, 0.55),
			inset 0 0.15vw 0.3vw rgba(0, 0, 0, 0.5),
			0 0.5vw 1.4vw rgba(0, 0, 0, 0.5);
	}
	/* Landscape has width to spare that portrait does not, so the tray takes it: squared off
	   against the betting panel below, which is the width the eye is already reading the table
	   at. `--panel-inset` is the panel's own inset, published on `.game` (see Game.svelte) so
	   this lines up with it by construction rather than by a number copied across. */
	@media (orientation: landscape) {
		.dice-tray {
			aspect-ratio: auto;
			width: calc(100% - 2 * var(--panel-inset, 12.5vw));
		}
	}
	.dice-scene {
		width: 100%;
		height: 100%;
		background: transparent;
		position: relative;
		z-index: 2;
		/* Duration mirrors EXIT_MS. The curve accelerates all the way out, so the dice leave under
		   their own weight rather than gliding off at a constant speed. */
		transition: transform 300ms cubic-bezier(0.4, 0, 0.9, 0.4);
	}
	/* Off the bottom on a clear. A full scene height carries every die past the lower edge, and
	   `.dice-box` clips there, so they are gone from view rather than faded out on the spot —
	   which is what lets the canvas be torn down without the teardown being seen.

	   No opacity here on purpose: fading would have them disappear before they had left, and the
	   point is that they leave. */
	.dice-scene.exiting {
		transform: translateY(110%);
	}
</style>
