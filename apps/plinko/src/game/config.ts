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
	rtp: 0.957,
	minBet: 0.01,
	maxBet: 2500,
	// FOLDED-BONUS DESIGN: only the 4 BASE modes (cost = ball count). The bonus is FREE and folds into
	// the base book on a rare per-tier quota — there is NO separate bonus mode. Must match the published
	// math config.json (4 modes).
	betModes: {
		// max_win is PER-TIER (mirror of math plinko_data.WINCAP_BY_BALLS): each tier's advertised max
		// win must be achievable in that tier's own books (Stake: max win hits >= 1/20,000,000). The
		// folded bonus's organic ceiling rises with ball count, so the caps ascend 200/250/300/400.
		onedrop: {
			cost: 1.0,
			feature: true,
			buyBonus: false,
			rtp: 0.957,
			max_win: 200.0,
		},
		tendrop: {
			cost: 10.0,
			feature: true,
			buyBonus: false,
			rtp: 0.957,
			max_win: 250.0,
		},
		twentydrop: {
			cost: 20.0,
			feature: true,
			buyBonus: false,
			rtp: 0.957,
			max_win: 300.0,
		},
		fiftydrop: {
			cost: 50.0,
			feature: true,
			buyBonus: false,
			rtp: 0.957,
			max_win: 400.0,
		},
		// BUY BONUS modes — one per tier (bonus-only; cost is ×bet-per-ball, independent of balls-per-drop).
		// cost comes from the rule-set PDF; the math tunes the bonus entry balls so each mode's RTP ≈ 95.7%
		// at that fixed cost. is_feature=false → one-shot. Per-tier max_win = the tier's advertised cap.
		// Must mirror the published math config.json (plinko_data.BUY_BONUS_TIER_DEFS).
		buystandard: { cost: 80.0, feature: false, buyBonus: true, rtp: 0.957, max_win: 300.0 },
		buyenhanced: { cost: 100.0, feature: false, buyBonus: true, rtp: 0.957, max_win: 340.0 },
		buypremium: { cost: 150.0, feature: false, buyBonus: true, rtp: 0.957, max_win: 450.0 },
		buysuperfury: { cost: 250.0, feature: false, buyBonus: true, rtp: 0.957, max_win: 600.0 },
	},
	/** [rowTierIndex 0..12] → slot multipliers (matches stake-math-sdk plinko_data.COEFFICIENT_SETS). */
	coefficientSets: tierTable(DEFAULT_SLOT_MULTIPLIERS) as number[][],
	/** Default meter maxima (overridden by `plinkoDrop.spinMeterMax` / `bonusMeterMax` from math). */
	spinMeterMax: 10,
	bonusMeterMax: 20,
};
