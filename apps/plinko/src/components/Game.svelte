<script lang="ts">

	import { onMount } from 'svelte';
	import { innerHeight, innerWidth } from 'svelte/reactivity/window';
	import { page } from '$app/state';

	import { stateBet, stateUrlDerived } from 'state-shared';
	import { numberToCurrencyString } from 'utils-shared/amount';



	import { coefficientsForRowCount } from '../game-logic/constants';
	import config from '../game/config';

	import { hasActiveRoundToResume } from '../game/plinkoActiveRound';
	import { canAffordPlinkoWager, maxAffordableStakePerBall, plinkoWagerAmount, snapStakeToBetLevels } from '../game/plinkoBet';
	import { playDevLocalBook } from '../game/devLocalBet';
	import { installPlinkoDevDebug } from '../game/devDebug';
	import { applyClientMeterDefaults } from '../game/plinkoMeterConfig';
	import { applyRgsSessionMetersToDisplay } from '../game/plinkoSessionMeters';

	import { getContext } from '../game/context';

	import {

		isBetControlsLocked,

		isGameOngoing,

		onBallLanded,

		onBonusEndAnnouncementClosed,

		onMainPlayClick,

		maybeAutoFireFeatureTrigger,

		onPageHidden,

		setDropRequestHandler,

		showToast,

		startAutoBet,

		stopAutoBet,

	} from '../game/gameOrchestrator';

	import {

		onBonusRouletteFinished,

		onBonusRouletteResultReady,

		onCoinPegHit,

		releaseRoundInteractionLocks,

		syncBallPerDropTier,

	} from '../game/meterFlow';

	import { stateGame, stateGameDerived, type InfoModalTab } from '../game/stateGame.svelte';
	import { stateXstate, stateXstateDerived } from '../game/stateXstate';

	import { BonusLevel, BonusMeter, BonusRoulette } from '../features/bonus';
	import { FreeSpinMeter, FreeSpinRoulette, onFreeSpinRouletteFinished } from '../features/freeSpin';

	import { isPortraitGameLayout } from '../lib/format';
	import { staticCssUrl, staticUrl } from '../lib/staticUrl';

	import Background from './Background.svelte';
	import BonusLevelUpOverlay from './BonusLevelUpOverlay.svelte';

	import { EnableHotkey } from 'components-shared';
	import { GameVersion, Modals } from 'components-ui-html';

	import EnableGameActor from './EnableGameActor.svelte';
	import ResumeBet from './ResumeBet.svelte';
	import ReplayDriver from './ReplayDriver.svelte';

	import EnableSound from './EnableSound.svelte';

	import GameHud from './GameHud.svelte';

	import HudMenuPopup from './HudMenuPopup.svelte';

	import InfoModal from './InfoModal.svelte';

	import MsgBox from './MsgBox.svelte';

	import PlinkoBoard from './PlinkoBoard.svelte';

	import Result from './Result.svelte';

	import Toast from './Toast.svelte';

	import type { BallDroppedEvent } from '../plinko-engine/PlinkoEngine';



	const context = getContext();

	/** Stake deterministic replay (`?replay=true`) — drives playback headlessly + locks the UI. */
	const isReplay = $derived(stateUrlDerived.replay());

	/**
	 * Match Background.svelte: re-evaluate the portrait/mobile layout reactively so the
	 * game area and betting panel switch in lockstep with the background. Tracking the
	 * window size keeps this in sync on resize / orientation change instead of being
	 * frozen at the value computed on mount.
	 */
	const mobile = $derived.by(() => {
		innerWidth.current;
		innerHeight.current;
		return isPortraitGameLayout();
	});

	/** TODO: remove — temporary preview of bonus congratulations typography on load. */
	const DEV_SHOW_BONUS_CONGRATULATIONS_ON_LOAD = false;
	let devBonusCongratulationsPreviewOpen = $state(DEV_SHOW_BONUS_CONGRATULATIONS_ON_LOAD);

	/** TODO: remove — temporary preview of win modal on load. */
	const DEV_SHOW_WIN_MODAL_ON_LOAD = false;

	/** TODO: remove — temporary preview of bonus level-up overlay on load. */
	const DEV_SHOW_BONUS_LEVEL_UP_ON_LOAD = false;

	let gameRootEl = $state<HTMLElement | undefined>(undefined);



	const coefficients = $derived.by(() =>
		coefficientsForRowCount(config.coefficientSets as number[][], stateGame.rowCount),
	);

	const boardCoefficients = $derived(
		stateGame.coefficients.length > 0 ? stateGame.coefficients : coefficients,
	);

	/** Track `stateGame` meter fields directly — getters on `stateGameDerived` are not reactive. */
	const bonusMeterProgress = $derived(
		stateGame.bonusMeterMax > 0
			? Math.min(1, Math.max(0, stateGame.bonusMeterValue / stateGame.bonusMeterMax))
			: 0,
	);

	const spinMeterProgress = $derived(
		stateGame.spinMeterMax > 0
			? Math.min(1, Math.max(0, stateGame.spinMeterValue / stateGame.spinMeterMax))
			: 0,
	);

	const winPopupAmountDisplay = $derived(numberToCurrencyString(stateGame.winPopupAmount));

	$effect(() => {
		if (!stateGame.showWinPopup) return;
		if (DEV_SHOW_WIN_MODAL_ON_LOAD) return;
		stateGame.winPopupAmount;
		const timer = setTimeout(() => {
			stateGame.showWinPopup = false;
		}, 3000);
		return () => clearTimeout(timer);
	});

	onMount(() => {

		installPlinkoDevDebug();

		applyClientMeterDefaults(config.spinMeterMax, config.bonusMeterMax);
		applyRgsSessionMetersToDisplay();

		if (DEV_SHOW_BONUS_LEVEL_UP_ON_LOAD) {
			stateGame.bonusLevelUpLevel = 4;
			stateGame.bonusLevelUpAddedBalls = 80;
			stateGame.bonusLevelUpOverlayOpen = true;
			stateGame.bonusLevelUpOverlayVisible = true;
		}

		if (DEV_SHOW_WIN_MODAL_ON_LOAD) {
			stateGame.winPopupAmount = 123456789.45;
			stateGame.showWinPopup = true;
		}

		if (!stateGame.authoritativeMeterFlow || stateGame.coefficients.length === 0) {
			stateGame.coefficients = coefficients;
		}

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

		if (!stateGame.authoritativeMeterFlow || stateGame.coefficients.length === 0) {
			stateGame.coefficients = coefficients;
		}

	});



	$effect(() => {

		stateGame.ballPerDrop;

		syncBallPerDropTier();

	});

	// Auto-fire the bonus trigger bet the moment the bonus meter is full and the round machine is idle.
	// Tracks the meter + round/machine state so it re-evaluates when a round fully settles (incl.
	// deferred end-round). Betting stays locked (isBetControlsLocked → isFeatureTriggerImminent) until
	// the bonus actually fires.
	$effect(() => {
		stateGame.bonusMeterValue;
		stateGame.bonusMeterMax;
		stateGame.dropRoundActive;
		stateGame.pendingFeatureTrigger;
		stateXstate.value;
		maybeAutoFireFeatureTrigger(placeBet);
	});

	function handleBetAmountChange(value: number) {
		const maxPerBall = maxAffordableStakePerBall() || value;
		stateBet.betAmount = snapStakeToBetLevels(Math.max(0, Math.min(value, maxPerBall)));
	}



	async function placeBet() {
		// Replay is passive playback of a recorded round — never place a wager.
		if (isReplay) return;
		// Ignore a bet while the previous round is still settling (machine not yet idle) — the
		// idle-only xstate machine would drop the BET and leave `isSubmitting` stuck.
		if (stateGame.isSubmitting || stateGame.dropRoundActive || stateXstateDerived.isPlaying())
			return;

		if (hasActiveRoundToResume()) {
			showToast('Finishing your previous round…', 'info');
			context.eventEmitter.broadcast({ type: 'resumeBet' });
			return;
		}

		if (!canAffordPlinkoWager()) {
			const wager = plinkoWagerAmount();
			showToast(
				wager <= 0
					? 'Set a valid bet amount'
					: `Insufficient balance (need ${wager.toFixed(2)})`,
				'error',
			);
			return;
		}

		stateGame.showWinPopup = false;
		stateGame.isSubmitting = true;

		context.eventEmitter.broadcast({ type: 'soundOnce', name: 'bet' });

		const hasRgsSession = Boolean(stateUrlDerived.rgsUrl() && stateUrlDerived.sessionID());
		const forceLocalBooks = page.url.searchParams.get('localBooks') === '1';

		if (import.meta.env.DEV && (!hasRgsSession || forceLocalBooks)) {
			try {
				await playDevLocalBook();
			} finally {
				releaseRoundInteractionLocks();
			}
			return;
		}

		context.eventEmitter.broadcast({ type: 'bet' });
	}



	function handlePlay() {

		onMainPlayClick(placeBet);

	}

	/**
	 * Replay "Play Again": reload the frame. Replay is fully driven by the URL params, so a reload
	 * re-fetches `/bet/replay` and replays the exact same round from scratch — no leftover round state.
	 */
	function handleReplayAgain() {
		window.location.reload();
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
		onBallLanded(event.ballId, event.multiplier, event.isSpinSlot, event.slotIndex);
	}

	function handleCoinPegHit(event: { ballId: number }) {
		onCoinPegHit(event.ballId);
	}



	function openInfo(tab: InfoModalTab) {

		stateGame.infoModalTab = tab;

		stateGame.infoModalOpen = true;

		stateGame.menuOpen = false;

	}

