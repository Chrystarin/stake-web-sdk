/** One row-tier table (13 slots) repeated for row counts 8–20. */
const tierTable = (coefficients: number[]): number[][] =>
	Array.from({ length: 13 }, () => [...coefficients]);

/** Calibrated with stake-math-sdk plinko_data (default drop RTP ~97%). */
const DEFAULT_SLOT_MULTIPLIERS = [
	24.99, 4.44, 2.22, 1.53, 1.39, 0.69, 0.42, 0.69, 1.39, 1.53, 2.22, 4.44, 24.99,
];

export default {
	providerName: 'casino_tv',
	gameName: 'Crimson Plinko',
	gameID: 'crimson_plinko',
	rtp: 0.97,
	minBet: 0.01,
	maxBet: 1000,
	betModes: {
		base: {
			cost: 1.0,
			feature: true,
			buyBonus: false,
			rtp: 0.97,
			max_win: 1000.0,
		},
	},
	/** [rowTierIndex 0..12] → slot multipliers (matches stake-math-sdk plinko_data.COEFFICIENT_SETS). */
	coefficientSets: tierTable(DEFAULT_SLOT_MULTIPLIERS) as number[][],
	/** Default meter maxima (overridden by `plinkoDrop.spinMeterMax` / `bonusMeterMax` from math). */
	spinMeterMax: 10,
	bonusMeterMax: 20,
};
