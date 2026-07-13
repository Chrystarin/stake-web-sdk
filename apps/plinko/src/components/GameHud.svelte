<script lang="ts">
	import { onMount } from 'svelte';

	import { OnHotkey } from 'components-shared';
	import { stateBet, stateUrlDerived } from 'state-shared';

	import {
		AUTO_BET_OPTIONS,
		BALL_PER_DROP_TIERS,
		BET_PER_BALL_PRESETS,
	} from '../game-logic/constants';
	import {
		isBetControlsLocked,
		isBonusPlayButtonDisabled,
		isGameOngoing,
		isPlayActionBlockedByBonusRoulette,
		isPlayActionBlockedByFreeSpinRoulette,
		isRapidSingleBallMode,
		isReplayMode,
		showToast,
		startAutoBet,
		stopAutoBet,
	} from '../game/gameOrchestrator';
	import {
		canAffordPlinkoWager,
		plinkoMaxStakePerBall,
		plinkoMinStakePerBall,
		plinkoStakePerBallOptions,
		plinkoStakePerBallSteps,
		plinkoWagerAmount,
	} from '../game/plinkoBet';
	import { syncPlinkoBetModeFromUi } from '../game/plinkoBetMode';
	import { stateGame } from '../game/stateGame.svelte';
	import { stateXstate } from '../game/stateXstate';
	import { getContext } from '../game/context';
	import { FreeSpinMeter } from '../features/freeSpin';
	import {
		currencySign as currencySignFor,
		formatCompactAmount,
		formatWinAmount,
	} from '../lib/format';
	import { staticUrl } from '../lib/staticUrl';

	import './GameHud.scss';

	type Props = {
		betAmount: number;
		totalBetAmount: number;
		onBetAmountChange: (value: number) => void;
		onPlay: () => void;
		autoMode: boolean;
		autoPlayStarted: boolean;
		autoRoundsLeft: number;
		spinMeterProgress?: number;
		hasPendingBonusBalls?: boolean;
		bonusBallsRemaining?: number;
		playDisabled?: boolean;
		bonusPlayDisabled?: boolean;
		mobile?: boolean;
		onMenuClick?: () => void;
	};

	const props: Props = $props();
	const context = getContext();

	let autoPanelOpen = $state(false);
	let betPresetOpen = $state(false);
	let mobileBetPopupOpen = $state(false);

	const currencySign = $derived(currencySignFor(stateBet.currency));
	// Social Mode restricts the word "Bet": the wager-field labels become "Play amount" / "Play per
	// ball" (rendered uppercase by CSS). Non-social sessions keep the localized "Bet" labels.
	const betLabel = $derived(
		stateUrlDerived.social() ? 'Play amount' : context.i18nDerived.t('Bet'),
	);
	const betPerBallLabel = $derived(
		stateUrlDerived.social() ? 'Play per ball' : context.i18nDerived.t('Bet per ball'),
	);
	/** Settlement currency win from the last round — not recalculated from current stake. */
	const displayWinAmount = $derived(stateGame.winAmount);
	// Rapid 1-ball mode holds each drop's win in the balance until its ball lands; show that shadow when
	// present, otherwise the authoritative balance.
	const displayBalance = $derived(stateGame.rapidBalanceShadow ?? stateBet.balanceAmount);
	const controlsLocked = $derived.by(() => {
		stateGame.isSubmitting;
		stateGame.isAnimating;
		stateGame.expectedOutcomeByBallId.size;
		stateGame.pendingSpacedSpawnTimers;
		stateGame.bonusBallsRemaining;
		stateGame.freeSpinRouletteOpen;
		stateGame.bonusRouletteOpen;
		stateGame.dropRoundActive;
		stateGame.rouletteFlowInProgress;
		// Keep wager config locked for the full Autobet run (not just per-round flags).
		stateGame.autoPlayStarted;
		// Stay locked until the round machine is fully idle (deferred end-round settlement).
		stateXstate.value;
		// Keep controls locked across the gap between the bonus meter filling and the trigger round.
		stateGame.pendingFeatureTrigger;
		stateGame.bonusMeterValue;
		stateGame.bonusMeterMax;
		return isBetControlsLocked();
	});
	// Rapid 1-ball mode keeps the wager config interactive while balls fall (continuous betting), so
	// `isBetControlsLocked()` reads false mid-drop. Per product, on the 1-ball tier the bet-per-ball and
	// ball-per-drop steppers must instead stay LOCKED while any drop is still animating, re-enabling only
	// once no balls remain in flight. This narrower lock applies to those wager controls only — the Play
	// button stays actionable so the player can still queue more 1-ball drops.
	const oneBallDropInFlight = $derived.by(() => {
		stateGame.isAnimating;
		stateGame.expectedOutcomeByBallId.size;
		stateGame.pendingSpacedSpawnTimers;
		stateGame.ballPerDrop;
		stateGame.bonusRoundActive;
		stateGame.pendingBuyBonusMode;
		return isRapidSingleBallMode() && isGameOngoing();
	});
	const wagerControlsLocked = $derived(controlsLocked || oneBallDropInFlight);
	// Replay drives bonus-ball drops itself — keep the visible bonus-play button locked for the viewer.
	const bonusPlayDisabled = $derived(
		isBonusPlayButtonDisabled() || props.bonusPlayDisabled || isReplayMode(),
	);
	// During a bonus round the drop is always single-ball (free balls), so the HUD shows 1 regardless
	// of the selected tier. `stateGame.ballPerDrop` itself is left untouched (tier logic / meters).
	const ballPerDropDisplay = $derived(stateGame.bonusRoundActive ? 1 : stateGame.ballPerDrop);
	const availableBetPresets = $derived(
		plinkoStakePerBallOptions().length
			? plinkoStakePerBallOptions()
			: BET_PER_BALL_PRESETS.filter(
					(v) => v >= plinkoMinStakePerBall() && v <= plinkoMaxStakePerBall(),
				),
	);

	// Disable reasons OTHER than "can't afford the wager". The affordability reason is split out so a
	// click on a button greyed out PURELY for insufficient balance can still surface a toast — a
	// natively `disabled` button fires no click event at all, so it must stay clickable for that.
	const playDisabledMainOther = $derived(
		props.playDisabled ||
			isPlayActionBlockedByBonusRoulette() ||
			isPlayActionBlockedByFreeSpinRoulette(),
	);

	// The wager is a real (>0) bet the player can't afford — the sole "insufficient balance" reason.
	const wagerUnaffordable = $derived(plinkoWagerAmount() > 0 && !canAffordPlinkoWager());

	/**
	 * HARD-disabled: block the play action outright (round running, locks, level-up overlay, roulette,
	 * zero bet, …) — every reason EXCEPT insufficient balance. These buttons get the native `disabled`
	 * attribute.
	 */
	const isPlayButtonHardDisabled = $derived(
		// The Level-Up reward popup (e.g. "LEVEL 2 / +20 FREE BALLS") is a transient full-screen overlay
		// with pointer-events:none, so clicks fall through and Space still fires. Block the play action
		// for its whole on-screen life (open → fade-out) so a bet can't be queued behind the transition.
		stateGame.bonusLevelUpOverlayOpen ||
			(props.hasPendingBonusBalls
				? bonusPlayDisabled
				: props.autoMode && !props.autoPlayStarted
					? playDisabledMainOther || props.betAmount <= 0
					: playDisabledMainOther),
	);

	/**
	 * SOFT-disabled: the button is greyed out ONLY because the wager exceeds the spendable balance. It
	 * stays clickable (no native `disabled`) but is styled disabled, so a click / Space shows the
	 * "Insufficient Balance" toast instead of placing a bet. Not applicable to the free bonus-ball drop
	 * (its wager is 0).
	 */
	const isPlayButtonSoftInsufficient = $derived(
		!isPlayButtonHardDisabled && !props.hasPendingBonusBalls && wagerUnaffordable,
	);

	// True while a bet is being submitted or its balls are in flight, back to false the moment the
	// round settles. Drives the loading spinner that replaces the Play button while a round runs.
	// Note: deliberately excludes `dropRoundActive` — that flag also spans the player-input bonus
	// window, where the button must stay an actionable Play (drop bonus balls), not a spinner.
	const roundInSession = $derived.by(() => {
		stateGame.isSubmitting;
		stateGame.isAnimating;
		stateGame.expectedOutcomeByBallId.size;
		stateGame.pendingSpacedSpawnTimers;
		return stateGame.isSubmitting || isGameOngoing();
	});
	// The loading spinner replaces the Play button only for regular rounds. During a bonus round the
	// button must keep showing the free-balls count badge, so the spinner is suppressed there.
	// Rapid 1-ball mode keeps the button an actionable Play while balls are still falling (the round has
	// already settled) — so the loading spinner is suppressed there; it only shows for gated rounds.
	const showPlayLoading = $derived(
		roundInSession &&
			!props.hasPendingBonusBalls &&
			!stateGame.bonusRoundActive &&
			!isRapidSingleBallMode(),
	);

	const mobileAutoCountDisplay = $derived(
		props.autoMode || props.autoPlayStarted
			? String(props.autoRoundsLeft ?? stateGame.autoRoundsDisplay)
			: String(stateGame.autoRoundsLeft),
	);

	// A bonus that fires mid-Autobet terminates the run (see `triggerRoulette`): while it winds down
	// (still `autoPlayStarted` but `autoPlayStopping`) the Autobet toggle goes inert and drops its
	// remaining-rounds badge, so the player can't re-arm it and no stale count lingers.
	const autoBetStopping = $derived(props.autoPlayStarted && stateGame.autoPlayStopping);

	function formatMoney(value: number) {
		const formatted = value.toLocaleString('en-US', {
			minimumFractionDigits: 2,
			maximumFractionDigits: 2,
		});
		return `${currencySign}${formatted}`;
	}

	/** Win amounts show up to 4 decimals so small wins on low bets aren't rounded to 0.00. */
	function formatWin(value: number) {
		return formatWinAmount(value, currencySign);
	}

	function getClosestPresetIndex(presets: readonly number[], amount: number) {
		if (!presets.length) return 0;
		let best = 0;
		let bestDiff = Math.abs(presets[0] - amount);
		for (let i = 1; i < presets.length; i++) {
			const diff = Math.abs(presets[i] - amount);
			if (diff < bestDiff) {
				bestDiff = diff;
				best = i;
			}
		}
		return best;
	}

	function adjustBetAmountStep(delta: number) {
		if (wagerControlsLocked || delta === 0) return;
		// The +/- stepper walks the FULL betLevels grid one level at a time (fine-grained), unlike the
		// preset dropdown which only offers the 8 sampled quick-jumps.
		const steps = plinkoStakePerBallSteps();
		if (!steps.length) return;
		const idx = getClosestPresetIndex(steps, props.betAmount);
		const next = idx + (delta > 0 ? 1 : -1);
		if (next < 0 || next >= steps.length) return;
		props.onBetAmountChange(steps[next]);
		context.eventEmitter.broadcast({ type: 'soundOnce', name: 'clickUIButton' });
	}

	function isBetAmountStepDisabled(delta: number) {
		if (wagerControlsLocked || delta === 0) return true;
		const steps = plinkoStakePerBallSteps();
		if (steps.length <= 1) return true;
		const idx = getClosestPresetIndex(steps, props.betAmount);
		if (delta > 0) return idx >= steps.length - 1;
		return idx <= 0;
	}

	function adjustBallPerDrop(delta: number) {
		if (wagerControlsLocked || delta === 0) return;
		const arr = BALL_PER_DROP_TIERS;
		let idx = arr.indexOf(stateGame.ballPerDrop as (typeof BALL_PER_DROP_TIERS)[number]);
		if (idx < 0) idx = 0;
		const next = idx + delta;
		if (next < 0 || next >= arr.length) return;
		stateGame.ballPerDrop = arr[next];
		syncPlinkoBetModeFromUi();
		context.eventEmitter.broadcast({ type: 'soundOnce', name: 'clickUIButton' });
	}

	function isBallPerDropStepDisabled(delta: number) {
		if (wagerControlsLocked || delta === 0) return true;
		const arr = BALL_PER_DROP_TIERS;
		let idx = arr.indexOf(stateGame.ballPerDrop as (typeof BALL_PER_DROP_TIERS)[number]);
		if (idx < 0) idx = 0;
		const next = idx + delta;
		return next < 0 || next >= arr.length;
	}

	function closePanels() {
		autoPanelOpen = false;
		betPresetOpen = false;
	}

	function onBetPerBallPanelTrigger(event: MouseEvent) {
		event.stopPropagation();
		if (wagerControlsLocked) return;
		autoPanelOpen = false;
		betPresetOpen = !betPresetOpen;
	}

	function selectBetPerBallOption(value: number) {
		if (wagerControlsLocked) return;
		props.onBetAmountChange(value);
		betPresetOpen = false;
		context.eventEmitter.broadcast({ type: 'soundOnce', name: 'clickUIButton' });
	}

	function onAutoButtonClick(event: MouseEvent) {
		event.stopPropagation();
		// Inert while a mid-Autobet bonus is terminating the run.
		if (autoBetStopping) return;
		if (controlsLocked && !props.autoPlayStarted) return;
		if (props.autoMode) {
			stateGame.autoMode = false;
			stopAutoBet();
			autoPanelOpen = false;
			return;
		}
		betPresetOpen = false;
		autoPanelOpen = !autoPanelOpen;
	}

	function selectAutoBetCount(count: number) {
		if (controlsLocked && !props.autoPlayStarted) return;
		stateGame.autoRoundsLeft = count;
		stateGame.autoRoundsDisplay = count;
		stateGame.autoMode = true;
		autoPanelOpen = false;
		if (!props.autoPlayStarted && props.betAmount > 0 && !isGameOngoing()) {
			startAutoBet(() => props.onPlay());
			context.eventEmitter.broadcast({ type: 'soundOnce', name: 'startAutoPlay' });
		}
	}

	function onAutoGameStopClick() {
		stateGame.autoMode = false;
		stopAutoBet();
	}

	function onAutoGameStartClick() {
		if (isPlayButtonHardDisabled) return;
		// Greyed out only for insufficient balance: surface the toast instead of arming Autobet.
		if (isPlayButtonSoftInsufficient) {
			showToast('Insufficient Balance');
			return;
		}
		if (props.betAmount <= 0) return;
		startAutoBet(() => props.onPlay());
		context.eventEmitter.broadcast({ type: 'soundOnce', name: 'startAutoPlay' });
	}

	function onMainActionClick() {
		if (isPlayButtonHardDisabled) return;
		// The button is greyed out purely because the total bet exceeds the balance — a click still
		// lands here (it is not natively `disabled`), so tell the player why instead of betting.
		if (isPlayButtonSoftInsufficient) {
			showToast('Insufficient Balance');
			return;
		}
		// While a mid-Autobet bonus terminates the run the main button is the (bonus / plain) Play button,
		// never the Autobet stop — so don't treat a press as "stop autobet".
		if (props.hasPendingBonusBalls || !props.autoMode || autoBetStopping) {
			props.onPlay();
			return;
		}
		if (props.autoPlayStarted) {
			onAutoGameStopClick();
		} else {
			onAutoGameStartClick();
		}
	}

	/**
	 * Space is the global "drop / bet" hotkey. EnableHotkey calls preventDefault on Space, so a
	 * focused button never activates natively — meaning we must drive the play action ourselves even
	 * while a HUD control holds focus (e.g. the play button after tabbing to it, or while free-spin /
	 * bonus balls are pending). Enter still natively activates whatever control is focused, so Space
	 * stays reserved for dropping balls.
	 *
	 * We bail only when play isn't allowed, an overlay is open (don't bet behind the menu / info
	 * modal), or the focused element is a custom role="button" control that handles Space itself
	 * (e.g. the bet-preset opener) — so Space doesn't both open that control and fire a bet.
	 */
	function onSpacePlay() {
		// Hard-disabled blocks Space entirely; the soft insufficient-balance case falls through to
		// onMainActionClick, which shows the toast (keeping Space consistent with a click).
		if (isPlayButtonHardDisabled) return;
		if (stateGame.menuOpen || stateGame.infoModalOpen) return;
		if (document.activeElement?.getAttribute('role') === 'button') return;
		onMainActionClick();
	}

	function toggleMobileBetPopup() {
		mobileBetPopupOpen = !mobileBetPopupOpen;
		if (mobileBetPopupOpen) autoPanelOpen = false;
	}

	function onMobileAutoButtonClick(event: MouseEvent) {
		event.stopPropagation();
		// Inert while a mid-Autobet bonus is terminating the run.
		if (autoBetStopping) return;
		if (props.autoPlayStarted) {
			onAutoGameStopClick();
			autoPanelOpen = false;
			return;
		}
		if (props.autoMode) {
			stateGame.autoMode = false;
			stopAutoBet();
			autoPanelOpen = false;
			return;
		}
		if (controlsLocked) return;
		mobileBetPopupOpen = false;
		autoPanelOpen = !autoPanelOpen;
	}

	function selectMobileAutoBetCount(count: number) {
		selectAutoBetCount(count);
	}

	onMount(() => {
		const onDocumentClick = (event: MouseEvent) => {
			const target = event.target as HTMLElement | null;
			if (!target) return;
			// Close the mobile bet popup on any click outside the coins control. The wrap
			// holds both the popup and its toggle button, so excluding it lets the button's
			// own toggle handle open/close and keeps clicks inside the popup from closing it.
			if (mobileBetPopupOpen && !target.closest('.mobile-coins-wrap')) {
				mobileBetPopupOpen = false;
			}
			if (
				target.closest('.bp-auto-wrap') ||
				target.closest('.bp-autobet-panel') ||
				target.closest('.bp-bet-presets-wrap') ||
				target.closest('.bp-bet-presets-panel') ||
				target.closest('.mobile-autobet-wrap') ||
				target.closest('.mobile-autobet-panel')
			) {
				return;
			}
			closePanels();
		};
		document.addEventListener('click', onDocumentClick);
		return () => document.removeEventListener('click', onDocumentClick);
	});
