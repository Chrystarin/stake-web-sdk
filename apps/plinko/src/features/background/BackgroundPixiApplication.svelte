<script lang="ts">
	import * as PIXI from 'pixi.js';
	import { onMount, onDestroy, type Snippet } from 'svelte';
	import { devicePixelRatio } from 'svelte/reactivity/window';

	import { getContextApp } from 'pixi-svelte';

	type Props = {
		children: Snippet;
		resizeTarget?: HTMLElement;
	};

	const props: Props = $props();
	const context = getContextApp();

	let wrap: HTMLDivElement;
	let initialised = $state(false);

	const initPixi = async (
		resizeTarget: HTMLElement | Window,
		preference: 'webgpu' | 'webgl',
	) => {
		const application = new PIXI.Application<PIXI.Renderer<HTMLCanvasElement>>();
		await application.init({
			autoDensity: true,
			backgroundAlpha: 0,
			multiView: false,
			antialias: true,
			clearBeforeRender: true,
			preference,
			powerPreference: 'high-performance',
			resolution: devicePixelRatio.current,
			resizeTo: resizeTarget,
		});

		application.stage.sortableChildren = true;
		application.renderer.events.autoPreventDefault = false;
		application.renderer.canvas.style.touchAction = 'auto';
		return application;
	};

	const initialiseApplication = async () => {
		const resizeTarget = props.resizeTarget ?? window;
		let application: PIXI.Application<PIXI.Renderer<HTMLCanvasElement>>;

		try {
			application = await initPixi(resizeTarget, 'webgpu');
		} catch (webgpuError) {
			console.warn('[plinko background] WebGPU init failed, falling back to WebGL', webgpuError);
			application = await initPixi(resizeTarget, 'webgl');
		}

		context.stateApp.pixiApplication = application;
		wrap.appendChild(application.canvas);
	};

	$effect(() => {
		const app = context.stateApp.pixiApplication;
		const target = props.resizeTarget;
		if (!app || !target) return;
		app.resizeTo = target;
		app.resize();
	});

	onMount(async () => {
		try {
			if (!initialised) await initialiseApplication();
			initialised = true;
		} catch (error) {
			console.error('[plinko background] Pixi init failed', error);
		}
	});

	onDestroy(() => {
		if (context.stateApp.pixiApplication) {
			context.stateApp.pixiApplication.destroy(true);
			context.stateApp.pixiApplication = undefined;
		}
	});
</script>

<div class="background-pixi-wrap" bind:this={wrap}>
	{#if initialised}
		{@render props.children()}
	{/if}
</div>

<style>
	.background-pixi-wrap {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		overflow: hidden;
	}

	.background-pixi-wrap :global(canvas) {
		display: block;
		width: 100%;
		height: 100%;
	}
</style>
