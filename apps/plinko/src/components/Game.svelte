<script lang="ts">

	import { onMount } from 'svelte';



	import { stateBet, stateUrlDerived } from 'state-shared';



	import config from '../game/config';

	import { playDevLocalBook } from '../game/devLocalBet';

	import { getContext } from '../game/context';

	import {

		isGameOngoing,

		onBallLanded,

		onBonusEndAnnouncementClosed,

		onMainPlayClick,

		onPageHidden,

		setDropRequestHandler,

		startAutoBet,

		stopAutoBet,

	} from '../game/gameOrchestrator';

	import {

		onBonusRouletteFinished,

		onBonusRouletteResultReady,

		onCoinPegHit,

		onFreeSpinRouletteFinished,

		syncBallPerDropTier,

	} from '../game/meterFlow';

	import { stateGame, stateGameDerived } from '../game/stateGame.svelte';

	import { BonusLevel, BonusRoulette, FreeSpinRoulette } from '../features/bonus';

	import { BonusMeter, FreeSpinMeter } from '../features/meters';

	import { isPortraitGameLayout } from '../lib/format';
	import { staticCssUrl, staticUrl } from '../lib/staticUrl';
	import { slotColorForMultiplier } from '../game-logic/slotColors';

	import Background from './Background.svelte';
	import BonusLevelUpOverlay from './BonusLevelUpOverlay.svelte';

	import { EnableHotkey } from 'components-shared';

	import EnableGameActor from './EnableGameActor.svelte';

	import EnableSound from './EnableSound.svelte';

	import GameHud from './GameHud.svelte';

	import InfoModal from './InfoModal.svelte';

	import MsgBox from './MsgBox.svelte';

	import PlinkoBoard from './PlinkoBoard.svelte';

	import Result from './Result.svelte';

	import Toast from './Toast.svelte';

	import type { BallDroppedEvent } from '../plinko-engine/PlinkoEngine';



	const context = getContext();

	const mobile = isPortraitGameLayout();



	const coefficients = $derived.by(() => {

		const sets = config.defaultCoefficientSets as number[][][];

		return stateGameDerived.coefficientsForDifficulty(

			stateGame.difficultyLevelId,

			stateGame.rowCount,

			sets,

		);

	});



	onMount(() => {

		stateGame.coefficients = coefficients;

		syncBallPerDropTier();

		setDropRequestHandler(({ stake }) => {

			context.eventEmitter.broadcast({ type: 'bonusBallDrop', stake });

		});

		const onVis = () => {

			if (document.hidden) onPageHidden();

		};

		document.addEventListener('visibilitychange', onVis);

		return () => document.removeEventListener('visibilitychange', onVis);

	});



	$effect(() => {

		stateGame.coefficients = coefficients;

	});



	$effect(() => {

		stateGame.ballPerDrop;

		syncBallPerDropTier();

	});



	function handleBetAmountChange(value: number) {

		stateBet.betAmount = value;

	}



	async function placeBet() {

		if (stateGame.isSubmitting || stateGame.isAnimating || isGameOngoing()) return;

		stateGame.isSubmitting = true;

		context.eventEmitter.broadcast({ type: 'soundOnce', name: 'bet' });

		const hasRgsSession = Boolean(stateUrlDerived.rgsUrl() && stateUrlDerived.sessionID());

		if (import.meta.env.DEV && !hasRgsSession) {

			try {

				await playDevLocalBook();

			} finally {

				stateGame.isSubmitting = false;

			}

			return;

		}

		context.eventEmitter.broadcast({ type: 'bet' });

		stateGame.isSubmitting = false;

	}



	function handlePlay() {

		onMainPlayClick(placeBet);

	}



	function toggleAuto() {

		stateGame.autoMode = !stateGame.autoMode;

		if (stateGame.autoMode) {

			startAutoBet(placeBet);

			context.eventEmitter.broadcast({ type: 'soundOnce', name: 'startAutoPlay' });

		} else {

			stopAutoBet();

		}

	}



	function onBallDropped(event: BallDroppedEvent) {

		const slotColor = slotColorForMultiplier(coefficients, event.multiplier);

		onBallLanded(event.ballId, event.multiplier, event.isSpinSlot, slotColor);

	}



	function toggleFullscreen() {

		if (!document.fullscreenElement) void document.documentElement.requestFullscreen();

		else void document.exitFullscreen();

		stateGame.menuOpen = false;

	}



	function openInfo(tab: 'rules' | 'fair' | 'history') {

		stateGame.infoModalTab = tab;

		stateGame.infoModalOpen = true;

		stateGame.menuOpen = false;

	}

