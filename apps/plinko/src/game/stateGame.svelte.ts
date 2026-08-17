import {
	BONUS_LEVEL_LABELS,
	DEFAULT_ROW_COUNT,
	MIN_MS_BETWEEN_BALL_SPAWNS,
	SIM_SPEED,
} from '../game-logic/constants';
import { createMeterController } from '../game-logic/meterController';
import type { Bet, BookEvent, PlinkoBallOutcome } from './typesBookEvent';
import { plinkoWagerAmount } from './plinkoBet';

/** One multiplier pill in a round's My Bet History row. */
export type HistoryChip = {
	/** Pill text, e.g. "x12.5" (base game), "10 Bonus", "Free Spin x5". */
	label: string;
	/** Pill background color. */
	color: string;
};

/** ONE row per round (not per ball) — base game + bonus + free spin folded together. */
export type HistoryEntry = {
	date: string;
	/** Total wager for the round (bet per ball × balls per drop). */
	bet: number;
	/** Per-ball stake for the round. */
	betPerBall: number;
	/** Balls dropped in the round (the round's ball-per-drop tier). */
	ballPerDrop: number;
	/** Total win for the round: base game + bonus + free spin. */
	win: number;
	/** Multiplier pills: base-game total, optional "N Bonus", and one "Free Spin xN" per free spin. */
	chips: HistoryChip[];
};
export type InfoModalTab = 'rules' | 'history' | 'howToPlay';
/** One entry in the 1-ball rapid win-sparkle set (newest first, capped to 3). Each is a small shine-ray
 * burst with the win value + tier label printed over it, that pops in at the skull's mouth, floats
 * slowly upward across its lifetime, then shrinks + fades away. `multiplier` sizes the sparkle (bigger
 * win → bigger burst) and picks the tier banner. `stackIndex` is the sparkle's slot in the vertical
 * stack: 0 = newest, at the mouth; 1 = one above; 2 = two above. New pushes increment every existing
 * sparkle's stackIndex so the newest always sits at the mouth and older ones slide upward — this is
 * what keeps the sparkles from overlapping when several wins land in quick succession. */
export type RapidWinSparkle = {
	id: number;
	amount: number;
	multiplier: number;
	stackIndex: number;
};
export type MsgBoxConfig = {
	text: string;
	confirmText?: string;
	cancelText?: string;
	onConfirm?: () => void;
	onCancel?: () => void;
};

