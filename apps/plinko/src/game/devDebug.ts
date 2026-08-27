import { stateBet } from 'state-shared';

import {
	WIN_REVEAL_BEFORE_HOLD_MS,
	WIN_TIER_MAX_WIN_FRACTION,
	WIN_TIMING,
	type WinTier,
} from '../lib/winCelebration';
import { SIM_SPEED } from '../game-logic/constants';
import { bonusMeterRenderedProgress } from '../features/bonus/bonusMeterVisual';
import { buildPlinkoPlayPayloadPreview } from './plinkoPlayDebug';
import {
	beginInBonusFreeSpinCoinStream,
	fireBonusEndCoinCollect,
	isBetControlsLocked,
	isDropBatchPending,
	isGameOngoing,
	isInBonusFreeSpinInevitable,
	pushRapidWinSparkle,
	snapshotInBonusSpinBank,
} from './gameOrchestrator';
import { forceUnlockBettingControls } from './meterFlow';
import { plinkoActiveModeMaxWin, plinkoStakePerBall } from './plinkoBet';
import { setRgsSessionSpinMeter } from './plinkoSessionMeters';
import { meterController, plinkoSimSpeed, stateGame } from './stateGame.svelte';

export type PlinkoLockDebugSnapshot = {
	controlsLocked: boolean;
	isSubmitting: boolean;
	dropRoundActive: boolean;
	isAnimating: boolean;
	expectedOutcomes: number;
	pendingSpacedSpawnTimers: number;
	isDropBatchPending: boolean;
	isGameOngoing: boolean;
	bonusBallsRemaining: number;
	// In-bonus level / energy-meter diagnostics (verify the combine-on-meter-full level-up).
	bonusRoundActive: boolean;
	bonusLevelProgress: number;
	bonusMeterValue: number;
	bonusMeterMax: number;
	/** Free-spin meter, alongside the bonus one — both are book-authored maxima (see
	 * `spinMeterMaxForTier` / `bonusMeterMaxForTier`); a max that disagrees with the math is what makes
	 * a bar read full without firing. */
	spinMeterValue: number;
	spinMeterMax: number;
	/** Bar pinned full for a level-up. Stuck true = the meter stops crediting coin-peg hits. */
	bonusMeterHoldFull: boolean;
	bonusLevelUpPending: boolean;
	/** What the meter is actually DRAWING (0..1) — the fill is animated, so it lags value/max. Every
	 *  level-up must land on ~1 here; anything lower means the reward beat the bar to the screen. */
	bonusMeterRenderedFill: number;
	bonusLevelQueueLength: number;
	bonusOutcomesTotal: number;
	bonusOutcomesIndex: number;
	bonusLevelUpOverlayOpen: boolean;
	/** Post-bonus congratulations (treasure total-win) screen. */
	bonusEndAnnouncementOpen: boolean;
	/** True while a congratulations screen fully hides the game — the animated background idles at 6fps
	 * for exactly this window. Stuck true = the background never comes back up to speed. */
	overlayCoversGame: boolean;
	/** Full-screen win celebration — must stay false for a round that played a bonus. */
	showWinPopup: boolean;
	winAmount: number;
	freeSpinRouletteOpen: boolean;
	/** In-bonus free-spin bar pinned full, owed a wheel. Stuck true = the free-ball stream stays blocked. */
	spinMeterHoldFull: boolean;
	/** Centre pockets that landed BEHIND a wheel and are owed back to the bar, plus whether the paced
	 * hand-back is running (`startInBonusSpinBankDrain`). A bank that empties in one frame is what used
	 * to chain two wheels together; one that never empties leaves the bar behind the book. */
	inBonusSpinBanked: number;
	inBonusSpinBankDraining: boolean;
	/** Book free spins queued for this bonus round but not yet opened. */
	pendingBonusFreeSpins: number;
	/** ...of which THIS level can fire. The Play lock is scoped to this, not to the whole queue. */
	freeSpinsFirableAtLevel: number;
	/** The balls already in the air will finish the free-spin bar, so Play is locked ahead of the fill. */
	freeSpinInevitable: boolean;
	bonusRouletteOpen: boolean;
	rouletteFlowInProgress: boolean;
	activeRouletteSource: string | null;
	pendingRouletteSource: string | null;
};