</script>



<EnableGameActor />

<EnableSound />

<EnableHotkey />

<MsgBox />

<Toast />

<Result />

<InfoModal />

<BonusLevelUpOverlay />



<main class="game-root" class:game-root--mobile={mobile}>

	<div class="bg-layer">
		<Background />
	</div>



	{#if !mobile}
		<header class="top-hud">
			<div class="top-hud-actions">
				<button
					class="top-hud-btn top-hud-btn--menu"
					type="button"
					style:background-image={staticCssUrl('img/menu-btn.png')}
					onclick={() => (stateGame.menuOpen = !stateGame.menuOpen)}
					aria-label="Menu"
				></button>

				{#if stateGame.menuOpen}
					<div class="hud-menu-popup">

					<button type="button" onclick={toggleFullscreen}>Fullscreen</button>

					<button type="button" onclick={() => openInfo('fair')}>Provably fair</button>

					<button type="button" onclick={() => openInfo('rules')}>Game rules</button>

					<button type="button" onclick={() => openInfo('history')}>Bet history</button>

					<button

						type="button"

						onclick={() => (stateGame.fastGameEnabled = !stateGame.fastGameEnabled)}

					>

						Fast: {stateGame.fastGameEnabled ? 'ON' : 'OFF'}

					</button>

					<button

						type="button"

						onclick={() => (stateGame.animationEnabled = !stateGame.animationEnabled)}

					>

						Anim: {stateGame.animationEnabled ? 'ON' : 'OFF'}

					</button>

					<button

						type="button"

						onclick={() => (stateGame.soundEnabled = !stateGame.soundEnabled)}

					>

						Sound: {stateGame.soundEnabled ? 'ON' : 'OFF'}

					</button>

					</div>
				{/if}
			</div>
		</header>
	{/if}

	{#if mobile && stateGame.menuOpen}
		<div class="hud-menu-popup hud-menu-popup--mobile">
			<button type="button" onclick={toggleFullscreen}>Fullscreen</button>
			<button type="button" onclick={() => openInfo('fair')}>Provably fair</button>
			<button type="button" onclick={() => openInfo('rules')}>Game rules</button>
			<button type="button" onclick={() => openInfo('history')}>Bet history</button>
			<button
				type="button"
				onclick={() => {
					stateGame.fastGameEnabled = !stateGame.fastGameEnabled;
					stateGame.menuOpen = false;
				}}
			>
				Fast: {stateGame.fastGameEnabled ? 'ON' : 'OFF'}
			</button>
			<button
				type="button"
				onclick={() => {
					stateGame.animationEnabled = !stateGame.animationEnabled;
					stateGame.menuOpen = false;
				}}
			>
				Anim: {stateGame.animationEnabled ? 'ON' : 'OFF'}
			</button>
			<button
				type="button"
				onclick={() => {
					stateGame.soundEnabled = !stateGame.soundEnabled;
					stateGame.menuOpen = false;
				}}
			>
				Sound: {stateGame.soundEnabled ? 'ON' : 'OFF'}
			</button>
		</div>
	{/if}

	<div class="game-content">
		<div class="game-area" class:game-area--pixi-fill={!mobile}>
			{#if mobile}
				<div class="top-hud">
					<button type="button" class="top-hud-buy-bonus" aria-label="Buy bonus">
						<img src={staticUrl('img/buy-bonus-btn.png')} alt="" aria-hidden="true" />
					</button>
				</div>
			{/if}

			<div
				class="container"
				class:container--bonus={stateGameDerived.isBonusBackgroundActive}
			>
				{#if stateGame.bonusRoundActive}
					<div class="bonus-level-behind-game-area">
						<BonusLevel
							activeLevels={stateGame.bonusLevelProgress}
							pendingLevelHighlight={stateGameDerived.bonusPendingLevelHighlight}
							levelLabels={[...stateGameDerived.bonusLevelLabels]}
						/>
					</div>
				{/if}

				<img
					class="game-area-frame"
					src={staticUrl('img/game_area_background.png')}
					alt=""
					aria-hidden="true"
				/>
				<img
					class="game-area-bonus-overlay"
					src={staticUrl('img/game_area_bonus.png')}
					alt=""
					aria-hidden="true"
				/>

				{#if mobile}
					<div class="pixi-stage-wrap">
						<PlinkoBoard
							{coefficients}
							rows={stateGame.rowCount}
							animationEnabled={stateGame.animationEnabled}
							animationSpeed={stateGame.fastGameEnabled ? 3 : 0.7}
							onBallDropped={onBallDropped}
							onCoinPegHit={onCoinPegHit}
						/>
					</div>
				{:else}
					<PlinkoBoard
						{coefficients}
						rows={stateGame.rowCount}
						animationEnabled={stateGame.animationEnabled}
						animationSpeed={stateGame.fastGameEnabled ? 3 : 0.7}
						onBallDropped={onBallDropped}
						onCoinPegHit={onCoinPegHit}
					/>
				{/if}

				<div class="bonus-meter-wrap">
					<BonusMeter progress={stateGameDerived.bonusMeterProgress} />
				</div>
			</div>
		</div>



	<GameHud
		betAmount={stateBet.betAmount}
		winAmount={stateGame.winAmount}
		totalBetAmount={stateBet.betAmount * stateGame.ballPerDrop}
		onBetAmountChange={handleBetAmountChange}
		onPlay={handlePlay}
		autoMode={stateGame.autoMode}
		autoPlayStarted={stateGame.autoPlayStarted}
		autoRoundsLeft={stateGame.autoRoundsDisplay}
		spinMeterProgress={stateGameDerived.spinMeterProgress}
		hasPendingBonusBalls={stateGameDerived.hasPendingBonusBalls}
		bonusBallsRemaining={stateGame.bonusBallsRemaining}
		playDisabled={stateGame.isSubmitting || stateGame.isAnimating || isGameOngoing()}
		bonusPlayDisabled={stateGame.bonusRouletteOpen}
		{mobile}
		onMenuClick={() => (stateGame.menuOpen = !stateGame.menuOpen)}
		/>
	</div>

	{#if stateGame.showWinPopup}

		<div class="win-overlay" role="dialog">

			<div class="win-card" style:background-image={staticCssUrl('img/win_bg.svg')}>

				<p>{context.i18nDerived.t('Win')}</p>

				<strong>{stateGame.winPopupAmount.toFixed(2)}</strong>

				<button type="button" onclick={() => (stateGame.showWinPopup = false)}>OK</button>

			</div>

		</div>

	{/if}



	{#if stateGame.freeSpinRouletteOpen}

		<FreeSpinRoulette

			targetSegmentIndex={stateGame.serverFreeSpinSegment}

			onFinished={(result) => onFreeSpinRouletteFinished(result.segmentLabel)}

		/>

	{/if}



	{#if stateGame.bonusRouletteOpen}

		<BonusRoulette

			targetFreeBalls={stateGame.serverBonusFreeBalls}

			onResultReady={(result) => onBonusRouletteResultReady(result.freeBallCount)}

			onFinished={() => onBonusRouletteFinished()}

		/>

	{/if}



	{#if stateGame.bonusEndAnnouncementOpen}

		<BonusRoulette

			mode="message"

			messageTitle="WIN"

			messageValue="{stateGame.bonusEndWinAmount.toFixed(2)} {stateBet.currency}"

			messageHint="PRESS ANYWHERE TO GO BACK TO THE GAME"

			onClosed={onBonusEndAnnouncementClosed}

		/>

	{/if}

</main>



<style>

	.game-root {

		width: 100vw;

		height: 100vh;

		height: 100dvh;

		display: flex;

		flex-direction: column;

		overflow: hidden;

		position: relative;

		isolation: isolate;

		font-family: 'Instrument Sans', system-ui, sans-serif;

		background: transparent;

	}

	.game-root:not(.game-root--mobile) .bg-layer {

		pointer-events: none;

	}

	.game-content {

		flex: 1;

		min-height: 0;

		position: relative;

		display: flex;

		flex-direction: column;

		align-items: stretch;

		justify-content: stretch;

		z-index: 1;

		overflow: visible;

	}

	.game-root:not(.game-root--mobile) .game-content {

		--game-area-width-cap: 100vw;
		padding: 0;

	}

	.game-root--mobile .game-content {

		--game-area-width-cap: 100vw;
		/* 992×1761 reference — scale layout tokens from design width */
		--portrait-dw: 992;
		--portrait-px: calc(100vw / var(--portrait-dw));
		padding: 0;
		flex: 1 1 0;
		min-height: 0;
		overflow: hidden;

	}

	.bg-layer {

		position: absolute;

		inset: 0;

		z-index: 0;

		overflow: hidden;

		pointer-events: none;

	}

	.game-root--mobile .bonus-level-behind-game-area :global(.bonus-level-track) {

		width: var(--mobile-bonus-track-width);

		height: var(--mobile-bonus-track-height);

	}

	.game-root--mobile .bonus-level-behind-game-area :global(.bonus-level-node:nth-child(1)) {

		left: calc(var(--mobile-bonus-track-width) * 0.1124);

		top: calc(var(--mobile-bonus-track-height) * 0.6548);

	}

	.game-root--mobile .bonus-level-behind-game-area :global(.bonus-level-node:nth-child(2)) {

		left: calc(var(--mobile-bonus-track-width) * 0.2016);

		top: calc(var(--mobile-bonus-track-height) * 0.5357);

	}

	.game-root--mobile .bonus-level-behind-game-area :global(.bonus-level-node:nth-child(3)) {

		left: calc(var(--mobile-bonus-track-width) * 0.2791);

		top: calc(var(--mobile-bonus-track-height) * 0.3869);

	}

	.game-root--mobile .bonus-level-behind-game-area :global(.bonus-level-node:nth-child(4)) {

		left: calc(var(--mobile-bonus-track-width) * 0.3721);

		top: calc(var(--mobile-bonus-track-height) * 0.2976);

	}

	.game-root--mobile .bonus-level-behind-game-area :global(.bonus-level-node:nth-child(5)) {

		left: calc(var(--mobile-bonus-track-width) * 0.4961);

		top: calc(var(--mobile-bonus-track-height) * 0.2679);

	}

	.game-root--mobile .bonus-level-behind-game-area :global(.bonus-level-node:nth-child(6)) {

		left: calc(var(--mobile-bonus-track-width) * 0.6124);

		top: calc(var(--mobile-bonus-track-height) * 0.3051);

	}

	.game-root--mobile .bonus-level-behind-game-area :global(.bonus-level-node:nth-child(7)) {

		left: calc(var(--mobile-bonus-track-width) * 0.7054);

		top: calc(var(--mobile-bonus-track-height) * 0.4018);

	}

	.game-root--mobile .bonus-level-behind-game-area :global(.bonus-level-node:nth-child(8)) {

		left: calc(var(--mobile-bonus-track-width) * 0.7752);

		top: calc(var(--mobile-bonus-track-height) * 0.5357);

	}

	.game-root--mobile .bonus-level-behind-game-area :global(.bonus-level-node:nth-child(9)) {

		left: calc(var(--mobile-bonus-track-width) * 0.8837);

		top: calc(var(--mobile-bonus-track-height) * 0.6548);

	}

	.top-hud {

		position: absolute;

		top: 0.55vw;

		left: 0.9vw;

		right: 0.9vw;

		z-index: 20;

		height: 3vw;

		display: flex;

		align-items: stretch;

		justify-content: flex-end;

		padding: 0;

		pointer-events: none;

	}

	.top-hud > * {

		pointer-events: auto;

	}

	.top-hud-actions {

		position: relative;

		display: flex;

		align-items: stretch;

		gap: 0.45vw;

		height: 100%;

	}

	.top-hud-btn {

		width: auto;

		height: 100%;

		aspect-ratio: 1 / 1;

		border: none;

		background: center / 100% 100% no-repeat;

		cursor: pointer;

		transition: transform 0.12s ease;

	}

	.hud-menu-popup {

		position: absolute;

		top: calc(100% + 0.55vw);

		right: 0;

		width: min(280px, 16.8vw);

		border-radius: 0.2vw;

		border: 0.08vw dashed rgba(255, 255, 255, 0.12);

		background: linear-gradient(180deg, rgba(22, 24, 31, 0.98) 0%, rgba(16, 18, 24, 0.99) 100%);

		box-shadow:
			inset 0 0.04vw 0 rgba(255, 255, 255, 0.04),
			0 0.45vw 1.1vw rgba(0, 0, 0, 0.45);

		padding: 0.7vw 0.8vw 0.8vw;

		display: flex;

		flex-direction: column;

		gap: 0.35vw;

		z-index: 30;

	}

	.hud-menu-popup button {

		background: transparent;

		border: none;

		color: #fff;

		text-align: left;

		padding: 0.45vw 0.35vw;

		cursor: pointer;

		font-size: clamp(12px, 0.85vw, 14px);

	}

	.hud-menu-popup--mobile {

		position: fixed;

		top: clamp(72px, 18vw, 112px);

		right: clamp(10px, 3vw, 18px);

		width: min(92vw, 320px);

		border-radius: 8px;

		padding: 12px;

		gap: 6px;

	}

	/* Desktop — absolute inset uses almost full viewport (HUD/panel overlay) */
	.game-root:not(.game-root--mobile) .game-area {

		position: absolute;

		top: 3vw;

		right: 0;

		bottom: 7vw;

		left: 0;

		flex: none;

		width: 100%;

		max-width: var(--game-area-width-cap, 100vw);

		height: auto;

		margin: 0;

	}

	.game-area {

		position: relative;

		display: flex;

		flex-direction: column;

		align-items: center;

		justify-content: center;

		flex: 1 1 0;

		width: 100%;

		max-width: var(--game-area-width-cap, 100vw);

		min-height: 0;

		height: 100%;

		overflow: visible;

		z-index: 1;

		margin: 0 auto;

		container-type: size;

		container-name: game-area;

	}

	.game-area--pixi-fill .container {

		position: relative;

		display: block;

		align-self: center;

		margin: 0 auto;

		min-height: 0;

	}

	.game-area--pixi-fill .container :global(.plinko-root) {

		position: absolute;

		inset: 0;

		overflow: visible;

		z-index: 2;

	}


	.top-hud-buy-bonus {

		position: absolute;

		top: 0;

		right: 0;

		width: clamp(72px, 18vw, 112px);

		height: clamp(72px, 18vw, 112px);

		border: none;

		background: transparent;

		padding: 0;

		margin: 0;

		cursor: pointer;

		z-index: 22;

	}

	.top-hud-buy-bonus img {

		width: 100%;

		height: 100%;

		display: block;

		object-fit: contain;

		pointer-events: none;

	}

	.container {

		/* Plinko layout ratios track frame (fit-width/height), not viewport vw */
		--plinko-area-scale: 0.58;
		--plinko-area-offset-ratio: 0.38;

		/* Bonus meter — desktop proportions vs 96×55 frame (12×7.8 @ top 6) */
		--bonus-meter-width-ratio: 0.125;
		--bonus-meter-height-ratio: 0.141818;
		--bonus-meter-top-ratio: 0.109091;
		/* Bonus level track uses frame-relative ratios like meter/marker. */
		--bonus-level-width-ratio: 0.33;
		--bonus-level-height-ratio: 0.238182;
		--bonus-level-top-ratio: -0.06;
		--bonus-level-left-ratio: 0.505;
		--mobile-bonus-track-width: 65vw;
		--mobile-bonus-track-height: 33.6vw;

		/* Largest 96:55 box inside game-area, no crop */
		--game-area-max-w: min(var(--game-area-width-cap, 100vw), 100cqw);
		--game-area-max-h: 100cqh;
		--game-area-aspect-w: 96;
		--game-area-aspect-h: 55;
		--game-area-fit-width: min(
			var(--game-area-max-w),
			calc(var(--game-area-max-h) * var(--game-area-aspect-w) / var(--game-area-aspect-h))
		);
		--game-area-fit-height: min(
			var(--game-area-max-h),
			calc(var(--game-area-max-w) * var(--game-area-aspect-h) / var(--game-area-aspect-w))
		);
		--plinko-host-width: calc(var(--game-area-fit-width) * var(--plinko-area-scale));
		--plinko-host-height: calc(var(--game-area-fit-height) * var(--plinko-area-scale));
		--plinko-area-offset-y: calc(
			var(--game-area-fit-height) * var(--plinko-area-offset-ratio)
		);
		--bonus-meter-width: calc(var(--game-area-fit-width) * var(--bonus-meter-width-ratio));
		--bonus-meter-height: calc(var(--game-area-fit-height) * var(--bonus-meter-height-ratio));
		--bonus-meter-offset-y: calc(var(--game-area-fit-height) * var(--bonus-meter-top-ratio));
		--bonus-level-width: calc(var(--game-area-fit-width) * var(--bonus-level-width-ratio));
		--bonus-level-height: calc(var(--game-area-fit-height) * var(--bonus-level-height-ratio));
		--bonus-level-offset-y: calc(var(--game-area-fit-height) * var(--bonus-level-top-ratio));

		width: var(--game-area-fit-width);

		height: var(--game-area-fit-height);

		max-width: var(--game-area-max-w);

		max-height: var(--game-area-max-h);

		border-radius: 0.8vw;

		padding: 0;

		text-align: center;

		position: relative;

		margin: 0 auto;

		overflow: visible;

		isolation: isolate;

		box-sizing: border-box;

		display: block;

		min-height: 0;

		container-type: size;

		container-name: plinko-frame;

	}

	.game-area-frame,
	.game-area-bonus-overlay {

		position: absolute;

		inset: 0;

		width: 100%;

		height: 100%;

		max-width: 100%;

		max-height: 100%;

		object-fit: contain;

		object-position: top center;

		pointer-events: none;

		z-index: 0;

		user-select: none;

	}

	.container .bonus-meter-wrap {

		position: absolute;

		left: 50%;

		top: var(--bonus-meter-offset-y);

		width: var(--bonus-meter-width);

		height: var(--bonus-meter-height);

		transform: translateX(-50%);

		pointer-events: none;

		z-index: 6;

	}

	.container .bonus-level-behind-game-area {

		position: absolute;

		left: calc(var(--game-area-fit-width) * var(--bonus-level-left-ratio));

		top: var(--bonus-level-offset-y);

		width: var(--bonus-level-width);

		height: var(--bonus-level-height);

		transform: translateX(-50%);

		pointer-events: none;

		z-index: -1;

	}

	.container .bonus-level-behind-game-area :global(.bonus-level-track) {

		width: 100%;

		height: 100%;

	}

	.game-area-frame {

		transition: opacity 0.28s ease-in-out;

	}

	.game-area-bonus-overlay {

		opacity: 0;
		z-index: 3;

		transition: opacity 0.28s ease-in-out;

	}

	.container :global(.plinko-root),
	.container .pixi-stage-wrap {

		position: absolute;

		inset: 0;

		z-index: 2;

		width: 100%;

		height: 100%;

		pointer-events: none;

	}

	.container :global(.plinko-root) :global(.plinko-host),
	.container .pixi-stage-wrap :global(.plinko-host) {

		pointer-events: auto;

	}

	.container.container--bonus .game-area-bonus-overlay {

		opacity: 1;

	}

	.container.container--bonus .game-area-frame {

		opacity: 1;

		transition: opacity 0.28s ease-in-out;

	}

	.win-overlay {

		position: fixed;

		inset: 0;

		background: rgba(0, 0, 0, 0.55);

		display: grid;

		place-items: center;

		z-index: 20;

	}

	.win-card {

		min-width: 280px;

		padding: 32px 40px;

		text-align: center;

		background-size: 100% 100%;

	}

	.win-card p {

		color: #fff;

	}

	.win-card strong {

		display: block;

		font-size: 2rem;

		margin: 12px 0 20px;

		color: #54f917;

	}

	.win-card button {

		border: none;

		background: linear-gradient(180deg, #3aa8e8, #1d6fad);

		color: #fff;

		padding: 10px 28px;

		border-radius: 999px;

		cursor: pointer;

		font-weight: 700;

	}

	/* Mobile — layout from 992×1761 reference (Portrait_animationGuide / legacy mobile) */
	.game-root--mobile .game-area {

		flex: 1 1 0;

		min-height: 0;

		width: 100%;

		max-width: var(--game-area-width-cap, 100vw);

		margin: calc(var(--portrait-px) * 10) auto calc(var(--portrait-px) * 12);

		padding: 0;

		position: relative;

		display: flex;

		flex-direction: column;

		align-items: center;

		justify-content: flex-start;

		align-self: stretch;

		z-index: 1;

		overflow: visible;

		container-type: size;

		container-name: game-area;

	}

	.game-root--mobile .game-area .top-hud {

		position: absolute;

		top: calc(var(--portrait-px) * 6);

		right: calc(var(--portrait-px) * 6);

		left: auto;

		width: auto;

		height: calc(var(--portrait-px) * 112);

		z-index: 22;

	}

	.game-root--mobile .game-area > .container {

		--plinko-area-scale: 1;

		--plinko-host-width: 100%;

		--plinko-host-height: 100%;

		--plinko-area-offset-y: 0;
		--bonus-level-left-ratio: 0.415;
		--bonus-level-top-ratio: -0.07;
		--bonus-level-width-ratio: 0.61;
		--bonus-level-height-ratio: 0.336;

		width: 100vw;

		max-width: 100vw;

		min-width: 0;

		flex: 1 1 0;

		min-height: clamp(360px, calc(100vw * 760 / 992), 760px);

		height: auto;

		max-height: 100%;

		box-sizing: border-box;

		display: flex;

		flex-direction: column;

		align-items: center;

		justify-content: flex-start;

		overflow: visible;

		position: relative;

		padding: calc(var(--portrait-px) * 222) 0 0;

		margin: 0 auto;

		border-radius: calc(var(--portrait-px) * 44);

		align-self: center;

	}

	.game-root--mobile .game-area > .container .bonus-level-behind-game-area {

		left: calc(var(--game-area-fit-width) * var(--bonus-level-left-ratio));

	}

	.game-root--mobile .game-area > .container .game-area-frame,
	.game-root--mobile .game-area > .container .game-area-bonus-overlay {

		top: 0;

		left: 50%;

		right: auto;

		bottom: auto;

		width: 125%;

		height: auto;

		max-width: none;

		max-height: none;

		transform: translateX(-50%);

		object-fit: cover;

		object-position: top center;

	}

	.game-root--mobile .game-area > .container .bonus-meter-wrap {

		top: calc(var(--portrait-px) * 132);

		left: 51%;

		width: calc(var(--portrait-px) * 258);

		height: calc(var(--portrait-px) * 198);

		transform: translateX(-50%);

	}

	.game-root--mobile .game-area > .container .pixi-stage-wrap {

		position: relative;

		inset: auto;

		flex: 0 0 auto;

		width: 100%;

		height: calc(var(--portrait-px) * 546);

		min-height: 0;

		overflow: visible;

		z-index: 2;

		pointer-events: none;

		margin-top: calc(var(--portrait-px) * 248);

	}

	.game-root--mobile .game-area > .container .pixi-stage-wrap :global(.plinko-root) {

		position: absolute;

		inset: 0;

		width: 100%;

		height: 100%;

	}

	.game-root--mobile .game-area > .container .pixi-stage-wrap :global(.plinko-host) {

		left: 50%;

		top: 0;

		width: 100%;

		height: 100%;

		max-width: 100%;

		max-height: 100%;

		transform: translateX(-50%);

		pointer-events: auto;

	}

</style>

