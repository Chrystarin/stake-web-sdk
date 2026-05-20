<script lang="ts">
	import { tick } from 'svelte';

	import { PlinkoEngine, type BallDroppedEvent } from '../plinko-engine/PlinkoEngine';
	import { getContext } from '../game/context';
	import { registerBonusBallOutcome } from '../game/gameOrchestrator';
	import config from '../game/config';
	import { stateGame, stateGameDerived } from '../game/stateGame.svelte';
	import type { PlinkoBallOutcome } from '../game/typesBookEvent';

	type Props = {
		coefficients: number[];
		rows: number;
		animationEnabled?: boolean;
		animationSpeed?: number;
		onBallDropped?: (event: BallDroppedEvent) => void;
		onCoinPegHit?: () => void;
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

		const sets = config.defaultCoefficientSets as number[][][];
		const coeffs =
			props.coefficients.length > 0
				? props.coefficients
				: stateGameDerived.coefficientsForDifficulty(
						stateGame.difficultyLevelId,
						stateGame.rowCount,
						sets,
					);

		engine.updateScene(coeffs, props.rows || stateGame.rowCount, props.animationEnabled ?? true);
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
					onCoinPegHit: () => props.onCoinPegHit?.(),
				});
				engine = eng;
				await bootstrapEngine(eng);
				if (disposed) return;

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
			const dropped = engine.dropBall(-1);
			if (!dropped) return;
			const mult = props.coefficients[dropped.targetIndex] ?? 1;
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

		const n = outcomes.length;
		const ballsPerDrop = Math.max(1, stateGame.ballPerDrop);
		const minSec = ballsPerDrop / 10;
		const maxSec = (ballsPerDrop / 10) * 2;
		const totalMs = (minSec + Math.random() * (maxSec - minSec)) * 1000;
		const delays = n <= 1 ? [0] : Array.from({ length: n }, (_, i) => (i / (n - 1)) * totalMs);
		const targetIndices = outcomes.map((o) => o.rateIndex);
		const pending = new Map<number, PlinkoBallOutcome>();

		engine.dropBallBurst(targetIndices, delays, ({ dropped, index }) => {
			const outcome = outcomes[index];
			if (!outcome || !dropped) return;
			pending.set(dropped.ballId, outcome);
		});

		stateGame.expectedOutcomeByBallId = pending;
	}
</script>

<div class="plinko-root">
	<div class="plinko-host" bind:this={hostEl}></div>
</div>

<style>
	.plinko-root {
		display: flex;
		flex-direction: column;
		width: 100%;
		height: 100%;
		min-height: inherit;
		flex: 1;
		position: relative;
		z-index: 2;
		overflow: visible;
	}

	.plinko-host {
		width: 100%;
		height: min(54vw, 100%);
		flex: 1;
		min-height: 0;
		max-height: 100%;
		margin: 2.4vw auto 0;
		position: relative;
		overflow: visible;
		box-sizing: border-box;
		background: transparent;
	}

	.plinko-host :global(canvas) {
		display: block;
		width: 100% !important;
		height: 100% !important;
		position: relative;
		z-index: 1;
		background: transparent !important;
	}

	:global(.game-area--pixi-fill) .plinko-root {
		flex: 1;
		min-height: 0;
	}

	:global(.game-area--pixi-fill) .plinko-host {
		flex: 0 1 auto;
		min-height: 0;
		height: min(54vw, 100%);
		max-height: 100%;
		width: 100%;
		margin-inline: auto;
	}

	:global(.game-root--mobile) .plinko-root {
		justify-content: flex-start;
		align-items: center;
	}

	:global(.game-root--mobile) .plinko-host {
		width: 100%;
		max-width: 100%;
		flex: 0 1 auto;
		min-height: 0;
		max-height: none;
		height: var(--mobile-pixi-height, 63vw);
		margin-left: 0;
		margin-top: 0;
		overflow: visible;
	}
</style>
