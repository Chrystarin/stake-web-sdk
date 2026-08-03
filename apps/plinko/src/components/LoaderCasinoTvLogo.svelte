<script lang="ts">
	import { onMount } from 'svelte';
	import { fade } from 'svelte/transition';

	import { waitForTimeout } from 'utils-shared/wait';

	import { SpineBackgroundRenderer } from '../lib/spine/SpineBackgroundRenderer';
	import {
		CASINO_TV_LOGO_BACKDROP,
		CASINO_TV_LOGO_DURATION_MS,
		CASINO_TV_LOGO_HOLD_SECONDS,
		CASINO_TV_LOGO_PULSE,
		getCasinoTvLogoAsset,
	} from '../lib/spine/casinoTvLogoAsset';
	import {
		preloadAllGameAssets,
		preloadPostRevealAssets,
		watchForUnpreloadedAssets,
	} from '../lib/preloadAssets';
	import { stateGame } from '../game/stateGame.svelte';

	/** Fade-out duration of the splash overlay (ms). Kept in sync with the `fade` transition below. */
	const FADE_OUT_MS = 400;

	type Props = {
		oncomplete?: () => void;
	};

	const props: Props = $props();

	let loading = $state(true);
	let host: HTMLDivElement;

	let renderer: SpineBackgroundRenderer | undefined;
	let disposed = false;
	let hiddenDriver: ReturnType<typeof setInterval> | undefined;

	/**
	 * Tear down the Pixi renderer and release the splash atlas (tens of MB of GPU textures) so it
	 * doesn't linger for the whole session and slow down the game's ball rendering.
	 *
	 * Deferred to just AFTER the fade-out (see `finishLoader`) so the logo fades out with the backdrop
	 * instead of popping out the instant the canvas is destroyed. A fallback timer + the onMount
	 * cleanup both call this, so a backgrounded tab (whose fade transition is paused) can't keep the
	 * heavy renderer alive indefinitely — whichever path fires first wins (idempotent via `disposed`).
	 */
	function disposeRenderer() {
		if (disposed) return;
		disposed = true;
		if (hiddenDriver) clearInterval(hiddenDriver);
		hiddenDriver = undefined;
		renderer?.destroy({ releaseAssets: true });
		renderer = undefined;
	}

	/**
	 * While the tab is visible, Pixi's shared ticker (rAF) animates the spine. When the tab is
	 * backgrounded or streamed, rAF is throttled/paused and the canvas would freeze on black — so
	 * we drive the animation off a timer instead (the old GIF loader painted without rAF, so this
	 * keeps parity). Only advances while hidden; visible frames are left to rAF to avoid double-stepping.
	 */
	function startHiddenDriver() {
		let lastTs = performance.now();
		hiddenDriver = setInterval(() => {
			const now = performance.now();
			const dt = Math.min((now - lastTs) / 1000, 0.25);
			lastTs = now;
			if (document.hidden) renderer?.advanceFrame(dt);
		}, 50);
	}

	function finishLoader() {
		// Everything in the manifest has settled by here, so the game is revealed fully loaded.
		loading = false;
		stateGame.introLoaderComplete = true;
		props.oncomplete?.();
		// The only things left outside the blocking pass: the opposite orientation's background files
		// (see preloadPostRevealAssets), plus a DEV alarm for anything the manifest is missing.
		void preloadPostRevealAssets();
		watchForUnpreloadedAssets();
		// Keep the logo canvas painted through the fade-out, then release it. Fallback timer only —
		// the onMount cleanup also disposes, so a paused/backgrounded fade can't leak the renderer.
		setTimeout(disposeRenderer, FADE_OUT_MS + 100);
	}

	/**
	 * Resolve once the intro spine's OWN track has reached `seconds`, not once that much wall-clock has
	 * passed. The two diverge by design: `catchUpMinFps` clamps how far a stalled frame may advance, so
	 * a busy preload makes the animation lag real time rather than skip — and a wall-clock wait would
	 * then dismiss the splash mid-fade.
	 *
	 * Polled on a timer rather than `requestAnimationFrame`: rAF is frozen in a backgrounded tab, which
	 * is exactly the case `startHiddenDriver` exists to keep animating, so a rAF poll would strand the
	 * splash there forever. Resolves immediately if the renderer is gone, so teardown can't hang it.
	 */
	function waitForAnimationTime(seconds: number): Promise<void> {
		return new Promise((resolve) => {
			const timer = setInterval(() => {
				if (!disposed && (renderer?.getAnimationTime() ?? Number.POSITIVE_INFINITY) < seconds) {
					return;
				}
				clearInterval(timer);
				resolve();
			}, 50);
		});
	}

	onMount(() => {
		renderer = new SpineBackgroundRenderer(host);

		// The asset preload is kicked off only AFTER the intro spine has loaded + started rendering —
		// not at mount — so its parallel requests + decodes don't compete with the spine's own atlas
		// download/upload during the opening frames (which was skipping the animation). It always
		// resolves (failures swallowed + timeout cap), so it can't trap the player on the splash.
		let preloadPromise: Promise<void> | undefined;
		const startPreload = () => (preloadPromise ??= preloadAllGameAssets());

		void renderer
			.init(getCasinoTvLogoAsset())
			.then(async () => {
				startHiddenDriver();
				// Let the logo paint a couple of clean opening frames, then begin the preload.
				await waitForTimeout(250);
				const preload = startPreload();
				let preloadSettled = false;
				void preload.then(() => {
					preloadSettled = true;
				});

				// Play the reveal, then — if the assets aren't in yet — hold the logo on a slow breath
				// rather than letting it dissolve into an empty screen while the player waits.
				await waitForAnimationTime(CASINO_TV_LOGO_HOLD_SECONDS);
				if (disposed) return;
				if (!preloadSettled) {
					renderer?.setAnimationHold(CASINO_TV_LOGO_PULSE);
					await preload;
					if (disposed) return;
					// Released mid-breath, so the animation carries on from wherever the swell had got to
					// and eases into the fade-out — no snap back to a fixed frame.
					renderer?.setAnimationHold(undefined);
				}

				// Assets are in: let the fade-out play out in full, then reveal the game.
				await waitForAnimationTime(CASINO_TV_LOGO_DURATION_MS / 1000);
				if (disposed) return;
				finishLoader();
			})
			.catch((error) => {
				// Never let a spine failure trap the player on the splash screen — but still wait for
				// assets (capped) so we don't reveal a half-loaded game.
				console.error('[LoaderCasinoTvLogo] failed to render intro spine', error);
				void startPreload().finally(() => {
					if (disposed) return;
					finishLoader();
				});
			});

		return () => disposeRenderer();
	});
</script>

{#if loading}
	<div
		class="casino-tv-logo-loader"
		style="background-image: url({CASINO_TV_LOGO_BACKDROP});"
		transition:fade={{ duration: FADE_OUT_MS }}
	>
		<div class="casino-tv-logo-stage" bind:this={host}></div>
	</div>
{/if}

<style lang="scss">
	.casino-tv-logo-loader {
		position: absolute;
		inset: 0;
		z-index: 999;
		overflow: hidden;
		background-color: #000;
		background-repeat: no-repeat;
		background-position: center;
		background-size: cover;
	}

	.casino-tv-logo-stage {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
	}
</style>