export function snapshotPlinkoLocks(): PlinkoLockDebugSnapshot {
	const inBonusSpinBank = snapshotInBonusSpinBank();
	return {
		controlsLocked: isBetControlsLocked(),
		isSubmitting: stateGame.isSubmitting,
		dropRoundActive: stateGame.dropRoundActive,
		isAnimating: stateGame.isAnimating,
		expectedOutcomes: stateGame.expectedOutcomeByBallId.size,
		pendingSpacedSpawnTimers: stateGame.pendingSpacedSpawnTimers,
		isDropBatchPending: isDropBatchPending(),
		isGameOngoing: isGameOngoing(),
		bonusBallsRemaining: stateGame.bonusBallsRemaining,
		bonusRoundActive: stateGame.bonusRoundActive,
		bonusLevelProgress: stateGame.bonusLevelProgress,
		bonusMeterValue: stateGame.bonusMeterValue,
		bonusMeterMax: stateGame.bonusMeterMax,
		spinMeterValue: stateGame.spinMeterValue,
		spinMeterMax: stateGame.spinMeterMax,
		bonusMeterHoldFull: stateGame.bonusMeterHoldFull,
		bonusLevelUpPending: stateGame.bonusLevelUpPending,
		bonusMeterRenderedFill: Number(bonusMeterRenderedProgress().toFixed(3)),
		bonusLevelQueueLength: stateGame.authoritativeBonusLevelQueue.length,
		bonusOutcomesTotal: stateGame.authoritativeBonusOutcomes.length,
		bonusOutcomesIndex: stateGame.authoritativeBonusOutcomeIndex,
		bonusLevelUpOverlayOpen: stateGame.bonusLevelUpOverlayOpen,
		bonusEndAnnouncementOpen: stateGame.bonusEndAnnouncementOpen,
		overlayCoversGame: stateGame.overlayCoversGame,
		showWinPopup: stateGame.showWinPopup,
		winAmount: stateGame.winAmount,
		freeSpinRouletteOpen: stateGame.freeSpinRouletteOpen,
		spinMeterHoldFull: stateGame.spinMeterHoldFull,
		inBonusSpinBanked: inBonusSpinBank.banked,
		inBonusSpinBankDraining: inBonusSpinBank.draining,
		pendingBonusFreeSpins: stateGame.pendingBonusFreeSpins.length,
		freeSpinsFirableAtLevel: stateGame.pendingBonusFreeSpins.filter(
			(fs) => fs.level <= stateGame.bonusLevelProgress,
		).length,
		freeSpinInevitable: isInBonusFreeSpinInevitable(),
		bonusRouletteOpen: stateGame.bonusRouletteOpen,
		rouletteFlowInProgress: stateGame.rouletteFlowInProgress,
		activeRouletteSource: stateGame.activeRouletteSource,
		pendingRouletteSource: stateGame.pendingRouletteSource,
	};
}

/**
 * Where inside each tier's band the debug trigger aims, as a fraction of the ACTIVE mode's max win
 * (the same ratio `winTierForMultiplier` scores). Mid-band on purpose so a re-tune of
 * `WIN_TIER_MAX_WIN_FRACTION` can't accidentally land a trigger in the neighbouring tier.
 */
const WIN_TIER_DEBUG_FRACTION: Record<WinTier, number> = {
	massive: WIN_TIER_MAX_WIN_FRACTION.epic / 2, // 0.13 — comfortably under the epic floor
	epic: (WIN_TIER_MAX_WIN_FRACTION.epic + WIN_TIER_MAX_WIN_FRACTION.captain) / 2, // 0.51
	captain: (WIN_TIER_MAX_WIN_FRACTION.captain + 1) / 2, // 0.88 — under the mode cap, over the floor
};

