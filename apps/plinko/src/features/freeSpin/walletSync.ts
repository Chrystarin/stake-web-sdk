import { settleFreeSpinWalletCredit, type FreeSpinWalletSettlement } from './wallet';
import { stateGame } from '../../game/stateGame.svelte';

export type PendingFreeSpinWalletCredit = FreeSpinWalletSettlement;

export function queuePendingFreeSpinWalletCredit(credit: PendingFreeSpinWalletCredit): void {
	if (credit.winAmount <= 0) return;
	stateGame.pendingFreeSpinWalletCredit = credit;
}

/**
 * Must run in `playBet` finally BEFORE xstate `endGame` calls `/wallet/end-round`.
 * Otherwise the round closes without the free-spin feature payout.
 */
export async function flushPendingFreeSpinWalletBeforeEndRound(): Promise<void> {
	const pending = stateGame.pendingFreeSpinWalletCredit;
	if (!pending || pending.winAmount <= 0) return;
	await settleFreeSpinWalletCredit(pending);
	stateGame.pendingFreeSpinWalletCredit = undefined;
}
