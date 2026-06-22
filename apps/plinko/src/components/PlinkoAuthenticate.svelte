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
		plinkoStakePerBallOptions,
		plinkoWagerAmount,
		snapStakeToBetLevels,
	} from '../game/plinkoBet';
import { syncPlinkoBetModeFromUi } from '../game/plinkoBetMode';
	import { stateGame } from '../game/stateGame.svelte';
	import { stateXstateDerived } from '../game/stateXstate';
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

	/**
	 * A bet is in flight: RGS has already debited the wager but not yet credited the win, so the
	 * balance is transiently low. Re-validating the stake against it here would clamp bet-per-ball
	 * down to a tiny value (e.g. 50 → 1) and reset `wageredBetAmount`, which corrupts the win
	 * display (it scales `payoutMultiplier` by `wageredBetAmount`). Only seed/clamp when idle, so
	 * the balance the clamp sees is the true settled balance.
	 */
	function isRoundInProgress(): boolean {
		return (
			stateGame.isSubmitting ||
			stateGame.dropRoundActive ||
			stateXstateDerived.isPlaying()
		);
	}

	function seedBetAmountOptions(): void {
		if (!stateConfig.betAmountOptions?.length) {
			const opts = BET_PER_BALL_PRESETS.filter(
				(v) => v >= config.minBet && v <= config.maxBet,
			);
			stateConfig.betAmountOptions = [...opts];
			stateConfig.betMenuOptions = [...opts];
		}
	}

	function seedSessionDefaults(): void {
		// Balance-independent setup is always safe to (re)apply.
		seedBetAmountOptions();

		// Never shrink the player's chosen stake against a mid-round (debited) balance.
		if (isRoundInProgress()) return;

		syncPlinkoBetModeFromUi();

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
		// No RGS session → use the USD presets as the bet-level grid (the shared default placeholder
		// would otherwise be treated as a foreign currency and scaled). Mirrors a USD RGS session.
		// Idempotent: only assign when the grid differs, so this reactive effect doesn't re-trigger
		// itself on a fresh array reference each run.
		const presets = BET_PER_BALL_PRESETS.filter((v) => v >= config.minBet && v <= config.maxBet);
		const cur = stateConfig.betAmountOptions;
		const alreadySeeded =
			cur?.length === presets.length && presets.every((v, i) => cur[i] === v);
		if (!alreadySeeded) {
			stateConfig.betAmountOptions = [...presets];
			stateConfig.betMenuOptions = [...presets];
		}
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
