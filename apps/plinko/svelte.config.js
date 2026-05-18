// @ts-ignore
import config from 'config-svelte';

/** @type {import('@sveltejs/kit').Config} */
export default {
	...config(),
	kit: {
		...config().kit,
		// Stake Engine serves the game from a CDN subpath; relative asset URLs avoid 404s.
		paths: {
			relative: true,
		},
	},
};
