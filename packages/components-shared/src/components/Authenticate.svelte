<script lang="ts">
	import { onMount, type Snippet } from 'svelte';

	import { requestAuthenticate, requestReplay } from 'rgs-requests';
	import { stateUrlDerived, stateBet, stateConfig, stateModal, stateUi } from 'state-shared';
	import { API_AMOUNT_MULTIPLIER, MOST_USED_BET_INDEXES } from 'constants-shared/bet';

	type Props = { children: Snippet };

	const props: Props = $props();

	let authenticated = $state(false);

	const authenticate = async () => {
		try {
			const authenticateData = await requestAuthenticate({
				rgsUrl: stateUrlDerived.rgsUrl(),
				sessionID: stateUrlDerived.sessionID(),
				language: stateUrlDerived.lang(),
			});

			// error
			if (authenticateData?.error) throw authenticateData;

			// balance
			if (authenticateData?.balance) {
				// Example of authenticateData.balance
				// {
				// 		"amount": 10000000000000000,
				// 		"currency": "USD"
				// },
				stateBet.currency = authenticateData.balance.currency;
				stateBet.balanceAmount = authenticateData.balance.amount / API_AMOUNT_MULTIPLIER;
			}

			// config
			if (authenticateData?.config) {
				// Example of authenticateData.config
				// {
				// 	"gameID": "37_test-lines",
				// 	"minBet": 100000,
				// 	"maxBet": 1000000000,
				// 	"stepBet": 10000,
				// 	"defaultBetLevel": 1000000,
				// 	"betLevels": [100000, 200000, ..., 1000000000],
				// 	"betModes": {},
				// 	"jurisdiction": {
				// 			"socialCasino": false,
				// 			"disabledFullscreen": false,
				// 			"disabledTurbo": false,
				// 			"disabledSuperTurbo": false,
				// 			"disabledAutoplay": false,
				// 			"disabledSlamstop": false,
				// 			"disabledSpacebar": false,
				// 			"disabledBuyFeature": false,
				// 			"displayNetPosition": false,
				// 			"displayRTP": false,
				// 			"displaySessionTimer": false,
				// 			"minimumRoundDuration": 0
				// 	}
				// }
				stateConfig.jurisdiction = authenticateData?.config?.jurisdiction;
				stateConfig.betAmountOptions = (authenticateData.config?.betLevels || []).map(
					(level) => level / API_AMOUNT_MULTIPLIER,
				);
				stateConfig.betMenuOptions = stateConfig.betAmountOptions.filter((_, index) =>
					MOST_USED_BET_INDEXES.includes(index),
				);

				// Bet-sizing params (display units). `betLevels` is the authoritative grid. minBet/maxBet/
				// stepBet aren't in the typed schema, but the RGS may still send them, so read defensively
				// and fall back to values derived from the grid. `stepBet` falls back to the smallest gap
				// between consecutive levels (the finest valid increment); `defaultBetLevel` is the
				// RGS-suggested starting stake.
				const levels = stateConfig.betAmountOptions;
				const rawConfig = authenticateData.config as typeof authenticateData.config & {
					minBet?: number;
					maxBet?: number;
					stepBet?: number;
				};
				const toDisplay = (value?: number) =>
					typeof value === 'number' && value > 0 ? value / API_AMOUNT_MULTIPLIER : undefined;
				const levelGaps = levels
					.slice(1)
					.map((level, index) => level - levels[index])
					.filter((gap) => gap > 0);
				const smallestGap = levelGaps.length ? Math.min(...levelGaps) : undefined;

				stateConfig.minBet = toDisplay(rawConfig.minBet) ?? levels[0] ?? 0;
				stateConfig.maxBet = toDisplay(rawConfig.maxBet) ?? levels.at(-1) ?? 0;
				stateConfig.stepBet =
					toDisplay(rawConfig.stepBet) ?? smallestGap ?? levels[0] ?? 0;
				stateConfig.defaultBetLevel = toDisplay(rawConfig.defaultBetLevel) ?? 0;
				// The modes the RGS actually has books for. `mode` on /wallet/play must be one of
				// these, so a game can check before betting rather than getting a generic server
				// error that gives no hint the published math is stale.
				stateConfig.publishedBetModes = Object.keys(authenticateData.config?.betModes ?? {});
			}

			// round
			if (authenticateData?.round) {
				// Example of authenticateData.round 
				// {
				// 	"betID": 62277967,
				// 	"amount": 1000000,
				// 	"payout": 33400000,
				// 	"payoutMultiplier": 33.4,
				// 	"active": true,
				// 	"state": [...],
				// 	"mode": "BONUS",
				// 	"event": null
				// }

				if (authenticateData.round.active === true || authenticateData.round?.state) {
					// @ts-ignore
					stateBet.betToResume = authenticateData.round;
				}

				if(authenticateData.round?.amount) {
					const betAmountValue =
						authenticateData.round.amount > 0
							? authenticateData.round.amount / API_AMOUNT_MULTIPLIER
							: 0;
					stateBet.betAmount = betAmountValue;
					stateBet.wageredBetAmount = betAmountValue;
				}

				if (authenticateData.round?.mode) {
					stateBet.activeBetModeKey = authenticateData.round.mode;
				};
			}
		} catch (error) {
			console.error(error);
			stateModal.modal = { name: 'error', error };
		}
	};

	const handleReplay = async () => {
		// Replay never authenticates, so the player's currency / balance can only come from the launch
		// URL (live play gets them from `/wallet/authenticate`). Without this, amounts render as default USD.
		const replayCurrency = stateUrlDerived.currency();
		if (replayCurrency) stateBet.currency = replayCurrency as typeof stateBet.currency;
		const replayBalance = stateUrlDerived.balance();
		if (replayBalance > 0) stateBet.balanceAmount = replayBalance / API_AMOUNT_MULTIPLIER;

		stateBet.betAmount = (stateUrlDerived.amount() / API_AMOUNT_MULTIPLIER) || 0;
		stateBet.wageredBetAmount = (stateUrlDerived.amount() / API_AMOUNT_MULTIPLIER) || 0;
		stateBet.activeBetModeKey = stateUrlDerived.mode();

		try {
			const data = await requestReplay({
				rgsUrl: stateUrlDerived.rgsUrl(),
				game: stateUrlDerived.game(),
				mode: stateUrlDerived.mode(),
				version: stateUrlDerived.version(),
				event: stateUrlDerived.event(),
			});

			console.info('[replay] /bet/replay response', {
				game: stateUrlDerived.game(),
				version: stateUrlDerived.version(),
				mode: stateUrlDerived.mode(),
				event: stateUrlDerived.event(),
				keys: data ? Object.keys(data as object) : null,
				stateLength: Array.isArray((data as { state?: unknown[] })?.state)
					? (data as { state?: unknown[] }).state?.length
					: undefined,
				error: (data as { error?: unknown })?.error,
			});

			// A replay payload carries the recorded round under `state`; without it there is nothing to
			// play back (bad params / RGS error), so surface it instead of silently showing a dead board.
			if (!data || (data as { error?: unknown }).error || !(data as { state?: unknown[] }).state) {
				throw data ?? new Error('Empty replay response');
			}

			// @ts-ignore
			stateBet.betToResume = {
				...data,
				event: '0',
				active: true,
				mode: stateUrlDerived.mode(),
			};
		} catch (error) {
			console.error('[replay] failed to load replay', error);
			stateModal.modal = { name: 'error', error };
		}
	};

	onMount(async () => {
		if(stateUrlDerived.replay()) {
			stateUi.config.mode = 'replay';
			await handleReplay();
		} else {
			stateUi.config.mode = 'default';
			await authenticate();
		};

		authenticated = true;
	});
</script>

{#if authenticated}
	{@render props.children()}
{/if}
