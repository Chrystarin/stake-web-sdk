<script lang="ts">
	import { onMount } from 'svelte';
	import { stateBet, stateConfig, stateUrlDerived } from 'state-shared';
	import { API_AMOUNT_MULTIPLIER } from 'constants-shared/bet';

	import { getContext } from '../game/context';
	import { devReplayBook, playDevLocalBook } from '../game/devLocalBet';
	import { isReplay } from '../game/replay';
	import { stateGameDerived } from '../game/stateGame.svelte';
	import { backedSpotsForResume, buyModeForResume } from '../game/activeRound';
	import { playBet } from '../game/utils';
	import type { Bet } from '../game/typesBookEvent';

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

	/**
	 * Offline replay: what the resume machine does online, without the machine. The round waiting
	 * on `stateBet.betToResume` is played as it stands; no balance moves, as in a real replay.
	 */
	const runReplay = async () => {
		const round = stateBet.betToResume as (Bet & { mode?: string }) | null;
		if (!round || !context.stateXstateDerived.isIdle()) return;
		stateBet.betToResume = null;
		context.stateXstate.value = 'bet';
		try {
			stateGameDerived.applyResumedSelection(
				backedSpotsForResume(round.state, round),
				buyModeForResume(round),
			);
			await playBet(round);
		} catch (error) {
			console.error('[Crazy Time] dev replay failed', error);
		} finally {
			context.stateXstate.value = 'idle';
		}
	};

	/** Stand in for the shared Authenticate's replay branch: URL currency and amount, a local book. */
	const mountReplay = () => {
		stateBet.currency = (stateUrlDerived.currency() || 'USD') as typeof stateBet.currency;
		stateBet.betAmount = stateUrlDerived.amount() / API_AMOUNT_MULTIPLIER || 0;
		stateBet.wageredBetAmount = stateBet.betAmount;
		stateBet.activeBetModeKey = stateUrlDerived.mode();
		const book = devReplayBook(stateUrlDerived.mode(), stateUrlDerived.event());
		if (book) stateBet.betToResume = { ...book, event: '0', active: true } as unknown as Bet;
		context.stateXstate.value = 'idle';
	};

	/**
	 * `?balance=<amount>` starts the offline wallet there, in whole currency units (`?balance=3.5`
	 * is 3.50), to try a board the balance only half covers, greyed chips, or an empty wallet.
	 * Anything that is not a number of 0 or more falls back to 1,000.
	 */
	const startingBalance = (): number => {
		const raw = new URLSearchParams(window.location.search).get('balance');
		if (raw === null || raw.trim() === '') return 1000;
		const value = Number(raw);
		if (Number.isFinite(value) && value >= 0) return value;
		console.warn(`[crazy-time] ?balance=${raw} is not a usable balance; starting at 1,000`);
		return 1000;
	};

	onMount(() => {
		if (isReplay()) {
			mountReplay();
			return;
		}
		// Fake an authenticated session so the game is playable offline (no RGS).
		// `?currency=PLN` tries the table in another currency's form (game/currency.ts).
		stateBet.currency = (stateUrlDerived.currency() || 'USD') as typeof stateBet.currency;
		stateBet.balanceAmount = startingBalance();
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
		resumeBet: () => void runReplay(),
	});
</script>
