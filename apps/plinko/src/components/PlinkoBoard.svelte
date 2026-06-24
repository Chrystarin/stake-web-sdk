<script lang="ts">
	import { tick } from 'svelte';

	import { PlinkoEngine, type BallDroppedEvent } from '../plinko-engine/PlinkoEngine';
	import { getContext } from '../game/context';
	import { registerBonusBallOutcome, takeAuthoritativeBonusOutcome } from '../game/gameOrchestrator';
	import { assertAuthoritativeOutcome } from '../game/plinkoFairnessGuard';
	import { coefficientsForRowCount, PLINKO_VISUAL_ROWS } from '../game-logic/constants';
	import { isSpinSlotRateIndex } from '../game-logic/spinSlot';
	import config from '../game/config';
	import { stateGame } from '../game/stateGame.svelte';
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
		context.eventEmitter.broadcast({ type: 'soundOnce', name: 'pocket' });
	};

	function syncEngineScene() {
		if (!engine) return;

		const coeffs =
			props.coefficients.length > 0
				? props.coefficients
				: coefficientsForRowCount(config.coefficientSets as number[][], stateGame.rowCount);

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
				});
				engine = eng;
				await bootstrapEngine(eng);
				if (disposed) return;
				// Signal readiness so replay/resume can start playback now the board can spawn balls.
				stateGame.plinkoEngineReady = true;

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
			layoutObserver?.disconnect();
			eng?.destroy();
			engine = undefined;
			stateGame.plinkoEngineReady = false;
		};
	});

	context.eventEmitter.subscribeOnMount({
		plinkoDrop: ({ outcomes, fastMode }) => {
			if (!engine) return;
			syncEngineScene();
			engine.animationSpeed = fastMode ? 3 : 0.7;
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
		const totalMs = (minSec + Math.random() * (maxSec - minSec)) * 1000;
		const delays = n <= 1 ? [0] : Array.from({ length: n }, (_, i) => (i / (n - 1)) * totalMs);
		const targetIndices = outcomes.map((o) => o.rateIndex);
		const hitBonusPegs = outcomes.map((o) => o.hitBonusPeg === true);

		stateGame.expectedOutcomeByBallId = new Map<number, PlinkoBallOutcome>();
		stateGame.pendingSpacedSpawnTimers = n;
		engine.dropBallBurst(targetIndices, delays, ({ dropped, index }) => {
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

	.plinko-host :global(canvas) {
		display: block;
		width: 100% !important;
		height: 100% !important;
		position: relative;
		z-index: 1;
		background: transparent !important;
	}
</style>
