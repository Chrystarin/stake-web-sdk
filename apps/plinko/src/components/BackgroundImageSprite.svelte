<script lang="ts">
	import * as PIXI from 'pixi.js';
	import { getContextParent } from 'pixi-svelte';
	import { propsSyncEffect } from 'pixi-svelte';

	import { staticUrl } from '../lib/staticUrl';

	type Props = {
		path: string;
		x: number;
		y: number;
		width: number;
		height: number;
		zIndex?: number;
	};

	const { path, ...layout }: Props = $props();
	const parentContext = getContextParent();
	const sprite = new PIXI.Sprite(PIXI.Texture.EMPTY);

	parentContext.addToParent(sprite);
	propsSyncEffect({ props: layout, target: sprite });

	const loadImageTexture = (url: string) =>
		new Promise<PIXI.Texture>((resolve, reject) => {
			const image = new Image();
			image.decoding = 'async';
			image.onload = () => resolve(PIXI.Texture.from(image));
			image.onerror = () => reject(new Error(`Failed to load background image: ${url}`));
			image.src = url;
		});

	$effect(() => {
		const url = staticUrl(path);
		let disposed = false;

		loadImageTexture(url)
			.then((texture) => {
				if (!disposed) sprite.texture = texture;
			})
			.catch((error) => {
				console.error('[BackgroundImageSprite]', error);
			});

		return () => {
			disposed = true;
		};
	});
</script>
