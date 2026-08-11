<script lang="ts">
	import { onMount } from 'svelte';

	import { getContext } from '../game/context';
	import { stateGame } from '../game/stateGame.svelte';
	import { COLOUR_TO_PIP, type Colour } from '../game/constants';

	const context = getContext();

	let sceneEl: HTMLDivElement;
	let box: any = null;
	let rollInFlight = false;
	let d6FaceLabelsApplied = false;

	const sceneId = 'colour_dice_scene';

	// --- Throw geometry -------------------------------------------------------------------
	// The dice enter from above the top edge and are thrown at the middle of the table.
	//
	// World units: `display.containerHeight` is HALF the visible height, so y = +containerHeight
	// is the top edge of the frame and anything beyond that is off-screen. (Dice spawn at
	// z 200-400, nearer the camera than the z=0 desk, so the visible extent there is smaller
	// still — the spawn is comfortably out of frame.)
	//
	// dice-box-threejs walls the world at ±containerHeight * 0.93, and those are infinite
	// planes: a die spawned beyond one is on the wrong side and never enters play. So the top
	// wall has to be pushed out past the spawn line — see `raiseTopWall`.
	const SPAWN_Y = 1.35; // × containerHeight — first die's spawn height (top edge is 1.0)
	const SPAWN_STAGGER = 0.12; // × containerHeight — extra height per die, so they arrive in sequence
	const SPAWN_CEILING = 1.9; // × containerHeight — relocated top wall; must clear every spawn
	const SPAWN_X_SPREAD = 0.3; // × containerWidth — horizontal spread either side of centre
	const THROW_SPEED = 0.7; // fraction of the library's own throw speed (top→centre is a shorter path)

	// Face colours (index 0=pip1 .. 5=pip6), matching dice-box.component.ts mapping
	// 1=yellow, 2=blue, 3=white, 4=green, 5=pink, 6=red.
	const FACE_HEX = ['#F6C928', '#2D6BFF', '#FFFFFF', '#43B047', '#FF4DB8', '#E53935'];

	const getResponsiveBaseScale = () => {
		const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 1366;
		const isMobile = viewportWidth <= 768;
		return Math.round((viewportWidth / 100) * (isMobile ? 25 : 15));
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

	const createDiceBox = async (baseScale: number) => {
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
			baseScale,
			strength: 0.65,
			onRollComplete: () => {},
		});
	};

	/**
	 * Move the physics ceiling above the spawn line.
	 *
	 * Re-applied on every roll rather than once at init: `setDimensions` rebuilds the world box
	 * on window resize, which would put the wall back at 0.93 and trap the dice outside it.
	 */
	const raiseTopWall = () => {
		const topWall = box?.box_body?.topWall;
		if (!topWall) return;
		topWall.position.set(0, box.display.containerHeight * SPAWN_CEILING, 0);
	};

	/**
	 * Re-aim the library's throw: spawn the dice off-screen above the top edge, spread around
	 * the centre line, and send them at the middle of the table.
	 *
	 * Wraps `startClickThrow` (which `roll()` calls to build the per-die vectors) so the
	 * library still computes spin, axis and speed — only the launch position and heading are
	 * replaced. `spawnDice` applies `pos`/`velocity` verbatim, so this fully determines entry.
	 */
	const installTopThrow = () => {
		const original = box.startClickThrow.bind(box);
		box.startClickThrow = (notation: string) => {
			const thrown = original(notation);
			const vectors = thrown?.vectors;
			if (!vectors?.length) return thrown;

			const { containerWidth, containerHeight } = box.display;
			vectors.forEach((vector: any, index: number) => {
				// Fan the dice across the centre line so they neither spawn stacked nor all
				// funnel down the exact same path: -1 .. +1 across however many are rolled.
				const offset = vectors.length > 1 ? (index / (vectors.length - 1)) * 2 - 1 : 0;
				const x = offset * containerWidth * SPAWN_X_SPREAD;
				const y = containerHeight * (SPAWN_Y + index * SPAWN_STAGGER);
				vector.pos = { x, y, z: vector.pos.z };

				// Head for the middle of the table. Magnitude is taken from the library's own
				// throw so the `strength` option still governs how hard they are thrown.
				const speed = Math.hypot(vector.velocity.x, vector.velocity.y) * THROW_SPEED;
				const distance = Math.hypot(x, y) || 1;
				vector.velocity = {
					x: (-x / distance) * speed,
					y: (-y / distance) * speed,
					z: vector.velocity.z,
				};
			});
			return thrown;
		};
	};

	const rollColours = async (colours: Colour[]) => {
		if (!box || rollInFlight) return;
		rollInFlight = true;
		stateGame.rolling = true;
		try {
			await applyD6FaceColorPatches();
			const pips = colours.map((colour) => COLOUR_TO_PIP[colour]);
			const notation = `3d6@${pips.join(',')}`;
			box.clearDice?.();
			raiseTopWall();
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

		(async () => {
			try {
				box = await createDiceBox(getResponsiveBaseScale());
				await box.initialize();
				if (disposed) return;
				installTopThrow();
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
			box?.clearDice?.();
			box = null;
		};
	});

	context.eventEmitter.subscribeOnMount({
		diceReveal: async (emitterEvent) => {
			await rollColours(emitterEvent.colours);
		},
	});
</script>

<div class="dice-box">
	<div bind:this={sceneEl} class="dice-scene"></div>
</div>

<style>
	.dice-box {
		width: 100%;
		height: 100%;
		position: relative;
		overflow: hidden;
		background-image: url('/img/background.png');
		background-position: center;
		background-repeat: no-repeat;
		background-size: cover;
	}
	.dice-scene {
		width: 100%;
		height: 100%;
		background: transparent;
	}
</style>