export const stateGame = $state({
	rowCount: DEFAULT_ROW_COUNT,
	// Launch on the single-ball tier so the opening wager is one default bet level (e.g. 100 JPY), NOT a
	// 10× ball setup that would inflate the default 10×. Players opt into 10/20/50-ball tiers themselves.
	ballPerDrop: 1,
	/**
	 * This session's DEFAULT bet per ball — the stake the game launched at (RGS `defaultBetLevel`, or
	 * the seeded local-dev stake). Latched once on the first seed (see PlinkoAuthenticate) and never
	 * moved by the player's later stake changes, because it is the fixed reference the HIGH-BET
	 * confirmation threshold is measured against (`plinkoHighBetThreshold`). 0 = not yet seeded.
	 */
	defaultStakePerBall: 0,
	coefficients: [] as number[],
	fastGameEnabled: false,
	animationEnabled: true,
	isAnimating: false,
	isSubmitting: false,
	history: [] as HistoryEntry[],
	bonusMeterValue: 0,
	bonusMeterLevel: 0,
	spinMeterValue: 0,
	spinMeterMax: 10,
	spinMeterBaseMax: 10,
	bonusMeterMax: 20,
	bonusMeterBaseMax: 20,
	bonusMeterOverflowValue: 0,
	/**
	 * Pins the DISPLAYED bonus meter to a full bar for the length of a level-up.
	 *
	 * A level-up rewrites `bonusMeterValue` AND `bonusMeterMax` (the next level's bar is taller) and then
	 * drains — all inside one synchronous block. Svelte only flushes the FINAL state, so the "topped to
	 * max" step was never rendered: the ratio the meter received went straight from the part-filled value
	 * to `oldMax / newMax`, and the reward card appeared over a bar that had never visibly completed.
	 * While this is set the meter reads 1 no matter what those two fields do, so the bar can finish its
	 * fill animation, hold, and only then hand over to the new level's empty bar.
	 */
	bonusMeterHoldFull: false,
	/**
	 * A level-up is committed (the bar has filled / the level's balls ran out) but its card has not been
	 * shown yet. Disables the bonus Play button for that whole window, so no further free balls are
	 * dropped while the game finishes the balls already falling and completes the bar on screen.
	 */
	bonusLevelUpPending: false,
	bonusLevelProgress: 0,
	pendingBonusLevelUpCount: 0,
	deferredBonusLevelUpCount: 0,
	bonusRoundActive: false,
	bonusBallsRemaining: 0,
	bonusRoundSettlementInProgress: false,
	rouletteFlowInProgress: false,
	activeRouletteSource: null as 'spin' | 'bonus' | null,
	pendingRouletteSource: null as 'spin' | 'bonus' | null,
	pendingSpinRouletteAfterQueuedBonus: false,
	pendingSpinRouletteAfterBonusLevelDepletion: false,
	bonusRouletteResultAppliedEarly: false,
	/** True while the ENTRY "you won N drops" congratulations screen is on its way down / on screen.
	 * Its closing-door slam lands ~240ms BEFORE the screen fully covers the view — and bonus mode is now
	 * only switched on at full cover — so this is what tells the music swap that this particular slam is
	 * the bonus-entry one (the wheel backdrop's and the bonus-END screen's slams must not swap it). */
	bonusEntryCongratsActive: false,
	/** True while a full-screen congratulations/announcement screen completely hides the game behind it.
	 * Set at full cover and cleared the moment it starts sliding back up. The animated Spine background
	 * drops to a trickle frame rate while this is on (see `SpineBackgroundRenderer.setHiddenByOverlay`) —
	 * it is drawing a free-game scene (rain, two tornadoes, clouds, splashes) that nobody can see, and on
	 * a Retina display that hidden work is what starved the congratulations screen's own particle
	 * animations of GPU budget. */
	overlayCoversGame: false,
	pendingOutcomes: [] as PlinkoBallOutcome[],
	expectedOutcomeByBallId: new Map<number, PlinkoBallOutcome>(),
	/** Balls that already credited bonus meter from a server coin-peg hit this drop. */
	bonusPegMeterCreditedBallIds: new Set<number>(),
	/** Balls that already credited spin meter from a server spin-slot land this drop. */
	spinSlotMeterCreditedBallIds: new Set<number>(),
	pendingDropWinAmount: 0,
	/** stake-per-ball × multiplier sum from scaled playback outcomes (pre-animation). */
	playbackExpectedWinFromOutcomes: 0,
	/** Prevents duplicate win-mismatch console errors per round. */
	winMismatchLoggedThisRound: false,
	/** True when served `plinkoDrop.ballsPerDrop` does not match the UI balls-per-drop tier. */
	plinkoDropStratumMismatch: false,
	/** Base-game drop win snapshotted when a bonus round starts (preserved through bonus play). */
	baseRoundDropWinAmount: 0,
	winAmount: 0,
	bonusSessionWinAmount: 0,
	/** Running sum of in-bonus free-spin credits already logged as their own "Free Spin" history
	 * rows, so the consolidated "Bonus" row records only the bonus-ball portion (no double-count). */
	inBonusFreeSpinCreditTotal: 0,
	/** Set when `bonusRoulette` / `bonusRound` awards balls this wager round. */
	bonusAwardedThisRound: false,
	/** True while an active-round resume is being played back (set in `onResumeGameActive`, cleared
	 * after `playBet`). Lets handlers tell a genuine resume apart from a fresh bet — e.g. a BUY BONUS
	 * resume skips the entry roulette (already shown when the bonus was purchased). */
	resumingActiveRound: false,
	/** Set when the bonus meter is full and the next bet must auto-fire the RGS bonus trigger mode. */
	pendingFeatureTrigger: null as 'spin' | 'bonus' | null,
	/** When true, meter fills and roulettes follow RGS book events / outcome flags only. */
	authoritativeMeterFlow: false,
	/** When true, meter maxima come from config/books — do not tier-scale by balls-per-drop. */
	serverMeterLimitsActive: false,
	/** Session spin meter at the start of the current book (from RGS `plinkoDrop`). */
	betSpinMeterStart: 0,
	/** Session bonus meter / level at the start of the current book (from RGS `plinkoDrop`). */
	betBonusMeterStart: 0,
	betBonusLevelStart: 0,
	/** True when book `spinMeter` values are bet-relative (lookup-table) not session-absolute. */
	spinMeterBookValuesAreBetRelative: false,
	/** True when book `bonusMeter` values are bet-relative (lookup-table) not session-absolute. */
	bonusMeterBookValuesAreBetRelative: false,
	showBonusRoulette: false,
	showFreeSpinRoulette: false,
	freeSpinRouletteOpen: false,
	bonusRouletteOpen: false,
	bonusEndAnnouncementOpen: false,
	bonusEndWinAmount: 0,
	serverBonusFreeBalls: undefined as number | undefined,
	serverFreeSpinSegment: undefined as number | undefined,
	serverFreeSpinSegmentLabel: undefined as string | undefined,
	/** Math-authored free-spin payout for the current wheel (stake currency units). */
	serverFreeSpinWinAmount: undefined as number | undefined,
	/** Stake per ball from the current book's `plinkoDrop` (for scaling feature payouts). */
	lastBookStakePerBall: 1,
	/** Precomputed bonus-round ball outcomes from `bonusRound` book events. */
	authoritativeBonusOutcomes: [] as PlinkoBallOutcome[],
	authoritativeBonusOutcomeIndex: 0,
	/** Pending book-driven bonus level-ups (one entry per `bonusRound` event above the entry level). */
	authoritativeBonusLevelQueue: [] as { freeBalls: number; outcomes: PlinkoBallOutcome[]; level: number; levelupPegs?: number }[],
	bonusLevelUpOverlayOpen: false,
	bonusLevelUpOverlayVisible: false,
	bonusLevelUpLevel: 0,
	bonusLevelUpAddedBalls: 0,
	showWinPopup: false,
	winPopupAmount: 0,
	winPopupMultiplier: 0,
	/** The balance coin's two light layers, lit around coins merging into it so they only show during
	 * the collect, then hide (BalanceCard renders them; CoinFountain drives both — see its LEAD/LINGER
	 * constants). Separate flags because the sparkle brackets the glow: it lights earlier and holds
	 * longer, so the twinkle is already going before the light comes up and outlasts it. */
	balanceGlowActive: false,
	balanceSparkleActive: false,
	/** Multi-ball drop that PAID but below the total bet (so no win modal): bumped so CoinFountain still
	 * throws a small skull→balance coin burst. `minorWinCoinBurstAmount` carries the round win to float. */
	minorWinCoinBurstTick: 0,
	minorWinCoinBurstAmount: 0,
	/** Bumped once the post-bonus treasure screen has slid away, so CoinFountain pours the round's total
	 * out of the skull's mouth into the balance coin. `bonusEndCoinBurstAmount` carries the total to float.
	 * A bonus round shows no win modal (the treasure screen is its presentation — see the `finalWin`
	 * handler), so this collect is the only coins it gets — and it is also what releases `balanceWinHold`
	 * into its count-up. */
	bonusEndCoinBurstTick: 0,
	bonusEndCoinBurstAmount: 0,
	/** Bumped when coins merge into the balance coin to float a "+<win>" text down from it (BalanceCard).
	 * `balanceWinFloatAmount` is the win amount to show. */
	balanceWinFloatTick: 0,
	balanceWinFloatAmount: 0,
	/** Multi-ball win celebration: the DISPLAYED balance is held at the pre-win value (`balanceWinHold`)
	 * while the coins merge and the "+win" float slides from the coin — so it doesn't jump ahead of the
	 * animation. `balanceWinReleaseTick` is then bumped to hand off to a quick count-up
	 * (`balanceCountUpValue` carries the animating value) that ticks the balance up to the credited total.
	 * All three are DISPLAY-ONLY (affordability still gates on the authoritative balance). `null` = show
	 * authoritative. See WinCelebration (sets the hold + release) and Game.svelte (drives the count-up).
	 * A bonus round runs the same two beats through different owners: the hold is pinned by
	 * `onBonusEndAnnouncementCovered` (before the credit lands behind the treasure screen) and released by
	 * CoinFountain's post-bonus collect, on the first coin to reach the balance coin. */
	balanceWinHold: null as number | null,
	balanceWinReleaseTick: 0,
	balanceCountUpValue: null as number | null,
	/** DEV/debug ONLY: overrides `WIN_TIMING.hold` (ms) for the next win celebration, so a console
	 * trigger can park the reveal on screen for as long as it wants before the merge + fade. `null` =
	 * production timing. Set by the `plinkoTest*` helpers in devDebug.ts; cleared when the reveal ends. */
	winCelebrationHoldMs: null as number | null,
	/** 1-ball rapid tier: small win sparkles scattered around the skull + hat (newest first, max 3).
	 * Managed by the gameOrchestrator helpers (`pushRapidWinSparkle` / `clearRapidWinSparkles`); rendered
	 * by RapidWinSparkles.svelte. */
	rapidWinSparkles: [] as RapidWinSparkle[],
	/** Landed free-spin segment multiplier applied to the round win (e.g. 5 for `5X`). */
	freeSpinWinMultiplier: 0,
	/** Base drop win snapshotted when the free-spin wheel opens (before applying segment multiplier). */
	freeSpinBaseRoundWin: 0,
	/** Math/RGS `freeSpinTrigger` payload for the current round (segment + multiplier). */
	freeSpinTriggerPayload: undefined as
		| { segment?: string; multiplier?: number; amount?: number }
		| undefined,
	/** Hold win popup until session-meter free spin finishes (book omits `freeSpinTrigger`). */
	deferWinPopupForFreeSpin: false,
	/** `freeSpinTrigger` payload stashed when it arrives DURING a bonus round — the wheel runs after the
	 * bonus balls finish (in-bonus free spin), driven by `settleBonusRoundWhenFinished`. */
	pendingBonusFreeSpinPayload: undefined as
		| { segment?: string; multiplier?: number; amount?: number }
		| undefined,
	/** Per-level in-bonus free spins queued from the book's `freeSpinTrigger` events. Each fires at the
	 * end of its `level`'s balls, BEFORE that level's level-up (see `settleBonusRoundWhenFinished`).
	 * A book emits one entry per level whose spin meter filled; multiple levels can each carry one. */
	pendingBonusFreeSpins: [] as { level: number; segment?: string; multiplier?: number; amount?: number }[],
	autoMode: false,
	autoPlayStarted: false,
	autoPlayStopping: false,
	autoPlayPausedByFreeSpin: false,
	autoRoundsLeft: 5,
	autoRoundsDisplay: 5,
	pendingSpacedSpawnTimers: 0,
	/** True once the Pixi board has finished async init and can spawn balls. Replay waits on this
	 * before starting playback (it fires on mount with no network delay to cover engine init). */
	plinkoEngineReady: false,
	/** True once the intro splash loader has finished. Replay waits on this so the drop isn't hidden
	 * behind the splash (the loader holds for ~3.4s, longer than engine init takes). */
	introLoaderComplete: false,
	/** True while a book-driven drop round is playing. */
	dropRoundActive: false,
	/** Set when free-spin wheel ran this round (book or session-meter fallback). */
	freeSpinAwardedThisRound: false,
	/** True when `freeSpinTrigger` came from the RGS book (wallet settles with deferred end-round). */
	freeSpinSettledFromBook: false,
	/** When true, `/wallet/end-round` runs after this round's animations (see `checkIsPlinkoDeferredSettlement`). */
	roundDeferredSettlement: false,
	/** Balance (API units) right after `/wallet/play`; used to reconcile `round.payout`. */
	balanceAfterPlayApi: undefined as number | undefined,
	/** Current RGS round book (for deterministic fallback free-spin segment). */
	activeRoundBet: undefined as Bet | undefined,
	/** Book events for the active round (read by feature payout/settlement helpers). */
	activeBookEvents: [] as BookEvent[],
	nextBallSpawnAtMs: 0,
	/** Rapid 1-ball mode: display balance that holds each drop's win back until its ball lands, so the
	 * Win field and Balance both update on ball-land (not at settle). `null` = show authoritative balance. */
	rapidBalanceShadow: null as number | null,
	infoModalOpen: false,
	infoModalTab: 'rules' as InfoModalTab,
	menuOpen: false,
	/** Buy-bonus tier-select modal visibility. */
	buyBonusModalOpen: false,
	/** Full RGS mode of a pending buy-bonus purchase (e.g. `buystandard10`); drives `plinkoActiveBetMode`
	 * for that one bet, then clears when the round settles. `null` during normal play. */
	pendingBuyBonusMode: null as string | null,
	/** True while the browser reports no network connection. Drives the blocking "No Internet
	 * Connection" overlay (NetworkStatus.svelte) and suspends Play / bonus-ball drops — otherwise a
	 * dropped connection is invisible during a bonus round (its balls play from the pre-fetched book,
	 * with no network round-trip) until end-round settlement fails with a generic error. */
	isOffline: false,
	toastMessage: '' as string,
	toastType: 'info' as 'info' | 'error',
	msgBox: null as MsgBoxConfig | null,
	resultVisible: false,
	resultRate: 0,
	resultAmount: 0,
	soundEnabled: true,
	musicEnabled: true,
});

