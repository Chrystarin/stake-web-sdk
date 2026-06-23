<script lang="ts">
	import { onMount } from 'svelte';

	import { OnHotkey } from 'components-shared';
	import { stateBet } from 'state-shared';

	import config from '../game/config';
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
		isReplayMode,
		startAutoBet,
		stopAutoBet,
	} from '../game/gameOrchestrator';
	import { canAffordPlinkoWager, plinkoStakePerBallOptions } from '../game/plinkoBet';
	import { syncPlinkoBetModeFromUi } from '../game/plinkoBetMode';
	import { stateGame } from '../game/stateGame.svelte';
	import { stateXstate } from '../game/stateXstate';
	import { getContext } from '../game/context';
	import { FreeSpinMeter } from '../features/freeSpin';
	import { formatCompactAmount } from '../lib/format';
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

	const currencySign = $derived(stateBet.currency === 'USD' ? '$' : `${stateBet.currency} `);
	/** Settlement currency win from the last round — not recalculated from current stake. */
	const displayWinAmount = $derived(stateGame.winAmount);
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
			: BET_PER_BALL_PRESETS.filter((v) => v >= config.minBet && v <= config.maxBet),
	);

	const playDisabledMain = $derived(
		props.playDisabled ||
			!canAffordPlinkoWager() ||
			isPlayActionBlockedByBonusRoulette() ||
			isPlayActionBlockedByFreeSpinRoulette(),
	);

	/** Same disabled state as the visible play / stop / bonus-play button (and Space). */
	const isPlayButtonDisabled = $derived(
		props.hasPendingBonusBalls
			? bonusPlayDisabled
			: props.autoMode && !props.autoPlayStarted
				? playDisabledMain || props.betAmount <= 0
				: playDisabledMain,
	);

	const mobileAutoCountDisplay = $derived(
		props.autoMode || props.autoPlayStarted
			? String(props.autoRoundsLeft ?? stateGame.autoRoundsDisplay)
			: String(stateGame.autoRoundsLeft),
	);

	function formatMoney(value: number) {
		const formatted = value.toLocaleString('en-US', {
			minimumFractionDigits: 2,
			maximumFractionDigits: 2,
		});
		return `${currencySign}${formatted}`;
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
		if (controlsLocked || delta === 0) return;
		const presets = availableBetPresets;
		if (!presets.length) return;
		const idx = getClosestPresetIndex(presets, props.betAmount);
		const next = idx + (delta > 0 ? 1 : -1);
		if (next < 0 || next >= presets.length) return;
		props.onBetAmountChange(presets[next]);
	}

	function isBetAmountStepDisabled(delta: number) {
		if (controlsLocked || delta === 0) return true;
		const presets = availableBetPresets;
		if (presets.length <= 1) return true;
		const idx = getClosestPresetIndex(presets, props.betAmount);
		if (delta > 0) return idx >= presets.length - 1;
		return idx <= 0;
	}

	function adjustBallPerDrop(delta: number) {
		if (controlsLocked || delta === 0) return;
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
		if (controlsLocked || delta === 0) return true;
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
		if (controlsLocked) return;
		autoPanelOpen = false;
		betPresetOpen = !betPresetOpen;
	}

	function selectBetPerBallOption(value: number) {
		if (controlsLocked) return;
		props.onBetAmountChange(value);
		betPresetOpen = false;
		context.eventEmitter.broadcast({ type: 'soundOnce', name: 'clickUIButton' });
	}

	function onAutoButtonClick(event: MouseEvent) {
		event.stopPropagation();
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
		if (props.betAmount <= 0 || playDisabledMain) return;
		startAutoBet(() => props.onPlay());
		context.eventEmitter.broadcast({ type: 'soundOnce', name: 'startAutoPlay' });
	}

	function onMainActionClick() {
		if (isPlayButtonDisabled) return;
		if (props.hasPendingBonusBalls || !props.autoMode) {
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
		if (isPlayButtonDisabled) return;
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

<OnHotkey hotkey="Space" disabled={isPlayButtonDisabled} onpress={onSpacePlay} />

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
				<span class="mobile-top-card-label">{context.i18nDerived.t('Bet')}</span>
				<span class="mobile-top-card-value">{formatMoney(props.totalBetAmount)}</span>
			</div>
			<div class="mobile-top-card">
				{@render bettingFieldFrame()}
				<span class="mobile-top-card-label">{context.i18nDerived.t('Ball per drop')}</span>
				<span class="mobile-top-card-value">{ballPerDropDisplay}</span>
			</div>
			<div class="mobile-top-card">
				{@render bettingFieldFrame()}
				<span class="mobile-top-card-label">{context.i18nDerived.t('Bet per ball')}</span>
				<span class="mobile-top-card-value">{formatCompactAmount(props.betAmount)}</span>
			</div>
			<div class="mobile-top-card mobile-top-card--free-spin">
				<div class="mobile-free-spin-meter">
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
				disabled={isPlayButtonDisabled}
				aria-label="Bet"
				onclick={onMainActionClick}
			>
				<img src={staticUrl('img/play-btn-mobile.png')} alt="" aria-hidden="true" />
				{#if props.hasPendingBonusBalls}
					<span class="hud-play-count-badge">{props.bonusBallsRemaining}</span>
				{/if}
			</button>
			<button
				type="button"
				class="mobile-icon-btn mobile-icon-btn--coins"
				aria-expanded={mobileBetPopupOpen}
				aria-label="Open bet settings"
				onclick={toggleMobileBetPopup}
			>
				<img src={staticUrl('img/coins-btn-mobile.png')} alt="" aria-hidden="true" />
			</button>
			<div class="mobile-autobet-wrap">
				<button
					type="button"
					class="mobile-icon-btn mobile-icon-btn--autobet"
					class:mobile-icon-btn--on={props.autoMode || props.autoPlayStarted}
					disabled={controlsLocked && !props.autoPlayStarted}
					aria-pressed={props.autoMode || props.autoPlayStarted}
					aria-label="Autobet"
					onclick={onMobileAutoButtonClick}
				>
					<img src={staticUrl('img/auto-bet-btn-mobile.png')} alt="" aria-hidden="true" />
					{#if props.autoMode || props.autoPlayStarted}
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

		{#if mobileBetPopupOpen}
			<div class="mobile-bet-popup" role="dialog" aria-label="Bet settings">
				{@render bettingFieldFrame()}
				<div class="mobile-bet-popup-row mobile-bet-popup-row--stat">
					{@render bettingFieldFrame()}
					<div class="mobile-bet-popup-mid">
						<span class="mobile-bet-popup-label">{context.i18nDerived.t('Bet')}</span>
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
						<span class="mobile-bet-popup-label">{context.i18nDerived.t('Bet per ball')}</span>
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

		<div class="mobile-bottom-corners">
			<div class="mobile-corner-info mobile-corner-info--left">
				<img src={staticUrl('img/coin-ico.png')} alt="" aria-hidden="true" />
				<span class="mobile-corner-label">{context.i18nDerived.t('Win')}:</span>
				<span class="mobile-corner-value">{formatMoney(displayWinAmount)}</span>
			</div>
			<div class="mobile-corner-info mobile-corner-info--right">
				<img src={staticUrl('img/wallet-ico.png')} alt="" aria-hidden="true" />
				<span class="mobile-corner-value">{formatMoney(stateBet.balanceAmount)}</span>
			</div>
		</div>
	</div>
{:else}
	<div class="game-bottom-panel">
		<div class="bp-free-spin-meter-wrap">
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
							<span>{formatMoney(stateBet.balanceAmount)}</span>
						</div>
					</div>

					<div class="bp-field bp-field--bet-total">
						{@render bettingFieldFrame()}
						<span class="bp-field-label">{context.i18nDerived.t('Bet')}</span>
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
							<span>{formatMoney(displayWinAmount)}</span>
						</div>
					</div>

					<div
						class="bp-field bp-field--bet bp-field--select bp-field--bet-controls bp-bet-presets-wrap"
					>
						{@render bettingFieldFrame()}
						<span class="bp-field-label">{context.i18nDerived.t('Bet per ball')}</span>
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
								class:bp-bet-input-mid--disabled={controlsLocked}
								role="button"
								tabindex={controlsLocked ? -1 : 0}
								aria-disabled={controlsLocked}
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
										disabled={controlsLocked}
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
							disabled={isPlayButtonDisabled}
							aria-label="Bet"
							onclick={props.onPlay}
						>
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
						</button>
					{:else if props.autoPlayStarted}
						<button
							type="button"
							class="bp-btn-play bp-btn-play--narrow"
							aria-label="Stop autobet"
							onclick={onAutoGameStopClick}
						>
							<img src={staticUrl('img/pause-btn.png')} alt="" aria-hidden="true" />
						</button>
					{:else}
						<button
							type="button"
							class="bp-btn-play bp-btn-play--narrow"
							disabled={isPlayButtonDisabled}
							aria-label="Start autobet"
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
								disabled={controlsLocked && !props.autoPlayStarted}
								aria-pressed={props.autoMode}
								title={props.autoMode ? 'Manual' : 'Auto'}
								onclick={onAutoButtonClick}
							>
								<span class="bp-btn-auto-ico" aria-hidden="true">
									<img src={staticUrl('img/auto-bet-btn.png')} alt="" />
								</span>
								{#if props.autoMode}
									<span class="bp-auto-count-badge">{props.autoRoundsLeft}</span>
								{/if}
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
