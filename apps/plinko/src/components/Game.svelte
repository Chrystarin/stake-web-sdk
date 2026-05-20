<script lang="ts">

	import { onMount } from 'svelte';



	import { stateBet, stateUrlDerived } from 'state-shared';



	import config from '../game/config';

	import { playDevLocalBook } from '../game/devLocalBet';

	import { getContext } from '../game/context';

	import {

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

	import { isMobile } from '../lib/format';
	import { staticCssUrl, staticUrl } from '../lib/staticUrl';
	import { slotColorForMultiplier } from '../game-logic/slotColors';

	import { BackgroundLandscape } from '../features/background';
	import BonusLevelUpOverlay from './BonusLevelUpOverlay.svelte';

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

	const mobile = isMobile();



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

		if (stateGame.isSubmitting || stateGame.isAnimating) return;

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

<MsgBox />

<Toast />

<Result />

<InfoModal />

<BonusLevelUpOverlay />



<main class="game-root" class:game-root--mobile={mobile}>

	{#if !mobile}
		<BackgroundLandscape />
	{/if}

	<div
		class="bg-layer"
		style:background-image={mobile ? staticCssUrl('img/background-mobile.png') : undefined}
	></div>



	{#if stateGame.bonusRoundActive}

		<div class="bonus-level-layer">

			<BonusLevel

				activeLevels={stateGame.bonusLevelProgress}

				pendingLevelHighlight={stateGameDerived.bonusPendingLevelHighlight}

				levelLabels={[...stateGameDerived.bonusLevelLabels]}

			/>

		</div>

	{/if}



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
		<div class="board-area">
		{#if mobile}
			<div class="top-hud">
				<button type="button" class="top-hud-buy-bonus" aria-label="Buy bonus">
					<img src={staticUrl('img/buy-bonus-btn.png')} alt="" aria-hidden="true" />
				</button>
			</div>
		{/if}

		<div class="bonus-meter-wrap">

			<BonusMeter progress={stateGameDerived.bonusMeterProgress} />

		</div>

		<div

			class="board-frame"

			class:board-frame--bonus={stateGameDerived.isBonusBackgroundActive}

			style:background-image={staticCssUrl(
				stateGameDerived.isBonusBackgroundActive
					? 'img/game_area_bonus.png'
					: 'img/game_area_background.png',
			)}

		>

			<div class="board-bonus-overlay" aria-hidden="true"></div>

			<PlinkoBoard

				{coefficients}

				rows={stateGame.rowCount}

				animationEnabled={stateGame.animationEnabled}

				animationSpeed={stateGame.fastGameEnabled ? 3 : 0.7}

				onBallDropped={onBallDropped}

				onCoinPegHit={onCoinPegHit}

			/>

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
		playDisabled={stateGame.isSubmitting || stateGame.isAnimating}
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



	{#if stateGame.freeSpinRouletteOpen || stateGame.showFreeSpinRoulette}

		<FreeSpinRoulette

			targetSegmentIndex={stateGame.serverFreeSpinSegment}

			onFinished={(result) => onFreeSpinRouletteFinished(result.segmentLabel)}

		/>

	{/if}



	{#if stateGame.bonusRouletteOpen || stateGame.showBonusRoulette}

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

	.game-root :global(.background-landscape-root) {

		z-index: 0;

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

		z-index: 1;

		overflow: hidden;

	}

	.bg-layer {

		position: absolute;

		inset: 0;

		z-index: 0;

		overflow: hidden;

		background-size: cover;

		background-position: center;

		pointer-events: none;

	}

	.bonus-level-layer {

		position: absolute;

		inset: 0;

		z-index: 2;

		pointer-events: none;

		display: flex;

		align-items: flex-start;

		justify-content: center;

		padding-top: 10vh;

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

	.board-area {

		position: relative;

		flex: 1;

		min-height: 0;

		padding: 0 12px;

		display: flex;

		flex-direction: column;

		overflow: hidden;

	}

	.game-root--mobile .board-area .top-hud {

		top: 0.6vw;

		left: 0;

		right: 0;

		height: 7.6vw;

		justify-content: space-between;

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

	.bonus-meter-wrap {

		width: min(92vw, 720px);

		height: clamp(36px, 5vh, 52px);

		margin: 0 auto 6px;

		flex-shrink: 0;

	}

	.board-frame {

		position: relative;

		flex: 1;

		min-height: min(49vw, 52vh);

		background-size: contain;

		background-position: top center;

		background-repeat: no-repeat;

		border-radius: 12px;

		overflow: visible;

		display: flex;

		flex-direction: column;

		align-items: stretch;

	}

	.board-frame :global(.plinko-root) {

		position: relative;

		z-index: 2;

		flex: 1;

		width: 100%;

		min-height: min(46vw, 100%);

		margin-top: 3vw;

		margin-left: 0.75vw;

		box-sizing: border-box;

	}

	.board-frame--bonus .board-bonus-overlay {

		opacity: 1;

	}

	.board-bonus-overlay {

		position: absolute;

		inset: 0;

		pointer-events: none;

		z-index: 1;

		opacity: 0;

		transition: opacity 0.35s ease;

		background: radial-gradient(ellipse at 50% 30%, rgba(180, 40, 20, 0.18), transparent 70%);

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

		color: #fff;

		background-size: 100% 100%;

	}

	.win-card strong {

		display: block;

		font-size: 2rem;

		margin: 12px 0 20px;

		color: #fee663;

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

	.game-root--mobile .bonus-meter-wrap {

		width: 88vw;

	}

	.game-root--mobile .board-frame {

		min-height: clamp(360px, 96vw, 760px);

		padding-top: 22.4vw;

		background-size: 125% auto;

		background-position: center top;

	}

	.game-root--mobile .board-frame :global(.plinko-root) {

		flex: 1 1 auto;

		min-height: var(--mobile-pixi-height, 55vw);

		width: 100%;

		margin: 0;

	}

</style>

