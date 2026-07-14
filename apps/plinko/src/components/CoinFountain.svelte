<script lang="ts">
	import { onMount } from 'svelte';

	import { stateGame } from '../game/stateGame.svelte';
	import { CoinFountainRenderer, type FountainPoint } from '../lib/spine/CoinFountainRenderer';

	let hostEl: HTMLDivElement;
	let renderer: CoinFountainRenderer | undefined;
	let ready = false;
	let lightHideTimer: ReturnType<typeof setTimeout> | undefined;

	/** Centre of the first visible element matching `selector`, in client (screen) px. */
	function rectCenter(selector: string): FountainPoint | undefined {
		const els = document.querySelectorAll<HTMLElement>(selector);
		for (const el of els) {
			const r = el.getBoundingClientRect();
			if (r.width > 0 && r.height > 0) {
				return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
			}
		}
		return undefined;
	}

	// The coins pour out of the gold pile at the pirate SKULL'S MOUTH, which is baked into the
	// game-area frame art (`game_area_background.png`). These are the pile's centre as a fraction of
	// that image (measured from the art): centred horizontally, ~0.39 down — i.e. under the teeth, not
	// on the face. Mapping through the image below keeps the spawn glued to the mouth at any size.
	const FRAME_NATURAL_W = 1142;
	const FRAME_NATURAL_H = 1010;
	const SKULL_MOUTH_RATIO_X = 0.508;
	const SKULL_MOUTH_RATIO_Y = 0.39;

	/**
	 * Map a point given as a fraction of the frame image (0..1) to client (screen) px, accounting for
	 * the frame's `object-fit` letterboxing (contain on desktop, cover on mobile) with `object-position:
	 * top center`. Read live from `getBoundingClientRect` + `naturalWidth`, so the returned point tracks
	 * the current layout — it re-resolves correctly on every canvas resize / orientation change.
	 */
	function frameImagePoint(ratioX: number, ratioY: number): FountainPoint | undefined {
		const img = document.querySelector<HTMLImageElement>('.game-area-frame');
		if (!img) return undefined;
		const rect = img.getBoundingClientRect();
		if (rect.width <= 0 || rect.height <= 0) return undefined;
		const natW = img.naturalWidth || FRAME_NATURAL_W;
		const natH = img.naturalHeight || FRAME_NATURAL_H;
		const cover = getComputedStyle(img).objectFit === 'cover';
		const scale = cover
			? Math.max(rect.width / natW, rect.height / natH)
			: Math.min(rect.width / natW, rect.height / natH);
		const paintedW = natW * scale;
		const paintedH = natH * scale;
		// object-position: top center → horizontally centred, top-aligned.
		const paintedLeft = rect.left + (rect.width - paintedW) / 2;
		const paintedTop = rect.top;
		return { x: paintedLeft + ratioX * paintedW, y: paintedTop + ratioY * paintedH };
	}

	/** Pulse the balance coin as coins land (throttled so a stream of arrivals doesn't thrash it). */
	let lastPulseAt = 0;
	function pulseBalanceCoin() {
		const now = performance.now();
		if (now - lastPulseAt < 90) return;
		lastPulseAt = now;
		const coin = document.querySelector<HTMLElement>('[data-coin-fly-target="balance"]');
		if (!coin) return;
		coin.classList.remove('coin-fly-target--bump');
		// Reflow so re-adding the class restarts the animation even on back-to-back arrivals.
		void coin.offsetWidth;
		coin.classList.add('coin-fly-target--bump');
	}

	// The balance coin's light shows ONLY while coins are actively merging into it: it lights on each
	// arrival and hides a short beat after the last one lands (every arrival re-arms the hide timer, so
	// a continuous stream keeps it lit; once arrivals stop it fades out).
	function scheduleLightOff() {
		if (lightHideTimer) clearTimeout(lightHideTimer);
		lightHideTimer = setTimeout(() => {
			stateGame.coinFountainActive = false;
		}, 260);
	}
	function onCoinMerge() {
		pulseBalanceCoin();
		stateGame.coinFountainActive = true;
		scheduleLightOff();
	}

	function launchBurst(countOverride?: number) {
		if (!renderer || !ready) return;
		// Origin: the gold coin pile at the pirate skull's MOUTH (baked into the game-area frame art).
		// Fall back to the frame centre, then the viewport, so a burst always has somewhere to come from.
		const from =
			frameImagePoint(SKULL_MOUTH_RATIO_X, SKULL_MOUTH_RATIO_Y) ??
			rectCenter('.game-area-frame') ??
			(() => ({ x: window.innerWidth / 2, y: window.innerHeight * 0.4 }))();
		const to = rectCenter('[data-coin-fly-target="balance"]');
		// No balance coin on screen (shouldn't happen) — nothing to collect into.
		if (!to) return;

		// Multi-ball win: a bigger multiplier throws a few more coins. 1-ball rapid mode passes an explicit
		// 1-3 count (see the rapid effect below). Capped inside the renderer.
		const mult = stateGame.winPopupMultiplier || 0;
		const count = countOverride ?? Math.round(22 + Math.min(20, Math.log2(1 + mult) * 5));
		// The light is driven per-arrival (see onCoinMerge) — NOT lit at launch, so it only appears once
		// coins actually start merging into the balance coin. onComplete is a safety to guarantee it hides.
		renderer.burst({
			from,
			to,
			count,
			onArrive: onCoinMerge,
			onComplete: scheduleLightOff,
		});
	}

	onMount(() => {
		renderer = new CoinFountainRenderer(hostEl);
		void renderer.init().then(() => {
			ready = true;
		});
		return () => {
			if (lightHideTimer) clearTimeout(lightHideTimer);
			stateGame.coinFountainActive = false;
			renderer?.destroy();
			renderer = undefined;
			ready = false;
		};
	});

	// Fire a burst on the rising edge of the win modal. The modal is only shown on the multi-ball tiers
	// (never in 1-ball rapid mode), which is exactly where we want the celebration — so gate on the same
	// condition the `.win-card` uses.
	let winModalWasVisible = false;
	$effect(() => {
		const visible = stateGame.showWinPopup && stateGame.ballPerDrop !== 1;
		if (visible && !winModalWasVisible) {
			// Defer a frame so the win card has laid out and getBoundingClientRect is accurate. Wrap in an
			// arrow so rAF's timestamp isn't forwarded as launchBurst's count argument.
			requestAnimationFrame(() => requestAnimationFrame(() => launchBurst()));
		}
		winModalWasVisible = visible;
	});

	// 1-ball rapid tier: each paying land bumps `rapidCoinBurstTick` (see onBallLanded → gameOrchestrator).
	// Throw a small 1-3 coin burst per land, the count scaled by the landed multiplier. No layout defer
	// needed — the balance coin + skull frame are already on screen during rapid play.
	// Seed from the current tick so a (re)mount with a nonzero tick doesn't fire a spurious burst.
	let lastRapidTick = stateGame.rapidCoinBurstTick;
	$effect(() => {
		const tick = stateGame.rapidCoinBurstTick;
		if (tick !== lastRapidTick) {
			lastRapidTick = tick;
			if (stateGame.ballPerDrop === 1) launchBurst(stateGame.rapidCoinBurstCount);
		}
	});
</script>

<div class="coin-fountain-host" bind:this={hostEl} aria-hidden="true"></div>

<style>
	.coin-fountain-host {
		position: fixed;
		inset: 0;
		z-index: 16000;
		pointer-events: none;
		overflow: hidden;
	}
	.coin-fountain-host :global(canvas) {
		display: block;
		width: 100% !important;
		height: 100% !important;
	}
</style>
