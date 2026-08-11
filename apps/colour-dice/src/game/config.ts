import { LAYOUTS, RTP, maxWinForLayout, modeName } from './constants';

// Mirrors games/colour_dice/library/configs/config_fe_colour_dice.json (6 modes).
//
// One mode per backed-colour count: `cost` = colours backed, so the player is charged
// cost x amount, where `amount` is the per-colour stake. `max_win` is likewise a multiple
// of `amount` (math `max_win_for_layout`), matching crimson_plinko's "per stake_per_ball"
// convention — so the cap against the TOTAL wager is max_win / cost.
//
// RTP is identical across every mode: the mean multiplier is k x the single-colour RTP for
// k backed colours, and dividing by cost k returns that same figure. All 6 sit inside
// Stake's 90.00%-96.70% band at one number.
const betModes = Object.fromEntries(
	LAYOUTS.map((layout) => [
		modeName(layout),
		{
			cost: layout.reduce((sum, stake) => sum + stake, 0),
			feature: true,
			buyBonus: false,
			rtp: RTP,
			max_win: maxWinForLayout(layout),
		},
	]),
);

export default {
	providerName: 'sample_provider',
	gameName: 'Colour Dice',
	gameID: 'colour_dice',
	rtp: RTP,
	numReels: 0,
	numRows: [] as number[],
	betModes,
};
