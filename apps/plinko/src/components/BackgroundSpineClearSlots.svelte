<script lang="ts">
	import { getContextSpine } from 'pixi-svelte';

	type Props = {
		slotNames: readonly string[];
	};

	const { slotNames }: Props = $props();
	const spine = getContextSpine();

	$effect(() => {
		const clearSlots = () => {
			for (const slotName of slotNames) {
				spine.skeleton.findSlot(slotName)?.setAttachment(null);
			}
		};

		const previous = spine.beforeUpdateWorldTransforms;
		spine.beforeUpdateWorldTransforms = () => {
			previous?.();
			clearSlots();
		};

		clearSlots();

		return () => {
			spine.beforeUpdateWorldTransforms = previous;
		};
	});
</script>
