<script lang="ts">
	import { onMount } from 'svelte';

	import { frameImagePoint, SKULL_GOLD_PILE } from '../lib/frameArt';
	import { stateGame } from '../game/stateGame.svelte';
	import { eventEmitter } from '../game/eventEmitter';
	import { CoinFountainRenderer, type FountainPoint } from '../lib/spine/CoinFountainRenderer';

	let hostEl: HTMLDivElement;
	let renderer: CoinFountainRenderer | undefined;
	let ready = false;
	let glowHideTimer: ReturnType<typeof setTimeout> | undefined;
	let sparkleHideTimer: ReturnType<typeof setTimeout> | undefined;
	// Pending "+<win>" float timers — the float is shown a beat after launch (≈ when coins reach the
	// balance coin). Tracked so they can be cleared on unmount.
	const floatTimers = new Set<ReturnType<typeof setTimeout>>();
	// Approx travel time before coins start merging into the balance coin (matches the renderer's
	// startAt + duration for the earliest coins); the float appears then, so it reads "on merge".
	const COIN_MERGE_DELAY_MS = 1400;
	// The balance coin's light LEADS the coins in: each layer lights this far ahead of a coin landing,
	// so its burst is already up when they start merging rather than chasing them. The renderer takes
	// this off each coin's own remaining flight time (see CoinBurstOptions.leads); a timer started at
	// launch would have to guess the travel time, and guessing it short lights the coin, hides it
	// again, then re-lights it on the arrival.
	// …and LINGERS after them: each holds this far past the beat where arrivals stop, so it fades out
	// on its own rather than snapping off with the last coin.
	// The SPARKLE brackets the GLOW — in earlier, out later — so the coin is already twinkling as the
	// light comes up, and is still twinkling once it has gone. It can hold a window this wide because
	// it loops just its star segment (see loopRange); the glow would sit on a dead tail.
	const GLOW_LEAD_MS = 500;
	const GLOW_LINGER_MS = 500;
	const SPARKLE_LEAD_MS = 1000;
	const SPARKLE_LINGER_MS = 1000;
	// How long after the last arrival the stream counts as over (every arrival re-arms this).
	const LIGHT_ARRIVALS_IDLE_MS = 260;

	// --- Merge SFX ---------------------------------------------------------------------------------
	function playSound(name: string, rate?: number) {
		eventEmitter.broadcast({ type: 'soundOnce', name, rate });
	}

	// Coin-shuffle bed, played once as a win's coins start spawning. The two names are the same sample
	// sliced to different windows (see EnableSound): a short 0–1.5s for 1-ball rapid wins, a longer
	// 2–4s for the busier 10/20/50-ball drops.
	function playSpawnSfx() {
		playSound(stateGame.ballPerDrop === 1 ? 'coinShuffleSingle' : 'coinShuffleMulti');
	}

	// Each coin that reaches the balance coin flips a coin sound, with a touch of random pitch so a
	// stream of them reads as a cascade of distinct coins rather than one machine-gun tone.
	function playMergeSfx() {
		playSound('coinFlip', 0.94 + Math.random() * 0.12);
	}

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

	// Each light layer shows only around coins actually merging into the coin: it lights shortly before
	// one lands (its _LEAD_MS) and hides a beat after the last one has (every lead and arrival re-arms
	// its hide timer, so a continuous stream keeps it lit; once they stop it lingers, then fades out).
	// Every lead is followed by that coin's arrival its own lead later — well inside the hide window,
	// which is longer than any lead — so neither layer can blink off mid-stream.
	function scheduleGlowOff() {
		if (glowHideTimer) clearTimeout(glowHideTimer);
		glowHideTimer = setTimeout(() => {
			stateGame.balanceGlowActive = false;
		}, LIGHT_ARRIVALS_IDLE_MS + GLOW_LINGER_MS);
	}
	function scheduleSparkleOff() {
		if (sparkleHideTimer) clearTimeout(sparkleHideTimer);
		sparkleHideTimer = setTimeout(() => {
			stateGame.balanceSparkleActive = false;
		}, LIGHT_ARRIVALS_IDLE_MS + SPARKLE_LINGER_MS);
	}
	function showGlow() {
		stateGame.balanceGlowActive = true;
		scheduleGlowOff();
	}
	function showSparkle() {
		stateGame.balanceSparkleActive = true;
		scheduleSparkleOff();
	}
	function onCoinMerge() {
		pulseBalanceCoin();
		showGlow();
		showSparkle();
		playMergeSfx();
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
		// Coins are about to start spawning — kick off the one-shot coin-shuffle bed for this win.
		playSpawnSfx();
		// The light is driven by the coins themselves (see leads/onCoinMerge) — NOT lit at launch, so it
		// only appears around coins actually merging into the balance coin. onComplete is a safety to
		// guarantee both layers hide.
		renderer.burst({
			from,
			to,
			count,
			leads: [
				{ ms: SPARKLE_LEAD_MS, onLead: showSparkle },
				{ ms: GLOW_LEAD_MS, onLead: showGlow },
			],
			onArrive: onCoinMerge,
			onComplete: () => {
				scheduleGlowOff();
				scheduleSparkleOff();
			},
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
			if (glowHideTimer) clearTimeout(glowHideTimer);
			if (sparkleHideTimer) clearTimeout(sparkleHideTimer);
			floatTimers.forEach((t) => clearTimeout(t));
			floatTimers.clear();
			stateGame.balanceGlowActive = false;
			stateGame.balanceSparkleActive = false;
			renderer?.destroy();
			renderer = undefined;
			ready = false;
		};
	});

	// The multi-ball (10/20/50) win now plays the full-screen WinCelebration overlay, which owns its
	// OWN coins — they erupt from the middle of the screen and stream into the balance coin (and drive
	// the balance glow/sparkle/float there directly). So this renderer no longer fires the skull→balance
	// stream on the win-modal edge; doing both would double the coins. It stays mounted purely for the
	// 1-ball rapid bursts below.

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
