<script lang="ts">
	import { onMount } from 'svelte';

	import { isReplayMode, tickReplayBonusBalls } from '../game/gameOrchestrator';

	/**
	 * Cadence for streaming replay bonus free balls. Replay has no player to press Play, so this drives
	 * the drops directly — one free ball every 250ms (a steady stream) rather than waiting for each ball
	 * to fully land, which made a multi-ball bonus crawl.
	 */
	const REPLAY_TICK_MS = 250;

	onMount(() => {
		if (!isReplayMode()) return;
		const id = setInterval(tickReplayBonusBalls, REPLAY_TICK_MS);
		return () => clearInterval(id);
	});
</script>
