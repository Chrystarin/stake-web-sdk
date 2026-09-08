<script lang="ts">
	import { onMount } from 'svelte';
	import { stateBet, stateConfig } from 'state-shared';

	import { getContext } from '../game/context';
	import { playDevLocalBook } from '../game/devLocalBet';

	const context = getContext();

	const runBet = async () => {
		if (!context.stateXstateDerived.isIdle()) return;
		stateBet.wageredBetAmount = stateBet.betAmount;
		context.stateXstate.value = 'bet';
		try {
			await playDevLocalBook();
		} catch (error) {
			console.error('[Crazy Time] dev bet failed', error);
		} finally {
			context.stateXstate.value = 'idle';
		}
	};

	onMount(() => {
		// Fake an authenticated session so the game is playable offline (no RGS).
		stateBet.currency = 'USD';
		stateBet.balanceAmount = 1000;
		stateBet.betAmount = 5;
		stateBet.wageredBetAmount = 5;
		// Real mode + amount are set by stateGameDerived.beginSpin() from the selection; this is
		// just a valid starting value before the first bet.
		stateBet.activeBetModeKey = 'x1';
		stateConfig.betAmountOptions = [1, 2, 5, 10, 25, 50, 100];
		stateConfig.betMenuOptions = [1, 2, 5, 10, 25, 50, 100];
		stateConfig.minBet = 1;
		stateConfig.maxBet = 100;
		stateConfig.defaultBetLevel = 5;
		context.stateXstate.value = 'idle';
	});

	context.eventEmitter.subscribeOnMount({
		bet: () => void runBet(),
	});
</script>
