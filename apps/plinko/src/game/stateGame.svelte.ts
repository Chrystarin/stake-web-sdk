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
export type InfoModalTab = 'rules' | 'fair' | 'history' | 'howToPlay';
/** One entry in the 1-ball rapid win-toast stack (newest first, capped to 3). `instant` marks a toast
 * force-dropped by the 3-cap so it's removed WITHOUT the fade (only a natural time-up dismissal fades),
 * which keeps at most 3 visible even when drops bunch up faster than the fade. */
export type RapidWinToast = { id: number; amount: number; instant: boolean };
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
	authoritativeBonusLevelQueue: [] as { freeBalls: number; outcomes: PlinkoBallOutcome[]; level: number }[],
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
	/** 1-ball rapid tier: bumped on each paying land so CoinFountain fires a small (1-3 coin) burst.
	 * `rapidCoinBurstCount` carries how many coins to throw for that land (scaled by its multiplier). */
	rapidCoinBurstTick: 0,
	rapidCoinBurstCount: 1,
	/** Bumped when coins merge into the balance coin to float a "+<win>" text down from it (BalanceCard).
	 * `balanceWinFloatAmount` is the win amount to show. */
	balanceWinFloatTick: 0,
	balanceWinFloatAmount: 0,
	/** Multi-ball win celebration: the DISPLAYED balance is held at the pre-win value (`balanceWinHold`)
	 * while the coins merge and the "+win" float slides from the coin — so it doesn't jump ahead of the
	 * animation. `balanceWinReleaseTick` is then bumped to hand off to a quick count-up
	 * (`balanceCountUpValue` carries the animating value) that ticks the balance up to the credited total.
	 * All three are DISPLAY-ONLY (affordability still gates on the authoritative balance). `null` = show
	 * authoritative. See WinCelebration (sets the hold + release) and Game.svelte (drives the count-up). */
	balanceWinHold: null as number | null,
	balanceWinReleaseTick: 0,
	balanceCountUpValue: null as number | null,
	/** 1-ball rapid tier: stacking win toasts (newest first, max 3). Managed by the gameOrchestrator
	 * toast helpers (`pushRapidWinToast` / `clearRapidWinToasts`); rendered in Game.svelte. */
	rapidWinToasts: [] as RapidWinToast[],
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
	musicEnabled: false,
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
	get isBonusBackgroundActive(): boolean {
		if (stateGame.bonusRoundActive) return true;
		if (isBonusMeterFull()) return true;
		return (
			stateGame.activeRouletteSource === 'bonus' || stateGame.pendingRouletteSource === 'bonus'
		);
	},
	get bonusLevelLabels(): readonly number[] {
		return BONUS_LEVEL_LABELS;
	},
};
