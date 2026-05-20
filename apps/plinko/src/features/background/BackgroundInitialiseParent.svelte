<script lang="ts">
	import type { Snippet } from 'svelte';

	import { createContextParent, getContextApp } from 'pixi-svelte';

	type Props = { children: Snippet };

	const props: Props = $props();
	const context = getContextApp();

	let parentContext = $state<ReturnType<typeof createContextParent> | null>(null);

	$effect(() => {
		const stage = context.stateApp.pixiApplication?.stage;
		if (!stage) {
			parentContext = null;
			return;
		}
		if (!parentContext) {
			parentContext = createContextParent(stage);
		}
	});
</script>

{#if parentContext?.parent}
	{@render props.children()}
{/if}
