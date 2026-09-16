<script lang="ts">
	/**
	 * The intro splash: the casino TV logo flicker-on (One-Eyed Willy's Plinko's, verbatim) over a
	 * flat backdrop, with a progress bar under it reading out how far the game's initialisation has
	 * got — every asset in the manifest (lib/preloadAssets.ts) and then the game itself standing.
	 *
	 * Ported from the Plinko's LoaderCasinoTvLogo.svelte. The choreography is that one's: the logo
	 * plays to its fully-lit frame, breathes there for as long as loading takes, then plays out its
	 * fade and the overlay dissolves onto a game that is already fully in memory. The bar is the
	 * addition — that game deliberately shows no progress, but here the manifest is a good deal
	 * heavier per screen (the room boards alone are 13 MB) and a wait with a number on it reads as
	 * loading where the same wait without one reads as a hang.
	 *
	 * The game is NOT mounted behind this splash. `stateGame.assetsReady` flips once the manifest is
	 * in (see +layout.svelte), so <Game> renders straight from resident copies and never races the
	 * preload for the same files.
	 */
	import { onMount } from 'svelte';
	import { fade } from 'svelte/transition';

	import { waitForTimeout } from 'utils-shared/wait';

	import { LogoSpineRenderer } from '../lib/spine/LogoSpineRenderer';
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
		type PreloadProgress,
	} from '../lib/preloadAssets';
	import { stateGame } from '../game/stateGame.svelte';

	/** Fade-out duration of the splash overlay (ms). Kept in sync with the `fade` transition below. */
	const FADE_OUT_MS = 400;

	/**
	 * DEV escape hatch: `?noLoader=1` skips the splash entirely — the game mounts at once, the way it
	 * did before the loader existed — for harnesses that step the game on a clock and cannot spend
	 * three and a half seconds on an intro. The preload still runs, silently, so the assets end up
	 * resident either way. Ignored in production builds.
	 */
	const skipSplash =
		import.meta.env.DEV &&
		typeof window !== 'undefined' &&
		new URLSearchParams(window.location.search).get('noLoader') === '1';

	let loading = $state(!skipSplash);
	let host = $state<HTMLDivElement>();

	let renderer: LogoSpineRenderer | undefined;
	let disposed = false;
	let hiddenDriver: ReturnType<typeof setInterval> | undefined;

	/* ── Progress ────────────────────────────────────────────────────────────────────────────── */

	/** Where the preload actually is, 0..1. Steps up as tasks settle. */
	let target = $state(0);
	/** What the bar shows: eased towards `target` so bursts of settling tasks read as motion, not jumps. */
	let shown = $state(0);
	let phase = $state<PreloadProgress['phase']>('assets');
	const percent = $derived(Math.round(shown * 100));
	/** True once the bar has reached the end — it steps aside for the logo's fade-out. */
	const complete = $derived(shown >= 1);

	const onProgress = (progress: PreloadProgress) => {
		// Never backwards: a late-arriving report cannot pull the bar down.
		target = Math.max(target, progress.fraction);
		phase = progress.phase;
	};

	/**
	 * Ease `shown` towards `target`. A timer rather than a rAF loop, for the same reason as the spine's
	 * hidden driver below: a backgrounded tab gets no animation frames, and the bar must still be
	 * honest when the tab comes back. 40 ms is well under what reads as a step.
	 */
	let easeTimer: ReturnType<typeof setInterval> | undefined;
	function startEasing() {
		easeTimer = setInterval(() => {
			if (shown >= target) return;
			const next = shown + (target - shown) * 0.18;
			// Snap the last sliver so the readout lands on the round number instead of 99% forever.
			shown = target - next < 0.002 ? target : next;
		}, 40);
	}

	/* ── Spine ───────────────────────────────────────────────────────────────────────────────── */

	/**
	 * Tear down the Pixi renderer and release the splash atlas (tens of MB of GPU textures) so it
	 * does not linger for the whole session. Deferred to just AFTER the fade-out (see `finishLoader`)
	 * so the logo fades out with the backdrop instead of popping out the instant the canvas goes.
	 * Idempotent: a fallback timer and the onMount cleanup both call it.
	 */
	function disposeRenderer() {
		if (disposed) return;
		disposed = true;
		if (hiddenDriver) clearInterval(hiddenDriver);
		hiddenDriver = undefined;
		if (easeTimer) clearInterval(easeTimer);
		easeTimer = undefined;
		renderer?.destroy();
		renderer = undefined;
	}

	/**
	 * A frame this long overdue means `requestAnimationFrame` has stopped, whatever `document.hidden`
	 * says. Four missed 60 fps frames; a busy-but-live tab does not fall this far behind.
	 */
	const RAF_STALL_MS = 200;

	/**
	 * While the tab is visible and animating, Pixi's shared ticker (rAF) drives the spine. When rAF
	 * stops — a backgrounded tab, or an embedded/throttled one that is not `document.hidden` at all,
	 * where the Plinko's hidden-only check left the splash frozen on its last frame — the animation is
	 * driven off a timer instead. Only advances while rAF is actually stalled, so a live tab's frames
	 * are never double-stepped; when rAF resumes, `catchUpMinFps` clamps its first delta so the two
	 * clocks hand over without a jump.
	 */
	function startHiddenDriver() {
		let lastTs = performance.now();
		hiddenDriver = setInterval(() => {
			const now = performance.now();
			const dt = Math.min((now - lastTs) / 1000, 0.25);
			lastTs = now;
			if (!renderer) return;
			if (document.hidden || renderer.sharedTickerIdleMs() > RAF_STALL_MS) renderer.advanceFrame(dt);
		}, 50);
	}

	function finishLoader() {
		// Everything in the manifest has settled and the game is standing, so it is revealed complete.
		loading = false;
		stateGame.introLoaderComplete = true;
		// The video bodies, streamed in behind the game now that the splash is gone.
		preloadPostRevealAssets();
		watchForUnpreloadedAssets();
		// Keep the logo canvas painted through the fade-out, then release it. Fallback timer only —
		// the onMount cleanup also disposes, so a paused/backgrounded fade cannot leak the renderer.
		setTimeout(disposeRenderer, FADE_OUT_MS + 100);
	}

	/**
	 * Resolve once the intro spine's OWN track has reached `seconds`, not once that much wall-clock
	 * has passed — the two diverge by design whenever a stalled frame's catch-up is clamped. Polled
	 * on a timer rather than rAF so a backgrounded tab cannot strand the splash. Resolves at once if
	 * the renderer is gone, so teardown cannot hang it.
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
		if (skipSplash) {
			stateGame.assetsReady = true;
			stateGame.introLoaderComplete = true;
			void preloadAllGameAssets().then(() => {
				preloadPostRevealAssets();
				watchForUnpreloadedAssets();
			});
			return;
		}

		startEasing();
		// `host` is bound by the time onMount runs — the overlay renders on the first frame.
		if (!host) return;
		renderer = new LogoSpineRenderer(host);

		// The asset preload is kicked off only AFTER the intro spine has loaded + started rendering —
		// not at mount — so its parallel requests + decodes do not compete with the spine's own atlas
		// download/upload during the opening frames (which was skipping the animation). It always
		// resolves (failures swallowed + timeout caps), so it cannot trap the player on the splash.
		let preloadPromise: Promise<void> | undefined;
		const startPreload = () => (preloadPromise ??= preloadAllGameAssets({ onProgress }));

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

				// Play the reveal, then — if the assets are not in yet — hold the logo on a slow breath
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

				// Assets in, game standing: let the fade-out play out in full, then reveal.
				await waitForAnimationTime(CASINO_TV_LOGO_DURATION_MS / 1000);
				if (disposed) return;
				finishLoader();
			})
			.catch((error) => {
				// Never let a spine failure trap the player on the splash — but still wait for the assets
				// (capped) so a half-loaded game is not revealed. The bar carries the wait on its own.
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

		<div
			class="load-progress"
			class:complete
			role="progressbar"
			aria-label={phase === 'boot' ? 'Starting game' : 'Loading game assets'}
			aria-valuemin="0"
			aria-valuemax="100"
			aria-valuenow={percent}
		>
			<div class="load-progress-row">
				<span class="load-progress-label">{phase === 'boot' ? 'Starting game' : 'Loading'}</span>
				<span class="load-progress-pct">{percent}%</span>
			</div>
			<div class="load-progress-track">
				<div class="load-progress-fill" style="transform: scaleX({shown});"></div>
			</div>
		</div>
	</div>
{/if}

<style lang="scss">
	/* Above everything the game can raise: the confirm prompt sits at 18500, the chip flights at 503. */
	.casino-tv-logo-loader {
		position: fixed;
		inset: 0;
		z-index: 20000;
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

	/* ── Progress bar ──
	   Parked in the lower band of the backdrop, under the logo's footprint (the art is centred and
	   cover-fit, and its lowest lit pixels stop well above this). Sized in clamp()s so it is one bar on
	   a phone and on a 4K desktop alike; the type is the system face on purpose — nothing of the game's
	   own is guaranteed loaded while this is on screen, and a swap mid-count would read as a glitch. */
	.load-progress {
		position: absolute;
		left: 50%;
		bottom: clamp(28px, 9svh, 84px);
		width: min(64vw, 440px);
		transform: translateX(-50%);
		font-family:
			system-ui,
			-apple-system,
			'Segoe UI',
			Roboto,
			sans-serif;
		color: rgba(255, 255, 255, 0.86);
		text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6);
		pointer-events: none;
		transition: opacity 300ms ease;
	}
	/* Done: hand the screen to the logo's own fade-out rather than sit at 100% under it. */
	.load-progress.complete {
		opacity: 0;
		transition-delay: 350ms;
	}

	.load-progress-row {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		margin-bottom: clamp(6px, 1.2vh, 10px);
		font-size: clamp(11px, 1.6vh, 14px);
		font-weight: 600;
		letter-spacing: 0.14em;
		text-transform: uppercase;
	}
	.load-progress-pct {
		font-variant-numeric: tabular-nums;
		letter-spacing: 0.04em;
		color: #f5c451;
	}

	.load-progress-track {
		position: relative;
		height: clamp(5px, 0.9vh, 8px);
		border-radius: 999px;
		background: rgba(255, 255, 255, 0.14);
		box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.5);
		overflow: hidden;
	}
	/* Scaled, not width-animated: a transform is a compositor-only change and the JS already eases
	   the value, so the short transition only smooths the 40 ms steps. */
	.load-progress-fill {
		position: absolute;
		inset: 0;
		transform-origin: left center;
		border-radius: inherit;
		background: linear-gradient(90deg, #d99a1e 0%, #f5c451 60%, #ffe08a 100%);
		box-shadow: 0 0 10px rgba(245, 196, 81, 0.55);
		transition: transform 120ms linear;
	}
</style>