/** Fallback per-ball stake for the win amount when no session has seeded a bet amount yet. */
const DEBUG_FALLBACK_STAKE_PER_BALL = 1;

/**
 * Options for the tier triggers. Positional args still work (`(amount, balls, seconds)`); pass an
 * object when you only care about one of them — e.g. `plinkoTestEpicBounty({ seconds: 15 })`.
 */
export type WinCelebrationTestOptions = {
	/** Win amount the counter climbs to. Default: what the trigger multiplier pays at the current bet. */
	amount?: number;
	/** Balls-per-drop tier to show it on (picks the bet mode → its max win). Default 10. */
	balls?: number;
	/**
	 * How long the reveal STAYS ON SCREEN, in seconds, measured from when it appears to when the coins
	 * turn for the balance and it starts fading (the fade + coin merge tail then runs as usual). Default:
	 * production timing (~2.3s). Values below the count-up length are clamped to it.
	 */
	seconds?: number;
};

/** What the console triggers accept: `(amount?, balls?, seconds?)` OR a single options object. */
export type WinCelebrationTestArgs =
	| [options?: WinCelebrationTestOptions]
	| [amount?: number, balls?: number, seconds?: number];

function toWinCelebrationOptions(args: WinCelebrationTestArgs): WinCelebrationTestOptions {
	const [first, balls, seconds] = args as [
		WinCelebrationTestOptions | number | undefined,
		number | undefined,
		number | undefined,
	];
	if (first !== null && typeof first === 'object') return first;
	return { amount: first, balls, seconds };
}

/** Seconds-on-screen → the `WIN_TIMING.hold` override that produces it (null = production timing). */
function holdMsForSeconds(seconds?: number): number | null {
	if (seconds == null || !Number.isFinite(seconds)) return null;
	// The reveal can't start leaving before the number has finished counting, so the hold is the
	// requested screen time MINUS that fixed lead-in, floored at the production hold.
	return Math.max(WIN_TIMING.hold, seconds * 1000 - WIN_REVEAL_BEFORE_HOLD_MS);
}

/**
 * Fire the full-screen win celebration at a CHOSEN tier. The tier is decided inside the component from
 * `winPopupMultiplier ÷ plinkoActiveModeMaxWin()`, so we set `ballPerDrop` FIRST (that picks the mode,
 * hence the max win) and only then derive the multiplier that lands in the requested band.
 */
function showTestWinCelebration(tier: WinTier, opts: WinCelebrationTestOptions = {}): void {
	const { amount, balls = 10, seconds } = opts;
	// The celebration is a multi-ball-tier feature (1-ball rapid mode uses the sparkles instead).
	stateGame.ballPerDrop = balls <= 1 ? 10 : balls;

	const multiplier = plinkoActiveModeMaxWin() * WIN_TIER_DEBUG_FRACTION[tier];
	const stake = plinkoStakePerBall() || DEBUG_FALLBACK_STAKE_PER_BALL;
	const winAmount = amount ?? multiplier * stake * stateGame.ballPerDrop;

	// Consumed (and reset) by the overlay — set BEFORE the gate so it and Game.svelte's dismiss timer
	// both see it. Always assigned, so an un-timed call after a timed one is back to normal timing.
	stateGame.winCelebrationHoldMs = holdMsForSeconds(seconds);
	stateGame.winPopupAmount = winAmount;
	stateGame.winPopupMultiplier = multiplier;
	// Mirror the real finalWin flow: pin the pre-win balance, show the popup, then credit the win a
	// beat later — so the celebration holds the balance and counts it up (rather than it being there
	// from the start).
	stateGame.balanceWinHold = stateBet.balanceAmount;
	stateGame.showWinPopup = true;
	setTimeout(() => {
		stateBet.balanceAmount += winAmount;
	}, 60);
}

