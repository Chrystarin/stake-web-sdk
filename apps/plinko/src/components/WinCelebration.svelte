<script lang="ts">
	import { onMount } from 'svelte';
	import { innerHeight, innerWidth } from 'svelte/reactivity/window';

	import { stateGame } from '../game/stateGame.svelte';
	import { plinkoActiveModeMaxWin } from '../game/plinkoBet';
	import { eventEmitter } from '../game/eventEmitter';
	import { frameImagePoint } from '../lib/frameArt';
	import { isPortraitGameLayout } from '../lib/format';
	import { preloadWinPopupAssets } from '../lib/preloadAssets';
	import { staticUrl } from '../lib/staticUrl';
	import { uiScale } from '../lib/uiScale';
	import { WinCoinShower, type ShowerPoint } from '../lib/winCoinShower';
	import {
		winTierForMultiplier,
		WIN_TIER_BANNER,
		WIN_TIER_COIN_COUNT,
		WIN_RAYS_ART,
		WIN_BACKDROP_ART,
		WIN_COIN_ART,
		winDigitArt,
		WIN_DOT_ART,
		WIN_TIMING,
		winCelebrationMergeAtMs,
		winCelebrationBalanceReleaseAtMs,
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
	// NO thousands separators: the counter is drawn from digit-glyph ART (0–9 + a dot) and there is no
	// comma glyph, so a grouped value would have to fall back to a text comma that doesn't match the
	// silver 3D numerals. 1234567.89 → "1234567.89".
	function fmt(value: number, decimals: number): string {
		return value.toLocaleString('en-US', {
			minimumFractionDigits: decimals,
			maximumFractionDigits: decimals,
			useGrouping: false,
		});
	}

	// --- layout on the board ----------------------------------------------------------------------
	function computeLayout() {
		const nf = frameImagePoint(0.5, 0.5) ?? {
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
		for (const c of targetStr) units += c === '.' ? 0.42 : 0.74;
		units = Math.max(units, 1);
		const cap = portrait ? w * 0.15 : Math.min(h * 0.16, w * 0.072);
		// The 34px floor is the JS twin of a clamp's px minimum: it stops tracking the viewport once it
		// binds, which on a 400×225 popout leaves the counter 18% larger than its share of the frame at
		// the 1024×576 reference. Scaling it keeps the counter proportional (see lib/uiScale.ts).
		digitH = Math.max(34 * uiScale(), Math.min(cap, (w * 0.82) / units));
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

		// Tier by how close the round got to THIS mode's max win (captured now — the active mode is still
		// the one the round was played in; a buy-bonus mode isn't reverted until the round fully settles).
		tier = winTierForMultiplier(multiplier, plinkoActiveModeMaxWin());
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

		// Popup-appear SFX as the reveal begins (covers every win popup, incl. after the roulette spin).
		playSound('openPopup');

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

		// "Win is done showing" → turn the coins toward the balance coin and fade the reveal out. The hold
		// before this can be stretched by a DEV console trigger (`stateGame.winCelebrationHoldMs`); read
		// it ONCE here so the whole sequence — and Game.svelte's matching dismiss timer — agree on it.
		const holdMs = stateGame.winCelebrationHoldMs;
		addTimer(() => beginMerge(amount), winCelebrationMergeAtMs(holdMs));

		// Once the coins have landed and the "+win" float has slid up, release the balance to count up to
		// its credited total (Game.svelte watches this tick and animates it).
		addTimer(() => {
			stateGame.balanceWinReleaseTick++;
		}, winCelebrationBalanceReleaseAtMs(holdMs));
	}

	function startCountUp(amount: number, decimals: number) {
		const t0 = performance.now();
		const dur = WIN_TIMING.countUp;
		// Only WRITE when the rendered string actually changes. The ease-out spends its tail barely
		// moving, so most frames format to the same digits — reassigning anyway made Svelte reconcile the
		// glyph row (and re-set every `src`) ~60×/s for nothing, right where the mobile flicker clusters.
		let shown = numberChars.join('');
		const tick = (now: number) => {
			const p = Math.min(1, (now - t0) / dur);
			const eased = 1 - Math.pow(1 - p, 2.2); // ease-out: fast then settle
			const next = fmt(p < 1 ? amount * eased : amount, decimals);
			if (next !== shown) {
				shown = next;
				numberChars = next.split('');
			}
			countRaf = p < 1 ? requestAnimationFrame(tick) : 0;
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
		// A DEV hold override is ONE-SHOT: drop it here so the next (real) win plays production timing.
		stateGame.winCelebrationHoldMs = null;
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

		// Coin bitmap for the shower renderer (it needs the element itself, not just a warm cache).
		const coin = new Image();
		coin.onload = () => shower?.setCoinImage(coin);
		coin.src = staticUrl(WIN_COIN_ART);

		// Everything the reveal paints (banners, rays, backdrop, digits) is loaded, DECODED and retained
		// centrally — the app already fires this right after the loader, so by now it's usually a no-op.
		// Kept here as a backstop for entry points that skip the loader (Storybook, replay, a hot reload).
		void preloadWinPopupAssets();

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
		<!-- `decoding="sync"` on both full-screen layers: they are presented ATOMICALLY with the rest of
		     the reveal, so the compositor can never show a frame in which the art hasn't decoded yet (the
		     mobile "background flashes bright for one frame" bug — see the CSS notes on `.wc-backdrop`). -->
		<img class="wc-backdrop" src={staticUrl(WIN_BACKDROP_ART)} alt="" decoding="sync" />

		<div class="wc-rays-wrap">
			<img class="wc-rays-img" src={staticUrl(WIN_RAYS_ART)} alt="" decoding="sync" />
		</div>

		<img class="wc-banner" src={bannerSrc} alt="" data-tier={tier} />

		<div class="wc-number" class:visible={numberVisible}>
			<div class="wc-number-row">
				{#each numberChars as ch, i (i)}
					{#if ch === '.'}
						<img class="wc-digit wc-dot" src={staticUrl(WIN_DOT_ART)} alt="." />
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

		/* Ray burst + banner sizes. Landscape defaults; portrait overrides below.
		   Sparkle (rays) footprint enlarged 30% (then another 30% on top) per design; the banner
		   (label) text height is bumped ~30% so the title reads bigger relative to the value,
		   matching the reference proportions. */
		/* px bounds in --ui-px: the vw term is what's active at the 1024×576 reference, but both floors
		   bind well before a 400×225 popout — the ray burst would be pinned at 575 real px (144% of the
		   frame width, vs 81% at the reference) and the banner would dwarf the value under it. */
		--wc-rays-size: clamp(calc(575 * var(--ui-px)), 81.1vw, calc(1284 * var(--ui-px)));
		--wc-banner-text-h: clamp(calc(39 * var(--ui-px)), 5.7vw, calc(96 * var(--ui-px)));
		/* Width ceiling for the banner art. WATCH THIS when scaling a tier up: once a tier's art is this
		   wide it stops growing (height shrinks with it, since width is auto), so a bigger
		   `--wc-banner-scale` appears to do nothing. Raise the cap if a tier flattens out. */
		--wc-banner-max-w: 92vw;
	}
	.wc-overlay--portrait {
		--wc-rays-size: 196vw;
		--wc-banner-text-h: 11.2vw;
		--wc-banner-max-w: 92vw;
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
	   on the same point, so it only shades the burst area rather than dimming the whole screen.

	   ⚠️ THE BIGGEST LAYER IN THE APP — at 264vw square it is ~3100×3100 device px on a phone, and it is
	   what the whole board is dimmed by. If its raster/decode isn't ready when the compositor presents,
	   Chrome draws the tile TRANSPARENT and the entire board flashes bright for exactly one frame. QA hit
	   this on Android (Brave/Chrome): measured single-frame flashes at ~250–460ms and ~1.7s into the
	   celebration — i.e. as the enter transitions FINISHED (layer demoted + re-rastered) and as the
	   count-up rAF loop STOPPED. Two things keep it stable, don't drop either:
	     • `will-change: opacity` + `translateZ(0)` — pins it on its own composited layer for the whole
	       celebration, so finishing the opacity transition can't demote and re-raster it.
	     • the art itself is a PURE radial blur and is kept SMALL (1192×748, was 4766×2989 ≈ 57MB decoded)
	       — a re-decode now costs ~1 frame of nothing instead of stalling. Do NOT re-export it large. */
	.wc-backdrop {
		position: absolute;
		left: var(--wc-nx);
		top: var(--wc-ny);
		width: calc(var(--wc-rays-size) * 1.35);
		height: calc(var(--wc-rays-size) * 1.35);
		transform: translate(-50%, -50%) translateZ(0);
		backface-visibility: hidden;
		will-change: opacity;
		object-fit: fill;
		z-index: 0;
		opacity: 0;
		transition: opacity 0.3s ease;
	}
	.wc-overlay.entered .wc-backdrop {
		opacity: 1;
	}

	/* Shine rays: a wrap owns the enter (fade + grow), the inner img owns a slow continuous spin, so
	   the two transforms don't fight. `will-change` on BOTH for the same reason as `.wc-backdrop`: the
	   wrap's opacity/transform transitions END at 0.4s/0.55s, and a layer demoted at that moment gets
	   re-rastered at full size (196vw ≈ 2300px on a phone) — one missed raster = one flashed frame. */
	.wc-rays-wrap {
		position: absolute;
		left: var(--wc-nx);
		top: var(--wc-ny);
		width: var(--wc-rays-size);
		height: var(--wc-rays-size);
		transform: translate(-50%, -50%) scale(0.55);
		z-index: 1;
		opacity: 0;
		will-change: opacity, transform;
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
		backface-visibility: hidden;
		will-change: transform;
	}
	@keyframes wc-rays-spin {
		to {
			transform: rotate(360deg);
		}
	}

	/* Headline banner: stays put and POPS in — small + fading in, growing past its final size, then
	   settling back to its original size (see the reference). The pop is a keyframe animation that plays
	   on mount; `backwards` fill (NOT forwards) so it reverts to the base opacity:1/scale:1 afterwards
	   and the exit `opacity:0` transition can still take over. Size + placement come from the per-tier
	   knobs below; `--wc-banner-place` composes the shared centring with this tier's nudge so the base
	   rule AND the pop keyframes can reuse the exact same translate. */
	.wc-banner {
		position: absolute;
		left: var(--wc-bx);
		top: var(--wc-by);
		/* Fallbacks — every tier overrides these in the knob block below. */
		--wc-banner-scale: 1;
		--wc-banner-dx: 0vw;
		--wc-banner-dy: 0vh;
		--wc-banner-place: translate(
			calc(-50% + var(--wc-banner-dx)),
			calc(-50% + var(--wc-banner-dy))
		);
		height: calc(var(--wc-banner-text-h) * var(--wc-banner-scale));
		width: auto;
		max-width: var(--wc-banner-max-w);
		/* Safety net for the cap: `height` is explicit and `width` is auto, so once `max-width` binds the
		   box keeps the full height at a clamped width and the ART STRETCHES (measured: portrait captain
		   was squashed 35% before this). `contain` letterboxes inside the box instead — the title can stop
		   growing, but it can never distort. */
		object-fit: contain;
		z-index: 3;
		transform: var(--wc-banner-place);
		/* Hidden until `entered` — the pop is gated below so the banner comes in TOGETHER with the
		   backdrop-dim + rays (all behind the double-rAF guard). Without this the banner played on mount,
		   2+ frames ahead of the rest, popping onto the still-bright board (the pre-reveal "flash"). */
		opacity: 0;
		filter: drop-shadow(0 0.4vh 0.6vh rgba(0, 0, 0, 0.55));
		transition: opacity 0.6s ease;
	}
	/* Enter: only once the hidden start state has painted (`.entered`, set via raf2) do we run the pop.
	   `backwards` fill (NOT forwards) so after the pop it settles to this rule's opacity:1 and the exit
	   `opacity:0` transition can still take over. */
	.wc-overlay.entered .wc-banner {
		opacity: 1;
		animation: wc-banner-pop 0.72s ease-out backwards;
	}
	/* ══════════════════════ MANUAL TUNING KNOBS — WIN TITLE, PER TIER ══════════════════════
	   Three numbers per tier, and LANDSCAPE + PORTRAIT are independent sets: edit one without
	   touching the other. Tier comes from `data-tier` on the <img> (massive | epic | captain).

	     --wc-banner-scale : height = this × `--wc-banner-text-h` (the orientation's base size).
	                         NOT a like-for-like comparison between tiers — each art fills a
	                         different share of its own canvas with actual text (measured: massive
	                         0.82, epic 0.49, captain 0.55), so these multipliers are partly
	                         cancelling that out. Judge by eye, not by the number.
	     --wc-banner-dx    : nudge RIGHT off the shared anchor (negative = left). Viewport units.
	     --wc-banner-dy    : nudge DOWN off the shared anchor (negative = up).    Viewport units.

	   The anchor itself (shared by all three tiers, and the value's anchor) is in `computeLayout()`
	   — `frameImagePoint(0.5, 0.29)`. Move that to shift every tier at once; use dx/dy for one tier.
	   vw/vh (not %) on purpose: % would resolve against the banner's OWN box, so re-scaling a tier
	   would silently move it too. ────────────────────────────────────────────────────────────── */

	/* ── LANDSCAPE ── */
	.wc-banner[data-tier='massive'] {
		--wc-banner-scale: 3.25;
		--wc-banner-dx: 0vw;
		--wc-banner-dy: 0vh;
	}
	.wc-banner[data-tier='epic'] {
		--wc-banner-scale: 4.04;
		--wc-banner-dx: 0vw;
		--wc-banner-dy: 0vh;
	}
	.wc-banner[data-tier='captain'] {
		--wc-banner-scale: 4.7209;
		--wc-banner-dx: 0vw;
		--wc-banner-dy: 0vh;
	}

	/* ── PORTRAIT ──
	   NOT the landscape numbers. A phone is ~400px wide, so the landscape scales all overflow
	   `--wc-banner-max-w` (92vw) — they were being clamped and stretched. These are each tier's
	   WIDEST undistorted fit at 92vw, i.e. the largest the title can legitimately get in portrait:
	     massive 0.90 (limit ~0.918) · epic 2.85 (limit ~2.90) · captain 3.00 (limit ~3.06)
	   Tune DOWN freely; going far up just hits the cap and stops growing (see `object-fit` above). */
	.wc-overlay--portrait .wc-banner[data-tier='massive'] {
		--wc-banner-scale: 2.20;
		--wc-banner-dx: 0vw;
		--wc-banner-dy: 0vh;
	}
	.wc-overlay--portrait .wc-banner[data-tier='epic'] {
		--wc-banner-scale: 2.5;
		--wc-banner-dx: 0vw;
		--wc-banner-dy: 0vh;
	}
	.wc-overlay--portrait .wc-banner[data-tier='captain'] {
		--wc-banner-scale: 5;
		--wc-banner-dx: 0vw;
		--wc-banner-dy: 0vh;
	}
	/* The pop OWNS `transform` while it runs, so it has to carry the per-tier nudge too — otherwise the
	   banner would pop in at the un-nudged anchor and jump to its offset when the animation ends. */
	@keyframes wc-banner-pop {
		0% {
			opacity: 0;
			transform: var(--wc-banner-place) scale(0.25);
		}
		60% {
			opacity: 1;
			transform: var(--wc-banner-place) scale(1.18);
		}
		100% {
			opacity: 1;
			transform: var(--wc-banner-place) scale(1);
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
	/* Decimal-point glyph art is cropped tight to just the dot (not a full digit-height canvas), so it's
	   scaled down to match the dot's proportion within a digit and sits on the baseline. */
	.wc-dot {
		height: calc(var(--wc-digit-h) * 0.27);
		align-self: flex-end;
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
