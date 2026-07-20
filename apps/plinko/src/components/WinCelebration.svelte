<script lang="ts">
	import { onMount } from 'svelte';
	import { innerHeight, innerWidth } from 'svelte/reactivity/window';

	import { stateGame } from '../game/stateGame.svelte';
	import { eventEmitter } from '../game/eventEmitter';
	import { frameImagePoint } from '../lib/frameArt';
	import { isPortraitGameLayout } from '../lib/format';
	import { staticUrl } from '../lib/staticUrl';
	import { WinCoinShower, type ShowerPoint } from '../lib/winCoinShower';
	import {
		winTierForMultiplier,
		WIN_TIER_BANNER,
		WIN_TIER_COIN_COUNT,
		WIN_RAYS_ART,
		WIN_BACKDROP_ART,
		WIN_COIN_ART,
		winDigitArt,
		WIN_TIMING,
		WIN_BALANCE_RELEASE_AT_MS,
		type WinTier,
	} from '../lib/winCelebration';

	// --- refs / renderer ---------------------------------------------------------------------------
	let overlayEl: HTMLDivElement;
	let canvasEl: HTMLCanvasElement;
	let shower: WinCoinShower | undefined;

	// --- reactive view state -----------------------------------------------------------------------
	let active = $state(false); // sequence running → visual layers mounted
	let entered = $state(false); // CSS enter transitions engaged
	let exiting = $state(false); // fading the reveal out as the merge begins
	let numberVisible = $state(false);
	let tier = $state<WinTier>('massive');
	let bannerSrc = $state('');
	let numberChars = $state<string[]>([]);

	// Layout (px), computed from the board art so the reveal sits on the pirate frame at any size.
	let bannerX = $state(0);
	let bannerY = $state(0);
	let numberX = $state(0);
	let numberY = $state(0);
	let digitH = $state(72);

	// Portrait tracking (the overlay is fixed, outside the mobile layout class — mirror Result.svelte).
	const portrait = $derived.by(() => {
		innerWidth.current;
		innerHeight.current;
		return isPortraitGameLayout();
	});

	// --- sequence bookkeeping ----------------------------------------------------------------------
	const timers = new Set<ReturnType<typeof setTimeout>>();
	let countRaf = 0;
	let lightOffTimer: ReturnType<typeof setTimeout> | undefined;
	let targetStr = '';
	let coinCount = 0;

	function addTimer(fn: () => void, ms: number) {
		const id = setTimeout(() => {
			timers.delete(id);
			fn();
		}, ms);
		timers.add(id);
	}
	function clearTimers() {
		timers.forEach((t) => clearTimeout(t));
		timers.clear();
		if (countRaf) cancelAnimationFrame(countRaf);
		countRaf = 0;
	}
	// Double-rAF so the hidden start state paints before we engage the transitions — a single rAF
	// batches with the mount and the reveal SNAPS instead of sliding/growing in.
	function raf2(fn: () => void) {
		requestAnimationFrame(() => requestAnimationFrame(fn));
	}

	// --- sound ------------------------------------------------------------------------------------
	function playSound(name: string, rate?: number) {
		eventEmitter.broadcast({ type: 'soundOnce', name, rate });
	}
	let lastMergeSfxAt = 0;
	function playMergeSfx() {
		const now = performance.now();
		if (now - lastMergeSfxAt < 55) return; // a stream of arrivals reads as a cascade, not a buzz
		lastMergeSfxAt = now;
		playSound('coinFlip', 0.94 + Math.random() * 0.12);
	}

	// --- number formatting ------------------------------------------------------------------------
	// Decimals for the giant counter: a round win shows clean ("1,000", per the reference), a normal
	// win shows cents ("12.34"), and a sub-dollar win keeps up to 4 dp so a tiny win on a low bet still
	// reads as a win rather than "0" (matches the WIN_FRACTION_DIGITS spirit).
	function celebrationDecimals(amount: number): number {
		if (!Number.isFinite(amount)) return 2;
		if (Number.isInteger(amount)) return 0;
		return amount < 1 ? 4 : 2;
	}
	function fmt(value: number, decimals: number): string {
		return value.toLocaleString('en-US', {
			minimumFractionDigits: decimals,
			maximumFractionDigits: decimals,
		});
	}

	// --- layout on the board ----------------------------------------------------------------------
	function computeLayout() {
		const nf = frameImagePoint(0.5, 0.42) ?? {
			x: (innerWidth.current ?? window.innerWidth) / 2,
			y: (innerHeight.current ?? window.innerHeight) * 0.42,
		};
		// Banner sits just above the number (was 0.165 — a big gap); pulled down to tighten the
		// title↔value spacing.
		const bf = frameImagePoint(0.5, 0.29) ?? {
			x: (innerWidth.current ?? window.innerWidth) / 2,
			y: (innerHeight.current ?? window.innerHeight) * 0.32,
		};
		numberX = nf.x;
		numberY = nf.y;
		bannerX = bf.x;
		bannerY = bf.y;

		// Size the digit row to fit ~82% of the viewport width, capped so short amounts stay big.
		const w = innerWidth.current ?? window.innerWidth;
		const h = innerHeight.current ?? window.innerHeight;
		let units = 0;
		for (const c of targetStr) units += c === ',' || c === '.' ? 0.42 : 0.74;
		units = Math.max(units, 1);
		const cap = portrait ? w * 0.15 : Math.min(h * 0.16, w * 0.072);
		digitH = Math.max(34, Math.min(cap, (w * 0.82) / units));
	}

	// --- geometry helpers -------------------------------------------------------------------------
	function burstOrigin(): ShowerPoint {
		const p = frameImagePoint(0.5, 0.42);
		if (p) return p;
		return { x: numberX, y: numberY };
	}
	function balanceTarget(): ShowerPoint | undefined {
		const els = document.querySelectorAll<HTMLElement>('[data-coin-fly-target="balance"]');
		for (const el of els) {
			const r = el.getBoundingClientRect();
			if (r.width > 0 && r.height > 0) return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
		}
		return undefined;
	}
	function pulseBalanceCoin() {
		const coin = document.querySelector<HTMLElement>('[data-coin-fly-target="balance"]');
		if (!coin) return;
		coin.classList.remove('coin-fly-target--bump');
		void coin.offsetWidth; // reflow so back-to-back arrivals restart the pulse
		coin.classList.add('coin-fly-target--bump');
	}

	// --- the sequence -----------------------------------------------------------------------------
	function startSequence(amount: number, multiplier: number) {
		clearTimers();
		shower?.clear();

		active = true;
		entered = false;
		exiting = false;
		numberVisible = false;

		tier = winTierForMultiplier(multiplier);
		bannerSrc = staticUrl(WIN_TIER_BANNER[tier]);
		coinCount = WIN_TIER_COIN_COUNT[tier];

		const decimals = celebrationDecimals(amount);
		targetStr = fmt(amount, decimals);
		numberChars = fmt(0, decimals).split('');
		computeLayout();
		resizeShower();

		// NOTE: the balance is pinned at its pre-win value in the finalWin handler (bookEventHandlerMap),
		// which runs BEFORE the win is credited — more reliable than reading it here, where the credit may
		// already have landed. We only RELEASE it (below), once the coins + float have played.

		// Reveal: backdrop + rays + banner play their enter transitions (guarded double-rAF).
		raf2(() => {
			entered = true;
		});

		// Count-up starts after the reveal has settled — and the coin shower erupts AT THE SAME TIME,
		// its throw spread across the count-up so coins keep pouring while the value climbs. When the
		// count lands, the eruption is done (no new coins); the merge (below) follows shortly after.
		addTimer(() => {
			numberVisible = true;
			playSound('coinShuffleMulti');
			shower?.burst(burstOrigin(), coinCount, WIN_TIMING.countUp);
			startCountUp(amount, decimals);
		}, WIN_TIMING.countDelay);

		// "Win is done showing" → turn the coins toward the balance coin and fade the reveal out.
		const mergeAt = WIN_TIMING.countDelay + WIN_TIMING.countUp + WIN_TIMING.hold;
		addTimer(() => beginMerge(amount), mergeAt);

		// Once the coins have landed and the "+win" float has slid up, release the balance to count up to
		// its credited total (Game.svelte watches this tick and animates it).
		addTimer(() => {
			stateGame.balanceWinReleaseTick++;
		}, WIN_BALANCE_RELEASE_AT_MS);
	}

	function startCountUp(amount: number, decimals: number) {
		const t0 = performance.now();
		const dur = WIN_TIMING.countUp;
		const tick = (now: number) => {
			const p = Math.min(1, (now - t0) / dur);
			const eased = 1 - Math.pow(1 - p, 2.2); // ease-out: fast then settle
			numberChars = fmt(amount * eased, decimals).split('');
			if (p < 1) {
				countRaf = requestAnimationFrame(tick);
			} else {
				countRaf = 0;
				numberChars = fmt(amount, decimals).split('');
			}
		};
		countRaf = requestAnimationFrame(tick);
	}

	function beginMerge(amount: number) {
		exiting = true; // fade backdrop / rays / banner / number

		const target = balanceTarget();
		if (!target) return; // no coin to collect into — just let the reveal fade

		// Light the balance coin while the stream lands (fade + skeletons live on BalanceCard).
		stateGame.balanceGlowActive = true;
		stateGame.balanceSparkleActive = true;
		let floated = false;

		shower?.merge(target, {
			onArrive: () => {
				pulseBalanceCoin();
				playMergeSfx();
				if (!floated) {
					floated = true;
					stateGame.balanceWinFloatAmount = amount;
					stateGame.balanceWinFloatTick++;
				}
			},
		});

		// Turn the balance light off a beat after the stream has finished.
		if (lightOffTimer) clearTimeout(lightOffTimer);
		lightOffTimer = setTimeout(() => {
			stateGame.balanceGlowActive = false;
			stateGame.balanceSparkleActive = false;
		}, WIN_TIMING.merge + 260);
	}

	function endSequence() {
		clearTimers();
		if (lightOffTimer) {
			clearTimeout(lightOffTimer);
			lightOffTimer = undefined;
		}
		shower?.clear();
		active = false;
		entered = false;
		exiting = false;
		numberVisible = false;
		stateGame.balanceGlowActive = false;
		stateGame.balanceSparkleActive = false;
		// Safety: if we're torn down before the scheduled release fired, still hand the held balance off
		// to the count-up so it can never stick at the pre-win value.
		if (stateGame.balanceWinHold !== null) stateGame.balanceWinReleaseTick++;
	}

	// --- lifecycle --------------------------------------------------------------------------------
	function resizeShower() {
		if (!shower) return;
		const w = overlayEl?.clientWidth || window.innerWidth;
		const h = overlayEl?.clientHeight || window.innerHeight;
		shower.resize(w, h, Math.min(2, window.devicePixelRatio || 1));
	}

	onMount(() => {
		shower = new WinCoinShower(canvasEl);
		resizeShower();

		// Preload the coin + digit glyphs + tier banners so the count-up, burst and banner pop never flash
		// an unloaded image.
		const coin = new Image();
		coin.onload = () => shower?.setCoinImage(coin);
		coin.src = staticUrl(WIN_COIN_ART);
		for (let d = 0; d < 10; d++) new Image().src = staticUrl(winDigitArt(String(d)));
		for (const banner of Object.values(WIN_TIER_BANNER)) new Image().src = staticUrl(banner);

		const ro = new ResizeObserver(() => {
			resizeShower();
			if (active) computeLayout();
		});
		ro.observe(overlayEl);

		return () => {
			ro.disconnect();
			endSequence();
			shower?.destroy();
			shower = undefined;
		};
	});

	// Drive the sequence off the win-popup gate (10/20/50-ball tiers only — 1-ball has no modal).
	// The reveal owns its own animation; Game.svelte's auto-dismiss clears the gate after the full
	// celebration has played (WIN_CELEBRATION_TOTAL_MS), which tears everything down here.
	let wasGateOpen = false;
	$effect(() => {
		const open = stateGame.showWinPopup && stateGame.ballPerDrop !== 1;
		if (open && !wasGateOpen) {
			startSequence(stateGame.winPopupAmount, stateGame.winPopupMultiplier);
		} else if (!open && wasGateOpen) {
			endSequence();
		}
		wasGateOpen = open;
	});
