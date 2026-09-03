<script lang="ts">
	import { tick } from 'svelte';

	import { PlinkoEngine, type BallDroppedEvent } from '../plinko-engine/PlinkoEngine';
	import { getContext } from '../game/context';
	import {
		isDropBatchPending,
		isRapidSingleBallMode,
		registerBonusBallOutcome,
		settleInFlightBallsWithoutAnimation,
		takeAuthoritativeBonusOutcome,
	} from '../game/gameOrchestrator';
	import { assertAuthoritativeOutcome } from '../game/plinkoFairnessGuard';
	import { coefficientsForTier, PLINKO_VISUAL_ROWS, SIM_SPEED } from '../game-logic/constants';
	import { isSpinSlotRateIndex, spinPocketActiveForBallsPerDrop } from '../game-logic/spinSlot';
	import { activeMeterTierBalls } from '../game/plinkoSessionMeters';
	import { isPhoneScreen } from '../lib/backdropArt';
	import { frameImagePoint, SKULL_MOUTH_CAVITY, SKULL_MOUTH_CAVITY_HALF_W } from '../lib/frameArt';
	import config from '../game/config';
	import { pocketPitchForMultiplier } from '../game/sound';
	import { plinkoSimSpeed, plinkoSpawnPacingScale, stateGame } from '../game/stateGame.svelte';
	import type { PlinkoBallOutcome } from '../game/typesBookEvent';

	type Props = {
		coefficients: number[];
		rows: number;
		animationEnabled?: boolean;
		animationSpeed?: number;
		onBallDropped?: (event: BallDroppedEvent) => void;
		onCoinPegHit?: (event: { row: number; col: number; ballId: number }) => void;
	};

	const props: Props = $props();

	let hostEl = $state<HTMLDivElement | undefined>(undefined);
	let engine = $state<PlinkoEngine | undefined>(undefined);

	const context = getContext();

	const handleBallDropped = (event: BallDroppedEvent) => {
		props.onBallDropped?.(event);
		// Pitch the landing sound up on higher-paying pockets (center 0× is lowest, edge 100× highest).
		context.eventEmitter.broadcast({
			type: 'soundOnce',
			name: 'pocket',
			rate: pocketPitchForMultiplier(event.multiplier),
		});
	};

	// Per-peg "thunk" — fired immediately on every peg contact so hits in quick succession overlap
	// (a single ball bounces off ~13 pegs on the way down, and a multi-ball drop many more). Each
	// play() spawns its own Howler voice, so a new thunk mixes over any still ringing out. Slight
	// random pitch keeps rapid repeats from sounding machine-gun identical. Coin (featured) pegs
	// ring out distinctly higher-pitched than normal pegs.
	const handlePegBounce = (event: { featured: boolean }) => {
		// Coin (featured) peg plays its own coin_peg.mp3 sample, with a touch of random pitch. Normal
		// pegs keep the original peg "thunk".
		context.eventEmitter.broadcast(
			event.featured
				? { type: 'soundOnce', name: 'coinPeg', rate: 0.94 + Math.random() * 0.12 }
				: { type: 'soundOnce', name: 'peg', rate: 0.92 + Math.random() * 0.16 },
		);
	};

	function syncEngineScene() {
		if (!engine) return;

		const coeffs =
			props.coefficients.length > 0
				? props.coefficients
				: coefficientsForTier(
						config.coefficientSets as number[][],
						config.coefficientSetsByBalls,
						stateGame.rowCount,
						stateGame.ballPerDrop,
					);

		// Visual pyramid uses a fixed row count (decoupled from the math rowCount); the ball is
		// choreographed to its server slot index regardless of peg rows.
		engine.updateScene(coeffs, PLINKO_VISUAL_ROWS, props.animationEnabled ?? true);
		engine.refreshLayoutSync();
	}

	async function bootstrapEngine(eng: PlinkoEngine) {
		await eng.init();
		await tick();
		syncEngineScene();
		if (props.animationSpeed != null) eng.animationSpeed = props.animationSpeed;
		await tick();
		eng.bustResizeDedupe();
		eng.refreshLayoutSync();
		queueMicrotask(() => {
			eng.bustResizeDedupe();
			eng.refreshLayoutSync();
		});
		requestAnimationFrame(() => {
			requestAnimationFrame(() => eng.refreshLayoutSync());
		});
	}

	/** Bootstrap Pixi once the host element exists and flex layout has measured it. */
	$effect(() => {
		const el = hostEl;
		if (!el) return;

		let disposed = false;
		let eng: PlinkoEngine | undefined;
		let layoutObserver: ResizeObserver | undefined;
		let hiddenDriver: ReturnType<typeof setInterval> | undefined;

		const start = async () => {
			await new Promise<void>((resolve) => {
				requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
			});
			if (disposed) return;

			try {
				eng = new PlinkoEngine({
					hostElement: el,
					onBallDropped: handleBallDropped,
					onCoinPegHit: (event) => props.onCoinPegHit?.(event),
					onPegBounce: handlePegBounce,
					// Balls are thrown out of the black cavity in the pirate skull's mouth, which is
					// painted into the game-area frame art rather than drawn by the board. The width
					// comes along so the engine can throw from off-centre without leaving the black.
					resolveSpawnAnchor: () => {
						const centre = frameImagePoint(SKULL_MOUTH_CAVITY.x, SKULL_MOUTH_CAVITY.y);
						if (!centre) return null;
						const edge = frameImagePoint(
							SKULL_MOUTH_CAVITY.x + SKULL_MOUTH_CAVITY_HALF_W,
							SKULL_MOUTH_CAVITY.y,
						);
						return { ...centre, halfWidth: edge ? Math.abs(edge.x - centre.x) : undefined };
					},
				});
				engine = eng;
				// DEV-only: `window.plinkoDebugBoard()` returns live ball and coin geometry, so a
				// drop can be sampled numerically. Ball motion is the thing this board is judged on
				// and a screenshot has ~1s of latency, which is far too coarse to tell a bounce from
				// a slide — see docs/debug-console.md.
				// `window.plinkoBouncePockets()` fires the landing bounce on every pocket at once (pass
				// an index for one). No ball can be made to land in all fifteen, and the outer pockets
				// come up so rarely that "does that one react?" cannot be answered by playing.
				if (import.meta.env.DEV && typeof window !== 'undefined') {
					const w = window as unknown as {
						plinkoDebugBoard?: () => unknown;
						plinkoBouncePockets?: (index?: number) => unknown;
					};
					w.plinkoDebugBoard = () => eng?.debugBoardSnapshot();
					w.plinkoBouncePockets = (index?: number) => eng?.debugBouncePockets(index);
				}
				await bootstrapEngine(eng);
				if (disposed) return;
				// Signal readiness so replay/resume can start playback now the board can spawn balls.
				stateGame.plinkoEngineReady = true;

				// Keep in-flight drops advancing while the tab is backgrounded. The browser pauses
				// Pixi's ticker (rAF) on hide, which would freeze the ball mid-drop and stall an
				// active Autobet run (the round never settles). We drive the physics off a timer
				// instead — only while hidden, so visible frames are left to rAF and never
				// double-stepped. Background timers are throttled, so `advanceWhileHidden` steps by
				// real elapsed time rather than once per tick.
				let lastHiddenTs = performance.now();
				hiddenDriver = setInterval(() => {
					const now = performance.now();
					const dt = (now - lastHiddenTs) / 1000;
					lastHiddenTs = now;
					if (document.hidden) eng?.advanceWhileHidden(dt);
					// Visible: make sure the frame loop is still alive under an in-flight drop (see the engine).
					else eng?.reviveStalledTicker();
				}, 100);

				layoutObserver = new ResizeObserver(() => {
					if (!eng?.hostHasLayoutExtent()) return;
					eng.bustResizeDedupe();
					syncEngineScene();
				});
				layoutObserver.observe(el);
			} catch (err) {
				console.error('[PlinkoBoard] failed to initialize PlinkoEngine', err);
				eng?.destroy();
				engine = undefined;
			}
		};

		void start();

		return () => {
			disposed = true;
			if (hiddenDriver) clearInterval(hiddenDriver);
			hiddenDriver = undefined;
			layoutObserver?.disconnect();
			eng?.destroy();
			engine = undefined;
			stateGame.plinkoEngineReady = false;
			// The engine just took every ball in the air with it, so nothing is left to fire the
			// `onBallDropped` callbacks the round is waiting on. Settle them here or the drop batch stays
			// pending for good and the game soft-locks (see settleInFlightBallsWithoutAnimation). The board
			// no longer unmounts on rotation — this covers the remaining teardown paths (init failure, hot
			// reload, leaving the game).
			if (isDropBatchPending()) settleInFlightBallsWithoutAnimation();
		};
	});

	context.eventEmitter.subscribeOnMount({
		plinkoDrop: ({ outcomes, fastMode }) => {
			if (!engine) return;
			syncEngineScene();
			// `fastMode` is what the ROUND was submitted with; a dev speed override outranks it (and the
			// toggle), so a drop keeps whatever `plinkoSetSpeed` last asked for.
			engine.animationSpeed =
				stateGame.debugSpeedMultiplier != null
					? plinkoSimSpeed()
					: fastMode
						? SIM_SPEED.fast
						: SIM_SPEED.normal;
			spawnOutcomes(outcomes);
		},
		bonusBallDrop: ({ stake }) => {
			if (!engine) return;
			const authoredOutcome =
				stateGame.authoritativeBonusOutcomeIndex < stateGame.authoritativeBonusOutcomes.length
					? takeAuthoritativeBonusOutcome()
					: undefined;
			if (authoredOutcome) {
				const dropped = engine.dropBall(authoredOutcome.rateIndex, {
					hitBonusPeg: authoredOutcome.hitBonusPeg === true,
					deterministic: true,
				});
				if (!dropped) return;
				registerBonusBallOutcome(dropped.ballId, authoredOutcome);
				return;
			}
			// Provably-fair guard: in a live RGS round every bonus ball must come from a book outcome.
			// Reaching this client-random fallback live would break fairness, so surface it (throws in DEV).
			assertAuthoritativeOutcome('bonusBallDrop: no authoritative outcome for ball', {
				outcomeIndex: stateGame.authoritativeBonusOutcomeIndex,
				outcomeCount: stateGame.authoritativeBonusOutcomes.length,
			});
			const dropped = engine.dropBall(-1);
			if (!dropped) return;
			const isSpinSlot = isSpinSlotRateIndex(dropped.targetIndex, props.coefficients.length);
			const mult = isSpinSlot ? 0 : (props.coefficients[dropped.targetIndex] ?? 1);
			registerBonusBallOutcome(dropped.ballId, {
				rateIndex: dropped.targetIndex,
				multiplier: mult,
				amount: stake,
			});
		},
	});

	$effect(() => {
		props.coefficients;
		props.rows;
		props.animationEnabled;
		props.animationSpeed;
		const e = engine;
		if (!e) return;
		syncEngineScene();
		if (props.animationSpeed != null) e.animationSpeed = props.animationSpeed;
	});

	// Phones: halve the board's repaints while the full-screen win reveal is up (same gate WinCelebration
	// mounts on). The balls are down by then; see `PlinkoEngine.setFrameRateCap`.
	const phone = isPhoneScreen();
	$effect(() => {
		const reveal = phone && stateGame.showWinPopup && stateGame.ballPerDrop !== 1;
		engine?.setFrameRateCap(reveal ? 30 : 0);
	});

	// 1-ball rapid tier: the center pocket is a plain 0× slot (no bonus), so the board shows "0"
	// instead of the "SPIN" glyph. Keep the engine in sync as the ball-per-drop tier changes. Keyed to
	// the tier the ROUND plays (`activeMeterTierBalls`), so a bonus BOUGHT from the 1-ball tier — which
	// plays on the math's reference board — gets the "SPIN" glyph back for its duration.
	$effect(() => {
		const rapid = !spinPocketActiveForBallsPerDrop(activeMeterTierBalls());
		engine?.setRapidSingleBall(rapid);
	});

	function spawnOutcomes(outcomes: PlinkoBallOutcome[]) {
		if (!engine) return;

		const coeffs =
			props.coefficients.length > 0
				? props.coefficients
				: stateGame.coefficients.length > 0
					? stateGame.coefficients
					: [];
		if (!coeffs.length) {
			stateGame.pendingSpacedSpawnTimers = 0;
			console.warn('[PlinkoBoard] drop skipped — no coefficients loaded yet');
			return;
		}

		const n = outcomes.length;
		const ballsPerDrop = Math.max(1, stateGame.ballPerDrop);
		const minSec = ballsPerDrop / 10;
		const maxSec = (ballsPerDrop / 10) * 2;
		// Fast Game mode: balls also fall ~3.4× faster, so compress the spawn spread by the same
		// factor — otherwise the 1–2s spacing between spawns dominates the round and fast mode barely
		// ends sooner. Keyed off the live sim speed, so it tracks the toggle AND a dev speed override
		// (whose slow end is capped there, or a deep slow-down would spread the spawns over minutes).
		const spawnSpread = plinkoSpawnPacingScale();
		const totalMs = (minSec + Math.random() * (maxSec - minSec)) * 1000 * spawnSpread;
		const delays = n <= 1 ? [0] : Array.from({ length: n }, (_, i) => (i / (n - 1)) * totalMs);
		const targetIndices = outcomes.map((o) => o.rateIndex);
		const hitBonusPegs = outcomes.map((o) => o.hitBonusPeg === true);

		// Rapid 1-ball mode overlaps drops (prior balls may still be falling), so MERGE this drop's
		// outcomes onto the existing map instead of clearing it — otherwise an in-flight ball loses its
		// authoritative outcome. Every other mode starts each drop from a clean map.
		stateGame.expectedOutcomeByBallId = isRapidSingleBallMode()
			? new Map(stateGame.expectedOutcomeByBallId)
			: new Map<number, PlinkoBallOutcome>();
		// Count only the spawns the engine actually scheduled (0 if it refused the burst) — the callback
		// below is the only thing that decrements this, and it never runs for a burst that never started.
		stateGame.pendingSpacedSpawnTimers = engine.dropBallBurst(targetIndices, delays, ({ dropped, index }) => {
			const outcome = outcomes[index];
			if (outcome && dropped) {
				const next = new Map(stateGame.expectedOutcomeByBallId);
				next.set(dropped.ballId, outcome);
				stateGame.expectedOutcomeByBallId = next;
			}
			stateGame.pendingSpacedSpawnTimers = Math.max(0, stateGame.pendingSpacedSpawnTimers - 1);
		}, hitBonusPegs, { deterministic: stateGame.authoritativeMeterFlow });
	}