/**
 * Bounds on the console speed override. The low end is a sanity rail rather than a taste call — the
 * engine's whole speed model is scaled proportionally (see `slowMotionScale`), so 0.001x really is a
 * thousand times slower than normal, which is minutes per row. Below that a drop stops being
 * observable at all and just looks frozen.
 */
const DEBUG_SPEED_MIN = 0.001;
const DEBUG_SPEED_MAX = 20;

export type PlinkoSpeedDebugSnapshot = {
	/** The override in force, as a multiple of normal play. null = off (the Fast Game toggle decides). */
	debugSpeedMultiplier: number | null;
	fastGameEnabled: boolean;
	/** Engine `animationSpeed` the board is running at right now. */
	simSpeed: number;
	/** ...the same thing as a multiple of normal play, override or not. */
	effectiveMultiplier: number;
};

function plinkoSpeedSnapshot(): PlinkoSpeedDebugSnapshot {
	const simSpeed = plinkoSimSpeed();
	return {
		debugSpeedMultiplier: stateGame.debugSpeedMultiplier,
		fastGameEnabled: stateGame.fastGameEnabled,
		simSpeed: Number(simSpeed.toFixed(4)),
		effectiveMultiplier: Number((simSpeed / SIM_SPEED.normal).toFixed(4)),
	};
}

/**
 * Set (or clear) the ball-speed override. `multiplier` is a multiple of NORMAL play: 1 = normal,
 * 2 = exactly what the Fast Game toggle gives, 0.25 = quarter speed. Omitted / null / 'reset' hands
 * control back to the toggle.
 */
function setPlinkoDebugSpeed(multiplier?: number | null | 'reset'): PlinkoSpeedDebugSnapshot {
	if (multiplier == null || multiplier === 'reset') {
		stateGame.debugSpeedMultiplier = null;
		return plinkoSpeedSnapshot();
	}
	const requested = Number(multiplier);
	if (!Number.isFinite(requested) || requested <= 0) {
		console.warn(
			`[plinko] plinkoSetSpeed: want a positive multiplier (or nothing, to reset) — got ${String(multiplier)}`,
		);
		return plinkoSpeedSnapshot();
	}
	const clamped = Math.min(DEBUG_SPEED_MAX, Math.max(DEBUG_SPEED_MIN, requested));
	if (clamped !== requested) {
		console.warn(
			`[plinko] plinkoSetSpeed: clamped ${requested}x to ${clamped}x (range ${DEBUG_SPEED_MIN}-${DEBUG_SPEED_MAX}).`,
		);
	}
	stateGame.debugSpeedMultiplier = clamped;
	return plinkoSpeedSnapshot();
}

