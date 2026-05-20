<script lang="ts">
	import * as PIXI from 'pixi.js';
	import * as SPINE_PIXI from '@esotericsoftware/spine-pixi-v8';
	import '@esotericsoftware/spine-pixi-v8';

	import { onDestroy, onMount } from 'svelte';
	import { devicePixelRatio } from 'svelte/reactivity/window';

	import { BACKGROUND_LANDSCAPE_IMAGE } from '../../game/assets';
	import { staticUrl } from '../../lib/staticUrl';
	import { fetchBackgroundLandscapeSkeletonData } from './fetchBackgroundLandscapeSkeletonData';
	import { fitSpineCover } from './fitSpineCover';

	type Props = {
		host: HTMLElement;
	};

	const props: Props = $props();

	let application: PIXI.Application<PIXI.Renderer<HTMLCanvasElement>> | undefined;
	let spine: SPINE_PIXI.Spine | undefined;
	let backgroundSprite: PIXI.Sprite | undefined;
	let resizeObserver: ResizeObserver | undefined;
	let canvasEl: HTMLCanvasElement | undefined;

	/** Survives Svelte strict-mode remount without cancelling the active run. */
	let runGeneration = 0;

	const layoutBackgroundSprite = (
		sprite: PIXI.Sprite,
		texture: PIXI.Texture,
		viewportWidth: number,
		viewportHeight: number,
	) => {
		const scale = Math.max(viewportWidth / texture.width, viewportHeight / texture.height) * 1.05;
		sprite.scale.set(scale);
		sprite.anchor.set(0.5, 0);
		sprite.position.set(viewportWidth / 2, 0);
	};

	const relayout = () => {
		if (!application) return;
		const w = application.renderer.width;
		const h = application.renderer.height;
		if (w <= 0 || h <= 0) return;
		if (backgroundSprite?.texture) {
			layoutBackgroundSprite(backgroundSprite, backgroundSprite.texture, w, h);
		}
		if (spine) fitSpineCover(spine, w, h);
	};

	const waitForHostSize = (host: HTMLElement) =>
		new Promise<void>((resolve) => {
			if (host.clientWidth > 0 && host.clientHeight > 0) {
				resolve();
				return;
			}
			const observer = new ResizeObserver(() => {
				if (host.clientWidth > 0 && host.clientHeight > 0) {
					observer.disconnect();
					resolve();
				}
			});
			observer.observe(host);
		});

	const initPixi = async (host: HTMLElement) => {
		const app = new PIXI.Application<PIXI.Renderer<HTMLCanvasElement>>();
		// WebGL only — WebGPU init can hang indefinitely on some drivers (no error, no console).
		await app.init({
			autoDensity: true,
			backgroundAlpha: 0,
			antialias: true,
			clearBeforeRender: true,
			multiView: false,
			preference: 'webgl',
			powerPreference: 'high-performance',
			resolution: devicePixelRatio.current ?? 1,
			resizeTo: host,
		});

		app.stage.sortableChildren = true;
		app.renderer.events.autoPreventDefault = false;

		const canvas = app.canvas;
		canvas.style.display = 'block';
		canvas.style.position = 'absolute';
		canvas.style.inset = '0';
		canvas.style.width = '100%';
		canvas.style.height = '100%';
		canvas.style.pointerEvents = 'none';

		return app;
	};

	onMount(() => {
		const host = props.host;
		const generation = ++runGeneration;

		const run = async () => {
			try {
				await waitForHostSize(host);
				if (generation !== runGeneration) return;

				const app = await initPixi(host);
				if (generation !== runGeneration) {
					app.destroy(true);
					return;
				}

				const [skeletonData, bgTexture] = await Promise.all([
					fetchBackgroundLandscapeSkeletonData(),
					PIXI.Assets.load(staticUrl(BACKGROUND_LANDSCAPE_IMAGE)),
				]);
				if (generation !== runGeneration) {
					app.destroy(true);
					return;
				}

				const bgSprite = new PIXI.Sprite(bgTexture);
				bgSprite.zIndex = 0;

				const spineInstance = new SPINE_PIXI.Spine(skeletonData);
				spineInstance.autoUpdate = true;
				spineInstance.zIndex = 1;
				spineInstance.state.setAnimation(0, 'animation', true);

				app.stage.addChild(bgSprite, spineInstance);
				backgroundSprite = bgSprite;
				spine = spineInstance;

				const wrapper = document.createElement('div');
				wrapper.className = 'animated-landscape-canvas-wrap';
				wrapper.appendChild(app.canvas);
				host.appendChild(wrapper);

				application = app;
				canvasEl = app.canvas;

				app.resize();
				relayout();

				resizeObserver = new ResizeObserver(() => {
					app.resize();
					relayout();
				});
				resizeObserver.observe(host);
			} catch (error) {
				if (generation !== runGeneration) return;
				console.error('[plinko background] Failed to start animated background', error);
			}
		};

		void run();

		return () => {
			runGeneration += 1;
		};
	});

	onDestroy(() => {
		runGeneration += 1;
		resizeObserver?.disconnect();
		resizeObserver = undefined;

		if (application) {
			if (backgroundSprite) {
				application.stage.removeChild(backgroundSprite);
				backgroundSprite.destroy();
				backgroundSprite = undefined;
			}
			if (spine) {
				application.stage.removeChild(spine);
				spine.destroy();
				spine = undefined;
			}
			application.destroy(true);
			application = undefined;
		}

		canvasEl?.parentElement?.remove();
		canvasEl = undefined;
	});
</script>

<style>
	:global(.animated-landscape-canvas-wrap) {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		overflow: hidden;
		pointer-events: none;
	}
</style>
