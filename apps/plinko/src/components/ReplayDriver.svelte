<script lang="ts">
	import { onMount } from 'svelte';

	import { isReplayMode, tickReplayBonusBalls } from '../game/gameOrchestrator';

	/** Poll cadence for advancing replay playback (drop the next pending bonus ball when idle). */
	const REPLAY_TICK_MS = 200;

	onMount(() => {
		if (!isReplayMode()) return;
		const id = setInterval(tickReplayBonusBalls, REPLAY_TICK_MS);
		return () => clearInterval(id);
	});
</script>
