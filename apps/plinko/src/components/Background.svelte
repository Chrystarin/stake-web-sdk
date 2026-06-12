<script lang="ts">
	import { innerHeight, innerWidth } from 'svelte/reactivity/window';

	import { isPortraitGameLayout } from '../lib/format';
	import { staticUrl } from '../lib/staticUrl';

	const portrait = $derived.by(() => {
		innerWidth.current;
		innerHeight.current;
		return isPortraitGameLayout();
	});

	const imageSrc = $derived(
		staticUrl(portrait ? 'img/BG_portrait.jpg' : 'img/BG_landscape.jpg'),
	);
</script>

<div class="background">
	<img
		class="background__image"
		class:background__image--landscape={!portrait}
		src={imageSrc}
		alt=""
	/>
</div>

<style>
	.background {
		position: absolute;
		inset: 0;
		overflow: hidden;
		pointer-events: none;
	}

	.background__image {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: cover;
		object-position: center bottom;
	}

	.background__image--landscape {
		transform: scale(1.12);
		transform-origin: center bottom;
	}
</style>
