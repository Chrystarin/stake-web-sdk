<script lang="ts">
	import { stateBet } from 'state-shared';

	import { buyBonusPrice, canAffordBuyBonus } from '../game/plinkoBet';
	import { BUY_BONUS_TIERS, type BuyBonusTier } from '../game/plinkoBetMode';
	import { stateGame } from '../game/stateGame.svelte';
	import { staticUrl } from '../lib/staticUrl';

	type Props = {
		/** Disabled while a round/bonus is in progress (can't buy mid-round). */
		disabled?: boolean;
		onActivate: (tier: BuyBonusTier) => void;
	};

	const props: Props = $props();

	const currencySign = $derived(stateBet.currency === 'USD' ? '$' : `${stateBet.currency} `);
	/** Current balls-per-drop — the buy plays this drop, then the bonus, and the price scales with it. */
	const ballPerDrop = $derived(Math.max(1, Math.floor(stateGame.ballPerDrop || 1)));

	function formatMoney(value: number) {
		return `${currencySign}${value.toLocaleString('en-US', {
			minimumFractionDigits: 2,
			maximumFractionDigits: 2,
		})}`;
	}

	function close() {
		stateGame.buyBonusModalOpen = false;
	}

	function activate(tier: BuyBonusTier) {
		if (props.disabled || !canAffordBuyBonus(tier.key, ballPerDrop)) return;
		props.onActivate(tier);
	}
</script>

