import {
	BALL_PER_DROP_TIERS,
	BONUS_LEVEL_LABELS,
	DEFAULT_ROW_COUNT,
	MIN_MS_BETWEEN_BALL_SPAWNS,
	SIM_SPEED,
} from '../game-logic/constants';
import { createMeterController } from '../game-logic/meterController';
import type { PlinkoBallOutcome } from './typesBookEvent';
import { plinkoWagerAmount } from './plinkoBet';

export type HistoryEntry = { result: number; color: string };
export type InfoModalTab = 'rules' | 'fair' | 'history';
export type MsgBoxConfig = {
	text: string;
	confirmText?: string;
	cancelText?: string;
	onConfirm?: () => void;
	onCancel?: () => void;
};

export const stateGame = $state({
	difficultyLevelId: 0,
	rowCount: DEFAULT_ROW_COUNT,
	ballPerDrop: BALL_PER_DROP_TIERS[0],
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
	winAmount: 0,
	bonusSessionWinAmount: 0,
	/** When true, meter fills and roulettes follow RGS book events / outcome flags only. */
	authoritativeMeterFlow: false,
	/** When true, meter maxima come from config/books — do not tier-scale by balls-per-drop. */
	serverMeterLimitsActive: false,
	/** Session spin meter at the start of the current book (from RGS `plinkoDrop`). */
	betSpinMeterStart: 0,
	/** True when book `spinMeter` values are bet-relative (lookup-table) not session-absolute. */
	spinMeterBookValuesAreBetRelative: false,
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
	bonusLevelUpOverlayOpen: false,
	bonusLevelUpOverlayVisible: false,
	bonusLevelUpLevel: 0,
	bonusLevelUpAddedBalls: 0,
	showWinPopup: false,
	winPopupAmount: 0,
	winPopupMultiplier: 0,
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
		// Show bonus visuals only after the bonus wheel is visibly opened, or once bonus mode is active.
		return stateGame.bonusRouletteOpen || stateGame.bonusRoundActive;
	},
	get bonusLevelLabels(): readonly number[] {
		return BONUS_LEVEL_LABELS;
	},
	coefficientsForDifficulty(difficulty: number, rowCount: number, sets: number[][][]): number[] {
		const rowIndex = Math.max(0, Math.min(rowCount - 8, 12));
		return sets[difficulty]?.[rowIndex] ?? [];
	},
};
