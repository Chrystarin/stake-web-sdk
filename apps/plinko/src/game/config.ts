/** One row-tier table (13 slots) repeated for row counts 8–20 (crimson `config.set[difficulty][rowCount - 8]`). */
const tierTable = (coefficients: number[]): number[][] =>
	Array.from({ length: 13 }, () => [...coefficients]);

const EASY_14 = [18, 3.2, 1.6, 1.1, 1, 0.5, 0.3, 0.5, 1, 1.1, 1.6, 3.2, 18];
const MEDIUM_14 = [33, 11, 4, 2, 1.1, 0.6, 0.3, 0.6, 1.1, 2, 4, 11, 33];
const HARD_14 = [110, 41, 10, 5, 3, 1.5, 0.5, 1.5, 3, 5, 10, 41, 110];
const EXPERT_14 = [170, 67, 20, 7, 2, 0.2, 0.2, 0.2, 2, 7, 20, 67, 170];

export default {
	providerName: 'crimson',
	gameName: 'crimson_plinko',
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
	/** [difficulty][rowTierIndex 0..12] → slot multipliers (matches stake-math-sdk plinko_data.COEFFICIENT_SETS). */
	defaultCoefficientSets: [
		tierTable(EASY_14),
		tierTable(MEDIUM_14),
		tierTable(HARD_14),
		tierTable(EXPERT_14),
	] as number[][][],
};