</script>

<div class="plinko-root">
	<div class="plinko-host" bind:this={hostEl}></div>
</div>

<style>
	/* Sized/positioned from mode-specific .container CSS vars (desktop vs mobile) */
	.plinko-root {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		z-index: 2;
		overflow: visible;
		pointer-events: none;
	}

	:global(.game-root:not(.game-root--mobile)) .plinko-host {
		left: calc(50% + var(--plinko-area-offset-x, 0vw));
		top: var(--plinko-area-offset-y, 0);
		width: var(--plinko-host-width);
		height: var(--plinko-host-height);
		max-width: var(--plinko-host-width);
		max-height: var(--plinko-host-height);
	}

	:global(.game-root--mobile) .plinko-host {
		left: calc(50% + var(--plinko-area-offset-x-mobile, 0vw));
		top: var(--plinko-area-offset-y-mobile, 0);
		width: var(--plinko-host-width-mobile);
		height: var(--plinko-host-height-mobile);
		max-width: var(--plinko-host-width-mobile);
		max-height: var(--plinko-host-height-mobile);
	}

	.plinko-host {
		position: absolute;
		transform: translateX(-50%);
		box-sizing: border-box;
		overflow: visible;
		background: transparent;
		pointer-events: auto;
	}

	/* The buffer is taller than the host: the board sits low inside it so there is airspace above
	   for the skull-mouth spawn. The engine drives these two vars as a matched pair — the canvas
	   grows upward by exactly the amount it is pulled up by — so the extra airspace becomes visible
	   above the host box while the board itself stays put. Falling back to the plain 100%/0 box (if
	   the vars are ever missing) just hides the airspace again; it never moves the board.
	   `!important` is needed to beat the inline size Pixi's autoDensity writes. */
	.plinko-host :global(canvas) {
		display: block;
		width: 100% !important;
		height: var(--plinko-canvas-height, 100%) !important;
		position: relative;
		top: var(--plinko-canvas-top, 0px);
		z-index: 1;
		background: transparent !important;
	}
</style>
