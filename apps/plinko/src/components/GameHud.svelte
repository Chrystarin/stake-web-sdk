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
		startBonusBallHoldDrop,
		stopAutoBet,
		stopBonusBallHoldDrop,
	} from '../game/gameOrchestrator';
	import {
		canAffordAutoBetRun,
		canAffordPlinkoWager,
		plinkoDisplayBalance,
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
	};

	const props: Props = $props();
	const context = getContext();

	let autoPanelOpen = $state(false);
	let betPresetOpen = $state(false);
	// While the player hovers an Autobet count option, the total-bet displays preview what that whole
	// run would cost (per-drop total × rounds) instead of the single-drop total. Cleared on mouse-out.
	let hoveredAutoRounds = $state<number | null>(null);

	const currencySign = $derived(currencySignFor(stateBet.currency));
	// Social Mode restricts the word "Bet": the wager-field labels become "Play amount" / "Play per
	// ball" (rendered uppercase by CSS). Non-social sessions keep the localized "Bet" labels.
	const betLabel = $derived(
		stateUrlDerived.social() ? 'Play amount' : context.i18nDerived.t('Bet'),
	);
	const betPerBallLabel = $derived(
		stateUrlDerived.social() ? 'Play per ball' : context.i18nDerived.t('Bet per ball'),
	);
	// Mobile TOTAL BET stat card wants the full "Total bet" wording (reference), not the bare "Bet"
	// that the desktop field uses. Social Mode swaps "Bet" → "Play" here too.
	const totalBetLabel = $derived(
		stateUrlDerived.social() ? 'Total play' : context.i18nDerived.t('Total bet'),
	);
	// Left-side read-only field showing the round's LIVE win total: it accumulates in real time as each
	// ball lands (`stateGame.winAmount`, via `addSettledWinAmount`) and resets to 0 when a new round
	// starts (blanked at bet time). Labelled "Win" — Social Mode doesn't restrict that word.
	const winFieldLabel = $derived(context.i18nDerived.t('Win'));
	// Total bet shown in the plaque under PLAY (and the mobile total cards): the single-drop total
	// normally, or — while an Autobet count option is hovered — the whole run's cost (per-drop × rounds).
	const displayTotalBet = $derived(
		hoveredAutoRounds != null ? props.totalBetAmount * hoveredAutoRounds : props.totalBetAmount,
	);
	// Belt-and-braces reset: the panel can close from many paths (click-outside, other-panel-open,
	// autobet stop, select, …), not just mouse-out. Whenever the panel is not open, the hover preview
	// cannot be true regardless of the last mouse/focus event that fired.
	$effect(() => {
		if (!autoPanelOpen) hoveredAutoRounds = null;
	});
	/** Settlement currency win from the last round — not recalculated from current stake. */
	const displayWinAmount = $derived(stateGame.winAmount);
	// Held-back / counting-up display balance (rapid shadow, multi-ball win hold, or authoritative) —
	// see plinkoDisplayBalance. NOT for affordability (that uses plinkoSpendableBalance).
	const displayBalance = $derived(plinkoDisplayBalance());
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
	/**
	 * Arming Autobet is a WAGER-CONFIG action, not a play action: picking a count both arms AND starts the
	 * run, and `startAutoBet` refuses to start while any ball is still in flight. So the count menu must be
	 * unavailable under exactly that same precondition — "the menu is offered ⟺ a run can actually start".
	 *
	 * `controlsLocked` alone is not enough. On the rapid 1-ball tier it deliberately reads FALSE mid-drop
	 * (continuous betting keeps Play live), which let the player open the menu and pick a count while a ball
	 * was falling: the run could not start, yet `autoMode` was left armed — and an armed-idle Autobet turns
	 * the main Play button into a "start autobet" control, so the next ordinary Play press fired the whole
	 * run with no confirmation. Gating on the in-flight state too makes every tier behave like 10/20/50:
	 * the menu is simply locked until the board is clear.
	 *
	 * The `!autoPlayStarted` exemption at each call site keeps the toggle (Stop) and the count options live
	 * DURING a run, where picking a count only retargets the remaining rounds.
	 */
	const autoBetConfigLocked = $derived.by(() => {
		stateGame.isAnimating;
		stateGame.expectedOutcomeByBallId.size;
		stateGame.pendingSpacedSpawnTimers;
		return controlsLocked || isGameOngoing();
	});
	// If a drop starts while the count panel is open (possible on the rapid 1-ball tier, where Play stays
	// live mid-drop) its options go disabled — close the panel too so it can't sit open and inert.
	$effect(() => {
		if (autoBetConfigLocked && !props.autoPlayStarted) autoPanelOpen = false;
	});
	/**
	 * During a bonus round every drop is a FREE ball, so the wager controls become read-only: the − / +
	 * steppers are removed entirely (desktop and mobile) rather than just disabled, and on mobile the
	 * Total bet card goes with them — a total-bet readout is meaningless when the drops cost nothing
	 * (the desktop total-bet overlay is already dropped for the same reason). The Bet per ball / Balls
	 * per drop VALUES stay on screen so the player can still see what the bonus is playing at, and the
	 * two remaining mobile cards centre themselves in the row.
	 */
	const wagerSteppersHidden = $derived(stateGame.bonusRoundActive);
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
		if (autoBetConfigLocked && !props.autoPlayStarted) return;
		// Same click SFX as the bet-panel steppers.
		context.eventEmitter.broadcast({ type: 'soundOnce', name: 'clickUIButton' });
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
		// The panel is closing either way; make sure the hover-preview doesn't stay pinned to the
		// last-hovered option (esp. on the toast branch, which doesn't move focus off the option).
		hoveredAutoRounds = null;
		if (autoBetConfigLocked && !props.autoPlayStarted) return;
		// Already-running Autobet: picking a count only retargets the remaining rounds, it never
		// re-arms or re-starts anything.
		if (props.autoPlayStarted) {
			stateGame.autoRoundsLeft = count;
			stateGame.autoRoundsDisplay = count;
			autoPanelOpen = false;
			return;
		}
		// Picking a count starts a fresh Autobet run immediately, and Autobet is all-or-nothing:
		// the player must be able to fund every selected drop up front (count × per-drop wager). If
		// the whole run isn't affordable, don't arm or start it at all — just show the toast.
		if (!canAffordAutoBetRun(count)) {
			autoPanelOpen = false;
			showToast('Insufficient Balance');
			return;
		}
		autoPanelOpen = false;
		if (props.betAmount <= 0) return;
		stateGame.autoRoundsLeft = count;
		stateGame.autoRoundsDisplay = count;
		// ARMING AND STARTING ARE ONE ATOMIC ACTION. Selecting a count is the player's only confirmation
		// of an Autobet run, so if the run can't actually start we must not leave `autoMode` armed: an
		// armed-idle Autobet swaps the main Play button for a "start autobet" control, and the player's
		// next ordinary Play press would then fire the whole run without ever confirming it.
		stateGame.autoMode = true;
		if (!startAutoBet(() => props.onPlay())) {
			stateGame.autoMode = false;
			return;
		}
		context.eventEmitter.broadcast({ type: 'soundOnce', name: 'startAutoPlay' });
	}

	function onAutoGameStopClick() {
		stateGame.autoMode = false;
		stopAutoBet();
	}

	function onAutoGameStartClick() {
		if (isPlayButtonHardDisabled) return;
		// Autobet is all-or-nothing: require enough balance for the whole selected run (rounds ×
		// per-drop wager), not just one drop. Otherwise surface the toast instead of arming Autobet.
		if (!canAffordAutoBetRun(stateGame.autoRoundsLeft)) {
			showToast('Insufficient Balance');
			return;
		}
		if (props.betAmount <= 0) return;
		// Same invariant as `selectAutoBetCount`: never leave Autobet armed-but-idle. If the run can't
		// start (balls still in flight) fall back to manual rather than priming a run for the next press.
		if (!startAutoBet(() => props.onPlay())) {
			stateGame.autoMode = false;
			return;
		}
		context.eventEmitter.broadcast({ type: 'soundOnce', name: 'startAutoPlay' });
	}

	/**
	 * A pointer press on the play button DURING A BONUS ROUND is owned by the hold handlers below
	 * (`onPlayPointerDown` drops the first free ball, then streams while held). The browser still
	 * fires a `click` on release, which must not drop a second ball — and, once the last free ball is
	 * gone, must not fall through to a real wager either. So a pointer-driven bonus press consumes its
	 * own trailing click. Cleared as soon as the press ends, so a keyboard activation (a `click` with
	 * no preceding `pointerdown`) is never swallowed.
	 */
	let bonusPointerPressActive = false;

	function onPlayPointerDown(event: PointerEvent) {
		// Base game: a press is an ordinary single bet — leave it to the click handler. (Repeat-betting
		// with real money is Autobet's job, and it is armed deliberately.)
		if (!props.hasPendingBonusBalls) return;
		if (!event.isPrimary) return;
		if (event.pointerType === 'mouse' && event.button !== 0) return;
		bonusPointerPressActive = true;
		// Follow the pointer off the button so the release still reaches us; `lostpointercapture` then
		// also covers the button going `disabled` mid-hold (a wheel opening), which would otherwise
		// swallow the pointerup and leave the stream running.
		(event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
		startBonusBallHoldDrop();
	}

	function onPlayPointerRelease() {
		stopBonusBallHoldDrop();
		// The trailing `click` fires before this, so it still sees the flag set.
		setTimeout(() => {
			bonusPointerPressActive = false;
		}, 0);
	}

	function onMainActionClick() {
		if (bonusPointerPressActive) return;
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

	/**
	 * Space held (400ms — `OnHotkey`) streams free balls, matching a held press on the button. Bonus
	 * only: a held Space in the base game must not repeat-bet, so there the single `onpress` drop from
	 * `onSpacePlay` stands. `OnHotkey` calls `onholdend` when the key lifts AND when it goes disabled
	 * (a wheel opening), so the stream can't outlive the hold.
	 */
	function onSpaceHold() {
		if (!props.hasPendingBonusBalls) return;
		if (stateGame.menuOpen || stateGame.infoModalOpen) return;
		startBonusBallHoldDrop();
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
		if (autoBetConfigLocked) return;
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

<OnHotkey
	hotkey="Space"
	disabled={isPlayButtonHardDisabled}
	onpress={onSpacePlay}
	onhold={onSpaceHold}
	onholdend={stopBonusBallHoldDrop}
/>

<svelte:window onblur={stopBonusBallHoldDrop} />

{#snippet bettingFieldFrame()}
	<img
		class="bp-field-frame"
		src={staticUrl('img/betting-component-frame.png')}
		alt=""
		aria-hidden="true"
	/>
{/snippet}

<!-- Mobile top-row cards (Bet / Ball per drop / Bet per ball) use a dedicated frame asset, distinct
     from the shared desktop/mobile-popup frame above. -->
{#snippet mobileTopCardFrame()}
	<img
		class="bp-field-frame"
		src={staticUrl('img/betting-component-frame-mobile.png')}
		alt=""
		aria-hidden="true"
	/>
{/snippet}

<!-- The desktop main action button is one round plaque across every state (play / loading / autobet /
     bonus count); only what sits on top of it changes. -->
{#snippet mainButtonBase()}
	<img class="bp-btn-play-bg" src={staticUrl('img/main_btn_empty.png')} alt="" aria-hidden="true" />
{/snippet}

{#snippet mainButtonPlayIcon()}
	<img
		class="bp-btn-play-icon"
		src={staticUrl('img/main_btn_play_icon.png')}
		alt=""
		aria-hidden="true"
	/>
{/snippet}

<!-- Bet-per-ball stat field. Rendered in the RIGHT group normally (next to Ball per drop), but moved
     into the LEFT group during a bonus round (to the left of Autobet) — hence a shared snippet. -->
{#snippet betPerBallField()}
	<div class="bp-field bp-field--bet bp-field--select bp-field--bet-controls bp-bet-presets-wrap">
		{@render bettingFieldFrame()}
		<span class="bp-field-label">{betPerBallLabel}</span>
		<div class="bp-bet-input-wrap">
			{#if !wagerSteppersHidden}
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
			{/if}
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
			{#if !wagerSteppersHidden}
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
			{/if}
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
{/snippet}

{#if props.mobile}
	<div class="mobile-hud">
		<!-- Free-spin meter on its own row above the bet fields, right-aligned (matches the reference).
		     Permanently mounted; shown/hidden via `visibility` only (see `--hidden`). Never
		     `{#if}`-unmount the Pixi/WebGL meter on a Ball-Per-Drop change — recreating its canvas flashes
		     white for a frame on slower GPUs. The row reserves its height either way, so hiding the meter
		     inside it has no layout effect. -->
		<div class="mobile-meter-row">
			<div
				class="mobile-free-spin-meter"
				class:mobile-free-spin-meter--hidden={stateGame.ballPerDrop === 1}
			>
				<FreeSpinMeter progress={props.spinMeterProgress ?? 0} />
			</div>
		</div>

		<div class="mobile-top-row" class:mobile-top-row--bonus={wagerSteppersHidden}>
			<!-- TOTAL BET — read-only display (no steppers), narrower than the two stepper fields.
			     Dropped during a bonus round (free balls cost nothing), leaving the two cards centred. -->
			{#if !wagerSteppersHidden}
				<div class="mobile-top-card mobile-top-card--stat">
					{@render mobileTopCardFrame()}
					<div class="mobile-top-card-mid">
						<span class="mobile-top-card-label">{totalBetLabel}</span>
						<span class="mobile-top-card-value">{formatMoney(displayTotalBet)}</span>
					</div>
				</div>
			{/if}

			<!-- BET PER BALL — inline − / + steppers (the old chip popup is removed). -->
			<div class="mobile-top-card mobile-top-card--stepper">
				{@render mobileTopCardFrame()}
				{#if !wagerSteppersHidden}
					<button
						type="button"
						class="mobile-top-step mobile-top-step--decrease"
						disabled={isBetAmountStepDisabled(-1)}
						aria-label="Decrease bet per ball"
						onclick={() => adjustBetAmountStep(-1)}
					>
						<img
							src={staticUrl('img/betting-component-input-decrease-containerless.png')}
							alt=""
							aria-hidden="true"
						/>
					</button>
				{/if}
				<div class="mobile-top-card-mid">
					<span class="mobile-top-card-label">{betPerBallLabel}</span>
					<span class="mobile-top-card-value">{formatCompactAmount(props.betAmount)}</span>
				</div>
				{#if !wagerSteppersHidden}
					<button
						type="button"
						class="mobile-top-step mobile-top-step--increase"
						disabled={isBetAmountStepDisabled(1)}
						aria-label="Increase bet per ball"
						onclick={() => adjustBetAmountStep(1)}
					>
						<img
							src={staticUrl('img/betting-component-input-increase-containerless.png')}
							alt=""
							aria-hidden="true"
						/>
					</button>
				{/if}
			</div>

			<!-- BALLS PER DROP — inline − / + steppers. -->
			<div class="mobile-top-card mobile-top-card--stepper">
				{@render mobileTopCardFrame()}
				{#if !wagerSteppersHidden}
					<button
						type="button"
						class="mobile-top-step mobile-top-step--decrease"
						disabled={isBallPerDropStepDisabled(-1)}
						aria-label="Decrease ball per drop"
						onclick={() => adjustBallPerDrop(-1)}
					>
						<img
							src={staticUrl('img/betting-component-input-decrease-containerless.png')}
							alt=""
							aria-hidden="true"
						/>
					</button>
				{/if}
				<div class="mobile-top-card-mid">
					<span class="mobile-top-card-label">{context.i18nDerived.t('Ball per drop')}</span>
					<span class="mobile-top-card-value">{ballPerDropDisplay}</span>
				</div>
				{#if !wagerSteppersHidden}
					<button
						type="button"
						class="mobile-top-step mobile-top-step--increase"
						disabled={isBallPerDropStepDisabled(1)}
						aria-label="Increase ball per drop"
						onclick={() => adjustBallPerDrop(1)}
					>
						<img
							src={staticUrl('img/betting-component-input-increase-containerless.png')}
							alt=""
							aria-hidden="true"
						/>
					</button>
				{/if}
			</div>
		</div>

		<div class="mobile-action-row">
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
			<!-- The strap art is wrapped WITH the Play button (not dropped straight into the row) so it
			     is anchored to the button's own box: its socket offset is then a pure function of the
			     button size and can never drift if the row's other buttons are resized. The wrapper is
			     shrink-to-fit, so it adds no layout of its own. -->
			<div class="mobile-play-wrap">
				<!-- Portrait-only decorative strap running behind the action row, with the Play plaque
				     seated in its socket. Purely presentational — it must never eat a tap meant for the
				     button underneath the pointer.
				     A DIV rather than an <img>: the plate has to be sized from the PLAY BUTTON (its socket
				     is pinned to the ball), not from its own intrinsic size, and the box is what carries
				     that — the art then fills it at its native 610 : 263 ratio, undistorted. The URL
				     rides in on a custom property so SvelteKit's `base` still resolves it — the
				     convention documented in lib/staticUrl.ts — since a bundled SCSS `url()` can't see
				     the CDN subpath. -->
				<div
					class="mobile-play-strap"
					style:--strap-img="url({staticUrl('img/portait_bet_panel_strap.png')})"
					aria-hidden="true"
				></div>
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
					onpointerdown={onPlayPointerDown}
					onpointerup={onPlayPointerRelease}
					onpointercancel={onPlayPointerRelease}
					onlostpointercapture={onPlayPointerRelease}
				>
					<!-- Play button now uses the desktop round plaque + icon (main_btn_empty.png +
					     main_btn_play_icon.png) via the shared snippets, replacing play-btn-mobile.png. The
					     plaque is drawn in every state; only the overlay (spinner / icon) changes. -->
					{@render mainButtonBase()}
					{#if showPlayLoading}
						<img
							class="bp-btn-play-spinner"
							src={staticUrl('img/loading_vector.png')}
							alt=""
							aria-hidden="true"
						/>
					{:else if props.hasPendingBonusBalls}
						<!-- During a bonus round the mobile Play button matches desktop: the play icon is
						     dropped and the plaque shows only the number of free balls left. -->
						<span class="hud-play-count-badge">{props.bonusBallsRemaining}</span>
					{:else}
						{@render mainButtonPlayIcon()}
					{/if}
				</button>
			</div>
			<div class="mobile-autobet-wrap">
				<button
					type="button"
					class="mobile-icon-btn mobile-icon-btn--autobet"
					class:mobile-icon-btn--on={props.autoMode || props.autoPlayStarted}
					disabled={(autoBetConfigLocked && !props.autoPlayStarted) || autoBetStopping}
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
								disabled={autoBetConfigLocked && !props.autoPlayStarted}
								onclick={() => selectMobileAutoBetCount(option)}
							>
								{option}
							</button>
						{/each}
					</div>
				{/if}
			</div>
		</div>

		<div class="mobile-bottom-corners">
			<div class="mobile-corner-info mobile-corner-info--left">
				<img src={staticUrl('img/coin-ico.png')} alt="" aria-hidden="true" />
				<span class="mobile-corner-label">{context.i18nDerived.t('Win')}:</span>
				<span class="mobile-corner-value">{formatWin(displayWinAmount)}</span>
			</div>
			<div class="mobile-corner-info mobile-corner-info--right">
				<span class="mobile-corner-value">{formatMoney(displayBalance)}</span>
				<!-- Wallet icon TRAILS the balance (right side). It still doubles as the on-win coin-burst
				     target — winning coins merge into it (located via data-coin-fly-target). -->
				<img
					class="mobile-balance-wallet coin-fly-target"
					data-coin-fly-target="balance"
					src={staticUrl('img/wallet-ico.png')}
					alt=""
					aria-hidden="true"
				/>
				<!-- "+<win>" rising out of the wallet as coins merge into it — the mobile twin of
				     BalanceCard's `.balance-win-float`, driven by the same `balanceWinFloatTick`. Keyed on
				     the tick so a re-mount restarts the one-shot animation. Absolutely positioned, so it
				     never disturbs the corner row's flex layout. -->
				{#if stateGame.balanceWinFloatTick > 0}
					{#key stateGame.balanceWinFloatTick}
						<span class="mobile-balance-win-float" aria-hidden="true">
							+{formatWin(stateGame.balanceWinFloatAmount)}
						</span>
					{/key}
				{/if}
			</div>
		</div>
	</div>
{:else}
	<!-- During a bonus round the panel is nudged slightly LOWER (see `.game-bottom-panel--bonus`) since
	     the bottom total-bet overlay is gone, leaving room below. -->
	<div class="game-bottom-panel" class:game-bottom-panel--bonus={stateGame.bonusRoundActive}>
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
					<!-- Layout follows the reference art: [Balance | Win] on the left, the Auto | PLAY |
					     Fast cluster centred, and [Bet per ball | Ball per drop] on the right. Balance itself
					     sits in the standalone BalanceCard (to the left of the Win field); the Win field shows
					     the round's live win total, and the total BET shows in the pill under PLAY. -->
					<div class="bp-side-group bp-side-group--left">
						<!-- Win: read-only display of the round's LIVE win total. It accumulates in real time
						     as each ball lands (`stateGame.winAmount`, via `addSettledWinAmount`) and resets to
						     0 when a new round starts (blanked at bet time). No steppers — display only. Shown
						     in both normal and bonus rounds so the desktop bonus HUD keeps the normal-mode
						     layout (only the bottom total-bet overlay is dropped during bonus). -->
						<div class="bp-field bp-field--win-bet" aria-label="Round win">
							{@render bettingFieldFrame()}
							<span class="bp-field-label">{winFieldLabel}</span>
							<span class="bp-select-display bp-win-bet-value" aria-live="polite">
								{formatWin(displayWinAmount)}
							</span>
						</div>
					</div>

					<!-- Center cluster mirrors the reference art around the play button: Auto | PLAY | Fast. -->
					<div class="bp-center-cluster">
						<div class="bp-auto-wrap">
							<button
								type="button"
								class="bp-btn-auto"
								class:bp-btn-auto--on={props.autoMode}
								class:bp-btn-auto--running={props.autoPlayStarted}
								disabled={(autoBetConfigLocked && !props.autoPlayStarted) || autoBetStopping}
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
								<!-- svelte-ignore a11y_mouse_events_have_key_events -->
								<div class="bp-autobet-panel" onmouseleave={() => (hoveredAutoRounds = null)}>
									{#each AUTO_BET_OPTIONS as option}
										<button
											type="button"
											class="bp-autobet-option"
											disabled={autoBetConfigLocked && !props.autoPlayStarted}
											onclick={() => selectAutoBetCount(option)}
											onmouseenter={() => (hoveredAutoRounds = option)}
											onfocus={() => (hoveredAutoRounds = option)}
											onblur={() => (hoveredAutoRounds = null)}
										>
											{option}
										</button>
									{/each}
								</div>
							{/if}
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
								onpointerdown={onPlayPointerDown}
								onpointerup={onPlayPointerRelease}
								onpointercancel={onPlayPointerRelease}
								onlostpointercapture={onPlayPointerRelease}
							>
								{@render mainButtonBase()}
								{#if showPlayLoading}
									<img
										class="bp-btn-play-spinner"
										src={staticUrl('img/loading_vector.png')}
										alt=""
										aria-hidden="true"
									/>
								{:else if props.hasPendingBonusBalls}
									<span class="bp-bonus-count-badge">{props.bonusBallsRemaining}</span>
								{:else}
									{@render mainButtonPlayIcon()}
								{/if}
							</button>
						{:else if props.autoPlayStarted && !autoBetStopping}
							<!-- A running Autobet is a DISPLAY, not a control: the plaque shows the spinning loader
							     with the rounds left counting down inside it, and takes no clicks. Stopping is
							     done from the side Autobet toggle, which is the only control deliberately exempt
							     from the run's own `controlsLocked`. -->
							<button
								type="button"
								class="bp-btn-play bp-btn-play--loading"
								disabled
								aria-label="Autobet running"
								aria-busy="true"
							>
								{@render mainButtonBase()}
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
								class="bp-btn-play"
								class:bp-btn-play--soft-disabled={isPlayButtonSoftInsufficient}
								disabled={isPlayButtonHardDisabled}
								aria-label="Start autobet"
								aria-disabled={isPlayButtonSoftInsufficient}
								onclick={onAutoGameStartClick}
							>
								{@render mainButtonBase()}
								{@render mainButtonPlayIcon()}
							</button>
						{/if}

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

					<!-- Right group: Bet per ball (nearest the centre) then Ball per drop, mirroring the
					     Balance | Win-bet pair on the left. Kept identical in normal and bonus rounds so the
					     desktop bonus HUD matches the normal-mode layout. -->
					<div class="bp-side-group bp-side-group--right">
						{@render betPerBallField()}

						<div class="bp-field bp-field--select bp-field--bet-controls">
							{@render bettingFieldFrame()}
							<span class="bp-field-label">{context.i18nDerived.t('Ball per drop')}</span>
							<div class="bp-bet-input-wrap">
								{#if !wagerSteppersHidden}
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
								{/if}
								<div class="bp-bet-input-mid">
									<span class="bp-select-display" aria-live="polite">{ballPerDropDisplay}</span>
								</div>
								{#if !wagerSteppersHidden}
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
								{/if}
							</div>
						</div>
					</div>
				</div>
			</div>
		</div>
	</div>

	<!-- Total bet (bet-per-ball × ball-per-drop, or a hovered Autobet run cost) on a full-width dark
	     OVERLAY BAR flush to the very bottom edge of the game — a "Bet" label on the left and the total
	     value on the right. Rendered as a SIBLING of `.game-bottom-panel` (not inside it) so it escapes
	     that panel's `scale(0.9)`/centre transform: it is a child of `.game-content`, which is 100vw
	     wide and `position: relative`, letting the bar span the full viewport and pin to the bottom.
	     Hidden during a bonus round: drops are free balls, so a total-bet readout is meaningless there —
	     the rest of the HUD keeps the normal-mode layout. -->
	{#if !stateGame.bonusRoundActive}
		<div class="bp-total-overlay" aria-label="Total bet">
			<span class="bp-play-total-label">{betLabel}</span>
			<span class="bp-play-total-value" aria-live="polite">
				{formatMoney(displayTotalBet)}
			</span>
		</div>
	{/if}
{/if}
