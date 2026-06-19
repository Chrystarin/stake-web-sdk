import {
	BONUS_LEVEL_LABELS,
	DEFAULT_ROW_COUNT,
	MIN_MS_BETWEEN_BALL_SPAWNS,
	SIM_SPEED,
} from '../game-logic/constants';
import { createMeterController } from '../game-logic/meterController';
import type { Bet, BookEvent, PlinkoBallOutcome } from './typesBookEvent';
import { plinkoWagerAmount } from './plinkoBet';

export type HistoryEntry = {
	date: string;
	bet: number;
	multiplier: number;
	win: number;
	color: string;
};
export type InfoModalTab = 'rules' | 'fair' | 'history' | 'howToPlay';
export type MsgBoxConfig = {
	text: string;
	confirmText?: string;
	cancelText?: string;
	onConfirm?: () => void;
	onCancel?: () => void;
};

export const stateGame = $state({
	rowCount: DEFAULT_ROW_COUNT,
	ballPerDrop: 10,
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
	/** Set when `bonusRoulette` / `bonusRound` awards balls this wager round. */
	bonusAwardedThisRound: false,
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
	autoMode: false,
	autoPlayStarted: false,
	autoPlayStopping: false,
	autoPlayPausedByFreeSpin: false,
	autoRoundsLeft: 5,
	autoRoundsDisplay: 5,
	pendingSpacedSpawnTimers: 0,
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
	infoModalOpen: false,
	infoModalTab: 'rules' as InfoModalTab,
	menuOpen: false,
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
		const levelUpQueued =
			stateGame.pendingBonusLevelUpCount + stateGame.deferredBonusLevelUpCount;
		if (levelUpQueued <= 0) return 0;
		const maxLevels = BONUS_LEVEL_LABELS.length;
		if (stateGame.bonusLevelProgress >= maxLevels) return 0;
		const available = Math.max(0, maxLevels - stateGame.bonusLevelProgress);
		return stateGame.bonusLevelProgress + Math.min(available, levelUpQueued);
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
