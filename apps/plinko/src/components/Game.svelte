<script lang="ts">

	import { onMount } from 'svelte';
	import { innerHeight, innerWidth } from 'svelte/reactivity/window';
	import { page } from '$app/state';

	import { stateBet, stateUrlDerived } from 'state-shared';
	import { numberToCurrencyString } from 'utils-shared/amount';



	import { BONUS_LEVEL_LABELS, coefficientsForRowCount, SIM_SPEED } from '../game-logic/constants';
	import config from '../game/config';

	import { hasActiveRoundToResume } from '../game/plinkoActiveRound';
	import { canAffordPlinkoWager, maxAffordableStakePerBall, plinkoWagerAmount, snapStakeToBetLevels } from '../game/plinkoBet';
	import { buyBonusModeName, syncPlinkoBetModeFromUi, type BuyBonusTier } from '../game/plinkoBetMode';
	import { playDevLocalBook } from '../game/devLocalBet';
	import { installPlinkoDevDebug } from '../game/devDebug';
	import { applyClientMeterDefaults } from '../game/plinkoMeterConfig';
	import { applyBonusMeterDisplay, applyRgsSessionMetersToDisplay } from '../game/plinkoSessionMeters';

	import { getContext } from '../game/context';

	import {

		isBetControlsLocked,

		isGameOngoing,

		onBallLanded,

		onBonusEndAnnouncementClosed,

		onMainPlayClick,

		maybeAutoFireFeatureTrigger,

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

	import EnableMusic from './EnableMusic.svelte';

	import GameHud from './GameHud.svelte';

	import HudMenuPopup from './HudMenuPopup.svelte';

	import InfoModal from './InfoModal.svelte';

	import BuyBonusModal from './BuyBonusModal.svelte';

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

	/** TODO: remove — open the bonus roulette the moment the game loads (pairs with DEBUG_KEEP_OPEN in
	 * BonusRoulette.svelte, which holds it on screen). Bonus will NOT resolve while this is on. */
	const DEV_SHOW_BONUS_ROULETTE_ON_LOAD = false;

	/** DEBUG: enter bonus mode on load and light up ALL bonus level bars as if every level is unlocked.
	 * Forces bonusRoundActive (which also flips on the bonus background) and pins bonusLevelProgress to
	 * the full count so every node uses its active image. Purely a visual override — set back to false
	 * to restore normal flow. */
	const DEV_SHOW_ALL_BONUS_LEVELS_ON_LOAD = true;

	/** DEBUG: force the bonus meter's visual fill to a fixed value in 0..1 (e.g. 0.5 = half full).
	 * Purely cosmetic — it only feeds the <BonusMeter> progress prop and does NOT touch the real
	 * meter value, bonus trigger logic, or anything else. Leave as null to use the live meter.
	 * Can also be changed live from the dev console: plinkoSetBonusMeter(0.5) / plinkoSetBonusMeter(null). */
	const DEV_BONUS_METER_PROGRESS: number | null = null;
	let devBonusMeterProgress = $state<number | null>(DEV_BONUS_METER_PROGRESS);

	let gameRootEl = $state<HTMLElement | undefined>(undefined);



	const coefficients = $derived.by(() =>
		coefficientsForRowCount(config.coefficientSets as number[][], stateGame.rowCount),
	);

	const boardCoefficients = $derived(
		stateGame.coefficients.length > 0 ? stateGame.coefficients : coefficients,
	);

	/** Track `stateGame` meter fields directly — getters on `stateGameDerived` are not reactive. */
	const bonusMeterProgress = $derived(
		devBonusMeterProgress ??
			(stateGame.bonusMeterMax > 0
				? Math.min(1, Math.max(0, stateGame.bonusMeterValue / stateGame.bonusMeterMax))
				: 0),
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

		if (import.meta.env.DEV) {
			// Live cosmetic override for the bonus meter fill — see DEV_BONUS_METER_PROGRESS above.
			// plinkoSetBonusMeter(0.5) fills to half; plinkoSetBonusMeter(null) restores the live value.
			(window as Window & { plinkoSetBonusMeter?: (value: number | null) => void }).plinkoSetBonusMeter =
				(value) => {
					devBonusMeterProgress = value === null ? null : Math.min(1, Math.max(0, value));
				};
		}

		applyClientMeterDefaults(config.spinMeterMax, config.bonusMeterMax);
		applyRgsSessionMetersToDisplay();

		if (DEV_SHOW_BONUS_LEVEL_UP_ON_LOAD) {
			stateGame.bonusLevelUpLevel = 4;
			stateGame.bonusLevelUpAddedBalls = 80;
			stateGame.bonusLevelUpOverlayOpen = true;
			stateGame.bonusLevelUpOverlayVisible = true;
		}

		if (DEV_SHOW_BONUS_ROULETTE_ON_LOAD) {
			stateGame.bonusRouletteOpen = true;
		}

		if (DEV_SHOW_ALL_BONUS_LEVELS_ON_LOAD) {
			stateGame.bonusRoundActive = true;
			stateGame.bonusLevelProgress = BONUS_LEVEL_LABELS.length;
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

		// Autobet intentionally keeps running while the tab is backgrounded (parity with the
		// reference game). The Pixi ticker (rAF) pauses on hide, so the board drives its ball
		// physics off a timer instead (see PlinkoEngine.advanceWhileHidden) and rounds keep
		// settling. We therefore do NOT terminate Autobet on `visibilitychange`.

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

	// Buy bonus — can't open mid-round / mid-bonus / in replay.
	const buyBonusDisabled = $derived.by(() => {
		stateGame.isSubmitting;
		stateGame.dropRoundActive;
		stateGame.bonusRoundActive;
		stateGame.bonusRouletteOpen;
		stateGame.freeSpinRouletteOpen;
		stateGame.autoPlayStarted;
		stateXstate.value;
		return isReplay || isBetControlsLocked() || isGameOngoing() || stateGame.bonusRoundActive;
	});

	function openBuyBonus() {
		if (buyBonusDisabled) return;
		stateGame.menuOpen = false;
		stateGame.buyBonusModalOpen = true;
	}

	// Buy bonus is LIVE: the 4 bonus-only buy modes (buystandard/enhanced/premium/superfury) are published
	// in the math. Cost is ×bet-per-ball and independent of balls-per-drop. Set false to disable the
	// Activate buttons (the modal UI still opens) if the math is ever unpublished.
	const BUY_BONUS_ENABLED = true as boolean;

	/** A tier's Activate: route the next bet through that buy mode, then place it. A buy is bonus-only, so
	 * we pre-fill the bonus meter to FULL for immediate feedback (the book also opens with it full); the
	 * bonus fires at once, the roulette lands on the bought entry balls, and chain hits add more on top.
	 * The pending mode is cleared by the revert effect once the round fully settles. */
	function handleBuyBonusActivate(tier: BuyBonusTier) {
		if (!BUY_BONUS_ENABLED) return;
		stateGame.buyBonusModalOpen = false;
		// Bonus-only buy → mode is per tier (bpd-independent).
		stateGame.pendingBuyBonusMode = buyBonusModeName(tier.key);
		// Show the bonus meter FULL the instant the buy round starts. The book carries a full
		// bonus_meter_start too, but the client ignores the book's start for the session meter (anti
		// stratum-jump), so we set the HUD value directly here.
		applyBonusMeterDisplay(stateGame.bonusMeterMax);
		syncPlinkoBetModeFromUi();
		placeBet();
	}

	// Buy bonus is one-shot (is_feature=false): once the purchased round has started AND fully settled,
	// drop the pending mode so the next bet reverts to the normal tier mode.
	let buyBonusInFlight = false;
	$effect(() => {
		const playing =
			stateGame.isSubmitting ||
			stateGame.dropRoundActive ||
			stateGame.bonusRoundActive ||
			stateXstateDerived.isPlaying();
		if (!stateGame.pendingBuyBonusMode) {
			buyBonusInFlight = false;
			return;
		}
		if (playing) {
			buyBonusInFlight = true;
		} else if (buyBonusInFlight) {
			buyBonusInFlight = false;
			stateGame.pendingBuyBonusMode = null;
			syncPlinkoBetModeFromUi();
		}
	});

</script>



<EnableGameActor />

<ResumeBet />

<ReplayDriver />

<EnableSound />

<EnableMusic />

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

<BuyBonusModal disabled={buyBonusDisabled} onActivate={handleBuyBonusActivate} />

<BonusLevelUpOverlay />



<main class="game-root" class:game-root--mobile={mobile} bind:this={gameRootEl}>

	<div class="bg-layer">
		<Background />
	</div>

	{#if !isReplay}
		<button
			type="button"
			class="buy-bonus-trigger"
			class:buy-bonus-trigger--mobile={mobile}
			disabled={buyBonusDisabled}
			onclick={openBuyBonus}
			aria-label="Buy bonus"
		>
			<img src={staticUrl('img/buy-bonus-btn.png')} alt="" aria-hidden="true" />
		</button>
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
					<HudMenuPopup
						soundEnabled={stateGame.soundEnabled}
						onToggleSound={() => (stateGame.soundEnabled = !stateGame.soundEnabled)}
						musicEnabled={stateGame.musicEnabled}
						onToggleMusic={() => (stateGame.musicEnabled = !stateGame.musicEnabled)}
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
			musicEnabled={stateGame.musicEnabled}
			onToggleMusic={() => (stateGame.musicEnabled = !stateGame.musicEnabled)}
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
							animationSpeed={stateGame.fastGameEnabled ? SIM_SPEED.fast : SIM_SPEED.normal}
							onBallDropped={onBallDropped}
							onCoinPegHit={handleCoinPegHit}
						/>
					</div>
				{:else}
					<PlinkoBoard
						coefficients={boardCoefficients}
						rows={stateGame.rowCount}
						animationEnabled={stateGame.animationEnabled}
						animationSpeed={stateGame.fastGameEnabled ? SIM_SPEED.fast : SIM_SPEED.normal}
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

			skipSpin={!!stateGame.pendingBuyBonusMode}

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

	.game-root--mobile .game-area > .container .bonus-level-behind-game-area :global(.bonus-level-track) {

		/* Higher specificity than the desktop `.container ...` track rule (100%/100%) so the mobile
		   track adopts the tile coordinate space (65vw × 33.6vw). This locks the gold-arch base image
		   to the number tiles — both share one box — instead of the base sizing to the fit-width box
		   (which left the arch floating high above the tiles). */
		width: var(--mobile-bonus-track-width);

		height: var(--mobile-bonus-track-height);

	}

	/* Mobile deliberately does NOT override the per-tile node positions: it reuses the desktop
	   defaults from BonusLevel.svelte. Those positions are tuned to the gold-arch base image at the
	   desktop track aspect ratio, so as long as the mobile track matches that aspect (see
	   --mobile-bonus-track-height below), the numbers sit in the arch segments exactly like desktop. */

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

	/* Buy bonus trigger — desktop top-left, mobile top-right. */
	.buy-bonus-trigger {
		position: absolute;
		top: 2.2vw;
		left: 1vw;
		z-index: 25;
		width: 5vw;
		height: 5vw;
		min-width: 54px;
		min-height: 54px;
		padding: 0;
		border: none;
		background: none;
		cursor: pointer;
		transition:
			transform 0.12s ease,
			filter 0.12s ease;
	}

	.buy-bonus-trigger img {
		width: 100%;
		height: 100%;
		object-fit: contain;
		pointer-events: none;
		filter: drop-shadow(0 2px 6px rgba(0, 0, 0, 0.5));
	}

	.buy-bonus-trigger:hover:not(:disabled) {
		transform: scale(1.06);
	}

	.buy-bonus-trigger:disabled {
		cursor: not-allowed;
		filter: grayscale(0.7) brightness(0.55);
	}

	.buy-bonus-trigger--mobile {
		top: 10px;
		right: 10px;
		left: auto;
		width: 62px;
		height: 62px;
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
		/* Height = width / 2.419 so the mobile track matches the desktop track aspect ratio. This keeps
		   the gold arch the same flatness as desktop and lets the shared default tile positions land in
		   the arch segments. (65 / 2.419 ≈ 26.87) */
		--mobile-bonus-track-height: 26.87vw;

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

		--plinko-area-scale: 0.54;
		--plinko-area-top-width-scale: 0.65;
		--plinko-area-bottom-width-scale: 0.75;
		--plinko-area-height-scale: 1.2;
		/* Offsets are expressed as fractions of the fitted game-area box (same units that
		   size the frame), NOT of raw 100vw. This keeps the plinko host glued to the frame
		   when the viewport is height-constrained — otherwise the frame stays fixed (driven
		   by height) while a vw-based offset drifts the board up/down. */
		--plinko-area-offset-x-ratio: 0.008;
		--plinko-area-offset-ratio: 0.357;
		--plinko-area-offset-y-extra-ratio: 0;
		--plinko-area-offset-x: calc(var(--plinko-area-offset-x-ratio) * var(--game-area-fit-width));
		--plinko-host-width: calc(
			var(--game-area-fit-width) * var(--plinko-area-scale) *
				max(var(--plinko-area-top-width-scale), var(--plinko-area-bottom-width-scale))
		);
		--plinko-host-height: calc(
			var(--game-area-fit-height) * var(--plinko-area-scale) * var(--plinko-area-height-scale)
		);
		--plinko-area-offset-y: calc(
			(var(--plinko-area-offset-ratio) + var(--plinko-area-offset-y-extra-ratio)) *
				var(--game-area-fit-height)
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

		/* Landscape rectangle matching the win_bg.svg reference art (120×104 ≈ 1.4:1 wide), widening
		   further as the win amount gets longer. `--win-w` is the width floor (so a short amount still
		   reads as a wide landscape card) and `--win-h` the fixed height; `max-content` lets a longer
		   amount push the width past the floor. The divider uses a relative width (below) so the
		   *amount* — not the divider — drives how wide the card grows.
		   NOTE: floor + height + padding are in `rem` (like the text) so the aspect ratio is identical
		   on desktop and mobile — the SDK scales the root font-size per device, and px/vw units would
		   leave the box fixed while the text grew, distorting the shape on mobile. */
		--win-w: 16.5rem;
		--win-h: 11.5rem;

		display: flex;

		flex-direction: column;

		align-items: center;

		justify-content: center;

		width: max-content;

		height: var(--win-h);

		min-width: var(--win-w);

		max-width: 96vw;

		padding: 0 3.5rem;

		text-align: center;

		/* Coded equivalent of win_bg.svg: dark radial fill + green rounded border. The border and
		   radius are in `rem` too so they stay proportionate to the card on mobile (a fixed px border
		   reads as chunky once the SDK scales the root font-size down). */
		background: radial-gradient(ellipse at center, #332f3e 0%, #1a191d 100%);

		border: 0.5rem solid #54f917;

		border-radius: 1rem;

	}

	.win-card p {

		color: #54f917;

		/* 1.58125rem base, +20%. */
		font-size: 1.8975rem;

		font-weight: 400;

		margin: 0;

	}

	.win-divider {

		display: block;

		/* Relative width so the divider tracks the card instead of forcing its min-width
		   (lets the win amount drive how wide the card grows). */
		width: 60%;

		height: 3px;

		margin: 12px auto 0;

		border-radius: 999px;

		background: rgba(255, 255, 255, 0.45);

	}

	.win-card strong {

		display: block;

		white-space: nowrap;

		/* 1.3rem base, +20%. */
		font-size: 1.56rem;

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

		--plinko-area-scale-mobile: 0.75;
		--plinko-area-top-width-scale-mobile: 1;
		--plinko-area-bottom-width-scale-mobile: 1;
		--plinko-area-height-scale-mobile: 1.45;
		--plinko-area-offset-x-ratio-mobile: 0.015;
		--plinko-area-offset-ratio-mobile: 0;
		--plinko-area-offset-y-ratio-mobile: -0.03;

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

		--bonus-level-left-ratio: 0.495;
		--bonus-level-top-ratio: -0.11;
		/* Uniform shrink of the bonus bar so its arc edges align with the pirate-hat brim. */
		--mobile-bonus-level-scale: 0.97;
		--bonus-level-width-ratio: 0.6;
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

		/* Shrink the whole bar (arch + tiles) a touch so its edges tuck into the pirate-hat brim.
		   Scales about the box centre, so it stays centred on the hat. */
		transform: translateX(-50%) scale(var(--mobile-bonus-level-scale, 1));

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

