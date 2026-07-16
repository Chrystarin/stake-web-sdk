<script lang="ts">
	import { onMount } from 'svelte';

	import { frameImagePoint, SKULL_GOLD_PILE } from '../lib/frameArt';
	import { stateGame } from '../game/stateGame.svelte';
	import { CoinFountainRenderer, type FountainPoint } from '../lib/spine/CoinFountainRenderer';

	let hostEl: HTMLDivElement;
	let renderer: CoinFountainRenderer | undefined;
	let ready = false;
	let lightHideTimer: ReturnType<typeof setTimeout> | undefined;
	// Pending "+<win>" float timers — the float is shown a beat after launch (≈ when coins reach the
	// balance coin). Tracked so they can be cleared on unmount.
	const floatTimers = new Set<ReturnType<typeof setTimeout>>();
	// Approx travel time before coins start merging into the balance coin (matches the renderer's
	// startAt + duration for the earliest coins); the float appears then, so it reads "on merge".
	const COIN_MERGE_DELAY_MS = 1400;

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

	function launchBurst(countOverride?: number, winAmount?: number) {
		if (!renderer || !ready) return;
		// Origin: the gold coin pile at the pirate skull's MOUTH (baked into the game-area frame art).
		// Fall back to the frame centre, then the viewport, so a burst always has somewhere to come from.
		const from =
			frameImagePoint(SKULL_GOLD_PILE.x, SKULL_GOLD_PILE.y) ??
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

		// Float a "+<win>" text down from the balance coin around when these coins start merging into it.
		if (winAmount && winAmount > 0) {
			const amount = winAmount;
			const timer = setTimeout(() => {
				floatTimers.delete(timer);
				stateGame.balanceWinFloatAmount = amount;
				stateGame.balanceWinFloatTick++;
			}, COIN_MERGE_DELAY_MS);
			floatTimers.add(timer);
		}
	}

	onMount(() => {
		renderer = new CoinFountainRenderer(hostEl);
		void renderer.init().then(() => {
			ready = true;
		});
		return () => {
			if (lightHideTimer) clearTimeout(lightHideTimer);
			floatTimers.forEach((t) => clearTimeout(t));
			floatTimers.clear();
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
			// Snapshot the round win now (the popup amount), and defer a frame so the win card has laid out
			// and getBoundingClientRect is accurate. The arrow keeps rAF's timestamp out of the args.
			const winAmount = stateGame.winPopupAmount;
			requestAnimationFrame(() => requestAnimationFrame(() => launchBurst(undefined, winAmount)));
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
			if (stateGame.ballPerDrop === 1) launchBurst(stateGame.rapidCoinBurstCount, stateGame.winAmount);
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
