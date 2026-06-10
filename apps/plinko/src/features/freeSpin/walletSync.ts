import { stateGame } from '../../game/stateGame.svelte';

export type PendingFreeSpinWalletCredit = {
	segment: string;
	multiplier: number;
	winAmount: number;
};

/** @deprecated Wallet credits via `/wallet/end-round` book `payoutMultiplier` only. */
export function queuePendingFreeSpinWalletCredit(_credit: PendingFreeSpinWalletCredit): void {
	// No-op — Stake production RGS has no `/bet/action` for this game.
}

/** Clears any stale pending credit before end-round (payout is on the book). */
export async function flushPendingFreeSpinWalletBeforeEndRound(): Promise<void> {
	stateGame.pendingFreeSpinWalletCredit = undefined;
}
