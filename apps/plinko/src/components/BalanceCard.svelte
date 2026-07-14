<script lang="ts">
	import { stateBet } from 'state-shared';

	import { stateGame } from '../game/stateGame.svelte';
	import { currencySign as currencySignFor } from '../lib/format';
	import { staticUrl } from '../lib/staticUrl';
	import { i18nDerived } from '../i18n/i18nDerived';

	const currencySign = $derived(currencySignFor(stateBet.currency));
	// Rapid 1-ball mode holds each drop's win in the balance until its ball lands; show that shadow
	// when present, otherwise the authoritative balance (mirrors the old HUD balance field).
	const displayBalance = $derived(stateGame.rapidBalanceShadow ?? stateBet.balanceAmount);
	const label = $derived(i18nDerived.t('Balance'));

	function formatMoney(value: number) {
		const formatted = value.toLocaleString('en-US', {
			minimumFractionDigits: 2,
			maximumFractionDigits: 2,
		});
		return `${currencySign}${formatted}`;
	}
</script>

<div class="balance-card" aria-label="Balance">
	<div class="balance-card-text">
		<span class="balance-card-label">{label}</span>
		<span class="balance-card-value">{formatMoney(displayBalance)}</span>
	</div>
	<div class="balance-card-coin">
		<img
			class="balance-card-coin-light"
			class:balance-card-coin-light--active={stateGame.coinFountainActive}
			src={staticUrl('img/balance_coin_light.png')}
			alt=""
			aria-hidden="true"
		/>
		<img
			class="balance-card-coin-img coin-fly-target"
			data-coin-fly-target="balance"
			src={staticUrl('img/coin_peg.png')}
			alt=""
			aria-hidden="true"
		/>
	</div>
</div>

<style>
	/* Upper-left balance card — dark plaque with a glossy gold border + warm glow, per the reference
	   art / figma. A gold coin sits at the right over a radiating starburst. Sizes are vw-driven
	   (clamped) so it scales with the responsive desktop layout. `overflow: hidden` clips the burst
	   rays to the rounded plaque, exactly like the reference. */
	.balance-card {
		position: absolute;
		top: 2.2vw;
		left: 1.1vw;
		z-index: 22;

		display: flex;
		flex-direction: row;
		align-items: center;
		justify-content: space-between;
		gap: 0.8vw;

		/* Fixed width (no growing/shrinking with the amount). Symmetric vertical padding sets the
		   plaque height around the coin/text content (raised to make the plaque ~20% taller without
		   changing the label/amount or coin sizes). */
		width: clamp(212px, 16.5vw, 286px);
		padding: 0.39vw 0.5vw 0.39vw 1.15vw;
		box-sizing: border-box;
		overflow: hidden;

		/* Dark fill (padding-box) + gold gradient ring (border-box) — the two-layer trick keeps the
		   gradient constrained to the border while preserving the rounded corners. */
		background:
			linear-gradient(#221a15, #221a15) padding-box,
			linear-gradient(180deg, #fbe596 0%, #f5b936 32%, #e29a1f 62%, #a96c10 100%) border-box;
		border: clamp(3px, 0.28vw, 5px) solid transparent;
		border-radius: clamp(6px, 0.55vw, 10px);

		/* Warm gold glow + drop shadow (figma: drop-shadow 28.5px rgba(237,176,42,.64) + black shadows). */
		box-shadow:
			0 0 2vw rgba(237, 176, 42, 0.55),
			0 0.28vw 0.4vw rgba(0, 0, 0, 0.75),
			0.07vw 0.14vw 0 rgba(0, 0, 0, 0.9);

		pointer-events: none;
		user-select: none;
	}

	/* Text sits above the starburst so the rays never wash over the label/amount. */
	.balance-card-text {
		position: relative;
		z-index: 3;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0;
	}

	.balance-card-label {
		font-family: 'Poppins', 'Instrument Sans', sans-serif;
		font-weight: 500;
		font-synthesis: none;
		/* Font scaled down 25% (12/1.32/22 → 9/0.99/16.5). */
		font-size: clamp(9px, 0.99vw, 16px);
		line-height: 0.95;
		letter-spacing: 0.05em;
		text-transform: uppercase;

		/* Gold gradient text (figma: 180deg #F5B936 → #EBAD26 → #D18A16). */
		background: linear-gradient(180deg, #f5b936 0%, #ebad26 56.7%, #d18a16 81.67%);
		-webkit-background-clip: text;
		background-clip: text;
		-webkit-text-fill-color: transparent;
		color: transparent;
	}

	.balance-card-value {
		display: inline-block;
		font-family: 'Poppins', 'Instrument Sans', sans-serif;
		font-weight: 500;
		font-synthesis: none;
		/* Font scaled down 25% (18/2/32 → 13.5/1.5/24). */
		font-size: clamp(14px, 1.5vw, 24px);
		line-height: 1;
		letter-spacing: 0.04em;
		white-space: nowrap;

		/* Cream-white with a soft light outline + dark shadow, matching the reference amount. */
		color: #f4efe4;
		-webkit-text-stroke: 0.5px rgba(255, 255, 255, 0.45);
		text-shadow: 0 0.14vw 0.28vw rgba(0, 0, 0, 0.65);
	}

	/* Coin cluster on the right — the on-win coin burst collects into this coin (fly target). */
	.balance-card-coin {
		position: relative;
		z-index: 2;
		flex-shrink: 0;
		/* Coin scaled 15% smaller (34/2.95/50 → 29/2.51/42.5). */
		width: clamp(29px, 2.51vw, 42.5px);
		height: clamp(29px, 2.51vw, 42.5px);
		display: grid;
		place-items: center;
		margin-right: 0.25vw;
	}

	/* Light burst behind the coin (balance_coin_light.png), clipped to the plaque by the card's overflow.
	   HIDDEN by default — it only fades in WHILE coins are merging into the balance coin (`--active`,
	   driven per-arrival by CoinFountain), then fades back out once arrivals stop. */
	.balance-card-coin-light {
		position: absolute;
		left: 50%;
		top: 50%;
		width: 215%;
		height: 215%;
		transform: translate(-50%, -50%);
		object-fit: contain;
		z-index: 0;
		pointer-events: none;
		opacity: 0;
		transition: opacity 0.18s ease;
	}

	.balance-card-coin-light--active {
		opacity: 1;
	}

	.balance-card-coin-img {
		position: relative;
		z-index: 1;
		/* The coin artwork sits ~2px/51 above its PNG's centre, so a box-centred coin reads slightly
		   high. Nudge it down ~4% of the coin height to visually centre it in the plaque. */
		top: 4%;
		width: 100%;
		height: 100%;
		object-fit: contain;
		filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.55));
		transform-origin: center;
	}
</style>
