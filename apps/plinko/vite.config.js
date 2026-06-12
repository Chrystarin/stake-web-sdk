// @ts-ignore
import config from 'config-vite';
import { mergeConfig } from 'vite';

export default () =>
	mergeConfig(config(), {
		resolve: {
			dedupe: ['@esotericsoftware/spine-core'],
		},
		optimizeDeps: {
			exclude: ['@esotericsoftware/spine-core'],
		},
	});
