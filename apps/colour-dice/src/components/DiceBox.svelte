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
	// The dice drop in from above the top edge and are thrown at the middle of the table.
	//
	// The trick is that "off-screen" and "outside the physics box" are NOT the same line. The
	// camera has a 20deg fov, so how much of the world is visible shrinks the nearer you get
	// to it: at the z the dice spawn at, the top of the frame is only ~0.88 x containerHeight,
	// while the library's wall sits further out at 0.93. Spawning at 0.90 is therefore out of
	// frame AND inside the box.
	//
	// That matters because dice-box-threejs walls the world with infinite planes. Moving the
	// ceiling out to allow a higher spawn also lets a bouncing die come to rest above the top
	// of the frame, where the player simply cannot see it. Staying inside the stock walls means
	// the library's own containment keeps every die on screen — at resting height the wall line
	// maps to 0.98 of the visible half-height, comfortably inside the frame.
	const SPAWN_Y = 0.9; // × containerHeight — just inside the 0.93 wall, above the visible edge
	const SPAWN_Z = 260; // world units toward the camera; higher = smaller visible area = more hidden
	const SPAWN_Z_STAGGER = 130; // extra height per die, so they arrive in sequence
	const SPAWN_X_SPREAD = 0.26; // × containerWidth — horizontal spread either side of centre
	// Launch speed as a multiple of the distance to the middle, rather than a fraction of the
	// library's own throw. Its boost is randomised per roll and tuned for an edge-to-edge
	// throw, which left the dice barely moving from the spawn line — deriving the speed from
	// the distance makes every roll carry the same way and scales with the viewport.
	const THROW_SPEED = 2.4;

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
				const y = containerHeight * SPAWN_Y;
				// Stagger in z, not y: y is pinned just inside the wall, so depth is what makes
				// them arrive in sequence — and the further from the desk, the more hidden.
				vector.pos = { x, y, z: SPAWN_Z + index * SPAWN_Z_STAGGER };

				// Head for the middle of the table, at a speed proportional to how far away it is.
				const distance = Math.hypot(x, y) || 1;
				const speed = distance * THROW_SPEED;
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
	.dice-scene {
		width: 100%;
		height: 100%;
		background: transparent;
		position: relative;
		z-index: 1;
	}
</style>
