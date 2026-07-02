<script lang="ts">
	import { onMount } from 'svelte';

	import { getContext } from '../game/context';
	import { installConnectionWatcher } from '../game/plinkoConnection';
	import { stateGame } from '../game/stateGame.svelte';

	const context = getContext();

	onMount(() => installConnectionWatcher());
</script>

{#if stateGame.isOffline}
	<div class="net-overlay" role="alertdialog" aria-modal="true" aria-live="assertive">
		<div class="net-card">
			<div class="net-icon" aria-hidden="true">
				<svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
					<path d="M1 1l22 22" />
					<path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55" />
					<path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39" />
					<path d="M10.71 5.05A16 16 0 0 1 22.58 9" />
					<path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88" />
					<path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
					<line x1="12" y1="20" x2="12.01" y2="20" />
				</svg>
			</div>
			<h2 class="net-title">{context.i18nDerived.t('No Internet Connection')}</h2>
			<p class="net-body">
				{context.i18nDerived.t(
					'Gameplay is paused. Please check your connection — your progress is saved and will resume automatically.',
				)}
			</p>
			<div class="net-spinner" aria-hidden="true"></div>
		</div>
	</div>
{/if}

<style>
	.net-overlay {
		position: fixed;
		inset: 0;
		z-index: 21000;
		display: grid;
		place-items: center;
		padding: 24px;
		background: rgba(0, 0, 0, 0.72);
		backdrop-filter: blur(3px);
		/* Block all interaction underneath — this is what suspends gameplay. */
		pointer-events: auto;
	}

	.net-card {
		box-sizing: border-box;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 14px;
		width: min(90vw, 360px);
		padding: 28px 26px;
		text-align: center;
		background: linear-gradient(180deg, #1a2a3d, #0d1520);
		border: 1px solid rgba(126, 200, 255, 0.35);
		border-radius: 14px;
		color: #e8f4ff;
		box-shadow: 0 10px 40px rgba(0, 0, 0, 0.55);
	}

	.net-icon {
		color: #ff8a8a;
	}

	.net-title {
		margin: 0;
		font-size: 1.25rem;
		font-weight: 700;
	}

	.net-body {
		margin: 0;
		font-size: 0.95rem;
		line-height: 1.4;
		color: rgba(232, 244, 255, 0.82);
	}

	.net-spinner {
		width: 26px;
		height: 26px;
		margin-top: 4px;
		border-radius: 50%;
		border: 3px solid rgba(126, 200, 255, 0.25);
		border-top-color: #7ec8ff;
		animation: net-spin 0.9s linear infinite;
	}

	@keyframes net-spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