/** Dev-only: expose lock diagnostics on `window.plinkoDebugLocks()` / `window.plinkoForceUnlock()`. */
export function installPlinkoDevDebug() {
	const w = window as Window & {
		plinkoDebugLocks?: () => PlinkoLockDebugSnapshot;
		plinkoPlayMeta?: () => Record<string, unknown>;
		plinkoForceUnlock?: () => PlinkoLockDebugSnapshot;
		plinkoTestWin?: (amount?: number, multiplier?: number, balls?: number) => void;
		plinkoTestWinTier?: (tier: WinTier, ...args: WinCelebrationTestArgs) => void;
		plinkoTestMassivePlunder?: (...args: WinCelebrationTestArgs) => void;
		plinkoTestEpicBounty?: (...args: WinCelebrationTestArgs) => void;
		plinkoTestCaptainsJackpot?: (...args: WinCelebrationTestArgs) => void;
		plinkoTestRapidSparkle?: (amount?: number, multiplier?: number, count?: number) => void;
		plinkoTestBonusEndCollect?: (amount?: number) => void;
		plinkoTestFreeSpinWinCoins?: (multiplier?: number, amount?: number) => void;
		plinkoSetSpinMeter?: (
			value: number,
			max?: number,
		) => { spinMeterValue: number; spinMeterMax: number; spinMeterProgress: number };
		plinkoSetSpeed?: (multiplier?: number | null | 'reset') => PlinkoSpeedDebugSnapshot;
		plinkoSpeed?: () => PlinkoSpeedDebugSnapshot;
	};

	w.plinkoPlayMeta = buildPlinkoPlayPayloadPreview;

	if (!import.meta.env.DEV) return;

	w.plinkoDebugLocks = snapshotPlinkoLocks;
	w.plinkoForceUnlock = () => {
		forceUnlockBettingControls();
		return snapshotPlinkoLocks();
	};

	// Dev-only: fire the full-screen win celebration on demand (multi-ball tiers only) without having
	// to actually win a round. `multiplier` picks the tier by its fraction of the balls-tier max win
	// (Massive ≤25% ≤ Epic ≤75% < Captain) and scales the coin count — e.g. on the default 10-ball tier
	// (max win 250×): `plinkoTestWin(1234.56, 120)` (48%) is Epic Bounty, `plinkoTestWin(9999, 220)` (88%)
	// is Captain's Jackpot.
	w.plinkoTestWin = (amount = 1234.56, multiplier = 120, balls = 10) => {
		stateGame.ballPerDrop = balls <= 1 ? 10 : balls;
		stateGame.winPopupAmount = amount;
		stateGame.winPopupMultiplier = multiplier;
		// Mirror the real finalWin flow: pin the pre-win balance, show the popup, then credit the win a
		// beat later — so the celebration holds the balance and counts it up (rather than it being there
		// from the start).
		stateGame.balanceWinHold = stateBet.balanceAmount;
		stateGame.showWinPopup = true;
		setTimeout(() => {
			stateBet.balanceAmount += amount;
		}, 60);
	};

	// Dev-only: fire a SPECIFIC win-celebration banner without having to work out the multiplier that
	// lands in that tier's band — e.g. `plinkoTestCaptainsJackpot()` for the top banner, or
	// `plinkoTestEpicBounty(5000, 50)` to see it on the 50-ball tier with a chosen win amount. Omit
	// `amount` to get the win the trigger multiplier would really pay at the current bet per ball.
	// A third arg (or `{ seconds }`) parks the reveal on screen that many seconds before it fades —
	// `plinkoTestCaptainsJackpot({ seconds: 20 })` to sit and study the banner art.
	w.plinkoTestWinTier = (tier, ...args) =>
		showTestWinCelebration(tier, toWinCelebrationOptions(args));
	w.plinkoTestMassivePlunder = (...args) =>
		showTestWinCelebration('massive', toWinCelebrationOptions(args));
	w.plinkoTestEpicBounty = (...args) =>
		showTestWinCelebration('epic', toWinCelebrationOptions(args));
	w.plinkoTestCaptainsJackpot = (...args) =>
		showTestWinCelebration('captain', toWinCelebrationOptions(args));

	// Dev-only: pop the small 1-ball rapid win sparkles on demand (switches to 1-ball first) — e.g.
	// `plinkoTestRapidSparkle(12.34, 15, 3)` fires 3 sparkles sized for a 15× win. `multiplier` sizes the
	// burst (1× small / 2× mid / 10× big); `count` (max 3 shown) exercises the cap + random scatter.
	w.plinkoTestRapidSparkle = (amount = 12.34, multiplier = 5, count = 3) => {
		stateGame.ballPerDrop = 1;
		for (let i = 0; i < count; i++) {
			setTimeout(() => pushRapidWinSparkle(amount, multiplier), i * 220);
		}
	};

	// Dev-only: fire the post-bonus coin collect — the stream that pours out of the skull's mouth into the
	// balance coin once the treasure screen has slid away — without having to play a whole bonus round.
	// `plinkoTestBonusEndCollect(250)` throws the collect for a $250 bonus total.
	w.plinkoTestBonusEndCollect = (amount = 250) => {
		stateGame.bonusEndWinAmount = amount;
		// Mirror the real flow: the treasure screen pins the pre-win balance at full cover and the credit
		// lands behind it, so by the time the collect runs the balance is already up and only the DISPLAY
		// is held back — which is what the coins then release into a count-up.
		stateGame.balanceWinHold = stateBet.balanceAmount;
		stateBet.balanceAmount += amount;
		fireBonusEndCoinCollect();
	};

	// Dev-only: fire the in-bonus free-spin coin stream — the coins that pour out of the skull's mouth
	// toward the HUD's Win readout once an in-bonus free-spin wheel has closed (merging into the coin in
	// portrait, fading out short of the plaque in landscape) — without having to fill the spin meter
	// inside a bonus round. `multiplier` is the wheel's landed
	// segment and sets the COIN COUNT (one per multiple won), so `plinkoTestFreeSpinWinCoins(1)` throws a
	// single coin, `(20)` throws twenty and `(0.5)` throws one shrunken coin; `amount` is the credit the
	// Win field floats and counts up by.
	w.plinkoTestFreeSpinWinCoins = (multiplier = 5, amount = 12.34) => {
		stateGame.inBonusFreeSpinCoinBurstMultiplier = multiplier;
		stateGame.inBonusFreeSpinCoinBurstAmount = amount;
		// Mirror the real flow: the credit is already in the Win total when the coins go, and only the
		// DISPLAY is held back — which is what the coins then release into a count-up.
		stateGame.winFieldHold = stateGame.winAmount;
		stateGame.winAmount += amount;
		beginInBonusFreeSpinCoinStream();
		stateGame.inBonusFreeSpinCoinBurstTick++;
	};

	// Dev-only: pin the Free Spin meter (the "Free Spin" wheel + fill bar in GameHud) to an exact
	// value without dropping any balls — e.g. `plinkoSetSpinMeter(7, 10)` for a 70%-full bar, or
	// `plinkoSetSpinMeter(10)` to see it land exactly on the free-spin-wheel trigger. Omit `max` to
	// keep the current tier's max (set by ballsPerDrop) and only move the fill value.
	// Also writes through the RGS session cache (`setRgsSessionSpinMeter`) — display-only writes get
	// silently snapped back to the cached session value on the next balance change (any bet/round
	// activity), the same resurrection bug documented for the bonus meter.
	w.plinkoSetSpinMeter = (value, max) => {
		if (typeof max === 'number') {
			stateGame.spinMeterMax = max;
			stateGame.spinMeterBaseMax = max;
		}
		stateGame.spinMeterValue = Math.max(0, Math.min(value, stateGame.spinMeterMax));
		setRgsSessionSpinMeter(stateGame.spinMeterValue);
		return {
			spinMeterValue: stateGame.spinMeterValue,
			spinMeterMax: stateGame.spinMeterMax,
			spinMeterProgress: meterController.spinMeterProgress(),
		};
	};

	// Dev-only: drive the speed the balls fall at, as a multiple of NORMAL play — `plinkoSetSpeed(0.2)`
	// to crawl through a single bounce, `plinkoSetSpeed(6)` to blow through a deep bonus round. It
	// outranks the Fast Game toggle (which is just the multiplier 2) until cleared with
	// `plinkoSetSpeed()`. Everything paced off ball speed follows it live — the fall itself, the spawn
	// spread inside a multi-ball drop, and the held free-ball stream's cadence — including on balls
	// already in the air. `plinkoSpeed()` reads back what is in force without changing it.
	w.plinkoSetSpeed = setPlinkoDebugSpeed;
	w.plinkoSpeed = plinkoSpeedSnapshot;
}
