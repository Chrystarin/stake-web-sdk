<script lang="ts">
	import { onMount } from 'svelte';

	import { stateBet } from 'state-shared';

	import { gameActor } from '../game/actor';
	import { getContext } from '../game/context';
	import { closeActiveRgsRound, hasReplayablePlinkoBookState } from '../game/plinkoActiveRound';

	const context = getContext();

	onMount(() => {
		let settled = false;

		const trySettleActiveRound = () => {
			if (settled) return;

			const betToResume = stateBet.betToResume as {
				active?: boolean;
				mode?: string;
				state?: unknown[];
			} | null;

			if (betToResume?.active && betToResume.mode) {
				stateBet.activeBetModeKey = betToResume.mode;
			}

			const hasReplayState = hasReplayablePlinkoBookState(betToResume?.state);
			if (betToResume?.active && hasReplayState) {
				settled = true;
				context.eventEmitter.broadcast({ type: 'resumeBet' });
				return;
			}

			if (betToResume?.active) {
				settled = true;
				void closeActiveRgsRound();
			}
		};

		const { unsubscribe } = gameActor.subscribe((snapshot) => {
			if (snapshot.value !== 'idle') return;
			trySettleActiveRound();
		});

		if (gameActor.getSnapshot().value === 'idle') {
			trySettleActiveRound();
		}

		return unsubscribe;
	});
</script>
