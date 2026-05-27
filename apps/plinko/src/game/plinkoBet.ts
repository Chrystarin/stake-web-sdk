import { stateBet } from 'state-shared';

import { stateGame } from './stateGame.svelte';

/** Balls in one paid drop (UI "balls per drop"). */
export function plinkoBallsPerDrop(): number {
	return Math.max(1, Math.floor(stateGame.ballPerDrop || 1));
}

/** Stake per ball — stored in `stateBet.betAmount` (UI "bet per ball"). */
export function plinkoStakePerBall(): number {
	return Math.max(0, Number(stateBet.betAmount) || 0);
}

/** Total wager for one drop: stake per ball × balls per drop. */
export function plinkoWagerAmount(): number {
	return plinkoStakePerBall() * plinkoBallsPerDrop();
}

export function canAffordPlinkoWager(): boolean {
	const wager = plinkoWagerAmount();
	return wager > 0 && wager <= stateBet.balanceAmount;
}