{#if stateGame.buyBonusModalOpen}
	<div class="bb-backdrop" role="presentation" onclick={close}>
		<div class="bb-modal" role="dialog" aria-label="Buy Plinko Bonus" onclick={(e) => e.stopPropagation()}>
			<button type="button" class="bb-close" aria-label="Close" onclick={close}>
				<img src={staticUrl('img/close_btn.png')} alt="" aria-hidden="true" />
			</button>

			<h2 class="bb-title">Buy Plinko Bonus</h2>

			<div class="bb-cards">
				{#each BUY_BONUS_TIERS as tier}
					{@const price = buyBonusPrice(tier.key, ballPerDrop)}
					{@const affordable = canAffordBuyBonus(tier.key, ballPerDrop)}
					{@const totalBalls = ballPerDrop + tier.freeBalls}
					<div class="bb-card">
						<img class="bb-card-frame" src={staticUrl('img/buy_bonus_panel.png')} alt="" aria-hidden="true" />
						<div class="bb-card-inner">
							<h3 class="bb-card-title">{tier.name}</h3>
							<p class="bb-card-desc">{tier.tagline}</p>
							<img
								class="bb-card-art"
								src={staticUrl(`img/buy_bonus_${tier.key}.png`)}
								alt=""
								aria-hidden="true"
							/>
							<div class="bb-card-total">{totalBalls} Balls</div>
							<div class="bb-card-breakdown">
								({ballPerDrop} Balls + <span class="bb-free">{tier.freeBalls} Free</span>)
							</div>
							<button
								type="button"
								class="bb-activate"
								disabled={props.disabled || !affordable}
								onclick={() => activate(tier)}
							>
								<span class="bb-activate-label">{affordable ? 'Activate' : 'Low balance'}</span>
								<span class="bb-activate-price">{formatMoney(price)}</span>
							</button>
						</div>
					</div>
				{/each}
			</div>
		</div>
	</div>
{/if}

<style>
	.bb-backdrop {
		position: fixed;
		inset: 0;
		z-index: 60;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(0, 0, 0, 0.82);
		padding: 3vh 2vw;
		overflow: auto;
	}

	.bb-modal {
		position: relative;
		width: min(1100px, 96vw);
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 2.2rem;
	}

	.bb-close {
		position: absolute;
		top: -0.5rem;
		right: -0.5rem;
		width: 2.6rem;
		height: 2.6rem;
		border: none;
		background: none;
		cursor: pointer;
		padding: 0;
		z-index: 2;
	}
	.bb-close img {
		width: 100%;
		height: 100%;
		object-fit: contain;
	}

	.bb-title {
		margin: 0;
		font-family: 'PiecesOfEight', serif;
		font-weight: 400;
		font-size: clamp(2rem, 5vw, 3.4rem);
		letter-spacing: 0.02em;
		color: #f6c54a;
		text-shadow:
			0 0 12px rgba(246, 168, 32, 0.65),
			0 2px 2px rgba(0, 0, 0, 0.8);
	}

	.bb-cards {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 1.2rem;
		width: 100%;
	}

	.bb-card {
		position: relative;
		aspect-ratio: 0.74;
		display: flex;
	}

	.bb-card-frame {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: fill;
		pointer-events: none;
		user-select: none;
	}

	.bb-card-inner {
		position: relative;
		z-index: 1;
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		padding: 9% 10% 8%;
		gap: 0.28rem;
	}

	.bb-card-title {
		margin: 0;
		font-family: 'PiecesOfEight', serif;
		font-weight: 400;
		/* px/vw based (NOT rem): the game halves the root font-size on narrow screens, so a rem title
		 * clamps tiny. This keeps the tier title prominent at every width. */
		font-size: clamp(20px, 4.2vw, 34px);
		line-height: 1.05;
		color: #ffffff;
		text-shadow: 0 2px 3px rgba(0, 0, 0, 0.7);
	}

	.bb-card-desc {
		margin: 0;
		font-family: 'PotatoSans', sans-serif;
		/* px/vw based — the game halves the root font-size on narrow screens (see title note). */
		font-size: clamp(8px, 1vw, 10px);
		line-height: 1.22;
		color: #d8d2c4;
		text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8);
	}

	.bb-card-art {
		width: auto;
		max-width: 68%;
		max-height: 36%;
		object-fit: contain;
		margin: 0.1rem auto;
		flex: 0 1 auto;
		min-height: 0;
		filter: drop-shadow(0 3px 6px rgba(0, 0, 0, 0.5));
		user-select: none;
	}

	.bb-card-total {
		font-family: 'PotatoSans', sans-serif;
		/* px/vw based (NOT rem) so it stays prominent on narrow screens (see title note). */
		font-size: clamp(17px, 3vw, 26px);
		color: #ffffff;
		text-shadow: 0 1px 3px rgba(0, 0, 0, 0.85);
	}

	.bb-card-breakdown {
		font-family: 'PotatoSans', sans-serif;
		/* ~half of .bb-card-total (clamp 17/26px → 8.5/13px); px/vw based, not rem. */
		font-size: clamp(8.5px, 1.5vw, 13px);
		color: #d8d2c4;
		text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8);
	}

	.bb-free {
		color: #7be84a;
	}

	.bb-activate {
		width: 100%;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.08em;
		line-height: 1.08;
		border: none;
		cursor: pointer;
		padding: 0.5em 0.4em;
		border-radius: 0.5rem;
		font-family: 'PotatoSans', sans-serif;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: #0c1408;
		background: #8fce3f;
		box-shadow: 0 3px 0 #5f9226, 0 4px 10px rgba(0, 0, 0, 0.5);
		transition:
			transform 0.1s ease,
			filter 0.1s ease;
	}

	/* px/vw based — the game halves the root font-size on narrow screens (see title note). */
	.bb-activate-label {
		font-size: clamp(13px, 1.7vw, 17px);
	}

	.bb-activate-price {
		font-size: clamp(11px, 1.4vw, 14px);
		opacity: 0.92;
	}
	.bb-activate:hover:not(:disabled) {
		filter: brightness(1.08);
		transform: translateY(-1px);
	}
	.bb-activate:active:not(:disabled) {
		transform: translateY(1px);
		box-shadow: 0 1px 0 #5f9226, 0 2px 6px rgba(0, 0, 0, 0.5);
	}
	.bb-activate:disabled {
		cursor: not-allowed;
		filter: grayscale(0.6) brightness(0.7);
	}

	/* Tablet / portrait — 2×2 grid */
	@media (max-width: 760px) {
		.bb-cards {
			grid-template-columns: repeat(2, 1fr);
			gap: 0.9rem;
		}
	}
</style>
