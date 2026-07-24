<script lang="ts">
	import { onMount } from 'svelte';
	import { fade } from 'svelte/transition';

	import { waitForTimeout } from 'utils-shared/wait';

	import { SpineBackgroundRenderer } from '../lib/spine/SpineBackgroundRenderer';
	import {
		CASINO_TV_LOGO_BACKDROP,
		CASINO_TV_LOGO_DURATION_MS,
		getCasinoTvLogoAsset,
	} from '../lib/spine/casinoTvLogoAsset';
	import { preloadCriticalAssets, preloadDeferredAssets } from '../lib/preloadAssets';
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
		// Reveal the game immediately and start warming the heavy feature art in the background.
		loading = false;
		stateGame.introLoaderComplete = true;
		props.oncomplete?.();
		void preloadDeferredAssets();
		// Keep the logo canvas painted through the fade-out, then release it. Fallback timer only —
		// the onMount cleanup also disposes, so a paused/backgrounded fade can't leak the renderer.
		setTimeout(disposeRenderer, FADE_OUT_MS + 100);
	}

	onMount(() => {
		renderer = new SpineBackgroundRenderer(host);

		// The first-view image/font preload is kicked off only AFTER the intro spine has loaded + started
		// rendering — not at mount — so its ~50 parallel image requests + decodes don't compete with the
		// spine's own atlas download/upload during the opening frames (which was skipping the animation).
		// Heavy feature art is loaded later still (finishLoader → preloadDeferredAssets). Both always
		// resolve (failures swallowed + timeout cap), so neither can trap the player on the splash.
		let preloadPromise: Promise<void> | undefined;
		const startPreload = () => (preloadPromise ??= preloadCriticalAssets());

		void renderer
			.init(getCasinoTvLogoAsset())
			.then(async () => {
				startHiddenDriver();
				// Let the logo paint a couple of clean opening frames, then begin the first-view preload.
				await waitForTimeout(250);
				const preload = startPreload();
				// Hold the splash until BOTH the logo has played its minimum duration AND the first-view
				// assets have finished preloading — whichever takes longer.
				await Promise.all([waitForTimeout(CASINO_TV_LOGO_DURATION_MS - 250), preload]);
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
