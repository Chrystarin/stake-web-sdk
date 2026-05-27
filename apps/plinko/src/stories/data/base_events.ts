export default {
	"plinkoDrop": {
		"index": 0,
		"type": "plinkoDrop",
		"difficulty": 0,
		"rowCount": 14,
		"ballsPerDrop": 10,
		"stakePerBall": 1,
		"coefficients": [
			24.99,
			4.44,
			2.22,
			1.53,
			1.39,
			0.69,
			0.42,
			0.69,
			1.39,
			1.53,
			2.22,
			4.44,
			24.99
		],
		"spinMeterMax": 10,
		"bonusMeterMax": 20,
		"outcomes": [
			{
				"rateIndex": 7,
				"multiplier": 0.69,
				"amount": 1,
				"hitBonusPeg": false,
				"hitSpinSlot": false
			},
			{
				"rateIndex": 4,
				"multiplier": 1.39,
				"amount": 1,
				"hitBonusPeg": false,
				"hitSpinSlot": false
			},
			{
				"rateIndex": 6,
				"multiplier": 0,
				"amount": 1,
				"hitBonusPeg": false,
				"hitSpinSlot": true
			},
			{
				"rateIndex": 9,
				"multiplier": 1.53,
				"amount": 1,
				"hitBonusPeg": true,
				"hitSpinSlot": false
			},
			{
				"rateIndex": 5,
				"multiplier": 0.69,
				"amount": 1,
				"hitBonusPeg": false,
				"hitSpinSlot": false
			},
			{
				"rateIndex": 8,
				"multiplier": 1.39,
				"amount": 1,
				"hitBonusPeg": false,
				"hitSpinSlot": false
			},
			{
				"rateIndex": 6,
				"multiplier": 0,
				"amount": 1,
				"hitBonusPeg": false,
				"hitSpinSlot": true
			},
			{
				"rateIndex": 5,
				"multiplier": 0.69,
				"amount": 1,
				"hitBonusPeg": true,
				"hitSpinSlot": false
			},
			{
				"rateIndex": 9,
				"multiplier": 1.53,
				"amount": 1,
				"hitBonusPeg": false,
				"hitSpinSlot": false
			},
			{
				"rateIndex": 4,
				"multiplier": 1.39,
				"amount": 1,
				"hitBonusPeg": false,
				"hitSpinSlot": false
			}
		]
	},
	"spinMeter": {
		"index": 0,
		"type": "spinMeter",
		"value": 1,
		"max": 10
	},
	"bonusMeter": {
		"index": 0,
		"type": "bonusMeter",
		"value": 1,
		"level": 0
	},
	"setTotalWin": {
		"index": 0,
		"type": "setTotalWin",
		"amount": 93
	},
	"finalWin": {
		"index": 0,
		"type": "finalWin",
		"amount": 93
	}
} as const;