</script>

<OnHotkey hotkey="Space" disabled={isPlayButtonHardDisabled} onpress={onSpacePlay} />

{#snippet bettingFieldFrame()}
	<img
		class="bp-field-frame"
		src={staticUrl('img/betting-component-frame.png')}
		alt=""
		aria-hidden="true"
	/>
{/snippet}

{#if props.mobile}
	<div class="mobile-hud">
		<div class="mobile-top-row">
			<div class="mobile-top-card">
				{@render bettingFieldFrame()}
				<span class="mobile-top-card-label">{betLabel}</span>
				<span class="mobile-top-card-value">{formatMoney(props.totalBetAmount)}</span>
			</div>
			<div class="mobile-top-card">
				{@render bettingFieldFrame()}
				<span class="mobile-top-card-label">{context.i18nDerived.t('Ball per drop')}</span>
				<span class="mobile-top-card-value">{ballPerDropDisplay}</span>
			</div>
			<div class="mobile-top-card">
				{@render bettingFieldFrame()}
				<span class="mobile-top-card-label">{betPerBallLabel}</span>
				<span class="mobile-top-card-value">{formatCompactAmount(props.betAmount)}</span>
			</div>
			<!-- Keep the free-spin card container even on the 1-ball tier (where the meter is hidden): it
			     reserves its grid column + the row's height, so Bet / Ball per drop / Bet per ball don't
			     shift when the meter is hidden. Only the meter INSIDE is conditionally rendered. -->
			<div class="mobile-top-card mobile-top-card--free-spin">
				<!-- Permanently mounted; shown/hidden via `visibility` only (see `--hidden`). Never
				     `{#if}`-unmount the Pixi/WebGL meter on a Ball-Per-Drop change — recreating its canvas
				     flashes white for a frame on slower GPUs. The card already reserves this grid cell, so
				     keeping the meter mounted inside it has no layout effect. -->
				<div
					class="mobile-free-spin-meter"
					class:mobile-free-spin-meter--hidden={stateGame.ballPerDrop === 1}
				>
					<FreeSpinMeter progress={props.spinMeterProgress ?? 0} />
				</div>
			</div>
		</div>

		<div class="mobile-action-row">
			<button
				type="button"
				class="mobile-icon-btn mobile-icon-btn--menu"
				aria-label="Menu"
				onclick={() => props.onMenuClick?.()}
			>
				<img src={staticUrl('img/menu-btn-mobile.png')} alt="" aria-hidden="true" />
			</button>
			<button
				type="button"
				class="mobile-icon-btn mobile-icon-btn--fast"
				class:mobile-icon-btn--fast-on={stateGame.fastGameEnabled}
				disabled={controlsLocked && !props.autoPlayStarted}
				aria-pressed={stateGame.fastGameEnabled}
				aria-label="Fast game"
				onclick={() => {
					stateGame.fastGameEnabled = !stateGame.fastGameEnabled;
					context.eventEmitter.broadcast({ type: 'soundOnce', name: 'clickUIButton' });
				}}
			>
				<img src={staticUrl('img/fast-game-btn-mobile.png')} alt="" aria-hidden="true" />
			</button>
			<button
				type="button"
				class="mobile-icon-btn mobile-icon-btn--play"
				class:mobile-icon-btn--play-loading={showPlayLoading}
				class:mobile-icon-btn--soft-disabled={isPlayButtonSoftInsufficient}
				disabled={isPlayButtonHardDisabled}
				aria-label="Bet"
				aria-disabled={isPlayButtonSoftInsufficient}
				aria-busy={showPlayLoading}
				onclick={onMainActionClick}
			>
				{#if showPlayLoading}
					<img src={staticUrl('img/empty-btn-brown.png')} alt="" aria-hidden="true" />
					<img
						class="mobile-play-spinner"
						src={staticUrl('img/loading_vector.png')}
						alt=""
						aria-hidden="true"
					/>
				{:else}
					<img src={staticUrl('img/play-btn-mobile.png')} alt="" aria-hidden="true" />
					{#if props.hasPendingBonusBalls}
						<span class="hud-play-count-badge">{props.bonusBallsRemaining}</span>
					{/if}
				{/if}
			</button>
			<div class="mobile-coins-wrap">
				<button
					type="button"
					class="mobile-icon-btn mobile-icon-btn--coins"
					aria-expanded={mobileBetPopupOpen}
					aria-label="Open bet settings"
					onclick={toggleMobileBetPopup}
				>
					<img src={staticUrl('img/coins-btn-mobile.png')} alt="" aria-hidden="true" />
				</button>
				{@render mobileBetPopup()}
			</div>
			<div class="mobile-autobet-wrap">
				<button
					type="button"
					class="mobile-icon-btn mobile-icon-btn--autobet"
					class:mobile-icon-btn--on={props.autoMode || props.autoPlayStarted}
					disabled={(controlsLocked && !props.autoPlayStarted) || autoBetStopping}
					aria-pressed={props.autoMode || props.autoPlayStarted}
					aria-label="Autobet"
					onclick={onMobileAutoButtonClick}
				>
					<img src={staticUrl('img/auto-bet-btn-mobile.png')} alt="" aria-hidden="true" />
					{#if (props.autoMode || props.autoPlayStarted) && !autoBetStopping}
						<span class="mobile-autobet-count-badge">{mobileAutoCountDisplay}</span>
					{/if}
				</button>
				{#if autoPanelOpen}
					<div class="mobile-autobet-panel">
						{#each AUTO_BET_OPTIONS as option}
							<button
								type="button"
								class="mobile-autobet-option"
								disabled={controlsLocked}
								onclick={() => selectMobileAutoBetCount(option)}
							>
								{option}
							</button>
						{/each}
					</div>
				{/if}
			</div>
		</div>

		{#snippet mobileBetPopup()}
			{#if mobileBetPopupOpen}
				<div class="mobile-bet-popup" role="dialog" aria-label="Bet settings">
					<img
						class="bp-field-frame mobile-bet-popup-base"
						src={staticUrl('img/mobile_popup_bet_modal_base.png')}
						alt=""
						aria-hidden="true"
					/>
					<div class="mobile-bet-popup-row mobile-bet-popup-row--stat">
						{@render bettingFieldFrame()}
						<div class="mobile-bet-popup-mid">
							<span class="mobile-bet-popup-label">{betLabel}</span>
							<span class="mobile-bet-popup-value">{formatMoney(props.totalBetAmount)}</span>
						</div>
					</div>
					<div class="mobile-bet-popup-row">
						{@render bettingFieldFrame()}
						<button
							type="button"
							class="mobile-bet-popup-step"
							disabled={isBallPerDropStepDisabled(-1)}
							aria-label="Decrease ball per drop"
							onclick={() => adjustBallPerDrop(-1)}
						>
							<img
								src={staticUrl('img/betting-component-input-decrease.png')}
								alt=""
								aria-hidden="true"
							/>
						</button>
						<div class="mobile-bet-popup-mid">
							<span class="mobile-bet-popup-label">{context.i18nDerived.t('Ball per drop')}</span>
							<span class="mobile-bet-popup-value">{ballPerDropDisplay}</span>
						</div>
						<button
							type="button"
							class="mobile-bet-popup-step"
							disabled={isBallPerDropStepDisabled(1)}
							aria-label="Increase ball per drop"
							onclick={() => adjustBallPerDrop(1)}
						>
							<img
								src={staticUrl('img/betting-component-input-increase.png')}
								alt=""
								aria-hidden="true"
							/>
						</button>
					</div>
					<div class="mobile-bet-popup-row">
						{@render bettingFieldFrame()}
						<button
							type="button"
							class="mobile-bet-popup-step"
							disabled={isBetAmountStepDisabled(-1)}
							aria-label="Decrease bet per ball"
							onclick={() => adjustBetAmountStep(-1)}
						>
							<img
								src={staticUrl('img/betting-component-input-decrease.png')}
								alt=""
								aria-hidden="true"
							/>
						</button>
						<div class="mobile-bet-popup-mid">
							<span class="mobile-bet-popup-label">{betPerBallLabel}</span>
							<span class="mobile-bet-popup-value">{formatCompactAmount(props.betAmount)}</span>
						</div>
						<button
							type="button"
							class="mobile-bet-popup-step"
							disabled={isBetAmountStepDisabled(1)}
							aria-label="Increase bet per ball"
							onclick={() => adjustBetAmountStep(1)}
						>
							<img
								src={staticUrl('img/betting-component-input-increase.png')}
								alt=""
								aria-hidden="true"
							/>
						</button>
					</div>
				</div>
			{/if}
		{/snippet}

		<div class="mobile-bottom-corners">
			<div class="mobile-corner-info mobile-corner-info--left">
				<img src={staticUrl('img/coin-ico.png')} alt="" aria-hidden="true" />
				<span class="mobile-corner-label">{context.i18nDerived.t('Win')}:</span>
				<span class="mobile-corner-value">{formatWin(displayWinAmount)}</span>
			</div>
			<div class="mobile-corner-info mobile-corner-info--right">
				<img src={staticUrl('img/wallet-ico.png')} alt="" aria-hidden="true" />
				<span class="mobile-corner-value">{formatMoney(displayBalance)}</span>
			</div>
		</div>
	</div>
{:else}
	<div class="game-bottom-panel">
		<!-- Free-spin meter is PERMANENTLY MOUNTED and only shown/hidden via `visibility` (see
		     `--hidden`). Never `{#if}`-unmount it on a Ball-Per-Drop change: it's a Pixi/WebGL surface,
		     and destroying + recreating its canvas on toggle makes the freshly-created (or torn-down)
		     canvas composite as an opaque WHITE box for a frame on slower GPUs — the recurring QA-only
		     flash. The wrap is `position: absolute`, so keeping it mounted has no layout effect. -->
		<div
			class="bp-free-spin-meter-wrap"
			class:bp-free-spin-meter-wrap--hidden={stateGame.ballPerDrop === 1}
		>
			<div class="bp-free-spin-meter">
				<FreeSpinMeter progress={props.spinMeterProgress ?? 0} />
			</div>
		</div>

		<div class="bottom-panel-form">
			<div class="bottom-panel-chrome">
				<div class="bottom-panel-row">
					<div class="bp-field">
						{@render bettingFieldFrame()}
						<span class="bp-field-label">{context.i18nDerived.t('Balance')}</span>
						<div class="bp-field-value">
							<span>{formatMoney(displayBalance)}</span>
						</div>
					</div>

					<div class="bp-field bp-field--bet-total">
						{@render bettingFieldFrame()}
						<span class="bp-field-label">{betLabel}</span>
						<div class="bp-total-stepper">
							<span class="bp-total-display" aria-live="polite">
								{formatMoney(props.totalBetAmount)}
							</span>
						</div>
					</div>

					<div class="bp-field">
						{@render bettingFieldFrame()}
						<span class="bp-field-label">{context.i18nDerived.t('Win')}</span>
						<div class="bp-field-value">
							<span>{formatWin(displayWinAmount)}</span>
						</div>
					</div>

					<div
						class="bp-field bp-field--bet bp-field--select bp-field--bet-controls bp-bet-presets-wrap"
					>
						{@render bettingFieldFrame()}
						<span class="bp-field-label">{betPerBallLabel}</span>
						<div class="bp-bet-input-wrap">
							<button
								type="button"
								class="bp-stepper-btn bp-stepper-btn--decrease"
								disabled={isBetAmountStepDisabled(-1)}
								aria-label="Decrease bet per ball"
								onclick={() => adjustBetAmountStep(-1)}
							>
								<img
									src={staticUrl('img/betting-component-input-decrease.png')}
									alt=""
									aria-hidden="true"
								/>
							</button>
							<!-- svelte-ignore a11y_click_events_have_key_events -->
							<!-- svelte-ignore a11y_no_static_element_interactions -->
							<div
								class="bp-bet-input-mid"
								class:bp-bet-input-mid--disabled={wagerControlsLocked}
								role="button"
								tabindex={wagerControlsLocked ? -1 : 0}
								aria-disabled={wagerControlsLocked}
								aria-label="Open bet per ball presets"
								onmousedown={(e) => e.preventDefault()}
								onclick={onBetPerBallPanelTrigger}
								onkeydown={(e) => {
									if (e.key === 'Enter' || e.key === ' ')
										onBetPerBallPanelTrigger(e as unknown as MouseEvent);
								}}
							>
								<span class="bp-select-display" aria-live="polite">
									{formatCompactAmount(props.betAmount)}
								</span>
							</div>
							<button
								type="button"
								class="bp-stepper-btn bp-stepper-btn--increase"
								disabled={isBetAmountStepDisabled(1)}
								aria-label="Increase bet per ball"
								onclick={() => adjustBetAmountStep(1)}
							>
								<img
									src={staticUrl('img/betting-component-input-increase.png')}
									alt=""
									aria-hidden="true"
								/>
							</button>
						</div>
						{#if betPresetOpen}
							<div class="bp-bet-presets-panel">
								{#each availableBetPresets as preset}
									<button
										type="button"
										class="bp-bet-presets-option"
										class:bp-bet-presets-option--active={props.betAmount === preset}
										disabled={wagerControlsLocked}
										onclick={() => selectBetPerBallOption(preset)}
									>
										{formatCompactAmount(preset)}
									</button>
								{/each}
							</div>
						{/if}
					</div>

					<div class="bp-field bp-field--select bp-field--bet-controls">
						{@render bettingFieldFrame()}
						<span class="bp-field-label">{context.i18nDerived.t('Ball per drop')}</span>
						<div class="bp-bet-input-wrap">
							<button
								type="button"
								class="bp-stepper-btn bp-stepper-btn--decrease"
								disabled={isBallPerDropStepDisabled(-1)}
								aria-label="Decrease ball per drop"
								onclick={() => adjustBallPerDrop(-1)}
							>
								<img
									src={staticUrl('img/betting-component-input-decrease.png')}
									alt=""
									aria-hidden="true"
								/>
							</button>
							<div class="bp-bet-input-mid">
								<span class="bp-select-display" aria-live="polite">{ballPerDropDisplay}</span>
							</div>
							<button
								type="button"
								class="bp-stepper-btn bp-stepper-btn--increase"
								disabled={isBallPerDropStepDisabled(1)}
								aria-label="Increase ball per drop"
								onclick={() => adjustBallPerDrop(1)}
							>
								<img
									src={staticUrl('img/betting-component-input-increase.png')}
									alt=""
									aria-hidden="true"
								/>
							</button>
						</div>
					</div>

					{#if !props.autoMode || props.hasPendingBonusBalls}
						<button
							type="button"
							class="bp-btn-play"
							class:bp-btn-play--loading={showPlayLoading}
							class:bp-btn-play--soft-disabled={isPlayButtonSoftInsufficient}
							disabled={isPlayButtonHardDisabled}
							aria-label="Bet"
							aria-disabled={isPlayButtonSoftInsufficient}
							aria-busy={showPlayLoading}
							onclick={onMainActionClick}
						>
							{#if showPlayLoading}
								<img src={staticUrl('img/empty-btn-brown.png')} alt="" aria-hidden="true" />
								<img
									class="bp-btn-play-spinner"
									src={staticUrl('img/loading_vector.png')}
									alt=""
									aria-hidden="true"
								/>
							{:else}
								<img
									src={staticUrl(
										props.hasPendingBonusBalls ? 'img/empty-btn.png' : 'img/play-btn.png',
									)}
									alt=""
									aria-hidden="true"
								/>
								{#if props.hasPendingBonusBalls}
									<span class="bp-bonus-count-badge">{props.bonusBallsRemaining}</span>
								{/if}
							{/if}
						</button>
					{:else if props.autoPlayStarted && !autoBetStopping}
						<!-- During a running Autobet the main button mirrors the normal base-game loading
						     state: a non-clickable Play with a spinner. The remaining-rounds count sits in
						     the middle, like the bonus free-balls badge. Stopping is done from the Autobet
						     toggle on the side. -->
						<button
							type="button"
							class="bp-btn-play bp-btn-play--loading"
							disabled
							aria-label="Autobet running"
							aria-busy="true"
						>
							<img src={staticUrl('img/empty-btn-brown.png')} alt="" aria-hidden="true" />
							<img
								class="bp-btn-play-spinner"
								src={staticUrl('img/loading_vector.png')}
								alt=""
								aria-hidden="true"
							/>
							<span class="bp-bonus-count-badge">{props.autoRoundsLeft}</span>
						</button>
					{:else}
						<button
							type="button"
							class="bp-btn-play bp-btn-play--narrow"
							class:bp-btn-play--soft-disabled={isPlayButtonSoftInsufficient}
							disabled={isPlayButtonHardDisabled}
							aria-label="Start autobet"
							aria-disabled={isPlayButtonSoftInsufficient}
							onclick={onAutoGameStartClick}
						>
							<img src={staticUrl('img/play-btn.png')} alt="" aria-hidden="true" />
						</button>
					{/if}

					<div class="bp-side-actions">
						<div class="bp-auto-wrap">
							<button
								type="button"
								class="bp-btn-auto"
								class:bp-btn-auto--on={props.autoMode}
								class:bp-btn-auto--running={props.autoPlayStarted}
								disabled={(controlsLocked && !props.autoPlayStarted) || autoBetStopping}
								aria-pressed={props.autoMode}
								title={props.autoPlayStarted ? 'Stop autobet' : props.autoMode ? 'Manual' : 'Auto'}
								onclick={onAutoButtonClick}
							>
								<!-- While an Autobet run is active the toggle becomes the Stop control (full opacity
								     via .bp-btn-auto--running) and swaps to the stop artwork. The remaining-rounds
								     count no longer sits here — it moved to the middle of the Play button. -->
								<span class="bp-btn-auto-ico" aria-hidden="true">
									<img
										src={staticUrl(
											props.autoPlayStarted ? 'img/auto-bet-stop-btn.png' : 'img/auto-bet-btn.png',
										)}
										alt=""
									/>
								</span>
							</button>
							{#if autoPanelOpen}
								<div class="bp-autobet-panel">
									{#each AUTO_BET_OPTIONS as option}
										<button
											type="button"
											class="bp-autobet-option"
											disabled={controlsLocked}
											onclick={() => selectAutoBetCount(option)}
										>
											{option}
										</button>
									{/each}
								</div>
							{/if}
						</div>

						<div class="bp-fast-panel">
							<button
								type="button"
								class="bp-fast-btn"
								class:bp-fast-btn--on={stateGame.fastGameEnabled}
								disabled={controlsLocked && !props.autoPlayStarted}
								aria-pressed={stateGame.fastGameEnabled}
								aria-label="Fast game"
								onclick={() => {
									stateGame.fastGameEnabled = !stateGame.fastGameEnabled;
									context.eventEmitter.broadcast({ type: 'soundOnce', name: 'clickUIButton' });
								}}
							>
								<img src={staticUrl('img/fast-game-btn.png')} alt="" aria-hidden="true" />
							</button>
						</div>
					</div>
				</div>
			</div>
		</div>
	</div>
{/if}
