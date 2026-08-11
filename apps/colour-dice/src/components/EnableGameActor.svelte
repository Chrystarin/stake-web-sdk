<script lang="ts">
	import { onMount } from 'svelte';

	import { gameActor } from '../game/actor';
	import { getContext } from '../game/context';
	import { stateGame } from '../game/stateGame.svelte';
	import {
		hasActiveRoundToResume,
		activeRoundHasNoPayout,
		closeActiveRgsRound,
	} from '../game/activeRound';

	const context = getContext();

	/**
	 * Clear whatever round the RGS still has open at load.
	 *
	 * Two routes, because the SDK only ever closes a round as a side effect of settling a WIN:
	 *  - a round that paid out is replayed through the resume machine, which ends it;
	 *  - a zero-payout round is invisible to that path, so it is closed directly.
	 */
	const finishOpenRound = async () => {
		if (!hasActiveRoundToResume()) return;

		if (activeRoundHasNoPayout()) {
			const { ok, error } = await closeActiveRgsRound();
			if (!ok) {
				stateGame.openRoundError =
					`Your previous round could not be closed by the server${error ? ` (${error})` : ''}. ` +
					`Betting is blocked until it clears — try a new session.`;
			}
			return;
		}
		gameActor.send({ type: 'RESUME_BET' });
	};

	onMount(() => {
		const { unsubscribe } = gameActor.subscribe((snapshot) => {
			context.stateXstate.value = snapshot.value;
		});

		gameActor.start();
		gameActor.send({ type: 'RENDERED' });

		// Finish any round the RGS still has open BEFORE the player can bet — otherwise the
		// first /wallet/play is rejected with ERR_VAL "player has active round". `Authenticate`
		// wraps this component, so `betToResume` is already populated by the time we mount.
		// Queued so the RENDERED transition (rendering -> idle) has landed first; RESUME_BET is
		// only accepted from idle.
		queueMicrotask(() => void finishOpenRound());

		return () => {
			unsubscribe();
			gameActor.stop();
		};
	});

	context.eventEmitter.subscribeOnMount({
		bet: () => gameActor.send({ type: 'BET' }),
		// Without this an RGS round left open by a reload or a dropped connection is never
		// finished, and every subsequent /wallet/play is rejected with
		// ERR_VAL "player has active round".
		resumeBet: () => gameActor.send({ type: 'RESUME_BET' }),
	});
</script>
