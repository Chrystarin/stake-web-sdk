import { stateGame } from './stateGame.svelte';

/**
 * Network connectivity watcher.
 *
 * A Plinko bonus round plays its free balls from the book outcomes already fetched at bet time — there
 * is NO network round-trip while the balls drop. So a dropped connection stays invisible until the
 * round's `/wallet/end-round` settlement finally fails with a generic error. This module surfaces the
 * loss immediately: `stateGame.isOffline` drives the blocking "No Internet Connection" overlay
 * (NetworkStatus.svelte) and gates Play / bonus-ball drops so gameplay is suspended at once.
 */

/** True while the browser reports no connection (or the overlay is up). */
export function isPlinkoOffline(): boolean {
	return stateGame.isOffline;
}

/**
 * Install `online`/`offline` listeners and seed the current state. Returns a cleanup function.
 * No-op (and returns a no-op cleanup) outside the browser.
 */
export function installConnectionWatcher(): () => void {
	if (typeof window === 'undefined' || typeof navigator === 'undefined') {
		return () => {};
	}
	stateGame.isOffline = navigator.onLine === false;
	const onOnline = () => {
		stateGame.isOffline = false;
	};
	const onOffline = () => {
		stateGame.isOffline = true;
	};
	window.addEventListener('online', onOnline);
	window.addEventListener('offline', onOffline);
	return () => {
		window.removeEventListener('online', onOnline);
		window.removeEventListener('offline', onOffline);
	};
}
