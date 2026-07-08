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
				await applyD6FaceColorPatches();
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
