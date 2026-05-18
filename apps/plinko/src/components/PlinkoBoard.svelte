<script lang="ts">

	import { onMount, tick } from 'svelte';



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



	let hostEl: HTMLDivElement;

	/** Must be reactive so `$effect` re-runs after bootstrap (plain `let` never triggers effects). */
	let engine = $state<PlinkoEngine | undefined>(undefined);



	const context = getContext();



	const handleBallDropped = (event: BallDroppedEvent) => {

		props.onBallDropped?.(event);

		context.eventEmitter.broadcast({ type: 'soundOnce', name: 'pocket' });

	};



	onMount(() => {

		const eng = new PlinkoEngine({

			hostElement: hostEl,

			onBallDropped: handleBallDropped,

			onCoinPegHit: () => props.onCoinPegHit?.(),

		});

		engine = eng;

		void eng.init().then(async () => {

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

		});



		return () => {

			eng.destroy();

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

	function spawnOutcomes(outcomes: PlinkoBallOutcome[]) {

		if (!engine) return;

		const n = outcomes.length;

		const ballsPerDrop = Math.max(1, stateGame.ballPerDrop);

		const minSec = ballsPerDrop / 10;

		const maxSec = (ballsPerDrop / 10) * 2;

		const totalMs = (minSec + Math.random() * (maxSec - minSec)) * 1000;

		const delays =

			n <= 1 ? [0] : Array.from({ length: n }, (_, i) => (i / (n - 1)) * totalMs);

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
	}

	.plinko-host {
		width: 100%;
		height: 100%;
		flex: 1;
		min-height: inherit;
		position: relative;
		overflow: visible;
	}

	.plinko-host :global(canvas) {
		display: block;
		width: 100% !important;
		height: 100% !important;
	}

	:global(.game-root--mobile) .plinko-host {
		min-height: var(--mobile-pixi-height, 55vw);
	}
</style>