</script>



<EnableGameActor />

<ResumeBet />

<ReplayDriver />

<EnableSound />

<EnableHotkey />

<Modals>
	{#snippet version()}
		<GameVersion version="0.0.0" />
	{/snippet}
</Modals>

<MsgBox />

<Toast />

<Result />

<InfoModal />

<BonusLevelUpOverlay />



<main class="game-root" class:game-root--mobile={mobile} bind:this={gameRootEl}>

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
					<HudMenuPopup
						soundEnabled={stateGame.soundEnabled}
						onToggleSound={() => (stateGame.soundEnabled = !stateGame.soundEnabled)}
						onOpenFair={() => openInfo('fair')}
						onOpenRules={() => openInfo('rules')}
						onOpenHistory={() => openInfo('history')}
						onOpenHowToPlay={() => openInfo('howToPlay')}
						onClose={() => (stateGame.menuOpen = false)}
					/>
				{/if}
			</div>
		</header>
	{/if}

	{#if mobile && stateGame.menuOpen}
		<HudMenuPopup
			mobile
			soundEnabled={stateGame.soundEnabled}
			onToggleSound={() => (stateGame.soundEnabled = !stateGame.soundEnabled)}
			onOpenFair={() => openInfo('fair')}
			onOpenRules={() => openInfo('rules')}
			onOpenHistory={() => openInfo('history')}
			onOpenHowToPlay={() => openInfo('howToPlay')}
			onClose={() => (stateGame.menuOpen = false)}
		/>
	{/if}

	<div class="game-content">
		<div class="game-area" class:game-area--pixi-fill={!mobile}>
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
							coefficients={boardCoefficients}
							rows={stateGame.rowCount}
							animationEnabled={stateGame.animationEnabled}
							animationSpeed={stateGame.fastGameEnabled ? 3 : 0.7}
							onBallDropped={onBallDropped}
							onCoinPegHit={handleCoinPegHit}
						/>
					</div>
				{:else}
					<PlinkoBoard
						coefficients={boardCoefficients}
						rows={stateGame.rowCount}
						animationEnabled={stateGame.animationEnabled}
						animationSpeed={stateGame.fastGameEnabled ? 3 : 0.7}
						onBallDropped={onBallDropped}
						onCoinPegHit={handleCoinPegHit}
					/>
				{/if}

				<div class="bonus-meter-wrap">
					<BonusMeter progress={bonusMeterProgress} />
				</div>
			</div>
		</div>



	<GameHud
		betAmount={stateBet.betAmount}
		totalBetAmount={stateBet.betAmount * stateGame.ballPerDrop}
		onBetAmountChange={handleBetAmountChange}
		onPlay={handlePlay}
		autoMode={stateGame.autoMode}
		autoPlayStarted={stateGame.autoPlayStarted}
		autoRoundsLeft={stateGame.autoRoundsDisplay}
		spinMeterProgress={spinMeterProgress}
		hasPendingBonusBalls={stateGameDerived.hasPendingBonusBalls}
		bonusBallsRemaining={stateGame.bonusBallsRemaining}
		playDisabled={isBetControlsLocked() || isGameOngoing()}
		bonusPlayDisabled={stateGame.bonusRouletteOpen}
		{mobile}
		onMenuClick={() => (stateGame.menuOpen = !stateGame.menuOpen)}
		/>
	</div>

	{#if stateGame.showWinPopup}

		<div class="win-overlay" role="dialog">

			<div class="win-card">

				<p>{context.i18nDerived.t('Win')}</p>

				<span class="win-divider"></span>

				<strong>{winPopupAmountDisplay}</strong>

			</div>

		</div>

	{/if}



	{#if stateGame.freeSpinRouletteOpen}

		<FreeSpinRoulette

			targetSegmentIndex={stateGame.serverFreeSpinSegment}

			serverAuthoritative={stateGame.authoritativeMeterFlow}

			onFinished={(result) => void onFreeSpinRouletteFinished(result.segmentLabel)}

		/>

	{/if}



	{#if stateGame.bonusRouletteOpen}

		<BonusRoulette

			targetFreeBalls={stateGame.serverBonusFreeBalls}

			serverAuthoritative={stateGame.authoritativeMeterFlow}

			autoDismiss={isReplay}

			onResultReady={(result) => onBonusRouletteResultReady(result.freeBallCount)}

			onFinished={(result) => onBonusRouletteFinished(result.freeBallCount)}

		/>

	{/if}



	{#if stateGame.bonusEndAnnouncementOpen}

		<BonusRoulette

			mode="message"

			messageTitle="WIN"

			messageValue="{stateGame.bonusEndWinAmount.toFixed(2)} {stateBet.currency}"

			messageHint="PRESS ANYWHERE TO GO BACK TO THE GAME"

			autoDismiss={isReplay}

			onClosed={onBonusEndAnnouncementClosed}

		/>

	{/if}

	{#if devBonusCongratulationsPreviewOpen}
		<BonusRoulette
			mode="message"
			messageTitle="CONGRATULATIONS!"
			messageValue="YOU WON 50 DROPS"
			messageHint="PRESS ANYWHERE TO GO BACK TO THE GAME"
			onClosed={() => {
				devBonusCongratulationsPreviewOpen = false;
			}}
		/>
	{/if}

	{#if isReplay}
		<div class="replay-ui" class:replay-ui--mobile={mobile}>
			<div class="replay-badge">
				<span class="replay-dot"></span>
				REPLAY
			</div>
			<button type="button" class="replay-again-btn" onclick={handleReplayAgain}>
				Play Again
			</button>
		</div>
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

		top: 2.5vw;

		left: 0.9vw;

		right: 2.6vw;

		z-index: 20;

		height: 3.6vw;

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

	/* Desktop — absolute inset uses almost full viewport (HUD/panel overlay) */
	.game-root:not(.game-root--mobile) .game-area {

		--game-area-offset-y-ratio: 0;

		position: absolute;

		top: calc(3vw + var(--game-area-offset-y-ratio) * 100vw);

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


	.container {

		/* Bonus meter — desktop proportions vs 96×55 frame (12×7.8 @ top 6) */
		--bonus-meter-width-ratio: 0.135;
		--bonus-meter-height-ratio: 0.141818;
		--bonus-meter-top-ratio: 0.109091;
		--bonus-meter-offset-x-ratio: 0.0075;
		--bonus-meter-offset-y-ratio: 0;
		/* Bonus level track uses frame-relative ratios like meter/marker. */
		--bonus-level-width-ratio: 0.33;
		--bonus-level-height-ratio: 0.238182;
		--bonus-level-top-ratio: -0.055;
		--bonus-level-left-ratio: 0.51;
		/* Increase all bonus-level bars uniformly. */
		--bonus-level-node-size-ratio: 2.5;
		/* Bonus overlay image controls (desktop fallback). */
		--bonus-overlay-scale: 1;
		--bonus-overlay-offset-x: 0.3%;
		--bonus-overlay-offset-y: 0.3%;
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
		--bonus-meter-width: calc(var(--game-area-fit-width) * var(--bonus-meter-width-ratio));
		--bonus-meter-height: calc(var(--game-area-fit-height) * var(--bonus-meter-height-ratio));
		--bonus-meter-offset-y: calc(
			var(--game-area-fit-height) *
				(var(--bonus-meter-top-ratio) + var(--bonus-meter-offset-y-ratio))
		);
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

		transform-origin: center center;

	}

	/* Desktop / landscape — game layout + plinko board (frame fit-width/height) */
	.game-root:not(.game-root--mobile) .game-area > .container {
		--game-layout-scale: 1.1;
		--game-layout-offset-x-ratio: 0;
		--game-layout-offset-y-ratio: 0.015;
		transform: translate(
				calc(var(--game-layout-offset-x-ratio) * 100vw),
				calc(var(--game-layout-offset-y-ratio) * 100vw)
			)
			scale(var(--game-layout-scale));

		--plinko-area-scale: 0.525;
		--plinko-area-top-width-scale: 0.85;
		--plinko-area-bottom-width-scale: 0.85;
		--plinko-area-height-scale: 1.1;
		--plinko-area-offset-x-ratio: 0.007;
		--plinko-area-offset-ratio: 0.1825;
		--plinko-area-offset-y-extra-ratio: 0;
		--plinko-area-offset-x: calc(var(--plinko-area-offset-x-ratio) * 100vw);
		--plinko-host-width: calc(
			var(--game-area-fit-width) * var(--plinko-area-scale) *
				max(var(--plinko-area-top-width-scale), var(--plinko-area-bottom-width-scale))
		);
		--plinko-host-height: calc(
			var(--game-area-fit-height) * var(--plinko-area-scale) * var(--plinko-area-height-scale)
		);
		--plinko-area-offset-y: calc(
			(var(--plinko-area-offset-ratio) + var(--plinko-area-offset-y-extra-ratio)) * 100vw
		);
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

		left: calc(50% + var(--bonus-meter-offset-x-ratio, 0) * 100%);

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
		transform: translate(var(--bonus-overlay-offset-x), var(--bonus-overlay-offset-y))
			scale(var(--bonus-overlay-scale));
		transform-origin: center;

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

		display: grid;

		place-items: center;

		z-index: 20;

		pointer-events: none;

	}

	.win-card {

		box-sizing: border-box;

		width: max-content;

		min-width: 150px;

		max-width: 96vw;

		padding: 32px 24px;

		text-align: center;

		/* Coded equivalent of win_bg.svg: dark radial fill + green rounded border. */
		background: radial-gradient(ellipse at center, #332f3e 0%, #1a191d 100%);

		border: 9px solid #54f917;

		border-radius: 16px;

	}

	.win-card p {

		color: #54f917;

		font-size: 1.58125rem;

		font-weight: 400;

		margin: 0;

	}

	.win-divider {

		display: block;

		width: 72px;

		height: 3px;

		margin: 12px auto 0;

		border-radius: 999px;

		background: rgba(255, 255, 255, 0.45);

	}

	.win-card strong {

		display: block;

		white-space: nowrap;

		font-size: 1.3rem;

		margin: 10px 0 0;

		font-weight: 400;

		color: #54f917;

	}

	/* Replay mode — floating badge + Play Again (top center). */
	.replay-ui {
		position: fixed;
		top: 14px;
		left: 50%;
		transform: translateX(-50%);
		z-index: 40;
		display: flex;
		align-items: center;
		gap: 10px;
		pointer-events: none;
	}

	.replay-ui--mobile {
		top: 10px;
	}

	.replay-ui > * {
		pointer-events: auto;
	}

	.replay-badge {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		padding: 6px 14px;
		border-radius: 999px;
		background: rgba(18, 18, 22, 0.82);
		border: 1.5px solid #54f917;
		color: #54f917;
		font-size: 0.78rem;
		font-weight: 700;
		letter-spacing: 0.16em;
		text-transform: uppercase;
		box-shadow: 0 2px 12px rgba(0, 0, 0, 0.45);
		backdrop-filter: blur(2px);
		user-select: none;
	}

	.replay-dot {
		width: 9px;
		height: 9px;
		border-radius: 50%;
		background: #54f917;
		box-shadow: 0 0 8px #54f917;
		animation: replay-pulse 1.2s ease-in-out infinite;
	}

	@keyframes replay-pulse {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.3;
		}
	}

	.replay-again-btn {
		appearance: none;
		border: none;
		cursor: pointer;
		padding: 7px 18px;
		border-radius: 999px;
		background: #54f917;
		color: #0c1408;
		font-size: 0.78rem;
		font-weight: 700;
		letter-spacing: 0.04em;
		box-shadow: 0 2px 12px rgba(84, 249, 23, 0.35);
		transition:
			transform 0.12s ease,
			filter 0.12s ease;
	}

	.replay-again-btn:hover {
		filter: brightness(1.08);
		transform: translateY(-1px);
	}

	.replay-again-btn:active {
		transform: translateY(0);
	}

	/* Mobile — layout from 992×1761 reference (Portrait_animationGuide / legacy mobile) */
	.game-root--mobile .game-area {

		--game-area-offset-y-ratio-mobile: 0;

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

		transform: translateY(calc(var(--game-area-offset-y-ratio-mobile) * 100vw));

	}

	.game-root--mobile .game-area > .container {

		/* Portrait plinko layout — tune independently from desktop / landscape */
		--game-layout-scale-mobile: 1.15;
		--game-layout-offset-x-ratio-mobile: -0.015;
		--game-layout-offset-y-ratio-mobile: 0.1;
		transform: translate(
				calc(var(--game-layout-offset-x-ratio-mobile) * 100vw),
				calc(var(--game-layout-offset-y-ratio-mobile) * 100vw)
			)
			scale(var(--game-layout-scale-mobile));

		--plinko-area-scale-mobile: 0.8;
		--plinko-area-top-width-scale-mobile: 1;
		--plinko-area-bottom-width-scale-mobile: 1;
		--plinko-area-height-scale-mobile: 1.35;
		--plinko-area-offset-x-ratio-mobile: 0.01;
		--plinko-area-offset-ratio-mobile: 0;
		--plinko-area-offset-y-ratio-mobile: -0.01;

		--plinko-area-offset-x-mobile: calc(var(--plinko-area-offset-x-ratio-mobile) * 100vw);
		--plinko-host-width-mobile: calc(
			100% * var(--plinko-area-scale-mobile) *
				max(
					var(--plinko-area-top-width-scale-mobile),
					var(--plinko-area-bottom-width-scale-mobile)
				)
		);
		--plinko-host-height-mobile: calc(
			100% * var(--plinko-area-scale-mobile) * var(--plinko-area-height-scale-mobile)
		);
		--plinko-area-offset-y-mobile: calc(
			(var(--plinko-area-offset-ratio-mobile) + var(--plinko-area-offset-y-ratio-mobile)) *
				100vw
		);

		--bonus-level-left-ratio: 0.415;
		--bonus-level-top-ratio: -0.07;
		--bonus-level-width-ratio: 0.61;
		--bonus-level-height-ratio: 0.336;
		/* Optional mobile-specific overlay tuning (falls back to desktop vars). */
		--bonus-overlay-scale-mobile: var(--bonus-overlay-scale);
		--bonus-overlay-offset-x-mobile: var(--bonus-overlay-offset-x);
		--bonus-overlay-offset-y-mobile: var(--bonus-overlay-offset-y);
		/* === Mobile bonus meter tweaks — safe to adjust without affecting desktop === */
		--mobile-bonus-meter-scale: .95;           /* overall size multiplier (>1 = bigger) */
		--mobile-bonus-meter-top-px: 132;        /* vertical position in portrait-px units */
		--mobile-bonus-meter-left: 51.5%;          /* horizontal center anchor */
		--mobile-bonus-meter-offset-x-ratio: 0; /* fine-tune X as a fraction of container width */
		--mobile-bonus-meter-offset-y-ratio: -0.05; /* fine-tune Y as a fraction of game-area height */

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

		transform-origin: center top;

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

		object-fit: cover;

		object-position: top center;

	}

	.game-root--mobile .game-area > .container .game-area-frame {

		transform: translateX(-50%);

	}

	.game-root--mobile .game-area > .container .game-area-bonus-overlay {

		transform: translate(
				calc(-50% + var(--bonus-overlay-offset-x-mobile)),
				var(--bonus-overlay-offset-y-mobile)
			)
			scale(var(--bonus-overlay-scale-mobile));
		transform-origin: center top;

	}

	.game-root--mobile .game-area > .container .bonus-meter-wrap {

		top: calc(
			var(--portrait-px) * var(--mobile-bonus-meter-top-px) +
				var(--game-area-fit-height) * var(--mobile-bonus-meter-offset-y-ratio)
		);

		left: calc(var(--mobile-bonus-meter-left) + var(--mobile-bonus-meter-offset-x-ratio) * 100%);

		width: calc(var(--portrait-px) * 258 * var(--mobile-bonus-meter-scale));

		height: calc(var(--portrait-px) * 198 * var(--mobile-bonus-meter-scale));

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

		pointer-events: auto;

	}

</style>

