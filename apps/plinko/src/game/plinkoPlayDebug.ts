/**
 * Side-effect module: registers `window.plinkoPlayMeta()` as soon as the app loads.
 * Import from `+layout.svelte` so it works in dev and production builds.
 */
import { stateBet } from 'state-shared';

import { buildBetMetaPlayConditions } from './plinkoSessionMeters';
import {
	plinkoBetModeCost,
	plinkoBallsPerDrop,
	plinkoPlayAmount,
	plinkoPlayAmountApiUnits,
	plinkoStakePerBallOptions,
	plinkoWagerAmount,
} from './plinkoBet';

export function buildPlinkoPlayPayloadPreview() {
	return {
		mode: stateBet.activeBetModeKey,
		stakePerBall: stateBet.betAmount,
		ballsPerDrop: plinkoBallsPerDrop(),
		modeCost: plinkoBetModeCost(),
		playAmount: plinkoPlayAmount(),
		playAmountApi: plinkoPlayAmountApiUnits(),
		totalDebit: plinkoWagerAmount(),
		betLevels: plinkoStakePerBallOptions(),
		meta: buildBetMetaPlayConditions(),
	};
}

if (typeof window !== 'undefined') {
	const w = window as Window & { plinkoPlayMeta?: () => ReturnType<typeof buildPlinkoPlayPayloadPreview> };
	w.plinkoPlayMeta = buildPlinkoPlayPayloadPreview;
}
