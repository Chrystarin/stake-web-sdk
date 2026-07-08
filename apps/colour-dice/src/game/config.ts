// Mirrors games/colour_dice/library/configs/config_fe_colour_dice.json
export default {
	providerName: 'sample_provider',
	gameName: 'Colour Dice',
	gameID: 'colour_dice',
	rtp: 0.9701,
	numReels: 0,
	numRows: [] as number[],
	betModes: {
		base: {
			cost: 1.0,
			feature: true,
			buyBonus: false,
			rtp: 0.9701,
			max_win: 200.0,
		},
	},
};
