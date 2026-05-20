<script lang="ts">
	import { onMount, onDestroy, type Snippet } from 'svelte';
	import { EnablePixiExtension } from 'components-pixi';

	import { getContextApp } from 'pixi-svelte';

	import Background from '../../components/Background.svelte';
	import BackgroundInitialiseParent from './BackgroundInitialiseParent.svelte';
	import BackgroundPixiApplication from './BackgroundPixiApplication.svelte';
	import { loadBackgroundLandscape } from './loadBackgroundLandscape';

	type Props = {
		resizeTarget?: HTMLElement;
	};

	const props: Props = $props();
	const context = getContextApp();

	let assetsReady = $state(false);
	let loadError = $state<string | undefined>(undefined);

	onMount(async () => {
		try {
			await loadBackgroundLandscape(context.stateApp);
			assetsReady = true;
		} catch (error) {
			console.error('[plinko background] Failed to load spine assets', error);
			loadError = error instanceof Error ? error.message : String(error);
		}
	});

	onDestroy(() => {
		context.stateApp.loadedAssets = {};
		context.stateApp.loaded = false;
	});
</script>

<BackgroundPixiApplication resizeTarget={props.resizeTarget}>
	<BackgroundInitialiseParent>
		<EnablePixiExtension />
		{#if assetsReady}
			<Background />
		{:else if loadError}
			<!-- Spine failed; solid fill is handled by BackgroundPixiApplication canvas clear + body bg -->
		{/if}
	</BackgroundInitialiseParent>
</BackgroundPixiApplication>
