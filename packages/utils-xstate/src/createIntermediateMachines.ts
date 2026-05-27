import { createIntermediateMachineBet } from './createIntermediateMachineBet';
import { createIntermediateMachineAutoBet } from './createIntermediateMachineAutoBet';
import { createIntermediateMachineResumeBet } from './createIntermediateMachineResumeBet';

import type { PrimaryMachines } from './types';

const createIntermediateMachines = (
	{ resumeGame, newGame, playGame, endGame }: PrimaryMachines,
	options?: { isBetCostAvailable?: () => boolean },
) => {
	const bet = createIntermediateMachineBet({ newGame, playGame, endGame });
	const autoBet = createIntermediateMachineAutoBet({
		bet,
		isBetCostAvailable: options?.isBetCostAvailable,
	});
	const resumeBet = createIntermediateMachineResumeBet({ resumeGame, playGame, endGame });

	return {
		bet,
		autoBet,
		resumeBet,
	};
};

export { createIntermediateMachines };
