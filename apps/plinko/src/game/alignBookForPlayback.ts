import { alignCoefficientSet, resolveOutcomeMultiplier } from '../game-logic/boardMultipliers';
import { isSpinSlotRateIndex } from '../game-logic/spinSlot';
import { plinkoBallsPerDrop, plinkoStakePerBall } from './plinkoBet';
import { resizePlinkoDropOutcomes } from './plinkoDropOutcomes';
import { hasActiveRgsSession } from './plinkoSessionMeters';
import { bookHasFeatureSettlement } from './plinkoRoundSettlement';
import type { Bet, BookEvent, PlinkoBallOutcome } from './typesBookEvent';

type PlinkoDropEvent = Extract<BookEvent, { type: 'plinkoDrop' }>;

function scaleOutcomesForUi(
	source: PlinkoBallOutcome[],
	uiBalls: number,
	coefficients: readonly number[],
	stakePerBall: number,
	bookStake: number,
): PlinkoBallOutcome[] {
	const stakeScale = bookStake > 0 ? stakePerBall / bookStake : 1;
	const slotCount = coefficients.length;
	return resizePlinkoDropOutcomes(source, uiBalls).map((outcome) => {
		const hitSpinSlot =
			outcome.hitSpinSlot ??
			(slotCount > 0 && isSpinSlotRateIndex(outcome.rateIndex, slotCount));
		const normalized = {
			...outcome,
			amount: outcome.amount * stakeScale,
			hitSpinSlot,
			hitBonusPeg: outcome.hitBonusPeg ?? false,
		};
		return {
			...normalized,
			multiplier: hitSpinSlot ? 0 : resolveOutcomeMultiplier(normalized, coefficients),
		};
	});
}

/**
 * Dev / Storybook playback only — resize `plinkoDrop` outcomes for the UI.
 * Never mutates `setTotalWin`, `finalWin`, or `payoutMultiplier`; settlement stays on the served book.
 * Live RGS rounds return the bet unchanged.
 */
export function alignBookForPlayback(bet: Bet): Bet {
	if (hasActiveRgsSession()) return bet;

	const events = Array.isArray(bet.state) ? [...bet.state] : [];
	if (bookHasFeatureSettlement(events)) return bet;

	const dropIndex = events.findIndex((event): event is PlinkoDropEvent => event.type === 'plinkoDrop');
	if (dropIndex < 0) return bet;

	const drop = events[dropIndex];
	const uiBalls = plinkoBallsPerDrop();
	const bookBalls = Math.max(1, drop.ballsPerDrop ?? drop.outcomes?.length ?? 1);
	const stakePerBall = plinkoStakePerBall();
	const bookStake = drop.stakePerBall > 0 ? drop.stakePerBall : 1;
	const coefficients = drop.coefficients?.length
		? alignCoefficientSet(drop.coefficients)
		: [];

	const originalOutcomeCount = drop.outcomes?.length ?? 0;
	const playedOutcomes = scaleOutcomesForUi(
		drop.outcomes ?? [],
		uiBalls,
		coefficients,
		stakePerBall,
		bookStake,
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
