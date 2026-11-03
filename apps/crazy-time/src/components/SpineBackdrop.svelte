<script lang="ts">
	/**
	 * An animated backdrop (lib/spine/backdropScenes.ts) over its own still.
	 *
	 * The still — the artist's guide composite of the same scene — is painted first, from the preload's
	 * resident copy, and is what shows while the canvas comes up, on the reduced drawing budget
	 * (lib/deviceTier.svelte.ts, `lite`, where no canvas is made at all) and whenever the GPU takes the
	 * canvas away. The canvas fades in over it once its first frame is painted, so the swap is the same
	 * picture starting to move.
	 *
	 * A new `scene` (the device turned) tears the canvas down and builds the other cut; a lost WebGL
	 * context does the same after a pause, a few times at most before the still is left for good.
	 */
	import { onDestroy, untrack } from 'svelte';

	import { device } from '../lib/deviceTier.svelte';
	import { staticCssUrl } from '../lib/staticUrl';
	import { SceneSpineRenderer } from '../lib/spine/SceneSpineRenderer';
	import { SCENE_STILLS, type SceneKey } from '../lib/spine/backdropScenes';

	type Props = {
		scene: SceneKey;
		/** Hold the animation on its current frame — the scene is covered. */
		paused?: boolean;
	};
	let { scene, paused = false }: Props = $props();

	let host = $state<HTMLDivElement>();
	let ready = $state(false);
	let renderer: SceneSpineRenderer | undefined;
	let rebuilds = 0;
	let rebuildTimer: ReturnType<typeof setTimeout> | undefined;
	const MAX_REBUILDS = 3;
	const REBUILD_DELAY_MS = 1500;

	const teardown = () => {
		clearTimeout(rebuildTimer);
		renderer?.destroy();
		renderer = undefined;
		ready = false;
	};

	const build = (key: SceneKey, el: HTMLElement) => {
		const made = new SceneSpineRenderer(el, {
			onReady: () => {
				if (renderer === made) ready = true;
			},
			onLost: () => {
				if (renderer !== made) return;
				teardown();
				if (rebuilds >= MAX_REBUILDS) return;
				rebuilds += 1;
				rebuildTimer = setTimeout(() => {
					if (!renderer && host) build(scene, host);
				}, REBUILD_DELAY_MS);
			},
		});
		renderer = made;
		// Untracked: the build effect must rerun on a new scene, not on every pause.
		made.setPaused(untrack(() => paused));
		void made.init(key);
	};

	$effect(() => {
		const key = scene;
		const el = host;
		if (!el || device.tier === 'lite') return;
		build(key, el);
		return teardown;
	});

	$effect(() => {
		renderer?.setPaused(paused);
	});

	onDestroy(teardown);

	/** The sea's knock as a bonus room's icon slams home (see SceneSpineRenderer.lurch). */
	export const lurch = () => renderer?.lurch();
</script>

<div class="backdrop" style="--still:{staticCssUrl(SCENE_STILLS[scene])}">
	<div class="canvas" class:ready bind:this={host}></div>
</div>

<style>
	.backdrop {
		position: absolute;
		inset: 0;
		overflow: hidden;
		pointer-events: none;
		background: var(--still) no-repeat center / cover;
		background-color: #0b1420;
	}

	.canvas {
		position: absolute;
		inset: 0;
		opacity: 0;
		transition: opacity 400ms ease-out;
	}

	.canvas.ready {
		opacity: 1;
	}
</style>