export const meterController = createMeterController(stateGame);

export function isBonusMeterFull(): boolean {
	const max = Number(stateGame.bonusMeterMax);
	const safeMax = Number.isFinite(max) && max > 0 ? max : 20;
	return stateGame.bonusMeterValue >= safeMax;
}

export const stateGameDerived = {
	get simSpeed(): number {
		return stateGame.fastGameEnabled ? SIM_SPEED.fast : SIM_SPEED.normal;
	},
	get minMsBetweenBallSpawns(): number {
		return MIN_MS_BETWEEN_BALL_SPAWNS;
	},
	get spinMeterProgress(): number {
		return meterController.spinMeterProgress();
	},
	get bonusMeterProgress(): number {
		return meterController.bonusMeterProgress();
	},
	get totalBetAmount(): number {
		return plinkoWagerAmount();
	},
	get hasPendingBonusBalls(): boolean {
		return stateGame.bonusBallsRemaining > 0;
	},
	get bonusPendingLevelHighlight(): number {
		if (!stateGame.bonusRoundActive) return 0;
		// Production uses the book-authored level queue; the session-meter fallback uses the deferred/
		// pending counters. A level-up is pending if either has work left.
		const levelUpQueued =
			stateGame.authoritativeBonusLevelQueue.length +
			stateGame.pendingBonusLevelUpCount +
			stateGame.deferredBonusLevelUpCount;
		if (levelUpQueued <= 0) return 0;
		const maxLevels = BONUS_LEVEL_LABELS.length;
		if (stateGame.bonusLevelProgress >= maxLevels) return 0;
		// Only blink once the in-bonus meter has visibly FILLED to max — i.e. the player can see the bar
		// is "ready to level up" and is just waiting for the current level's balls to finish dropping.
		const max = stateGame.bonusMeterMax > 0 ? stateGame.bonusMeterMax : 1;
		if (stateGame.bonusMeterValue < max) return 0;
		return stateGame.bonusLevelProgress + 1;
	},
	/**
	 * Free-game look (FREEGAME backdrop + spine overlays + the bonus game-area frame).
	 *
	 * Tied to `bonusRoundActive` ALONE — deliberately NOT to "meter full" / "a bonus wheel is queued".
	 * Those fire while the base game is still fully visible (the meter fills mid-drop, and
	 * `triggerRoulette` waits for the balls to land before the wheel screen even slides down), so the
	 * whole scene used to swap to the free-game art in front of the player, seconds before the bonus.
	 * `bonusRoundActive` is flipped by `awardBonusBalls` from the congratulations screen's
	 * `onResultReady`, which now fires only once that screen has fully covered the view — so every
	 * bonus-mode UI change lands behind it and the reveal is a single clean cut.
	 */
	get isBonusBackgroundActive(): boolean {
		return stateGame.bonusRoundActive;
	},
	get bonusLevelLabels(): readonly number[] {
		return BONUS_LEVEL_LABELS;
	},
	/**
	 * Whether the Free Spin / Free Bonus meters belong on screen. The plain 1-ball tier is feature-free,
	 * so its (cosmetic) meters stay hidden — EXCEPT while a BOUGHT bonus is running there. A buy is
	 * balls-per-drop-independent and plays on the math's reference tier, so the bonus and its in-bonus
	 * free spin are genuinely live at 1-ball and their bars must show like on any other tier.
	 * `pendingBuyBonusMode` covers the window between activating the buy and `bonusRoundActive` flipping.
	 */
	get areTierMetersVisible(): boolean {
		return (
			stateGame.ballPerDrop !== 1 ||
			stateGame.bonusRoundActive ||
			!!stateGame.pendingBuyBonusMode
		);
	},
};
