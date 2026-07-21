<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { innerHeight, innerWidth } from 'svelte/reactivity/window';
	import { fade, scale } from 'svelte/transition';
	import { flip } from 'svelte/animate';
	import { backOut } from 'svelte/easing';
	import { page } from '$app/state';

	import { stateBet, stateI18n, stateUrlDerived } from 'state-shared';

	import { coefficientsForRowCount, SIM_SPEED } from '../game-logic/constants';
	import config from '../game/config';

	import { hasActiveRoundToResume } from '../game/plinkoActiveRound';
	import { canAffordPlinkoWager, plinkoWagerAmount, snapStakeToBetLevels } from '../game/plinkoBet';
	import {
		buyBonusModeName,
		syncPlinkoBetModeFromUi,
		type BuyBonusTier,
	} from '../game/plinkoBetMode';
	import { playDevLocalBook } from '../game/devLocalBet';
	import { installPlinkoDevDebug } from '../game/devDebug';
	import { applyClientMeterDefaults } from '../game/plinkoMeterConfig';
	import {
		applyBonusMeterDisplay,
		applyRgsSessionMetersToDisplay,
	} from '../game/plinkoSessionMeters';

	import { getContext } from '../game/context';

	import {
		isBetControlsLocked,
		isGameOngoing,
		isRapidSingleBallMode,
		clearRapidWinToasts,
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
	import {
		FreeSpinMeter,
		FreeSpinRoulette,
		applyFreeSpinWinOnLand,
		onFreeSpinRouletteFinished,
	} from '../features/freeSpin';

	import { isPlinkoOffline } from '../game/plinkoConnection';

	import {
		currencySign,
		isPortraitGameLayout,
		WIN_FRACTION_DIGITS,
		formatWinAmount,
	} from '../lib/format';
	import { staticCssUrl, staticUrl } from '../lib/staticUrl';
	import { WIN_CELEBRATION_TOTAL_MS, WIN_TIMING } from '../lib/winCelebration';

	import Background from './Background.svelte';
	import BonusLevelUpOverlay from './BonusLevelUpOverlay.svelte';

	import { EnableHotkey } from 'components-shared';
	import { GameVersion, Modals } from 'components-ui-html';

	import EnableGameActor from './EnableGameActor.svelte';
	import SuppressButtonFocusRing from './SuppressButtonFocusRing.svelte';
	import ResumeBet from './ResumeBet.svelte';
	import ReplayDriver from './ReplayDriver.svelte';

	import EnableSound from './EnableSound.svelte';

	import EnableMusic from './EnableMusic.svelte';

	import GameHud from './GameHud.svelte';

	import HudMenuPopup from './HudMenuPopup.svelte';

	import InfoModal from './InfoModal.svelte';

	import BuyBonusModal from './BuyBonusModal.svelte';

	import MsgBox from './MsgBox.svelte';

	import NetworkStatus from './NetworkStatus.svelte';

	import PlinkoBoard from './PlinkoBoard.svelte';

	import Result from './Result.svelte';

	import BalanceCard from './BalanceCard.svelte';

	import CoinFountain from './CoinFountain.svelte';

	import WinCelebration from './WinCelebration.svelte';

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

	/** TODO: remove — open the bonus roulette the moment the game loads so the reassembled wheel + the
	 * per-segment gold highlight can be watched. It spins after DEBUG_SPIN_DELAY_MS in BonusRoulette.svelte
	 * and lands on the debug target set in onMount below. Clicking the "press anywhere" announcement
	 * afterwards runs the real bonus flow, so just reload to watch the spin again. */
	const DEV_SHOW_BONUS_ROULETTE_ON_LOAD = false;

	/** TODO: remove — open the free-spin roulette on load so the reassembled wheel + per-segment gold
	 * highlight can be watched. It spins after DEBUG_SPIN_DELAY_MS in FreeSpinRoulette.svelte (set to ~5s)
	 * and lands on the debug target (10X). Rendered via its own preview flag below (independent of the
	 * game's round flow, which would otherwise reset the open state during init). Reload to watch again. */
	const DEV_SHOW_FREE_SPIN_ROULETTE_ON_LOAD = false;
	let devFreeSpinRoulettePreviewOpen = $state(DEV_SHOW_FREE_SPIN_ROULETTE_ON_LOAD);

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

	// Clear the win-popup gate once the full-screen WinCelebration has played out (it owns its own
	// reveal → count-up → hold → merge → fade timeline). Re-reading winPopupAmount restarts the timer
	// if a fresh win lands while one is showing, so the celebration always runs its full length.
	$effect(() => {
		if (!stateGame.showWinPopup) return;
		if (DEV_SHOW_WIN_MODAL_ON_LOAD) return;
		stateGame.winPopupAmount;
		const timer = setTimeout(() => {
			stateGame.showWinPopup = false;
		}, WIN_CELEBRATION_TOTAL_MS + 300);
		return () => clearTimeout(timer);
	});

	// Balance count-up driver. WinCelebration holds the displayed balance at its pre-win value and, once
	// the coins have merged + the "+win" float has slid, bumps `balanceWinReleaseTick`. Here (in the
	// always-mounted root, so it survives the overlay unmounting) we ease the displayed balance from the
	// held value up to the credited total, then clear the override so it falls back to authoritative.
	let balanceCountUpRaf = 0;
	let lastBalanceReleaseTick = stateGame.balanceWinReleaseTick;
	$effect(() => {
		const tick = stateGame.balanceWinReleaseTick;
		untrack(() => {
			if (tick === lastBalanceReleaseTick) return;
			lastBalanceReleaseTick = tick;
			const from = stateGame.balanceWinHold ?? stateBet.balanceAmount;
			const to = stateBet.balanceAmount;
			stateGame.balanceWinHold = null; // hand the display over to the count-up value
			if (balanceCountUpRaf) cancelAnimationFrame(balanceCountUpRaf);
			if (Math.abs(to - from) < 0.005) {
				stateGame.balanceCountUpValue = null; // nothing to count (e.g. not yet credited) — just release
				return;
			}
			stateGame.balanceCountUpValue = from;
			const t0 = performance.now();
			const dur = WIN_TIMING.balanceCountUp;
			const step = (now: number) => {
				const p = Math.min(1, (now - t0) / dur);
				const eased = 1 - Math.pow(1 - p, 2.2);
				stateGame.balanceCountUpValue = from + (to - from) * eased;
				if (p < 1) {
					balanceCountUpRaf = requestAnimationFrame(step);
				} else {
					balanceCountUpRaf = 0;
					stateGame.balanceCountUpValue = null; // done → display falls back to authoritative
				}
			};
			balanceCountUpRaf = requestAnimationFrame(step);
		});
	});
	$effect(() => () => {
		if (balanceCountUpRaf) cancelAnimationFrame(balanceCountUpRaf);
	});

	// 1-ball rapid win toasts show the amount without a currency symbol — plain locale-formatted
	// number, matching the base-game win popup (up to 4 decimals for tiny wins on low bets).
	const formatRapidToastAmount = (amount: number) =>
		stateI18n.i18n.number(amount, WIN_FRACTION_DIGITS);

	// Leaving the 1-ball tier clears any lingering win toasts (and cancels their fade timers) so a
	// stale toast can't reappear when the tier is re-selected.
	$effect(() => {
		if (stateGame.ballPerDrop !== 1 && stateGame.rapidWinToasts.length > 0) {
			clearRapidWinToasts();
		}
	});

	onMount(() => {
		installPlinkoDevDebug();

		if (import.meta.env.DEV) {
			// Live cosmetic override for the bonus meter fill — see DEV_BONUS_METER_PROGRESS above.
			// plinkoSetBonusMeter(0.5) fills to half; plinkoSetBonusMeter(null) restores the live value.
			(
				window as Window & { plinkoSetBonusMeter?: (value: number | null) => void }
			).plinkoSetBonusMeter = (value) => {
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
			// Give the wheel a valid authoritative target (lands on the 50 wedge) so it resolves cleanly
			// instead of tripping the provably-fair guard with an undefined server value.
			stateGame.serverBonusFreeBalls = 50;
			stateGame.bonusRouletteOpen = true;
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
		// Keep the player's chosen bet-per-ball exactly where they set it — only snap it onto a valid
		// betLevels entry (RGS validity). Never shrink it to fit the current balance: an unaffordable
		// stake simply disables the Bet button (see `canAffordPlinkoWager`), it is not auto-adjusted.
		stateBet.betAmount = snapStakeToBetLevels(Math.max(0, value));
	}

	// Rapid 1-ball mode uses a lightweight INPUT THROTTLE instead of an input queue. Each click fires a
	// bet immediately when the round machine is free; clicks that arrive while it's busy (or inside the
	// throttle window) are dropped, never buffered. The ball drop + its SFX therefore fire in direct
	// response to the click that triggered them, and betting stops the instant the player stops clicking —
	// no trailing backlog of balls draining out after the burst ends.
	const RAPID_BET_THROTTLE_MS = 30;
	let lastRapidBetAt = 0;

	async function placeBet() {
		// Replay is passive playback of a recorded round — never place a wager.
		if (isReplay) return;
		// Offline: gameplay is suspended behind the "No Internet Connection" overlay. Don't fire a
		// bet (nor queue an autobet round) that would immediately fail against the RGS.
		if (isPlinkoOffline()) {
			showToast('No Internet Connection', 'error');
			return;
		}
		// Rapid 1-ball mode: throttle a mashed / held Bet button so it can't fire faster than
		// RAPID_BET_THROTTLE_MS. Throttled clicks are dropped, not buffered, so betting halts the moment
		// the player stops clicking (no trailing balls). See RAPID_BET_THROTTLE_MS.
		if (isRapidSingleBallMode() && performance.now() - lastRapidBetAt < RAPID_BET_THROTTLE_MS)
			return;
		// Ignore a bet while the previous round is still settling (machine not yet idle) — the
		// idle-only xstate machine would drop the BET and leave `isSubmitting` stuck. In rapid 1-ball
		// mode the click is simply dropped (the throttle above already prevents lost-click spam).
		if (stateGame.isSubmitting || stateGame.dropRoundActive || stateXstateDerived.isPlaying()) {
			return;
		}

		if (hasActiveRoundToResume()) {
			showToast('Finishing your previous round…', 'info');
			context.eventEmitter.broadcast({ type: 'resumeBet' });
			return;
		}

		if (!canAffordPlinkoWager()) {
			// The Bet button is already disabled whenever the total bet exceeds the spendable balance;
			// this is the safety net for any path that still reaches placeBet (e.g. the Space hotkey
			// racing a balance change). Match the Autobet start/finish toast style — info, not error.
			if (plinkoWagerAmount() <= 0) {
				showToast('Set a valid bet amount', 'error');
			} else {
				showToast('Insufficient Balance');
			}
			return;
		}

		if (isRapidSingleBallMode()) lastRapidBetAt = performance.now();
		stateGame.showWinPopup = false;
		stateGame.isSubmitting = true;

		context.eventEmitter.broadcast({ type: 'soundOnce', name: 'bet' });

		const hasRgsSession = Boolean(stateUrlDerived.rgsUrl() && stateUrlDerived.sessionID());
		const forceLocalBooks = page.url.searchParams.get('localBooks') === '1';

		if (import.meta.env.DEV && (!hasRgsSession || forceLocalBooks)) {
			try {
				await playDevLocalBook();
			} finally {
				// Preserve the still-falling ball in rapid 1-ball mode (parity with playBet's own finally),
				// otherwise this outer reset would strip its outcome before it lands.
				releaseRoundInteractionLocks(isRapidSingleBallMode());
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

	// Buy bonus — can't open mid-round / mid-bonus / in replay, and NOT on the single-ball (rapid) tier,
	// which has no meters / bonus feature (the trigger button stays visible there but greyed to half
	// opacity and disabled).
	const buyBonusDisabled = $derived.by(() => {
		stateGame.isSubmitting;
		stateGame.dropRoundActive;
		stateGame.bonusRoundActive;
		stateGame.bonusRouletteOpen;
		stateGame.freeSpinRouletteOpen;
		stateGame.autoPlayStarted;
		stateXstate.value;
		return (
			isReplay ||
			stateGame.ballPerDrop === 1 ||
			isBetControlsLocked() ||
			isGameOngoing() ||
			stateGame.bonusRoundActive
		);
	});

	function openBuyBonus() {
		if (buyBonusDisabled) return;
		stateGame.menuOpen = false;
		stateGame.buyBonusModalOpen = true;
		// Same click SFX as the bet-panel steppers.
		context.eventEmitter.broadcast({ type: 'soundOnce', name: 'clickUIButton' });
	}

	// Close the buy-bonus modal if the player switches to the single-ball tier while it's open (the
	// feature isn't offered there).
	$effect(() => {
		if (stateGame.ballPerDrop === 1 && stateGame.buyBonusModalOpen) {
			stateGame.buyBonusModalOpen = false;
		}
	});

	// Buy bonus is LIVE: the 4 bonus-only buy modes (buystandard/enhanced/premium/superfury) are published
	// in the math. Cost is ×bet-per-ball and independent of balls-per-drop. Set false to disable the
	// Activate buttons (the modal UI still opens) if the math is ever unpublished.
	const BUY_BONUS_ENABLED = true as boolean;

	/** A tier's Activate: route the next bet through that buy mode, then place it. A buy is bonus-only:
	 * the bonus fires at once, the roulette lands on the bought entry balls, and chain hits add more on
	 * top. The pending mode is cleared by the revert effect once the round fully settles. */
	function handleBuyBonusActivate(tier: BuyBonusTier) {
		// No buy bonus on the single-ball tier (rapid mode).
		if (!BUY_BONUS_ENABLED || stateGame.ballPerDrop === 1) return;
		stateGame.buyBonusModalOpen = false;
		// Bonus-only buy → mode is per tier (bpd-independent).
		stateGame.pendingBuyBonusMode = buyBonusModeName(tier.key);
		// A bought bonus jumps straight into the bonus round with NO trigger fill-up, so seed the "Free
		// Bonus" meter to its EMPTY in-bonus baseline instead of flashing it full. Showing it full here
		// (and again from the book's full bonus_meter_start / the bonus-start snap) made the bar animate
		// up to max and then drop back to empty when the level-1 in-bonus meter took over — a jarring
		// bounce on entry.
		applyBonusMeterDisplay(0);
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

<SuppressButtonFocusRing />

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

<NetworkStatus />

<Toast />

<Result />

<CoinFountain />

<WinCelebration />

<InfoModal />

<BuyBonusModal disabled={buyBonusDisabled} onActivate={handleBuyBonusActivate} />

<BonusLevelUpOverlay />

<main class="game-root" class:game-root--mobile={mobile} bind:this={gameRootEl}>
	<div class="bg-layer">
		<Background />
	</div>

	<!-- Buy Bonus is a standalone badge in the top corner: top-left on desktop (opposite Menu),
	     top-right on mobile. -->
	{#if !isReplay}
		<button
			type="button"
			class="buy-bonus-trigger"
			class:buy-bonus-trigger--mobile={mobile}
			class:buy-bonus-trigger--one-ball={stateGame.ballPerDrop === 1}
			disabled={buyBonusDisabled}
			onclick={openBuyBonus}
			aria-label="Buy bonus"
		>
			<img src={staticUrl('img/buy-bonus-btn.png')} alt="" aria-hidden="true" />
		</button>
	{/if}

	{#if !mobile}
		<BalanceCard />
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
			<div class="container" class:container--bonus={stateGameDerived.isBonusBackgroundActive}>
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
							{onBallDropped}
							onCoinPegHit={handleCoinPegHit}
						/>
					</div>
				{:else}
					<PlinkoBoard
						coefficients={boardCoefficients}
						rows={stateGame.rowCount}
						animationEnabled={stateGame.animationEnabled}
						animationSpeed={stateGame.fastGameEnabled ? SIM_SPEED.fast : SIM_SPEED.normal}
						{onBallDropped}
						onCoinPegHit={handleCoinPegHit}
					/>
				{/if}

				<!-- Bonus meter is PERMANENTLY MOUNTED and only shown/hidden via `visibility` (see
				     `--hidden` below). It must never be `{#if}`-unmounted on a Ball-Per-Drop change: the
				     meter is a Pixi/WebGL surface, and destroying + recreating its canvas on toggle makes a
				     freshly-created (or torn-down) canvas composite as an opaque WHITE box for a frame on
				     slower GPUs — the recurring QA-only white flash. Kept mounted, it's created once at load
				     (behind the intro loader; default tier is 10) and thereafter only flips visibility, so
				     there is no canvas churn and no flash. The wrap is `position: absolute`, so keeping it in
				     the DOM has no layout effect. -->
				<div
					class="bonus-meter-wrap"
					class:bonus-meter-wrap--hidden={!(
						stateGame.ballPerDrop !== 1 || stateGame.bonusRoundActive
					)}
				>
					<BonusMeter progress={bonusMeterProgress} />
				</div>

				<!-- The multi-ball (10/20/50) win reveal is the full-screen <WinCelebration /> overlay
				     (mounted at the top level, alongside <CoinFountain />), not a card in here. -->

				<!-- 1-ball rapid tier: stacking win toasts (newest on top, max 3). Each pops in (scale),
				     older ones slide down as new ones stack (flip), and each fades out after its TTL. -->
				{#if stateGame.ballPerDrop === 1 && stateGame.rapidWinToasts.length > 0}
					<div class="rapid-toast-stack" role="status" aria-live="polite">
						{#each stateGame.rapidWinToasts as toast (toast.id)}
							<div
								class="rapid-toast"
								in:scale={{ start: 0.4, opacity: 0, duration: 220, easing: backOut }}
								out:fade={{ duration: toast.instant ? 0 : 260 }}
								animate:flip={{ duration: 260 }}
							>
								<span class="rapid-toast-label">{context.i18nDerived.t('Win')}</span>
								<span class="rapid-toast-sep"></span>
								<span class="rapid-toast-value">{formatRapidToastAmount(toast.amount)}</span>
							</div>
						{/each}
					</div>
				{/if}
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
			{spinMeterProgress}
			hasPendingBonusBalls={stateGameDerived.hasPendingBonusBalls}
			bonusBallsRemaining={stateGame.bonusBallsRemaining}
			playDisabled={stateGame.isOffline ||
				(isRapidSingleBallMode()
					? stateGame.isSubmitting || stateGame.dropRoundActive || stateXstateDerived.isPlaying()
					: isBetControlsLocked() || isGameOngoing())}
			bonusPlayDisabled={stateGame.isOffline || stateGame.bonusRouletteOpen}
			{mobile}
			onMenuClick={() => (stateGame.menuOpen = !stateGame.menuOpen)}
		/>
	</div>

	{#if stateGame.freeSpinRouletteOpen}
		<FreeSpinRoulette
			targetSegmentIndex={stateGame.serverFreeSpinSegment}
			serverAuthoritative={stateGame.authoritativeMeterFlow}
			onLanded={(result) => applyFreeSpinWinOnLand(result.segmentLabel)}
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
			treasureWin
			messageTitle="CONGRATULATIONS!"
			messageValue="YOU HAVE WON"
			winValue={formatWinAmount(stateGame.bonusEndWinAmount, currencySign(stateBet.currency))}
			messageHint="PRESS ANYWHERE TO GO BACK TO THE GAME"
			autoDismiss={isReplay}
			onClosed={onBonusEndAnnouncementClosed}
		/>
	{/if}

	{#if devBonusCongratulationsPreviewOpen}
		<BonusRoulette
			mode="message"
			treasureWin
			messageTitle="CONGRATULATIONS!"
			messageValue="YOU HAVE WON"
			winValue={formatWinAmount(1733, currencySign(stateBet.currency))}
			messageHint="PRESS ANYWHERE TO GO BACK TO THE GAME"
			onClosed={() => {
				devBonusCongratulationsPreviewOpen = false;
			}}
		/>
	{/if}

	{#if devFreeSpinRoulettePreviewOpen}
		<!-- TODO: remove — dev preview of the reassembled free-spin wheel (see DEV_SHOW_FREE_SPIN_ROULETTE_ON_LOAD).
		     Isolated from the real free-spin flow; lands on 10X (index 4). Reload to watch again. -->
		<FreeSpinRoulette targetSegmentIndex={4} />
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

	.game-root--mobile
		.game-area
		> .container
		.bonus-level-behind-game-area
		:global(.bonus-level-track) {
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

		/* Center so a slightly larger Buy Bonus badge lines up with the Menu button. */
		align-items: center;

		gap: 0.6vw;

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
		/* Equal corner inset. These are BOX offsets, but they land equal VISIBLE margins too: the art's
		   opaque body carries a symmetric 11px of transparent padding on its top AND left edges
		   (buy-bonus-btn.png, 161×159), so both sides gain the same amount. The only residue is the
		   ~0.5px of vertical letterbox `object-fit: contain` adds for the art's 1.0126 aspect. */
		top: 2.2vw;
		left: 2.2vw;
		z-index: 25;
		/* 6.25vw = the original 5vw × 1.25. Mins scale with it so the +25% survives on small viewports. */
		width: 6.25vw;
		height: 6.25vw;
		min-width: 67.5px;
		min-height: 67.5px;
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

	.buy-bonus-trigger:disabled:not(.buy-bonus-trigger--one-ball) {
		cursor: not-allowed;
		filter: grayscale(0.7) brightness(0.55);
	}

	/* On the single-ball (rapid) tier the buy-bonus feature isn't offered, but the trigger stays
	   visible (disabled) at half opacity instead of being hidden, so players know it exists. It keeps
	   full colour — only faded — rather than the greyed-out look of the normal disabled state. */
	.buy-bonus-trigger--one-ball {
		opacity: 0.5;
		cursor: not-allowed;
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
		--game-layout-offset-x-ratio: -0.008;
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

	/* Hidden state for the always-mounted bonus meter (1-ball tier, outside a bonus round). `visibility`
	   — not `{#if}` — so the Pixi canvas is never destroyed/recreated on a Ball-Per-Drop toggle (that
	   canvas churn is what flashes white on slower GPUs). The wrap is absolutely positioned, so this has
	   no layout effect. */
	.container .bonus-meter-wrap--hidden {
		visibility: hidden;
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

	/* The multi-ball win reveal moved to the full-screen <WinCelebration /> overlay (its own component);
	   the old green `.win-card` / `.win-overlay` that lived here is gone. */

	/* 1-ball rapid win-toast stack. Anchored so the NEWEST toast sits at the TOP of the pirate hat, with
	   the TOP of the stack pinned there (offset up by half a toast) so that toast pops in at the hat top
	   and older ones slide DOWN below it (over the hat/head). `--toast-anchor-top-ratio` is the vertical
	   position as a fraction of the game-area box; the value is layout-specific because the frame PNG
	   fills a different share of the box on desktop vs mobile (mobile override below). `--toast-h` is
	   fixed so the offset is exact and the flip slide has a predictable step. Sizes in `rem` (the SDK
	   scales root font-size per device). */
	.rapid-toast-stack {
		--toast-anchor-top-ratio: 0.08;
		--toast-h: 2.5rem;

		position: absolute;

		left: 50%;

		top: calc(var(--toast-anchor-top-ratio) * 100%);

		/* Pin the stack's top-centre so slot 0 is centred on the anchor; the stack grows downward. */
		transform: translate(-50%, calc(var(--toast-h) / -2));

		display: flex;

		flex-direction: column;

		align-items: center;

		gap: 0.45rem;

		z-index: 21;

		pointer-events: none;
	}

	/* Portrait/mobile: the frame PNG fills more of the box, so a smaller ratio lands on the same spot
	   (top of the pirate hat) as the desktop value above. */
	.game-root--mobile .rapid-toast-stack {
		--toast-anchor-top-ratio: 0.07;
	}

	.rapid-toast {
		box-sizing: border-box;

		/* Horizontal rectangle: "Win" on the left, a vertical divider, then the value on the right. */
		display: flex;

		flex-direction: row;

		align-items: center;

		justify-content: center;

		gap: 0.7rem;

		height: var(--toast-h);

		padding: 0 1.05rem;

		white-space: nowrap;

		/* Same dark radial fill + green gradient border as the win card (two-layer background trick),
		   scaled down for the toast. */
		background:
			radial-gradient(ellipse at center, #332f3e 0%, #1a191d 100%) padding-box,
			linear-gradient(135deg, #9dff5c 0%, #54f917 30%, #2f7d10 62%, #14480a 100%) border-box;

		border: 0.22rem solid transparent;

		border-radius: 0.5rem;
	}

	.rapid-toast-label {
		color: #54f917;

		font-size: 1rem;

		font-weight: 700;

		line-height: 1;
	}

	/* Vertical divider between "Win" and the value. */
	.rapid-toast-sep {
		width: 2px;

		height: 1.15rem;

		border-radius: 999px;

		background: rgba(255, 255, 255, 0.45);
	}

	.rapid-toast-value {
		color: #54f917;

		font-size: 1.05rem;

		font-weight: 800;

		line-height: 1;
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
		--game-layout-offset-y-ratio-mobile: 0.05;

		/* === Portrait vertical-fit scaling ==============================================
		   The portrait game area is sized off --portrait-px (viewport WIDTH / 992, see .game-content),
		   so its height is driven purely by viewport WIDTH. That's right while the viewport is tall
		   enough, but on a SHORT viewport the width-driven height pushes the board + bonus meter down
		   into the betting panel.
		   Rather than re-derive every token (the internals mix --portrait-px, vw, %, and container-
		   query units, which resolve against different boxes), apply ONE uniform down-scale to the
		   whole container. --portrait-fit-scale is 1 while there's enough height and drops below 1 once
		   the container's natural visual height would exceed the room left above the HUD — that room is
		   100cqh of the .game-area box (the flex item that soaks up the leftover space; its height is
		   independent of the container, so there's no feedback loop). Because it's a transform on the
		   whole subtree, the board, bonus meter and bonus-level bars shrink together and stay perfectly
		   aligned whatever units each uses. Scaling toward `center top` (see transform-origin below)
		   keeps the block anchored at the top and lifts its bottom clear of the panel. When height is
		   not the limiting factor --portrait-fit-scale is 1, so tall phones render exactly as before.
		   --portrait-visual-h-ratio is the container's natural visual height as a fraction of its
		   width: laid-out height (222 top pad + 248 board margin + 546 board = 1016) × the layout
		   scale, ÷ the 992 design width, + the downward y-offset. tan(atan2(100cqh, 100cqw)) yields the
		   live height/width ratio of the .game-area box as a plain number so the two compare. Keep the
		   ratio in sync if the scale / y-offset knobs change. */
		--portrait-visual-h-ratio: calc(
			1016 * var(--game-layout-scale-mobile) / var(--portrait-dw) +
				var(--game-layout-offset-y-ratio-mobile)
		);
		--portrait-fit-scale: min(1, tan(atan2(100cqh, 100cqw)) / var(--portrait-visual-h-ratio));
		transform: scale(var(--portrait-fit-scale))
			translate(
				calc(var(--game-layout-offset-x-ratio-mobile) * 100vw),
				calc(var(--game-layout-offset-y-ratio-mobile) * 100vw)
			)
			scale(var(--game-layout-scale-mobile));

		--plinko-area-scale-mobile: 0.75;
		--plinko-area-top-width-scale-mobile: 1;
		--plinko-area-bottom-width-scale-mobile: 1;
		--plinko-area-height-scale-mobile: 1.57;
		--plinko-area-offset-x-ratio-mobile: 0.015;
		--plinko-area-offset-ratio-mobile: 0;
		--plinko-area-offset-y-ratio-mobile: -0.045;

		--plinko-area-offset-x-mobile: calc(var(--plinko-area-offset-x-ratio-mobile) * 100vw);
		--plinko-host-width-mobile: calc(
			100% * var(--plinko-area-scale-mobile) *
				max(var(--plinko-area-top-width-scale-mobile), var(--plinko-area-bottom-width-scale-mobile))
		);
		--plinko-host-height-mobile: calc(
			100% * var(--plinko-area-scale-mobile) * var(--plinko-area-height-scale-mobile)
		);
		--plinko-area-offset-y-mobile: calc(
			(var(--plinko-area-offset-ratio-mobile) + var(--plinko-area-offset-y-ratio-mobile)) * 100vw
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
		--mobile-bonus-meter-scale: 0.95; /* overall size multiplier (>1 = bigger) */
		--mobile-bonus-meter-top-px: 132; /* vertical position in portrait-px units */
		--mobile-bonus-meter-left: 51.5%; /* horizontal center anchor */
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
			var(--portrait-px) * var(--mobile-bonus-meter-top-px) + var(--game-area-fit-height) *
				var(--mobile-bonus-meter-offset-y-ratio)
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
