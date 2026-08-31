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
		canAffordPlinkoWager,
		isPlinkoHighBet,
		plinkoDisplayBalance,
		plinkoDisplayWinAmount,
		plinkoMaxStakePerBall,
		plinkoMinStakePerBall,
		plinkoStakePerBallOptions,
		plinkoStakePerBallSteps,
		plinkoWagerAmount,
	} from '../game/plinkoBet';
	import { syncPlinkoBetModeFromUi } from '../game/plinkoBetMode';
	import {
		isConfirmPromptOpen,
		requestConfirmPrompt,
		type ConfirmPromptKind,
	} from '../game/confirmPrompt.svelte';
	import { stateGame, stateGameDerived } from '../game/stateGame.svelte';
	import { stateXstate } from '../game/stateXstate';
	import { getContext } from '../game/context';
	import { FreeSpinMeter } from '../features/freeSpin';
	import {
		currencySign as currencySignFor,
		formatBalanceAmount,
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
	/** Settlement currency win from the last round — not recalculated from current stake. Held back /
	 * counted up while an in-bonus free spin's coins fly at the field — see plinkoDisplayWinAmount. */
	const displayWinAmount = $derived(plinkoDisplayWinAmount());
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
	 * Fast Game is a pure PRESENTATION preference — it scales the board's sim speed (and the free-ball
	 * stream's cadence with it) and touches nothing about the wager, the book or settlement. So it has
	 * no business sharing the wager controls' lock, and the bonus feature is exactly where a player
	 * reaches for it: a bought ladder streams hundreds of free balls, and the speed must be switchable
	 * — BOTH ways — while they are falling, not just between rounds. `pendingBuyBonusMode` covers the gap
	 * between activating the buy and `bonusRoundActive` flipping, so the toggle can't blink out under the
	 * player's finger mid-purchase.
	 *
	 * Everything the toggle drives already follows it live: `animationSpeed` reaches the engine through
	 * PlinkoBoard's `$effect`, and a held free-ball stream re-arms its own interval on the new cadence
	 * (see `retuneBonusBallHoldStream`).
	 *
	 * Replay keeps the lock — deterministic playback owns its pacing and takes no player input — and the
	 * `!autoPlayStarted` exemption stays as on every other control, so the toggle is live during an
	 * Autobet run exactly as before.
	 */
	const bonusFeatureActive = $derived(stateGame.bonusRoundActive || !!stateGame.pendingBuyBonusMode);
	const fastToggleLocked = $derived(
		bonusFeatureActive && !isReplayMode() ? false : controlsLocked && !props.autoPlayStarted,
	);
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
	 *
	 * The full-screen win celebration (`showWinPopup`) is the same kind of hole. By the time it plays the
	 * balls have all landed and the round has settled, so BOTH `controlsLocked` and `isGameOngoing()` read
	 * false — yet `isAutoBetRoundBusy` (the autobet loop's own gate) still holds on the popup so the reveal
	 * isn't torn down by the next drop. The menu therefore opened over a live celebration, and picking a
	 * count started a run that immediately gave up on its very first round: "Autobet Started" and "Autobet
	 * Finished" back to back, with nothing played. Locking on the popup here restores the same
	 * "menu is offered ⟺ a run can actually start" invariant. (The rapid 1-ball tier never shows this
	 * popup — see the `isRapidSingleBallMode` early return in the `finalWin` handler — so nothing is
	 * needlessly locked there.)
	 */
	const autoBetConfigLocked = $derived.by(() => {
		stateGame.isAnimating;
		stateGame.expectedOutcomeByBallId.size;
		stateGame.pendingSpacedSpawnTimers;
		stateGame.showWinPopup;
		return controlsLocked || isGameOngoing() || stateGame.showWinPopup;
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
	/**
	 * Replay drives bonus-ball drops itself — keep the visible bonus-play button locked for the viewer.
	 *
	 * ⚠️ The reads below ARE the dependency list, and they are deliberately made BEFORE the call — same
	 * pattern as `controlsLocked` / `autoBetConfigLocked` above, and for a sharper reason here.
	 * `isBonusPlayButtonDisabled()` is a chain of `||`, so the first true operand short-circuits every
	 * read after it and Svelte re-collects this derived's dependencies on each run. Once the free-spin
	 * hold pinned the bar full, the derived's dep set shrank to the two flags ahead of it — so when the
	 * wheel closed and cleared `spinMeterHoldFull` / `freeSpinRouletteOpen` / `activeRouletteSource`,
	 * nothing invalidated this value. It stayed stale-true, which left the Play button natively
	 * `disabled` and (through `isPlayButtonHardDisabled`) muted the Space hotkey with it: the free drops
	 * could not be resumed at all. Listing every reactive input up front makes the value track all of
	 * them regardless of where the chain stops.
	 */
	const bonusPlayDisabled = $derived.by(() => {
		stateGameDerived.hasPendingBonusBalls;
		stateGame.bonusLevelUpPending;
		stateGame.spinMeterHoldFull;
		stateGame.bonusRouletteOpen;
		stateGame.freeSpinRouletteOpen;
		stateGame.rouletteFlowInProgress;
		stateGame.activeRouletteSource;
		stateGame.pendingRouletteSource;
		return isBonusPlayButtonDisabled() || props.bonusPlayDisabled || isReplayMode();
	});
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
	//
	// Dependencies listed up front for the same reason as `bonusPlayDisabled` below: these are `||`
	// chains behind function calls, so whichever operand reads true hides every reactive field after it
	// from Svelte's dependency collection and the value can then miss its own un-blocking.
	const playDisabledMainOther = $derived.by(() => {
		stateGame.bonusRoundActive;
		stateGame.freeSpinRouletteOpen;
		stateGame.activeRouletteSource;
		stateGame.pendingRouletteSource;
		return (
			props.playDisabled ||
			isPlayActionBlockedByBonusRoulette() ||
			isPlayActionBlockedByFreeSpinRoulette()
		);
	});

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

	// The run has been stopped and is winding down (still `autoPlayStarted` but `autoPlayStopping`): the
	// Autobet toggle goes inert and drops its remaining-rounds badge, so the player can't re-arm it and no
	// stale count lingers. Reached only by a deliberate Stop press. An unaffordable wager and a triggered
	// bonus (`endAutoBetForBonusRound`) both end the run outright instead — `autoPlayStarted` goes false
	// in the same tick, so there is no winding-down state to show for either.
	const autoBetStopping = $derived(props.autoPlayStarted && stateGame.autoPlayStopping);

	// An Autobet run that is genuinely running (not winding down after a mid-run bonus). On mobile this
	// drives BOTH the permanent spinner on the Play plaque and the rounds-left count centred inside it:
	// the count rides the ring, matching desktop, instead of being stamped over the Autobet toggle.
	// Deliberately not `showPlayLoading`: that drops out between rounds, which would blink the ring (and
	// the count inside it) off in the gap between one round settling and the next being submitted.
	const autoBetRunning = $derived(props.autoPlayStarted && !autoBetStopping);

	function formatMoney(value: number) {
		const formatted = value.toLocaleString('en-US', {
			minimumFractionDigits: 2,
			maximumFractionDigits: 2,
		});
		return `${currencySign}${formatted}`;
	}

	/**
	 * The BALANCE only — 2 decimals normally, expanding to 4 when it carries sub-cent dust. Kept apart
	 * from `formatMoney` above, which also prints the total bet and stays at a flat 2 decimals.
	 */
	function formatBalance(value: number) {
		return formatBalanceAmount(value, currencySign);
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
		// Inert once a stop is already winding the run down.
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

	/**
	 * Which confirmation an Autobet start gets. A run is confirmed ONCE, here, and its rounds never
	 * re-prompt (see `needsHighBetConfirm` in Game.svelte) — so if the stake is a high bet, this is the
	 * player's only chance to be told that, and the prompt has to say so rather than just asking about
	 * Autobet. Measured against the CURRENT wager, which is what every round of the run will cost.
	 */
	function autoBetPromptKind(): ConfirmPromptKind {
		return isPlinkoHighBet() ? 'highAutobet' : 'autobet';
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
		// Picking a count starts a fresh Autobet run immediately. A run is funded drop by drop, NOT up
		// front: the player only needs to afford the NEXT drop, and the run plays on until the wallet
		// can't cover one (see `playAutoRounds`, which ends the run with the same toast). So the only
		// thing that blocks a start here is not being able to afford a single drop.
		if (wagerUnaffordable) {
			autoPanelOpen = false;
			showToast('Insufficient Balance');
			return;
		}
		autoPanelOpen = false;
		if (props.betAmount <= 0) return;
		// A run commits `count` whole wagers up front, so ask before arming anything.
		requestConfirmPrompt(autoBetPromptKind(), () => beginAutoBetRun(count));
	}

	/**
	 * Arm + start a confirmed Autobet run. Every precondition is re-checked here rather than trusted
	 * from `selectAutoBetCount`: the balance and the board can both change while the prompt is open.
	 */
	function beginAutoBetRun(count: number) {
		if (props.autoPlayStarted || autoBetConfigLocked) return;
		if (wagerUnaffordable) {
			showToast('Insufficient Balance');
			return;
		}
		if (props.betAmount <= 0) return;
		stateGame.autoRoundsLeft = count;
		stateGame.autoRoundsDisplay = count;
		// ARMING AND STARTING ARE ONE ATOMIC ACTION. Confirming the prompt is the player's only
		// confirmation of an Autobet run, so if the run can't actually start we must not leave `autoMode`
		// armed: an armed-idle Autobet swaps the main Play button for a "start autobet" control, and the
		// player's next ordinary Play press would then fire the whole run without ever confirming it.
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
		// One affordable drop is all a run needs to start — the rest are funded as they come (see
		// `selectAutoBetCount`). Otherwise surface the toast instead of arming Autobet.
		if (wagerUnaffordable) {
			showToast('Insufficient Balance');
			return;
		}
		if (props.betAmount <= 0) return;
		requestConfirmPrompt(autoBetPromptKind(), startArmedAutoBetRun);
	}

	/** Start the already-armed run once confirmed; preconditions re-checked (the prompt is not modal to
	 * the game clock — balance and in-flight balls can both move while it is up). */
	function startArmedAutoBetRun() {
		if (props.autoPlayStarted) return;
		if (wagerUnaffordable) {
			showToast('Insufficient Balance');
			return;
		}
		if (props.betAmount <= 0) return;
		// Same invariant as `beginAutoBetRun`: never leave Autobet armed-but-idle. If the run can't
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
	 * own trailing click. It is that click which clears the guard again (or, for a press that never
	 * produces one, the fallback window below), so a keyboard activation — a `click` with no preceding
	 * `pointerdown` — is never swallowed.
	 */
	let bonusPointerPressActive = false;

	/**
	 * How long the guard above waits for its trailing `click` before giving up on one.
	 *
	 * It is a SAFETY NET, not the mechanism: the click clears the guard itself (see
	 * `consumeBonusPointerPress`), and this only covers the presses that never produce one — a release
	 * that lands off the button while the pointer is captured, or a `pointercancel`. Generous on
	 * purpose, because the cost of it being too short is a double drop and the cost of it being too
	 * long is nothing: the next press clears any stale guard before it arms its own.
	 */
	const BONUS_TRAILING_CLICK_WINDOW_MS = 800;

	let bonusPointerPressTimer: ReturnType<typeof setTimeout> | null = null;

	/**
	 * Which transport currently holds the free-ball stream open, so a release on one never ends a hold
	 * owned by the other (clicking something else mid Space-hold, and vice versa).
	 */
	let bonusHoldTransport: 'pointer' | 'key' | null = null;

	function beginBonusBallHold(
		transport: 'pointer' | 'key',
		options?: { holdAlreadyQualified?: boolean },
	) {
		bonusHoldTransport = transport;
		startBonusBallHoldDrop(options);
	}

	/**
	 * A hold ends for one of two very different reasons, and only one of them should stop the stream:
	 *
	 *  - THE PLAYER LET GO (`'release'`) — stop, obviously.
	 *  - THE CONTROL WENT INERT UNDER THEM (`'transport'`) — a free-spin wheel or a level-up card
	 *    hard-disables the Play button mid-hold, and BOTH transports report that as an end: `OnHotkey`
	 *    synthesises a key-up when it goes `disabled`, and the button's pointer capture is dropped with
	 *    a `lostpointercapture`. The player never let go.
	 *
	 * Stopping on that second kind is what parked a Buy Bonus run: a ball triggered the Free Spin Wheel,
	 * the stream was torn down behind the overlay, and the remaining free drops then sat there until a
	 * fresh press. The stream was already built to ride this out — every tick re-checks
	 * `canDropBonusBallNow()`, so it PAUSES for the overlay and resumes on its own — so a transport end
	 * that arrives while the button is hard-disabled is ignored and the hold simply idles through the
	 * wheel. The genuine release is still heard: the window-level listeners below keep listening while
	 * the button and the Space hotkey are muted.
	 */
	function endBonusBallHold(transport: 'pointer' | 'key', via: 'release' | 'transport' = 'release') {
		if (via === 'transport' && isPlayButtonHardDisabled) return;
		// A hold owned by the other transport is none of this release's business.
		if (bonusHoldTransport !== null && bonusHoldTransport !== transport) return;
		bonusHoldTransport = null;
		stopBonusBallHoldDrop();
	}

	function onPlayPointerDown(event: PointerEvent) {
		// Base game: a press is an ordinary single bet — leave it to the click handler. (Repeat-betting
		// with real money is Autobet's job, and it is armed deliberately.)
		// Any guard still standing belongs to a PREVIOUS press whose trailing click never came, and the
		// fallback window may not have expired yet. Drop it here so it can never swallow the click this
		// press is about to produce — or, once the free balls run out, a real wager's.
		consumeBonusPointerPress();
		if (!props.hasPendingBonusBalls) return;
		if (!event.isPrimary) return;
		if (event.pointerType === 'mouse' && event.button !== 0) return;
		bonusPointerPressActive = true;
		// Follow the pointer off the button so the release still reaches us. The button going `disabled`
		// mid-hold (a wheel opening) also drops the capture — that arrives as `lostpointercapture`, which
		// is reported as a TRANSPORT end so the stream rides the overlay out instead of being torn down.
		(event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
		beginBonusBallHold('pointer');
	}

	function onPlayPointerRelease() {
		endBonusBallHold('pointer');
		clearBonusPointerPress();
	}

	/**
	 * The capture was dropped, not released — usually the button going `disabled` under the finger. The
	 * finger is still down, so `bonusPointerPressActive` deliberately STAYS set: clearing it here would
	 * hand the eventual release's trailing `click` to `onMainActionClick` and spend an extra free ball.
	 * The window-level release below clears it when the press actually ends.
	 */
	function onPlayPointerCaptureLost() {
		endBonusBallHold('pointer', 'transport');
	}

	/**
	 * The press is over, so the guard is now waiting for one thing only: the trailing `click`, which
	 * consumes it in `onMainActionClick`.
	 *
	 * ⚠️ This used to drop the guard on a `setTimeout(0)`, on the reasoning that the trailing click
	 * fires first. That holds on Chromium, where the compatibility mouse events and the `click` are
	 * dispatched in the same task as `pointerup` — the timeout is a macrotask and runs after all of
	 * them. WebKit dispatches that click in a LATER task, so the timeout slotted in between and the
	 * click arrived to find the guard already false: measured on an iPhone 15 / iOS 26 as pointerup at
	 * 159356ms, guard cleared at 159357ms, click at 159358ms. Every tap on the bonus Play button
	 * therefore spent TWO free balls — one from the press, one from the click falling through to
	 * `props.onPlay()`.
	 *
	 * So the click clears it now and this is only the fallback for a press that never produces one
	 * (released off the button under pointer capture, or cancelled).
	 */
	function clearBonusPointerPress() {
		// Every pointer release in the game reaches the window handler below, so without this the
		// fallback would arm a timer on releases that never touched the Play button at all.
		if (!bonusPointerPressActive) return;
		cancelBonusPointerPressTimer();
		bonusPointerPressTimer = setTimeout(() => {
			bonusPointerPressTimer = null;
			bonusPointerPressActive = false;
		}, BONUS_TRAILING_CLICK_WINDOW_MS);
	}

	function cancelBonusPointerPressTimer() {
		if (bonusPointerPressTimer === null) return;
		clearTimeout(bonusPointerPressTimer);
		bonusPointerPressTimer = null;
	}

	/** The trailing click arrived and has been swallowed — the guard has done its job. */
	function consumeBonusPointerPress() {
		cancelBonusPointerPressTimer();
		bonusPointerPressActive = false;
	}

	/**
	 * WINDOW-LEVEL RELEASES. Once the Play button goes `disabled` it stops receiving pointer events and
	 * `OnHotkey` stops forwarding hotkeys, so neither can tell us the player has let go — and a hold
	 * that now survives a wheel (see `endBonusBallHold`) must never survive an actual release. These fire
	 * regardless of what the button is doing, so they are also the authoritative end of the press.
	 */
	function onWindowPointerRelease() {
		endBonusBallHold('pointer');
		clearBonusPointerPress();
	}

	const isSpaceKey = (event: KeyboardEvent) => event.key === ' ' || event.code === 'Space';

	/**
	 * Physical Space state, kept at the window so it survives every mute in the game. `OnHotkey` reports
	 * presses to whoever is listening AT THE TIME, which leaves two blind spots this covers: a subscriber
	 * that is `disabled` hears nothing, and one that mounts mid-press never learns the key is down. The
	 * congratulations screens read it to recognise a Space the player is already holding as they open.
	 *
	 * Written only on the transition — auto-repeat fires keydown dozens of times a second, and this is
	 * reactive state.
	 */
	function onWindowKeyDown(event: KeyboardEvent) {
		if (!isSpaceKey(event)) return;
		if (!stateGame.spaceHotkeyDown) stateGame.spaceHotkeyDown = true;
	}

	function onWindowKeyUp(event: KeyboardEvent) {
		if (!isSpaceKey(event)) return;
		stateGame.spaceHotkeyDown = false;
		// The player has let go, so a press spent on a congratulations screen is done being spent — the
		// NEXT press is theirs to use on Play. This listener is the only one that always hears the
		// release, which is why the latch is cleared here rather than by the overlay that set it.
		stateGame.spaceHotkeyConsumedUntilRelease = false;
		endBonusBallHold('key');
	}

	/**
	 * Focus left the game entirely — no transport can still be held, so drop whichever owns the stream.
	 * The pointer release may never arrive (the button was released outside the window), so end the
	 * press here too rather than leaving it to swallow the next click.
	 */
	function onWindowBlur() {
		bonusHoldTransport = null;
		stopBonusBallHoldDrop();
		clearBonusPointerPress();
		// The key-up may land off-window and never reach us; leaving either flag set would deaden Space
		// for the rest of the session.
		stateGame.spaceHotkeyConsumedUntilRelease = false;
		stateGame.spaceHotkeyDown = false;
	}

	function onMainActionClick() {
		if (bonusPointerPressActive) {
			consumeBonusPointerPress();
			return;
		}
		if (isPlayButtonHardDisabled) return;
		// The button is greyed out purely because the total bet exceeds the balance — a click still
		// lands here (it is not natively `disabled`), so tell the player why instead of betting.
		if (isPlayButtonSoftInsufficient) {
			showToast('Insufficient Balance');
			return;
		}
		// With free balls pending the main button is the bonus Play button, never the Autobet stop — a
		// press must drop a ball. (That is also what lets the player finish an auto-driven bonus by hand
		// after stopping the run: Stop lives on the side Autobet toggle, which stays live throughout.)
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
		// This press was already spent dismissing a congratulations screen and the key is still down —
		// see `spaceHotkeyConsumedUntilRelease`. It bars a WAGER only: letting it through after the
		// post-bonus screen would place a real bet the player never asked for. A free bonus ball is the
		// opposite case — the player is holding Play on a round they have already won, and the drops are
		// meant to carry straight on from the screen they just dismissed.
		if (stateGame.spaceHotkeyConsumedUntilRelease && !props.hasPendingBonusBalls) return;
		// Hard-disabled blocks Space entirely; the soft insufficient-balance case falls through to
		// onMainActionClick, which shows the toast (keeping Space consistent with a click).
		if (isPlayButtonHardDisabled) return;
		if (stateGame.menuOpen || stateGame.infoModalOpen) return;
		// A confirmation prompt is awaiting a Yes/No — Space must not fire the very action being asked
		// about (the backdrop already blocks pointer input, but the hotkey is global).
		if (isConfirmPromptOpen()) return;
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
		// No `spaceHotkeyConsumedUntilRelease` check: this path is free-balls-only (the guard below), so
		// there is no wager to bar, and a Space still held out of the pre-bonus screen is exactly the
		// hold that should be streaming them.
		if (!props.hasPendingBonusBalls) return;
		if (stateGame.menuOpen || stateGame.infoModalOpen) return;
		if (isConfirmPromptOpen()) return;
		// `OnHotkey` only calls this once the key has been down for its own hold threshold, so the press
		// has already qualified — waiting out a second identical window would just stall the stream.
		beginBonusBallHold('key', { holdAlreadyQualified: true });
	}

	function onMobileAutoButtonClick(event: MouseEvent) {
		event.stopPropagation();
		// Inert once a stop is already winding the run down.
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
	onholdend={() => endBonusBallHold('key', 'transport')}
/>

<svelte:window
	onblur={onWindowBlur}
	onkeydown={onWindowKeyDown}
	onkeyup={onWindowKeyUp}
	onpointerup={onWindowPointerRelease}
	onpointercancel={onWindowPointerRelease}
/>

{#snippet bettingFieldFrame()}
	<img
		class="bp-field-frame"
		src={staticUrl('img/betting-component-frame.webp')}
		alt=""
		aria-hidden="true"
	/>
{/snippet}

<!-- Mobile top-row cards (Bet / Ball per drop / Bet per ball) use a dedicated frame asset, distinct
     from the shared desktop/mobile-popup frame above. -->
{#snippet mobileTopCardFrame()}
	<img
		class="bp-field-frame"
		src={staticUrl('img/betting-component-frame-mobile.webp')}
		alt=""
		aria-hidden="true"
	/>
{/snippet}

<!-- The desktop main action button is one round plaque across every state (play / loading / autobet /
     bonus count); only what sits on top of it changes. -->
{#snippet mainButtonBase()}
	<img class="bp-btn-play-bg" src={staticUrl('img/main_btn_empty.webp')} alt="" aria-hidden="true" />
{/snippet}

{#snippet mainButtonPlayIcon()}
	<img
		class="bp-btn-play-icon"
		src={staticUrl('img/main_btn_play_icon.webp')}
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
						src={staticUrl('img/betting-component-input-decrease.webp')}
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
						src={staticUrl('img/betting-component-input-increase.webp')}
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
				class:mobile-free-spin-meter--hidden={!stateGameDerived.areTierMetersVisible}
			>
				<!-- `visible` mirrors the `--hidden` class above: hiding it only stops it being COMPOSITED,
				     so the meter must also be told to stop drawing, or it keeps spinning its wheel at 60fps
				     behind `visibility: hidden` for the whole 1-ball tier. -->
				<FreeSpinMeter
					progress={props.spinMeterProgress ?? 0}
					visible={stateGameDerived.areTierMetersVisible}
				/>
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
							src={staticUrl('img/betting-component-input-decrease-containerless.webp')}
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
							src={staticUrl('img/betting-component-input-increase-containerless.webp')}
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
							src={staticUrl('img/betting-component-input-decrease-containerless.webp')}
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
							src={staticUrl('img/betting-component-input-increase-containerless.webp')}
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
				disabled={fastToggleLocked}
				aria-pressed={stateGame.fastGameEnabled}
				aria-label="Fast game"
				onclick={() => {
					stateGame.fastGameEnabled = !stateGame.fastGameEnabled;
					context.eventEmitter.broadcast({ type: 'soundOnce', name: 'clickUIButton' });
				}}
			>
				<img src={staticUrl('img/fast-game-btn-mobile.webp')} alt="" aria-hidden="true" />
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
					style:--strap-img="url({staticUrl('img/portait_bet_panel_strap.webp')})"
					aria-hidden="true"
				></div>
				<button
					type="button"
					class="mobile-icon-btn mobile-icon-btn--play"
					class:mobile-icon-btn--play-loading={showPlayLoading || autoBetRunning}
					class:mobile-icon-btn--soft-disabled={isPlayButtonSoftInsufficient}
					disabled={isPlayButtonHardDisabled}
					aria-label="Bet"
					aria-disabled={isPlayButtonSoftInsufficient}
					aria-busy={showPlayLoading || autoBetRunning}
					onclick={onMainActionClick}
					onpointerdown={onPlayPointerDown}
					onpointerup={onPlayPointerRelease}
					onpointercancel={onPlayPointerRelease}
					onlostpointercapture={onPlayPointerCaptureLost}
				>
					<!-- Play button now uses the desktop round plaque + icon (main_btn_empty.png +
					     main_btn_play_icon.png) via the shared snippets, replacing play-btn-mobile.png. The
					     plaque is drawn in every state; only the overlay (spinner / icon) changes. -->
					{@render mainButtonBase()}
					<!-- The ring spins for a gated round AND for the whole Autobet run, so the rounds-left
					     count below always has its arrows to sit inside. -->
					{#if showPlayLoading || autoBetRunning}
						<img
							class="bp-btn-play-spinner"
							src={staticUrl('img/spinner_logo.webp')}
							alt=""
							aria-hidden="true"
						/>
					{/if}
					{#if props.hasPendingBonusBalls}
						<!-- During a bonus round the mobile Play button matches desktop: the play icon is
						     dropped and the plaque shows only the number of free balls left. -->
						<span class="hud-play-count-badge">{props.bonusBallsRemaining}</span>
					{:else if autoBetRunning}
						<!-- Rounds left in the running Autobet, centred in the spinning ring — the same place
						     desktop puts it (see .bp-bonus-count-badge--auto). It is NOT stamped over the Autobet
						     toggle any more; that button is purely the Stop control while a run is up. -->
						<span class="hud-play-count-badge hud-play-count-badge--auto">
							{mobileAutoCountDisplay}
						</span>
					{:else if !showPlayLoading}
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
					aria-label={props.autoPlayStarted ? 'Stop autobet' : 'Autobet'}
					onclick={onMobileAutoButtonClick}
				>
					<!-- No remaining-rounds badge here: the count moved onto the Play plaque, inside the
					     spinning ring (matching desktop). This button is just the Autobet toggle / Stop —
					     and, as on desktop, it swaps to the STOP artwork for the life of a run so the icon
					     says what a press will do. -->
					<img
						src={staticUrl(
							props.autoPlayStarted
								? 'img/auto-bet-stop-btn-mobile.webp'
								: 'img/auto-bet-btn-mobile.webp',
						)}
						alt=""
						aria-hidden="true"
					/>
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
				<!-- Portrait's Win readout carries a coin, so an in-bonus free spin's coins have something to
				     land IN: they MERGE into this icon (and pop it) the way a collect merges into the balance
				     coin. Landscape's Win plaque has no coin, so its stream fades out short of the field
				     instead — CoinFountain picks the behaviour off which of the two targets is in the DOM. -->
				<img
					class="coin-fly-target"
					data-coin-fly-target="win-coin"
					src={staticUrl('img/coin-ico.webp')}
					alt=""
					aria-hidden="true"
				/>
				<span class="mobile-corner-label">{context.i18nDerived.t('Win')}:</span>
				<span class="mobile-corner-value">{formatWin(displayWinAmount)}</span>
				<!-- "+<credit>" rising out of the Win readout as an in-bonus free spin's coins merge into the
				     icon, while the value under it counts up to the new total. Same one-shot pattern as the
				     balance float on the right: keyed on the tick so a re-mount restarts the animation. -->
				{#if stateGame.winFieldFloatTick > 0}
					{#key stateGame.winFieldFloatTick}
						<span class="mobile-win-field-float" aria-hidden="true">
							+{formatWin(stateGame.winFieldFloatAmount)}
						</span>
					{/key}
				{/if}
			</div>
			<div class="mobile-corner-info mobile-corner-info--right">
				<span class="mobile-corner-value">{formatBalance(displayBalance)}</span>
				<!-- Wallet icon TRAILS the balance (right side). It still doubles as the on-win coin-burst
				     target — winning coins merge into it (located via data-coin-fly-target). -->
				<img
					class="mobile-balance-wallet coin-fly-target"
					data-coin-fly-target="balance"
					src={staticUrl('img/wallet-ico.webp')}
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
	<!-- Art scrim behind the WHOLE landscape betting panel — the controls row, the balance card and the
	     total-bet readout all sit on this one gradient (it replaced the flat dark bar that used to be
	     drawn only behind the total bet). A SIBLING of `.game-bottom-panel`, so it escapes that panel's
	     `scale(0.9)`/centre transform and can span the full 100vw of `.game-content` and pin to the
	     bottom edge. Rendered unconditionally: during a bonus round the total-bet readout goes away but
	     the panel does not, so the backdrop stays — it only shortens by the 1.05vw the panel drops (see
	     `.bp-panel-scrim--bonus`), keeping its top edge on the PLAY button.
	     A DIV with a background rather than an <img>: its height is solved against the PLAY button's top
	     edge, not from the art's own size, and the gradient then fills that box. The URL rides in on a
	     custom property so SvelteKit's `base` still resolves it — the convention documented in
	     lib/staticUrl.ts — since a bundled SCSS `url()` can't see the CDN subpath. -->
	<div
		class="bp-panel-scrim"
		class:bp-panel-scrim--bonus={stateGame.bonusRoundActive}
		style:--bp-panel-scrim-img="url({staticUrl('img/betting_panel_bottom_overlay.webp')})"
		aria-hidden="true"
	></div>

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
			class:bp-free-spin-meter-wrap--hidden={!stateGameDerived.areTierMetersVisible}
		>
			<div class="bp-free-spin-meter">
				<!-- `visible` mirrors the `--hidden` class on the wrap — see the mobile copy above. -->
				<FreeSpinMeter
					progress={props.spinMeterProgress ?? 0}
					visible={stateGameDerived.areTierMetersVisible}
				/>
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
						<!-- The "+<credit>" float lives in this wrapper, NOT in the field: `.bp-field--win-bet`
						     is `overflow: hidden` (its plaque art has to clip), so a float inside it would be
						     cut off the moment it rose. The wrapper shrink-to-fits the plaque, so it changes
						     no layout — see `.bp-win-bet-wrap`. -->
						<div class="bp-win-bet-wrap">
							<div
								class="bp-field bp-field--win-bet"
								aria-label="Round win"
								data-coin-fly-target="win"
							>
								{@render bettingFieldFrame()}
								<span class="bp-field-label">{winFieldLabel}</span>
								<span class="bp-select-display bp-win-bet-value" aria-live="polite">
									{formatWin(displayWinAmount)}
								</span>
							</div>
							<!-- Rises out of the plaque as an in-bonus free spin's coins fade into it, while the
							     value counts up to the new total. Twin of BalanceCard's `.balance-win-float`. -->
							{#if stateGame.winFieldFloatTick > 0}
								{#key stateGame.winFieldFloatTick}
									<span class="bp-win-field-float" aria-hidden="true">
										+{formatWin(stateGame.winFieldFloatAmount)}
									</span>
								{/key}
							{/if}
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
											props.autoPlayStarted ? 'img/auto-bet-stop-btn.webp' : 'img/auto-bet-btn.webp',
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
								onlostpointercapture={onPlayPointerCaptureLost}
							>
								{@render mainButtonBase()}
								{#if showPlayLoading}
									<img
										class="bp-btn-play-spinner"
										src={staticUrl('img/spinner_logo.webp')}
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
									src={staticUrl('img/spinner_logo.webp')}
									alt=""
									aria-hidden="true"
								/>
								<span class="bp-bonus-count-badge bp-bonus-count-badge--auto">
									{props.autoRoundsLeft}
								</span>
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
								disabled={fastToggleLocked}
								aria-pressed={stateGame.fastGameEnabled}
								aria-label="Fast game"
								onclick={() => {
									stateGame.fastGameEnabled = !stateGame.fastGameEnabled;
									context.eventEmitter.broadcast({ type: 'soundOnce', name: 'clickUIButton' });
								}}
							>
								<img src={staticUrl('img/fast-game-btn.webp')} alt="" aria-hidden="true" />
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
											src={staticUrl('img/betting-component-input-decrease.webp')}
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
											src={staticUrl('img/betting-component-input-increase.webp')}
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

	<!-- Total bet (bet-per-ball × ball-per-drop, or a hovered Autobet run cost) flush to the very bottom
	     edge of the game — a "Bet" label on the left and the total value on the right. It keeps its own
	     dark bar (`.bp-total-overlay::before`), which stacks ON TOP of `.bp-panel-scrim`'s art gradient
	     to give the readout a darker plinth than the rest of the panel gets.
	     Rendered as a SIBLING of `.game-bottom-panel` (not inside it) so it escapes that
	     panel's `scale(0.9)`/centre transform: it is a child of `.game-content`, which is 100vw wide and
	     `position: relative`, letting it span the full viewport and pin to the bottom.
	     Hidden during a bonus round: drops are free balls, so a total-bet readout is meaningless there —
	     the rest of the HUD keeps the normal-mode layout. -->
	{#if !stateGame.bonusRoundActive}
		<div
			class="bp-total-overlay"
			aria-label="Total bet"
			style:--bp-total-scrim-img="url({staticUrl(
				'img/betting_panel_total_bet_bottom_overlay.webp',
			)})"
		>
			<span class="bp-play-total-label">{betLabel}</span>
			<span class="bp-play-total-value" aria-live="polite">
				{formatMoney(displayTotalBet)}
			</span>
		</div>
	{/if}
{/if}
