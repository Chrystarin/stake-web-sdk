<script lang="ts">
	import { type Snippet } from 'svelte';
	import { page } from '$app/state';

	import { Authenticate } from 'components-shared';
	import { stateBet, stateConfig, stateUrlDerived } from 'state-shared';
	import { BET_PER_BALL_PRESETS } from '../game-logic/constants';
	import config from '../game/config';
	import {
		maxAffordableStakePerBall,
		plinkoPlayAmount,
		plinkoStakePerBallOptions,
		snapStakeToBetLevels,
	} from '../game/plinkoBet';
import { syncPlinkoBetModeFromUi } from '../game/plinkoBetMode';
	import { stateGame } from '../game/stateGame.svelte';
	import { stateXstateDerived } from '../game/stateXstate';
	import { applyRgsSessionMetersToDisplay } from '../game/plinkoSessionMeters';

	type Props = { children: Snippet };

	const props: Props = $props();

	// Set once the launch stake has been seeded, so the RGS `defaultBetLevel` is adopted only on the
	// first fresh-session seed and never clobbers the player's later stake changes.
	let hasSeededInitialStake = false;

	const useLocalDevSession = $derived.by(() => {
		if (!import.meta.env.DEV) return false;
		// Replay must always go through the shared Authenticate (which fetches the replay book), even in
		// dev where a missing sessionID would otherwise drop into local-book mode.
		if (stateUrlDerived.replay()) return false;
		const rgs = page.url.searchParams.get('rgs_url')?.trim() ?? '';
		const session = page.url.searchParams.get('sessionID')?.trim() ?? '';
		const forceLocalBooks = page.url.searchParams.get('localBooks') === '1';
		return forceLocalBooks || !rgs || !session;
	});

	function pickAffordableStakePerBall(): number {
		const affordable = maxAffordableStakePerBall();
		// Honor the RGS-suggested `defaultBetLevel` (from /wallet/authenticate) as the starting stake
		// when it's provided and affordable — snapped onto the betLevels grid so it stays RGS-valid.
		if (stateConfig.defaultBetLevel > 0) {
			const snapped = snapStakeToBetLevels(stateConfig.defaultBetLevel);
			if (snapped > 0 && (affordable <= 0 || snapped <= affordable)) return snapped;
		}
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

		// Latch on the first real seed (past the round-in-progress guard) so the default-bet adoption
		// below only ever happens once — later reactive re-runs respect the player's own stake choice.
		const isFirstSeed = !hasSeededInitialStake;
		hasSeededInitialStake = true;

		// FIRST launch of a fresh session (no active round to resume): take the starting bet straight
		// from the RGS `defaultBetLevel` (populated by Authenticate from `/wallet/authenticate`) rather
		// than the shared placeholder stake, which defaults every currency to 1.00. The value is used
		// as-is — it is already a valid, per-currency `betLevels` entry from the RGS, so it is not
		// derived or clamped here. Gated to fresh launches only: a resumed round already has its amount
		// applied by Authenticate, and dev/no-default sessions fall through to the existing snap logic.
		if (isFirstSeed && !stateBet.betToResume && stateConfig.defaultBetLevel > 0) {
			stateBet.betAmount = stateConfig.defaultBetLevel;
		} else if (stateBet.betAmount <= 0) {
			stateBet.betAmount = pickAffordableStakePerBall();
		} else {
			// Keep the player's chosen stake exactly where they set it — only snap it onto a valid
			// betLevels entry (RGS validity). This effect re-runs whenever the balance changes, so any
			// balance-based shrink here would silently drop bet-per-ball after a losing round. We never
			// auto-adjust to the balance: an unaffordable stake instead disables the Bet button
			// (`canAffordPlinkoWager`).
			stateBet.betAmount = snapStakeToBetLevels(Math.max(0, stateBet.betAmount));
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
		// Replay seeds its own stake / bet-level grid (handleReplay + alignPlinkoUiToReplayBook) from the
		// recorded round. Skip the live-session seeding, which would re-snap a non-USD replay stake onto
		// the USD presets and corrupt the displayed amounts.
		if (stateUrlDerived.replay()) return;
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
