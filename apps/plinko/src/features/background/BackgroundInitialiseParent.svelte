<script lang="ts">
	import type { Snippet } from 'svelte';

	import { getContextApp } from 'pixi-svelte';

	import BackgroundParentBridge from './BackgroundParentBridge.svelte';

	type Props = { children: Snippet };

	const props: Props = $props();
	const context = getContextApp();

	const stage = $derived(context.stateApp.pixiApplication?.stage);
</script>

{#if stage}
	<BackgroundParentBridge {stage}>
		{@render props.children()}
	</BackgroundParentBridge>
{/if}
