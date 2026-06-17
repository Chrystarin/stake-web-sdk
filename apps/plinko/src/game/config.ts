import { BOARD_SLOT_MULTIPLIERS } from '../game-logic/boardMultipliers';

/** One row-tier table (15 slots) repeated for row counts 8–20. */
const tierTable = (coefficients: number[]): number[][] =>
	Array.from({ length: 13 }, () => [...coefficients]);

/** Board-display multipliers (0.2× … 100×); books resolve payout via `rateIndex` into this table. */
const DEFAULT_SLOT_MULTIPLIERS = [...BOARD_SLOT_MULTIPLIERS];
export default {
	providerName: 'casino_tv',
	gameName: 'one_eyed_willys_plinko',
	gameID: 'one_eyed_willys_plinko',
	rtp: 0.97,
	minBet: 0.01,
	maxBet: 1000,
	betModes: {
		baseone: {
			cost: 1.0,
			feature: true,
			buyBonus: false,
			rtp: 0.97,
			max_win: 1000.0,
		},
		baseten: {
			cost: 10.0,
			feature: true,
			buyBonus: false,
			rtp: 0.97,
			max_win: 1000.0,
		},
		basetwenty: {
			cost: 20.0,
			feature: true,
			buyBonus: false,
			rtp: 0.97,
			max_win: 1000.0,
		},
		basefifty: {
			cost: 50.0,
			feature: true,
			buyBonus: false,
			rtp: 0.97,
			max_win: 1000.0,
		},
		// Feature-trigger modes (selected when a meter is full). cost 0 = free; must match the
		// published math config.json (run.py `set_trigger_mode_costs_free` / `TRIGGER_MODE_COST`).
		freespinone: { cost: 0.0, feature: true, buyBonus: false, rtp: 0.97, max_win: 1000.0 },
		freespinten: { cost: 0.0, feature: true, buyBonus: false, rtp: 0.97, max_win: 1000.0 },
		freespintwenty: { cost: 0.0, feature: true, buyBonus: false, rtp: 0.97, max_win: 1000.0 },
		freespinfifty: { cost: 0.0, feature: true, buyBonus: false, rtp: 0.97, max_win: 1000.0 },
		bonusone: { cost: 0.0, feature: true, buyBonus: false, rtp: 0.97, max_win: 1000.0 },
		bonusten: { cost: 0.0, feature: true, buyBonus: false, rtp: 0.97, max_win: 1000.0 },
		bonustwenty: { cost: 0.0, feature: true, buyBonus: false, rtp: 0.97, max_win: 1000.0 },
		bonusfifty: { cost: 0.0, feature: true, buyBonus: false, rtp: 0.97, max_win: 1000.0 },
	},
	/** [rowTierIndex 0..12] → slot multipliers (matches stake-math-sdk plinko_data.COEFFICIENT_SETS). */
	coefficientSets: tierTable(DEFAULT_SLOT_MULTIPLIERS) as number[][],
	/** Default meter maxima (overridden by `plinkoDrop.spinMeterMax` / `bonusMeterMax` from math). */
	spinMeterMax: 10,
	bonusMeterMax: 20,
};
