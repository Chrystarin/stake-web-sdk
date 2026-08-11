export const stateConfig = $state({
	jurisdiction: {
		socialCasino: false,
		disabledFullscreen: false,
		disabledTurbo: false,
		disabledSuperTurbo: false,
		disabledAutoplay: false,
		disabledSlamstop: false,
		disabledSpacebar: false,
		disabledBuyFeature: false,
		displayNetPosition: false,
		displayRTP: false,
		displaySessionTimer: false,
		minimumRoundDuration: 0,
	},
	betAmountOptions: [1, 5, 25, 50, 75, 100, 200, 500, 800, 1000],
	betMenuOptions: [1, 5, 25, 50, 75, 100, 200, 500, 800, 1000],
	// Bet-sizing params from the /wallet/authenticate `config` (display units — already divided by
	// API_AMOUNT_MULTIPLIER). Populated by Authenticate.svelte. `betLevels` (→ betAmountOptions) is the
	// authoritative grid; minBet/maxBet/stepBet fall back to values derived from it when the RGS omits
	// them, and `defaultBetLevel` is the RGS-suggested starting stake. 0 means "not provided" (local dev).
	minBet: 0,
	maxBet: 0,
	stepBet: 0,
	defaultBetLevel: 0,
	// Bet modes the RGS actually has books published for, from the authenticate `config`. The
	// `mode` sent on /wallet/play must be one of these; anything else fails server-side with a
	// generic error that is otherwise hard to trace back to a stale math publish.
	// Empty means the RGS reported none (local dev, or an older RGS build).
	publishedBetModes: [] as string[],
});
