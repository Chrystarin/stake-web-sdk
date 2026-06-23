<script lang="ts">
	import { onMount } from 'svelte';

	import { stateBet } from 'state-shared';

	import { gameActor } from '../game/actor';
	import { getContext } from '../game/context';
	import { closeActiveRgsRound, hasReplayablePlinkoBookState } from '../game/plinkoActiveRound';
	import { normalizePlinkoBetToResume } from '../game/plinkoReplay';
	import { stateGame } from '../game/stateGame.svelte';

	const context = getContext();

	/** Give up waiting on the Pixi board after this long and start anyway (init failed / hidden tab). */
	const ENGINE_READY_TIMEOUT_MS = 10_000;

	onMount(() => {
		let settled = false;
		let engineWaitScheduled = false;
		const startedAt = Date.now();

		const trySettleActiveRound = () => {
			if (settled) return;

			// The /bet/replay payload keys its book events as `events`; copy them onto `.state` so the
			// replayable-state gate below (and `resumeGame`) can find them. No-op for a normal resume.
			normalizePlinkoBetToResume();

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
				// The Pixi board must be initialized before playback, otherwise the `plinkoDrop` spawn is
				// silently dropped (`if (!engine) return`). Replay/resume fires on mount with no network
				// delay to cover engine init, so wait here until the board is ready (with a safety cap).
				if (!stateGame.plinkoEngineReady && Date.now() - startedAt < ENGINE_READY_TIMEOUT_MS) {
					if (!engineWaitScheduled) {
						engineWaitScheduled = true;
						const waitForEngine = () => {
							if (settled) return;
							if (
								stateGame.plinkoEngineReady ||
								Date.now() - startedAt >= ENGINE_READY_TIMEOUT_MS
							) {
								engineWaitScheduled = false;
								trySettleActiveRound();
								return;
							}
							requestAnimationFrame(waitForEngine);
						};
						requestAnimationFrame(waitForEngine);
					}
					return;
				}
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
