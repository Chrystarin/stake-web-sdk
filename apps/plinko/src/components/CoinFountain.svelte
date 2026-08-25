<script lang="ts">
	import { onMount } from 'svelte';

	import { frameImagePoint, SKULL_GOLD_PILE } from '../lib/frameArt';
	import { stateGame } from '../game/stateGame.svelte';
	import {
		endInBonusFreeSpinCoinStream,
		releaseBonusEndBalanceHold,
	} from '../game/gameOrchestrator';
	import { eventEmitter } from '../game/eventEmitter';
	import { CoinFountainRenderer, type FountainPoint } from '../lib/spine/CoinFountainRenderer';

	let hostEl: HTMLDivElement;
	let renderer: CoinFountainRenderer | undefined;
	let ready = false;
	let glowHideTimer: ReturnType<typeof setTimeout> | undefined;
	let sparkleHideTimer: ReturnType<typeof setTimeout> | undefined;
	// Pending one-shot beats scheduled off a launch — the "+<win>" float (≈ when the coins reach the
	// balance coin) and the free-spin stream's release + end. Tracked so they can be cleared on unmount.
	const floatTimers = new Set<ReturnType<typeof setTimeout>>();
	/** Run `fn` `delayMs` from now, tracked so unmount can cancel it. */
	function schedule(delayMs: number, fn: () => void) {
		const timer = setTimeout(() => {
			floatTimers.delete(timer);
			fn();
		}, delayMs);
		floatTimers.add(timer);
	}
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

	// The three coin destinations, by their `data-coin-fly-target` marker. `win-coin` exists only in the
	// PORTRAIT HUD (its Win readout carries a coin icon) and `win` only in landscape (a plaque, no coin),
	// so which one the document holds is also which behaviour the free-spin stream should play.
	const BALANCE_TARGET = '[data-coin-fly-target="balance"]';
	const WIN_COIN_TARGET = '[data-coin-fly-target="win-coin"]';
	const WIN_FIELD_TARGET = '[data-coin-fly-target="win"]';

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

	/** Pulse a coin target as coins land in it (throttled so a stream of arrivals doesn't thrash it). */
	let lastPulseAt = 0;
	function pulseCoinTarget(selector: string) {
		const now = performance.now();
		if (now - lastPulseAt < 90) return;
		lastPulseAt = now;
		const coin = document.querySelector<HTMLElement>(selector);
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
		pulseCoinTarget(BALANCE_TARGET);
		showGlow();
		showSparkle();
		playMergeSfx();
	}

	/**
	 * Where every coin stream comes from: the gold coin pile at the pirate skull's MOUTH (baked into the
	 * game-area frame art). Falls back to the frame centre, then the viewport, so a burst always has
	 * somewhere to come from.
	 */
	function burstOrigin(): FountainPoint {
		return (
			frameImagePoint(SKULL_GOLD_PILE.x, SKULL_GOLD_PILE.y) ??
			rectCenter('.game-area-frame') ?? { x: window.innerWidth / 2, y: window.innerHeight * 0.4 }
		);
	}

	// Only the post-bonus collect holds a balance: its treasure screen pins the displayed balance at the
	// pre-win value at full cover, so the number climbs with these coins instead of already being at its
	// new total when the screen lifts. `releasesBalance` marks that burst; the hold is handed to its
	// count-up off the FIRST coin to actually LAND (not a timer), so a slow device can't count the balance
	// up before the coins get there.
	function launchBurst(countOverride?: number, winAmount?: number, releasesBalance = false) {
		if (!renderer || !ready) {
			if (releasesBalance) releaseBonusEndBalanceHold();
			return;
		}
		const from = burstOrigin();
		const to = rectCenter(BALANCE_TARGET);
		// No balance coin on screen (shouldn't happen) — nothing to collect into.
		if (!to) {
			if (releasesBalance) releaseBonusEndBalanceHold();
			return;
		}

		let balanceReleased = false;
		const releaseBalanceOnce = () => {
			if (!releasesBalance || balanceReleased) return;
			balanceReleased = true;
			releaseBonusEndBalanceHold();
		};

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
			onArrive: () => {
				onCoinMerge();
				releaseBalanceOnce();
			},
			onComplete: () => {
				scheduleGlowOff();
				scheduleSparkleOff();
				// Safety: a burst can only finish with zero arrivals if it was cleared out from under us.
				releaseBalanceOnce();
			},
		});

		// Float a "+<win>" text down from the balance coin around when these coins start merging into it.
		if (winAmount && winAmount > 0) {
			const amount = winAmount;
			schedule(COIN_MERGE_DELAY_MS, () => {
				stateGame.balanceWinFloatAmount = amount;
				stateGame.balanceWinFloatTick++;
			});
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
			// Going away mid-stream — drop the screen-hold now rather than leaving the bonus round waiting
			// out its backstop for coins that no longer exist.
			endInBonusFreeSpinCoinStream();
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
	// stream on the win-modal edge; doing both would double the coins. It stays mounted for the two
	// bursts below — the minor-win one and the post-bonus collect.

	// The 1-ball rapid tier used to throw a small per-land burst here too. It doesn't any more: its
	// lands come too fast for a coin each to read as anything but a trickle (see onBallLanded). That
	// tier's win feedback is the skull sparkle alone — RapidWinSparkles.svelte.

	// Multi-ball drop that paid but stayed below the total bet: no win modal (so no WinCelebration coins),
	// but the round still won something — throw a small skull→balance burst so the credit still lands with
	// a few coins. `finalWin` bumps `minorWinCoinBurstTick` (see bookEventHandlerMap).
	const MINOR_WIN_COIN_COUNT = 6;
	let lastMinorTick = stateGame.minorWinCoinBurstTick;
	$effect(() => {
		const tick = stateGame.minorWinCoinBurstTick;
		if (tick !== lastMinorTick) {
			lastMinorTick = tick;
			launchBurst(MINOR_WIN_COIN_COUNT, stateGame.minorWinCoinBurstAmount);
		}
	});

	// Bonus round just ended and its treasure screen has slid away: pour the round's total into the balance
	// coin. A bonus round shows no win modal (the treasure screen is its whole presentation), so this is the
	// only collect it gets — hence the biggest stream of the three, just under the renderer's 48-coin cap.
	// `onBonusEndAnnouncementClosed` bumps `bonusEndCoinBurstTick` (see gameOrchestrator).
	const BONUS_END_COIN_COUNT = 40;
	let lastBonusEndTick = stateGame.bonusEndCoinBurstTick;
	$effect(() => {
		const tick = stateGame.bonusEndCoinBurstTick;
		if (tick !== lastBonusEndTick) {
			lastBonusEndTick = tick;
			launchBurst(BONUS_END_COIN_COUNT, stateGame.bonusEndCoinBurstAmount, true);
		}
	});

	// A free spin that triggered MID-BONUS: its wheel has just closed, so throw a stream out of the
	// skull's mouth toward the HUD's Win readout — where its `stake × M` went.
	//
	// HOW IT ARRIVES DEPENDS ON THE LAYOUT, because the two HUDs give it different things to arrive at.
	// PORTRAIT prints a coin icon beside the Win value, so the stream MERGES into it — coins shrink in
	// and pop it, exactly like a collect merging into the balance coin. LANDSCAPE has only the Win
	// plaque, nothing to merge with, so its stream DISSOLVES on approach (`fadeOut`) rather than piling
	// into the side of a text field. Read off the DOM (only the portrait HUD renders the coin target)
	// instead of re-deriving the breakpoint here.
	//
	// Either way it drives none of the BALANCE-side feedback: no glow, no sparkle, no "+win" under the
	// wallet. Nothing is being paid into the balance here — the credit is a bonus-round subtotal, and
	// the balance only sees it at the end-of-round collect. What the coins DO carry is the Win field's
	// own beat: the value was pinned at its pre-credit figure when the wheel landed
	// (`applyFreeSpinWinOnLand`), and as the coins reach it the field floats a "+<credit>" and counts up
	// to the new total.
	//
	// PACING is tighter than the collects' (which are tuned for ~40 coins pouring into the balance): the
	// level-up card and the end-of-round screen both queue behind this stream
	// (`isFreeSpinWheelOwningScreen`), so every extra beat here is a beat the next celebration waits.
	// `onFreeSpinRouletteFinished` bumps `inBonusFreeSpinCoinBurstTick` (see rouletteFlow).
	const FREE_SPIN_COIN_STAGGER_MS = 420;
	const FREE_SPIN_COIN_FLIGHT_MS = 1000;
	// When the first FADING coins have reached the field (a coin is fully faded by 0.9 of its flight).
	// The merging stream doesn't need this — it releases on a real arrival.
	const FREE_SPIN_COIN_ARRIVE_MS = 1000;
	// When the LAST one has: the last launch (stagger + its jitter) plus a full flight, rounded up.
	const FREE_SPIN_COIN_STREAM_MS = 2000;

	/** Float the "+<credit>" out of the Win field and hand its held value to the count-up. */
	function releaseWinFieldCredit(amount: number) {
		if (amount > 0) {
			stateGame.winFieldFloatAmount = amount;
			stateGame.winFieldFloatTick++;
		}
		if (stateGame.winFieldHold !== null) stateGame.winFieldReleaseTick++;
	}

	function launchFreeSpinWinCoins() {
		const amount = stateGame.inBonusFreeSpinCoinBurstAmount;
		const multiplier = stateGame.inBonusFreeSpinCoinBurstMultiplier;
		// The float + count-up fire once per stream, off whichever comes first: a coin actually landing
		// (portrait) or the beat the fading ones reach the field (landscape). The stream's end backstops
		// both.
		let released = false;
		const releaseOnce = () => {
			if (released) return;
			released = true;
			releaseWinFieldCredit(amount);
		};
		const live = Boolean(renderer) && ready;
		const mergeInto = live ? rectCenter(WIN_COIN_TARGET) : undefined;
		const to = mergeInto ?? (live ? rectCenter(WIN_FIELD_TARGET) : undefined);
		// Nothing to throw the coins at (renderer not up, no Win readout on screen): still settle the
		// field and let whatever is queued behind the stream go, rather than pinning the value on a burst
		// that is never coming.
		if (!renderer || !to) {
			releaseOnce();
			endInBonusFreeSpinCoinStream();
			return;
		}
		// ONE COIN PER MULTIPLE WON: 1X throws a single coin, 20X throws twenty. A sub-1X segment paid
		// less than a whole coin, so it throws one coin shrunk to the fraction it paid (0.5X → a visibly
		// smaller coin) — the floor keeps it readable rather than a speck.
		const count = Math.max(1, Math.round(multiplier));
		const sizeScale = multiplier > 0 && multiplier < 1 ? Math.max(0.55, multiplier) : 1;
		// Bed keyed to the COIN COUNT, not the ball tier `playSpawnSfx` reads: a 1X throwing one coin
		// under the long multi-ball shuffle would be all sound and no coins.
		playSound(count <= 3 ? 'coinShuffleSingle' : 'coinShuffleMulti');
		renderer.burst({
			from: burstOrigin(),
			to,
			count,
			sizeScale,
			fadeOut: !mergeInto,
			staggerMs: FREE_SPIN_COIN_STAGGER_MS,
			durationMs: FREE_SPIN_COIN_FLIGHT_MS,
			// Merging coins land IN the icon: each one clicks and pops it, and the FIRST to get there is
			// what releases the field — truer than a timer, which has to guess the flight. A fading stream
			// has no arrivals at all, so it rides the timer below instead.
			onArrive: mergeInto
				? () => {
						pulseCoinTarget(WIN_COIN_TARGET);
						playMergeSfx();
						releaseOnce();
					}
				: undefined,
		});
		if (!mergeInto) schedule(FREE_SPIN_COIN_ARRIVE_MS, releaseOnce);
		// Coins are gone — release the screen for the level-up card / end-of-round screen behind them.
		schedule(FREE_SPIN_COIN_STREAM_MS, () => {
			releaseOnce();
			endInBonusFreeSpinCoinStream();
		});
	}

	let lastFreeSpinWinTick = stateGame.inBonusFreeSpinCoinBurstTick;
	$effect(() => {
		const tick = stateGame.inBonusFreeSpinCoinBurstTick;
		if (tick !== lastFreeSpinWinTick) {
			lastFreeSpinWinTick = tick;
			launchFreeSpinWinCoins();
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
