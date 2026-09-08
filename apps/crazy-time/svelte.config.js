// @ts-ignore
import config from 'config-svelte';

/** @type {import('@sveltejs/kit').Config} */
export default {
	...config(),
	kit: {
		...config().kit,
		// Stake Engine serves the game from a CDN subpath — `/<game>/v<n>/`, and the version moves
		// with every upload — so nothing may be addressed from the domain root. Relative asset URLs
		// resolve against whatever path the build is actually sitting at. See src/lib/staticUrl.ts
		// for the runtime half of this.
		paths: {
			relative: true,
		},
	},
};
