<script lang="ts">
	import { type Snippet } from 'svelte';
	import { page } from '$app/state';

	import { Authenticate } from 'components-shared';
	import { stateBet, stateConfig } from 'state-shared';
	import { BET_PER_BALL_PRESETS } from '../game-logic/constants';
	import config from '../game/config';
	import { plinkoWagerAmount } from '../game/plinkoBet';
	import { stateGame } from '../game/stateGame.svelte';
	import {
		applyCachedBonusMeterToDisplay,
		applyCachedSpinMeterToDisplay,
		hydrateSessionBonusMeterCache,
		hydrateSessionSpinMeterCache,
	} from '../game/plinkoSessionMeters';

	type Props = { children: Snippet };

	const props: Props = $props();

	const useLocalDevSession = $derived.by(() => {
		if (!import.meta.env.DEV) return false;
		const rgs = page.url.searchParams.get('rgs_url')?.trim() ?? '';
		const session = page.url.searchParams.get('sessionID')?.trim() ?? '';
		return !rgs || !session;
	});

	function dropWagerForStakePerBall(stakePerBall: number): number {
		return Math.max(0, stakePerBall) * Math.max(1, Math.floor(stateGame.ballPerDrop || 1));
	}

	function pickAffordableStakePerBall(): number {
		const opts = stateConfig.betAmountOptions?.length
			? stateConfig.betAmountOptions
			: BET_PER_BALL_PRESETS.filter((v) => v >= config.minBet && v <= config.maxBet);
		if (!opts.length) return config.minBet;

		const balance = Math.max(0, stateBet.balanceAmount);
		const affordable = opts.filter(
			(stakePerBall) =>
				dropWagerForStakePerBall(stakePerBall) > 0 &&
				dropWagerForStakePerBall(stakePerBall) <= balance,
		);
		return affordable.at(-1) ?? opts[0] ?? config.minBet;
	}

	function seedSessionDefaults(): void {
		stateBet.activeBetModeKey = 'base';

		if (!stateConfig.betAmountOptions?.length) {
			const opts = BET_PER_BALL_PRESETS.filter(
				(v) => v >= config.minBet && v <= config.maxBet,
			);
			stateConfig.betAmountOptions = [...opts];
			stateConfig.betMenuOptions = [...opts];
		}

		if (stateBet.betAmount <= 0) {
			stateBet.betAmount = pickAffordableStakePerBall();
		} else {
			const maxPerBall =
				stateGame.ballPerDrop > 0
					? stateBet.balanceAmount / stateGame.ballPerDrop
					: stateBet.betAmount;
			stateBet.betAmount = Math.max(0, Math.min(stateBet.betAmount, maxPerBall));
			if (stateBet.betAmount <= 0 || plinkoWagerAmount() > stateBet.balanceAmount) {
				stateBet.betAmount = pickAffordableStakePerBall();
			}
		}

		stateBet.wageredBetAmount = stateBet.wageredBetAmount || stateBet.betAmount;
		hydrateSessionSpinMeterCache();
		hydrateSessionBonusMeterCache();
		applyCachedSpinMeterToDisplay();
		applyCachedBonusMeterToDisplay();
	}

	function seedLocalDevSession(): void {
		stateBet.currency = stateBet.currency || 'USD';
		stateBet.balanceAmount = stateBet.balanceAmount || 1000;
		seedSessionDefaults();
	}

	$effect(() => {
		if (useLocalDevSession) {
			seedLocalDevSession();
			return;
		}
		// After RGS authenticate sets balance + bet levels, ensure mode/stake are valid.
		if (stateBet.balanceAmount > 0) {
			seedSessionDefaults();
		}
	});
</script>

{#if useLocalDevSession}
	{@render props.children()}
{:else}
	<Authenticate>
		{@render props.children()}
	</Authenticate>
{/if}