</script>

<div
	class="wc-overlay"
	class:wc-overlay--portrait={portrait}
	class:entered
	class:exiting
	bind:this={overlayEl}
	aria-hidden="true"
	style="--wc-bx:{bannerX}px; --wc-by:{bannerY}px; --wc-nx:{numberX}px; --wc-ny:{numberY}px; --wc-digit-h:{digitH}px;"
>
	<!-- Coins live BETWEEN the shine rays and the win text — a plain 2D canvas so it can sit mid-stack.
	     Kept mounted (idle when empty) so a merge in progress is never cut off by an unmount. -->
	<canvas class="wc-coins" bind:this={canvasEl}></canvas>

	{#if active}
		<img class="wc-backdrop" src={staticUrl(WIN_BACKDROP_ART)} alt="" />

		<div class="wc-rays-wrap">
			<img class="wc-rays-img" src={staticUrl(WIN_RAYS_ART)} alt="" />
		</div>

		<img class="wc-banner" src={bannerSrc} alt="" data-tier={tier} />

		<div class="wc-number" class:visible={numberVisible}>
			<div class="wc-number-row">
				{#each numberChars as ch, i (i)}
					{#if ch === ',' || ch === '.'}
						<span class="wc-sep">{ch}</span>
					{:else}
						<img class="wc-digit" src={staticUrl(winDigitArt(ch))} alt={ch} />
					{/if}
				{/each}
			</div>
		</div>
	{/if}
</div>

<style>
	.wc-overlay {
		position: fixed;
		inset: 0;
		z-index: 15000;
		pointer-events: none;
		overflow: hidden;

		/* Ray burst + banner sizes. Landscape defaults; portrait overrides below. */
		--wc-rays-size: clamp(340px, 48vw, 760px);
		--wc-banner-text-h: clamp(30px, 4.4vw, 74px);
	}
	.wc-overlay--portrait {
		--wc-rays-size: 116vw;
		--wc-banner-text-h: 8.6vw;
	}

	.wc-coins {
		position: absolute;
		inset: 0;
		z-index: 2;
		width: 100%;
		height: 100%;
		display: block;
		pointer-events: none;
	}

	/* Soft dark vignette behind the reveal — sized to roughly the SPARKLE (rays) footprint and centred
	   on the same point, so it only shades the burst area rather than dimming the whole screen. */
	.wc-backdrop {
		position: absolute;
		left: var(--wc-nx);
		top: var(--wc-ny);
		width: calc(var(--wc-rays-size) * 1.35);
		height: calc(var(--wc-rays-size) * 1.35);
		transform: translate(-50%, -50%);
		object-fit: fill;
		z-index: 0;
		opacity: 0;
		transition: opacity 0.3s ease;
	}
	.wc-overlay.entered .wc-backdrop {
		opacity: 1;
	}

	/* Shine rays: a wrap owns the enter (fade + grow), the inner img owns a slow continuous spin, so
	   the two transforms don't fight. */
	.wc-rays-wrap {
		position: absolute;
		left: var(--wc-nx);
		top: var(--wc-ny);
		width: var(--wc-rays-size);
		height: var(--wc-rays-size);
		transform: translate(-50%, -50%) scale(0.55);
		z-index: 1;
		opacity: 0;
		transition:
			opacity 0.4s ease,
			transform 0.55s cubic-bezier(0.2, 0.8, 0.3, 1);
	}
	.wc-overlay.entered .wc-rays-wrap {
		opacity: 0.9;
		transform: translate(-50%, -50%) scale(1);
	}
	.wc-rays-img {
		width: 100%;
		height: 100%;
		animation: wc-rays-spin 30s linear infinite;
		transform-origin: center;
	}
	@keyframes wc-rays-spin {
		to {
			transform: rotate(360deg);
		}
	}

	/* Headline banner: stays put and POPS in — small + fading in, growing past its final size, then
	   settling back to its original size (see the reference). The pop is a keyframe animation that plays
	   on mount; `backwards` fill (NOT forwards) so it reverts to the base opacity:1/scale:1 afterwards
	   and the exit `opacity:0` transition can still take over. Sized by a per-tier canvas height so the
	   TEXT reads at ~the same height across the three arts (their text fills a different share of each
	   canvas — measured: massive 0.82, epic 0.49, captain 0.55 → multipliers below). */
	.wc-banner {
		position: absolute;
		left: var(--wc-bx);
		top: var(--wc-by);
		height: calc(var(--wc-banner-text-h) * 1.22);
		width: auto;
		max-width: 92vw;
		z-index: 3;
		transform: translate(-50%, -50%) scale(1);
		opacity: 1;
		filter: drop-shadow(0 0.4vh 0.6vh rgba(0, 0, 0, 0.55));
		transition: opacity 0.6s ease;
		animation: wc-banner-pop 0.72s ease-out backwards;
	}
	.wc-banner[data-tier='epic'] {
		height: calc(var(--wc-banner-text-h) * 2.04);
	}
	.wc-banner[data-tier='captain'] {
		height: calc(var(--wc-banner-text-h) * 1.82);
	}
	@keyframes wc-banner-pop {
		0% {
			opacity: 0;
			transform: translate(-50%, -50%) scale(0.25);
		}
		60% {
			opacity: 1;
			transform: translate(-50%, -50%) scale(1.18);
		}
		100% {
			opacity: 1;
			transform: translate(-50%, -50%) scale(1);
		}
	}

	/* Silver digit counter, centred on the board. `.wc-number` owns the centring, `.wc-number-row`
	   SLIDES UP from below while fading in (see the reference — the value rises into place). */
	.wc-number {
		position: absolute;
		left: var(--wc-nx);
		top: var(--wc-ny);
		transform: translate(-50%, -50%);
		z-index: 3;
	}
	.wc-number-row {
		display: flex;
		align-items: flex-end;
		justify-content: center;
		opacity: 0;
		transform: translateY(calc(var(--wc-digit-h) * 0.55));
		transition:
			opacity 0.4s ease,
			transform 0.5s cubic-bezier(0.2, 0.85, 0.3, 1);
		filter: drop-shadow(0 0.5vh 0.7vh rgba(0, 0, 0, 0.5));
	}
	.wc-number.visible .wc-number-row {
		opacity: 1;
		transform: translateY(0);
	}
	.wc-digit {
		height: var(--wc-digit-h);
		width: auto;
		display: block;
		margin: 0 calc(var(--wc-digit-h) * -0.008);
	}
	.wc-sep {
		align-self: flex-end;
		font-family: 'Arial Black', Arial, sans-serif;
		font-weight: 900;
		font-size: calc(var(--wc-digit-h) * 0.52);
		line-height: 1;
		color: #eef2f7;
		-webkit-text-stroke: calc(var(--wc-digit-h) * 0.022) #2b3038;
		paint-order: stroke fill;
		padding-bottom: calc(var(--wc-digit-h) * 0.05);
		margin: 0 calc(var(--wc-digit-h) * 0.008);
	}

	/* Exit — fade the whole reveal as the coins turn and stream into the balance coin. Placed after the
	   enter rules and at matching specificity so it wins while both `entered` and `exiting` are set. */
	.wc-overlay.exiting .wc-backdrop,
	.wc-overlay.exiting .wc-rays-wrap,
	.wc-overlay.exiting .wc-banner,
	.wc-overlay.exiting .wc-number-row {
		opacity: 0;
		transition: opacity 0.6s ease;
	}
</style>
