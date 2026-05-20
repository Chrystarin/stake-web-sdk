<script lang="ts">
	import { onDestroy } from 'svelte';
	import { EnablePixiExtension } from 'components-pixi';

	import { getContextApp } from 'pixi-svelte';

	import Background from '../../components/Background.svelte';
	import BackgroundInitialiseParent from './BackgroundInitialiseParent.svelte';
	import BackgroundPixiApplication from './BackgroundPixiApplication.svelte';
	import { loadBackgroundLandscape } from './loadBackgroundLandscape';

	type Props = {
		resizeTarget: HTMLElement;
	};

	const props: Props = $props();
	const context = getContextApp();

	let assetsReady = $state(false);
	let loadError = $state<string | undefined>(undefined);

	$effect(() => {
		const app = context.stateApp.pixiApplication;
		if (!app || assetsReady || loadError) return;

		let cancelled = false;

		void (async () => {
			try {
				await loadBackgroundLandscape(context.stateApp);
				if (!cancelled) assetsReady = true;
			} catch (error) {
				if (!cancelled) {
					console.error('[plinko background] Failed to load spine assets', error);
					loadError = error instanceof Error ? error.message : String(error);
				}
			}
		})();

		return () => {
			cancelled = true;
		};
	});

	onDestroy(() => {
		const { backgroundLandscape: _, ...rest } = context.stateApp.loadedAssets;
		context.stateApp.loadedAssets = rest;
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
