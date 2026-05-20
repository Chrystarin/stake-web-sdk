<script lang="ts">
	import type { Snippet } from 'svelte';
	import type * as PIXI from 'pixi.js';

	import { createContextParent } from 'pixi-svelte';

	type Props = {
		stage: PIXI.Container;
		children: Snippet;
	};

	const props: Props = $props();

	const parentContext = createContextParent(props.stage);
</script>

{#if parentContext.parent}
	{@render props.children()}
{/if}
