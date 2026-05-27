<script lang="ts">
	import { getContextApp } from 'pixi-svelte';

	type Props = {
		host: HTMLElement;
	};

	const { host }: Props = $props();
	const context = getContextApp();

	$effect(() => {
		const app = context.stateApp.pixiApplication;
		if (!app) return;

		app.resizeTo = host;

		return () => {
			app.resizeTo = window;
		};
	});
</script>
