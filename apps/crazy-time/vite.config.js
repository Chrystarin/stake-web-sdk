// @ts-ignore
import config from 'config-vite';
import { mergeConfig } from 'vite';

// The Spine runtime is set up the way the Plinko app has it: one copy of each package, and
// spine-core left out of the dependency pre-bundle (the Treasure Chest room's dragon).
export default () =>
	mergeConfig(config(), {
		resolve: {
			dedupe: ['@esotericsoftware/spine-core', '@esotericsoftware/spine-pixi-v8'],
		},
		optimizeDeps: {
			exclude: ['@esotericsoftware/spine-core'],
		},
	});
