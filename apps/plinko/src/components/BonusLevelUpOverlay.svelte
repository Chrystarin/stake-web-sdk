<script lang="ts">
	import { eventEmitter } from '../game/eventEmitter';
	import { stateGame } from '../game/stateGame.svelte';
	import { isPortraitGameLayout } from '../lib/format';
	import { staticUrl } from '../lib/staticUrl';

	const portrait = isPortraitGameLayout();

	// Fire the level-up chime on the rising edge of the overlay opening, so the sound lands the
	// moment the card pops. The sprite window (see EnableSound) trims the file's leading silence so
	// there's no dead air before it's heard.
	let wasOpen = false;
	$effect(() => {
		const open = stateGame.bonusLevelUpOverlayOpen;
		if (open && !wasOpen) {
			eventEmitter.broadcast({ type: 'soundOnce', name: 'bonusLevelUp' });
		}
		wasOpen = open;
	});

	const levelTitle = $derived(`LEVEL ${stateGame.bonusLevelUpLevel}`);
	const rewardValue = $derived(`+${stateGame.bonusLevelUpAddedBalls}`);
</script>

{#if stateGame.bonusLevelUpOverlayOpen}
	<div
		class="bonus-level-up-overlay"
		class:bonus-level-up-overlay--visible={stateGame.bonusLevelUpOverlayVisible}
		class:bonus-level-up-overlay--portrait={portrait}
	>
		<div
			class="bonus-level-up-card"
			style:background-image="url({staticUrl('img/bonus-level-up-base.png')})"
		>
			<div class="bonus-level-up-title">
				<span class="bonus-level-up-text-stroke bonus-level-up-text-stroke--title" aria-hidden="true">
					{levelTitle}
				</span>
				<span class="bonus-level-up-text-fill bonus-level-up-text-fill--title">{levelTitle}</span>
			</div>
			<div class="bonus-level-up-reward">
				<div class="bonus-level-up-reward-value">
					<span class="bonus-level-up-text-stroke bonus-level-up-text-stroke--value" aria-hidden="true">
						{rewardValue}
					</span>
					<span class="bonus-level-up-text-fill bonus-level-up-text-fill--value">{rewardValue}</span>
				</div>
				<div class="bonus-level-up-reward-label">
					<span class="bonus-level-up-text-stroke bonus-level-up-text-stroke--label" aria-hidden="true">
						FREE BALLS
					</span>
					<span class="bonus-level-up-text-fill bonus-level-up-text-fill--label">FREE BALLS</span>
				</div>
			</div>
		</div>
	</div>
{/if}

<style>
	.bonus-level-up-overlay {
		position: fixed;
		inset: 0;
		z-index: 14000;
		display: flex;
		align-items: center;
		justify-content: center;
		pointer-events: none;
		opacity: 0;
		transition: opacity 0.28s ease;
		backdrop-filter: blur(10px);
		-webkit-backdrop-filter: blur(10px);
		background: rgba(6, 14, 28, 0.28);
	}
	.bonus-level-up-overlay--visible {
		opacity: 1;
	}
	.bonus-level-up-overlay--portrait {
		background: rgba(6, 14, 28, 0.3);
	}
	.bonus-level-up-card {
		container-type: size;
		width: min(64vw, 920px);
		aspect-ratio: 1024 / 576;
		background-position: center;
		background-repeat: no-repeat;
		background-size: contain;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		box-sizing: border-box;
		text-align: center;
		transform: scale(1.25);
		transform-origin: center center;
	}
	.bonus-level-up-overlay--portrait .bonus-level-up-card {
		width: min(92vw, 760px);
	}
	.bonus-level-up-title,
	.bonus-level-up-reward-value,
	.bonus-level-up-reward-label {
		display: inline-grid;
		width: max-content;
		max-width: 100%;
	}
	.bonus-level-up-title > *,
	.bonus-level-up-reward-value > *,
	.bonus-level-up-reward-label > * {
		grid-area: 1 / 1;
		font-family: inherit;
		font-size: inherit;
		font-weight: inherit;
		line-height: inherit;
		letter-spacing: inherit;
		white-space: inherit;
	}
	.bonus-level-up-text-stroke {
		color: transparent;
		-webkit-text-stroke: var(--level-up-stroke-width) var(--level-up-stroke-color);
		paint-order: stroke fill;
		pointer-events: none;
		user-select: none;
	}
	.bonus-level-up-text-fill {
		background-clip: text;
		-webkit-background-clip: text;
		-webkit-text-fill-color: transparent;
		color: transparent;
		text-shadow: var(--level-up-glow-shadow), var(--level-up-highlight-shadow);
	}
	.bonus-level-up-title {
		--level-up-stroke-width: 0.04em;
		--level-up-stroke-color: #4a2f0a;
		--level-up-glow-shadow:
			0 0 0.48em rgba(255, 200, 70, 0.52), 0 0.05em 0.08em rgba(0, 0, 0, 0.28);
		--level-up-highlight-shadow: 0 -0.02em 0.03em rgba(255, 208, 75, 0.36);
		font-family: 'PiecesOfEight', serif;
		font-size: 10.5cqw;
		line-height: 0.95;
		letter-spacing: 0.02em;
		transform: translateY(-2cqh);
	}
	.bonus-level-up-text-fill--title {
		background-image: linear-gradient(180deg, #fad04a 0%, #f0b82e 56.7%, #de951a 100%);
	}
	.bonus-level-up-reward {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		width: 100%;
		margin-top: 6.5cqh;
		text-align: center;
	}
	.bonus-level-up-reward-value,
	.bonus-level-up-reward-label {
		--level-up-stroke-width: 0.05em;
		--level-up-stroke-color: #5c4010;
		--level-up-glow-shadow:
			0 0 0.4em rgba(255, 228, 120, 0.48), 0 0.04em 0.08em rgba(0, 0, 0, 0.25);
		--level-up-highlight-shadow: 0 -0.02em 0.03em rgba(245, 200, 95, 0.32);
		font-family: 'PotatoSans', sans-serif;
		line-height: 1;
		letter-spacing: 0.01em;
	}
	.bonus-level-up-reward-value {
		font-size: 6.25cqw;
		transform: translate(-1.8cqw, 3.5cqh);
	}
	.bonus-level-up-reward-label {
		margin-top: 0.1em;
		font-size: 5.5cqw;
		transform: translate(-1.8cqw, 1.5cqh);
	}
	.bonus-level-up-text-fill--value,
	.bonus-level-up-text-fill--label {
		background-image: linear-gradient(180deg, #f9e4bc 0%, #e0c48a 56.7%, #d49420 100%);
	}
</style>
