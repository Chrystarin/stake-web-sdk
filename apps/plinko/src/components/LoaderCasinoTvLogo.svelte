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
	import { stateGame } from '../game/stateGame.svelte';

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
	 * doesn't linger for the whole session and slow down the game's ball rendering. Called the
	 * moment the logo finishes — not deferred to the fade-out — so a backgrounded tab (which pauses
	 * the fade transition) can't keep the heavy renderer alive indefinitely.
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
		loading = false;
		stateGame.introLoaderComplete = true;
		disposeRenderer();
		props.oncomplete?.();
	}

	onMount(() => {
		renderer = new SpineBackgroundRenderer(host);

		void renderer
			.init(getCasinoTvLogoAsset())
			.then(async () => {
				startHiddenDriver();
				await waitForTimeout(CASINO_TV_LOGO_DURATION_MS);
				if (disposed) return;
				finishLoader();
			})
			.catch((error) => {
				// Never let a spine failure trap the player on the splash screen.
				console.error('[LoaderCasinoTvLogo] failed to render intro spine', error);
				if (disposed) return;
				finishLoader();
			});

		return () => disposeRenderer();
	});
</script>

{#if loading}
	<div
		class="casino-tv-logo-loader"
		style="background-image: url({CASINO_TV_LOGO_BACKDROP});"
		transition:fade
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
