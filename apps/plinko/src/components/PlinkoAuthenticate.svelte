<script lang="ts">
	import { type Snippet } from 'svelte';
	import { page } from '$app/state';

	import { Authenticate } from 'components-shared';
	import { stateBet, stateConfig } from 'state-shared';
	import { BET_PER_BALL_PRESETS } from '../game-logic/constants';
	import config from '../game/config';
	import {
		maxAffordableStakePerBall,
		plinkoPlayAmount,
		plinkoWagerAmount,
		snapStakeToBetLevels,
	} from '../game/plinkoBet';
import { syncPlinkoBetModeFromUi } from '../game/plinkoBetMode';
	import { stateGame } from '../game/stateGame.svelte';
	import { applyRgsSessionMetersToDisplay } from '../game/plinkoSessionMeters';

	type Props = { children: Snippet };

	const props: Props = $props();

	const useLocalDevSession = $derived.by(() => {
		if (!import.meta.env.DEV) return false;
		const rgs = page.url.searchParams.get('rgs_url')?.trim() ?? '';
		const session = page.url.searchParams.get('sessionID')?.trim() ?? '';
		const forceLocalBooks = page.url.searchParams.get('localBooks') === '1';
		return forceLocalBooks || !rgs || !session;
	});

	function pickAffordableStakePerBall(): number {
		const affordable = maxAffordableStakePerBall();
		if (affordable > 0) return affordable;
		const opts = plinkoStakePerBallOptions();
		return opts[0] ?? config.minBet;
	}

	function seedSessionDefaults(): void {
		syncPlinkoBetModeFromUi();

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
			const maxPerBall = maxAffordableStakePerBall() || stateBet.betAmount;
			stateBet.betAmount = snapStakeToBetLevels(
				Math.max(0, Math.min(stateBet.betAmount, maxPerBall)),
			);
			if (stateBet.betAmount <= 0 || plinkoWagerAmount() > stateBet.balanceAmount) {
				stateBet.betAmount = pickAffordableStakePerBall();
			}
		}

		// Win display multiplies `payoutMultiplier` by this — use the play amount (per-ball
		// stake = RGS `amount`), not the total wager, so displayed win matches the balance credit.
		stateBet.wageredBetAmount = plinkoPlayAmount() || stateBet.betAmount;
		applyRgsSessionMetersToDisplay();
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
