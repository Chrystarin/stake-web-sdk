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
		<span
			class="balance-card-coin-burst"
			class:balance-card-coin-burst--active={stateGame.coinFountainActive}
			aria-hidden="true"
		></span>
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

		/* Fixed width (no growing/shrinking with the amount) + a shorter, tighter plaque. */
		width: clamp(212px, 16.5vw, 286px);
		padding: 0.32vw 0.5vw 0.4vw 1.15vw;
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
		gap: 0.1vw;
	}

	.balance-card-label {
		font-family: 'Poppins', 'Instrument Sans', sans-serif;
		font-weight: 700;
		font-size: clamp(12px, 1.32vw, 22px);
		line-height: 1.05;
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
		font-weight: 700;
		font-size: clamp(18px, 2vw, 32px);
		line-height: 1.1;
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
		width: clamp(34px, 2.95vw, 50px);
		height: clamp(34px, 2.95vw, 50px);
		display: grid;
		place-items: center;
		margin-right: 0.25vw;
	}

	/* Radiating starburst behind the coin: a warm central glow + fine white rays, faded out with a
	   radial mask and clipped to the plaque by the card's overflow. HIDDEN by default — it only fades
	   in + spins while the on-win coin fountain is flying coins in (`--active`), then fades back out. */
	.balance-card-coin-burst {
		position: absolute;
		left: 50%;
		top: 50%;
		width: 260%;
		height: 260%;
		transform: translate(-50%, -50%);
		z-index: 0;
		pointer-events: none;
		opacity: 0;
		transition: opacity 0.35s ease;
		background:
			radial-gradient(
				circle,
				rgba(255, 246, 205, 0.95) 0%,
				rgba(255, 216, 110, 0.45) 20%,
				rgba(255, 216, 110, 0) 46%
			),
			repeating-conic-gradient(
				from 6deg,
				rgba(255, 255, 255, 0.9) 0deg 3deg,
				rgba(255, 255, 255, 0) 3deg 8.5deg
			);
		-webkit-mask: radial-gradient(circle, #000 3%, rgba(0, 0, 0, 0.8) 24%, transparent 52%);
		mask: radial-gradient(circle, #000 3%, rgba(0, 0, 0, 0.8) 24%, transparent 52%);
		animation: balance-coin-burst-spin 9s linear infinite;
		animation-play-state: paused;
	}

	.balance-card-coin-burst--active {
		opacity: 1;
		animation-play-state: running;
	}

	@keyframes balance-coin-burst-spin {
		to {
			transform: translate(-50%, -50%) rotate(360deg);
		}
	}

	.balance-card-coin-img {
		position: relative;
		z-index: 1;
		width: 100%;
		height: 100%;
		object-fit: contain;
		filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.55));
		transform-origin: center;
	}
</style>
