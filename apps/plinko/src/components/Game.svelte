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
	import { staticUrl } from '../lib/staticUrl';
	import { slotColorForMultiplier } from '../game-logic/slotColors';

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

	<div

		class="bg-layer"

		style:background-image="url({mobile ? staticUrl('img/background-mobile.png') : staticUrl('img/background.png')})"

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



	<header class="top-hud">

		<div class="balance-pill" style:background-image="url({staticUrl('img/balance-frame.png')})">

			<img src={staticUrl('img/wallet-ico.png')} alt="" class="ico" />

			<span>{context.i18nDerived.t('Balance')}</span>

			<strong>{stateBet.balanceAmount.toFixed(2)} {stateBet.currency}</strong>

		</div>

		<div class="top-actions">

			{#if mobile}

				<button type="button" class="buy-bonus-btn" aria-label="Buy bonus">

					<img src={staticUrl('img/buy-bonus-btn.png')} alt="" />

				</button>

			{/if}

			<button

				class="icon-btn"

				type="button"

				onclick={() => (stateGame.menuOpen = !stateGame.menuOpen)}

				aria-label="Menu"

			>

				<img src={mobile ? staticUrl('img/menu-btn-mobile.png') : staticUrl('img/menu-btn.png')} alt="" />

			</button>

			{#if stateGame.menuOpen}

				<div class="menu-popup">

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



	<div class="board-area">

		<div class="bonus-meter-wrap">

			<BonusMeter progress={stateGameDerived.bonusMeterProgress} />

		</div>

		<div

			class="board-frame"

			class:board-frame--bonus={stateGameDerived.isBonusBackgroundActive}

			style:background-image="url({stateGameDerived.isBonusBackgroundActive ? staticUrl('img/game_area_bonus.png') : staticUrl('img/game_area_background.png')})"

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

		onToggleAuto={toggleAuto}

		autoMode={stateGame.autoMode}

		autoPlayStarted={stateGame.autoPlayStarted}

		autoRoundsLeft={stateGame.autoRoundsDisplay}

		spinMeterProgress={stateGameDerived.spinMeterProgress}

		hasPendingBonusBalls={stateGameDerived.hasPendingBonusBalls}

		bonusBallsRemaining={stateGame.bonusBallsRemaining}

		playDisabled={stateGame.isSubmitting || stateGame.isAnimating}

		bonusPlayDisabled={stateGame.bonusRouletteOpen}

		{mobile}

	/>



	{#if stateGame.showWinPopup}

		<div class="win-overlay" role="dialog">

			<div class="win-card" style:background-image="url({staticUrl('img/win_bg.svg')})">

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

		display: grid;

		grid-template-rows: auto 1fr auto;

		overflow: hidden;

		position: relative;

		font-family: 'Instrument Sans', system-ui, sans-serif;

	}

	.bg-layer {

		position: absolute;

		inset: 0;

		background-size: cover;

		background-position: center;

		z-index: 0;

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

		position: relative;

		z-index: 10;

		display: flex;

		justify-content: space-between;

		align-items: center;

		padding: 12px 16px;

	}

	.balance-pill {

		display: flex;

		align-items: center;

		gap: 8px;

		background: center/100% 100% no-repeat;

		padding: 8px 20px;

		color: #e8f4ff;

		font-size: 14px;

	}

	.balance-pill strong {

		color: #fff;

	}

	.ico {

		width: 20px;

		height: 20px;

	}

	.top-actions {

		position: relative;

		display: flex;

		align-items: center;

		gap: 8px;

	}

	.buy-bonus-btn {

		border: none;

		background: none;

		padding: 0;

		cursor: pointer;

	}

	.buy-bonus-btn img {

		height: 40px;

	}

	.icon-btn {

		background: none;

		border: none;

		cursor: pointer;

		padding: 0;

	}

	.icon-btn img {

		height: 40px;

	}

	.menu-popup {

		position: absolute;

		right: 0;

		top: 100%;

		background: rgba(10, 18, 28, 0.95);

		border: 1px solid rgba(255, 255, 255, 0.12);

		border-radius: 8px;

		padding: 8px;

		display: flex;

		flex-direction: column;

		gap: 4px;

		min-width: 180px;

		z-index: 20;

	}

	.menu-popup button {

		background: transparent;

		border: none;

		color: #fff;

		text-align: left;

		padding: 8px;

		cursor: pointer;

	}

	.board-area {

		position: relative;

		z-index: 1;

		min-height: 0;

		padding: 0 12px;

		display: flex;

		flex-direction: column;

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

