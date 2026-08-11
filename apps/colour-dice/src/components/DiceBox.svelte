<script lang="ts">
	import { onMount } from 'svelte';

	import { waitForTimeout } from 'utils-shared/wait';

	import { getContext } from '../game/context';
	import { stateGame } from '../game/stateGame.svelte';
	import { COLOUR_TO_PIP, type Colour } from '../game/constants';

	const context = getContext();

	// Clearing the board drops the dice through the tray floor rather than blinking them out: the
	// camera looks straight down, so falling away from it is a shrink towards the tray's middle.
	// The scene is only TAKEN AWAY once that has played — `clearDice` on a visible canvas pops, so
	// the drop has to finish first. Mirrors the `transition` on `.dice-scene`.
	const EXIT_MS = 420;
	let diceExiting = $state(false);

	let sceneEl: HTMLDivElement;
	let trayEl: HTMLDivElement;
	let box: any = null;
	let rollInFlight = false;
	let d6FaceLabelsApplied = false;

	const sceneId = 'colour_dice_scene';

	// --- The tray -----------------------------------------------------------------------------
	// The dice are played inside a tray in the middle of the table rather than over the whole
	// felt: they drop in from above it, bounce off its rim, and all three come to rest inside it.
	// Nothing can leave, because the four walls dice-box-threejs builds the world with are
	// infinite planes — pull them in off the frame edge onto the tray's rim and they hold the dice
	// there at any height (see `installTrayWalls`).
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
	// The dice are dropped over the tray and thrown across it, each from its own point on a ring
	// so they neither spawn stacked nor share a lane. The ring is the tray's own shape scaled
	// down, so a wide tray gets them spread along it rather than bunched in the middle.
	/** How much of the tray the ring covers. */
	const DROP_RADIUS = 0.5;
	// Heights and speeds are multiples of the tray's NARROW half, so a throw carries the same way
	// whatever shape the tray is: widening it should spread the dice out, not fling them harder.
	/** Height the first die is dropped from. */
	const DROP_HEIGHT = 1.7;
	/** Extra height per die, so they arrive one after another instead of together. */
	const DROP_HEIGHT_STAGGER = 0.75;
	/** Launch speed — enough to carry a die across the tray and come off the rim. */
	const THROW_SPEED = 3.2;
	/**
	 * How far off dead opposite each die is aimed (radians). Straight across would send all three
	 * through the middle at once; angling them means they pass each other and take the rim at a
	 * slant, which is what keeps a throw scattering rather than piling up in the centre.
	 */
	const THROW_SWIRL = 0.55;

	// Face colours (index 0=pip1 .. 5=pip6), matching dice-box.component.ts mapping
	// 1=yellow, 2=blue, 3=white, 4=green, 5=pink, 6=red.
	const FACE_HEX = ['#F6C928', '#2D6BFF', '#FFFFFF', '#43B047', '#FF4DB8', '#E53935'];

	/**
	 * The tray in world units: half its width and height, and how far its middle sits above the
	 * middle of the scene. Read off `.dice-tray` by `measureTray`, and the only description of the
	 * tray the physics and the throw ever work from.
	 */
	let arena = { halfX: 0, halfY: 0, centreY: 0 };

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
			assetPath: '/dice-box-threejs/',
			sounds: false,
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
			box.box_body.topWall.position.set(0, centreY + halfY, 0);
			box.box_body.bottomWall.position.set(0, centreY - halfY, 0);
			box.box_body.leftWall.position.set(halfX, 0, 0);
			box.box_body.rightWall.position.set(-halfX, 0, 0);
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
	 * Re-aim the library's throw: drop the dice in over the tray and send them across it.
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
		box.startClickThrow = (notation: string) => {
			const thrown = original(notation);
			const vectors = thrown?.vectors;
			if (!vectors?.length) return thrown;

			const { halfX, halfY, centreY } = arena;
			// Heights and speeds go by the narrow way, so a wide tray spreads the throw out rather
			// than making it fiercer — the ring below is what takes care of covering the width.
			const narrow = Math.min(halfX, halfY);
			// Turned by a random amount per roll, so the same three dice never repeat the same
			// three paths.
			const turn = Math.random() * Math.PI * 2;
			/** The drop ring: the tray's own shape, shrunk. */
			const ring = (angle: number) => ({
				x: Math.cos(angle) * halfX * DROP_RADIUS,
				y: centreY + Math.sin(angle) * halfY * DROP_RADIUS,
			});

			vectors.forEach((vector: any, index: number) => {
				const around = turn + (index / vectors.length) * Math.PI * 2;
				const from = ring(around);
				vector.pos = {
					...from,
					// Height, not depth into the table: the camera is straight overhead, so this is
					// how far the die falls, and staggering it is what spaces the landings out.
					z: narrow * (DROP_HEIGHT + index * DROP_HEIGHT_STAGGER),
				};

				// Aimed at the far side of the ring rather than at a fixed heading, so on a wide
				// tray the dice are thrown ALONG it and cover the extra width.
				const at = ring(around + Math.PI + THROW_SWIRL);
				const away = Math.hypot(at.x - from.x, at.y - from.y) || 1;
				const speed = narrow * THROW_SPEED;
				vector.velocity = {
					x: ((at.x - from.x) / away) * speed,
					y: ((at.y - from.y) / away) * speed,
					z: 0,
				};
			});
			return thrown;
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
		background-image: url('/img/background.png');
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
		/* Duration mirrors EXIT_MS. `ease-in` gives the exit some weight — the dice drop away
		   rather than fading on the spot. */
		transition:
			transform 420ms cubic-bezier(0.5, 0, 0.75, 0.3),
			opacity 420ms ease-in;
	}
	/* Through the floor of the tray on a clear. The camera is straight overhead, so falling away
	   from it is a shrink — which is why this is a scale rather than a slide: the dice drop out of
	   the tray instead of sliding over the rim that is meant to hold them.

	   Scaled about the tray's middle, not the scene's, so they collapse into the tray. Kept on the
	   same `32.5%` as `.dice-tray`'s `top` — the two are the same line. */
	.dice-scene.exiting {
		transform-origin: 50% 32.5%;
		transform: scale(0.55);
		opacity: 0;
	}
</style>
