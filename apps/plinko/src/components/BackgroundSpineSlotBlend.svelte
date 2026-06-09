<script lang="ts">
	import { getContextSpine } from 'pixi-svelte';

	type Props = {
		slotNames: readonly string[];
		/** Spine blend mode id (1 = additive). */
		blendMode: number;
	};

	const { slotNames, blendMode }: Props = $props();
	const spine = getContextSpine();

	$effect(() => {
		const applyBlend = () => {
			for (const slotName of slotNames) {
				const slot = spine.skeleton.findSlot(slotName);
				if (slot) slot.data.blendMode = blendMode;
			}
		};

		const previous = spine.beforeUpdateWorldTransforms;
		spine.beforeUpdateWorldTransforms = () => {
			previous?.();
			applyBlend();
		};

		applyBlend();

		return () => {
			spine.beforeUpdateWorldTransforms = previous;
		};
	});
</script>
