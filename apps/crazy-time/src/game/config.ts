import { BUY_MODE_NAMES, MODE_NAMES, RTP, maxWinForMode, modeCost } from './constants';

// Mirrors games/crazy_time/library/configs/config_fe_crazy_time.json (255 modes, one per spot
// combination, plus the five buys).
//
// `cost` = spots covered, so the player is charged cost x amount, where `amount` is the chip.
// `max_win` is likewise a multiple of `amount` (math `max_win_for_mode`). Every spot is tuned to
// the same RTP, so every combination certifies at one number.
const betModes = Object.fromEntries([
	...MODE_NAMES.map((mode) => [
		mode,
		{
			cost: modeCost(mode),
			feature: true,
			buyBonus: false,
			rtp: RTP,
			max_win: maxWinForMode(mode),
		},
	]),
	// Buy-bonus modes: one-shot (not sticky), flagged as buys.
	...BUY_MODE_NAMES.map((mode) => [
		mode,
		{
			cost: modeCost(mode),
			feature: false,
			buyBonus: true,
			rtp: RTP,
			max_win: maxWinForMode(mode),
		},
	]),
]);

export default {
	providerName: 'casino_tv',
	// Working title: to be renamed before publish (see README).
	gameName: 'Crazy Time',
	gameID: 'crazy_time',
	rtp: RTP,
	numReels: 0,
	numRows: [] as number[],
	betModes,
};
