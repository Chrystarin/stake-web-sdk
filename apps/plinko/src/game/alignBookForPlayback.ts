import { stateUrlDerived } from 'state-shared';

import { alignCoefficientSet, resolveOutcomeMultiplier } from '../game-logic/boardMultipliers';
import { isSpinSlotRateIndex, spinPocketActiveForBallsPerDrop } from '../game-logic/spinSlot';
import { plinkoStakePerBall } from './plinkoBet';
import { resizePlinkoDropOutcomes } from './plinkoDropOutcomes';
import { activeMeterTierBalls, hasActiveRgsSession } from './plinkoSessionMeters';
import { bookHasFeatureSettlement } from './plinkoRoundSettlement';
import type { Bet, BookEvent, PlinkoBallOutcome } from './typesBookEvent';

type PlinkoDropEvent = Extract<BookEvent, { type: 'plinkoDrop' }>;

function scaleOutcomesForUi(
	source: PlinkoBallOutcome[],
	uiBalls: number,
	coefficients: readonly number[],
	stakePerBall: number,
	bookStake: number,
	spinPocketActive: boolean,
): PlinkoBallOutcome[] {
	const stakeScale = bookStake > 0 ? stakePerBall / bookStake : 1;
	const slotCount = coefficients.length;
	return resizePlinkoDropOutcomes(source, uiBalls).map((outcome) => {
		// `hitSpinSlot` means "this ball fed the free-spin meter" — never true on a tier without one
		// (1-ball), where the center is an ordinary paying pocket.
		const hitSpinSlot =
			spinPocketActive &&
			(outcome.hitSpinSlot ??
				(slotCount > 0 && isSpinSlotRateIndex(outcome.rateIndex, slotCount)));
		const normalized = {
			...outcome,
			amount: outcome.amount * stakeScale,
			hitSpinSlot,
			hitBonusPeg: outcome.hitBonusPeg ?? false,
		};
		return {
			// The board decides the payout: the shared board's center IS 0, and the 1-ball board pays
			// its center — so no `hitSpinSlot` special case is needed here.
			...normalized,
			multiplier: resolveOutcomeMultiplier(normalized, coefficients),
		};
	});
}

/**
 * Dev / Storybook playback only — resize `plinkoDrop` outcomes for the UI.
 * Never mutates `setTotalWin`, `finalWin`, or `payoutMultiplier`; settlement stays on the served book.
 * Live RGS rounds return the bet unchanged.
 */
export function alignBookForPlayback(bet: Bet): Bet {
	// Replay must reproduce the served book EXACTLY: never resize outcomes or strip meter events.
	// (Replay has an `rgs_url` but no `sessionID`, so `hasActiveRgsSession()` is false here — the UI
	// tier/stake are instead aligned to the book up front in `alignPlinkoUiToReplayBook`.)
	if (hasActiveRgsSession() || stateUrlDerived.replay()) return bet;

	const events = Array.isArray(bet.state) ? [...bet.state] : [];
	if (bookHasFeatureSettlement(events)) return bet;

	const dropIndex = events.findIndex((event): event is PlinkoDropEvent => event.type === 'plinkoDrop');
	if (dropIndex < 0) return bet;

	const drop = events[dropIndex];
	// The tier the ROUND plays, not the selector — a BUY BONUS is generated on the math's reference tier
	// whatever the selector says, so re-tiering a bought book onto the selected tier would move it to the
	// wrong board (the 1-ball table pays its center, the reference table uses it as the 0× spin pocket).
	const uiBalls = activeMeterTierBalls();
	const bookBalls = Math.max(1, drop.ballsPerDrop ?? drop.outcomes?.length ?? 1);
	const stakePerBall = plinkoStakePerBall();
	const bookStake = drop.stakePerBall > 0 ? drop.stakePerBall : 1;
	// Playback re-tiers the book to the UI's balls-per-drop, so the board (and whether the center is the
	// spin pocket) follows `uiBalls`, not the book's original tier.
	const coefficients = drop.coefficients?.length
		? alignCoefficientSet(drop.coefficients, uiBalls)
		: [];

	const originalOutcomeCount = drop.outcomes?.length ?? 0;
	const playedOutcomes = scaleOutcomesForUi(
		drop.outcomes ?? [],
		uiBalls,
		coefficients,
		stakePerBall,
		bookStake,
		spinPocketActiveForBallsPerDrop(uiBalls),
	);

	const downsized = playedOutcomes.length < originalOutcomeCount || bookBalls !== uiBalls;
	const stakeRescaled = bookStake > 0 && Math.abs(stakePerBall - bookStake) > 1e-9;

	if (
		!downsized &&
		!stakeRescaled &&
		playedOutcomes.length === originalOutcomeCount
	) {
		return bet;
	}

	let nextEvents: BookEvent[] = [...events];
	nextEvents[dropIndex] = {
		...drop,
		outcomes: playedOutcomes,
		ballsPerDrop: uiBalls,
		stakePerBall,
		...(coefficients.length ? { coefficients: [...coefficients] } : {}),
	};

	if (downsized) {
		nextEvents = nextEvents.filter(
			(event) => event.type !== 'spinMeter' && event.type !== 'bonusMeter',
		);
	}

	return { ...bet, state: nextEvents };
}

/** @deprecated Use `alignBookForPlayback` — playback-only; never rewrites settlement. */
export const alignBookToUiDrop = alignBookForPlayback;
