<script lang="ts">
	import { onMount } from 'svelte';

	import { stateBet } from 'state-shared';

	import { gameActor } from '../game/actor';
	import { getContext } from '../game/context';
	import { closeActiveRgsRound, hasReplayablePlinkoBookState } from '../game/plinkoActiveRound';
	import { isPlinkoReplay, normalizePlinkoBetToResume } from '../game/plinkoReplay';
	import { stateGame } from '../game/stateGame.svelte';

	const context = getContext();

	/** Give up waiting after this long and start anyway (engine init failed / loader hung / hidden tab).
	 * Must exceed the intro splash (~3.4s) so it never pre-empts a normal load. */
	const READY_TIMEOUT_MS = 20_000;
	/** After the splash finishes, wait this long for its fade-out to clear before the first ball drops. */
	const REPLAY_START_BUFFER_MS = 700;

	onMount(() => {
		let settled = false;
		let readyWaitScheduled = false;
		const startedAt = Date.now();

		// Replay/resume fires on mount with no network delay, so the board (and, in replay, the intro
		// splash) may not be ready yet. Starting then would hide the drop behind the loader or drop the
		// `plinkoDrop` spawn entirely (`if (!engine) return`). Gate on both before playing back.
		const isReadyToPlay = () =>
			stateGame.plinkoEngineReady && (!isPlinkoReplay() || stateGame.introLoaderComplete);

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
				if (!isReadyToPlay() && Date.now() - startedAt < READY_TIMEOUT_MS) {
					if (!readyWaitScheduled) {
						readyWaitScheduled = true;
						const waitForReady = () => {
							if (settled) return;
							if (isReadyToPlay() || Date.now() - startedAt >= READY_TIMEOUT_MS) {
								readyWaitScheduled = false;
								trySettleActiveRound();
								return;
							}
							requestAnimationFrame(waitForReady);
						};
						requestAnimationFrame(waitForReady);
					}
					return;
				}
				settled = true;
				// In replay, give the splash's fade-out a beat to clear so the drop starts on a fully
				// visible board (the splash holds longer than engine init, so playback was starting behind it).
				const fire = () => context.eventEmitter.broadcast({ type: 'resumeBet' });
				if (isPlinkoReplay()) {
					setTimeout(fire, REPLAY_START_BUFFER_MS);
				} else {
					fire();
				}
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
