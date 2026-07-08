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
		if (props.disabled || !canAffordBuyBonus(tier.key)) return;
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
					{@const price = buyBonusPrice(tier.key)}
					{@const affordable = canAffordBuyBonus(tier.key)}
					<div class="bb-card">
						<img class="bb-card-frame" src={staticUrl('img/buy_bonus_panel.png')} alt="" aria-hidden="true" />
						<div class="bb-card-inner">
							<h3 class="bb-card-title">{tier.name}</h3>
							<p class="bb-card-desc">{tier.tagline}</p>
							<img
								class="bb-card-art"
								class:bb-card-art--superfury={tier.key === 'superfury'}
								src={staticUrl(`img/buy_bonus_${tier.key}.png`)}
								alt=""
								aria-hidden="true"
							/>
							<div class="bb-card-total"><span class="bb-free">{tier.freeBalls}</span> Free Balls</div>
							<button
								type="button"
								class="bb-activate"
								disabled={props.disabled || !affordable}
								onclick={() => activate(tier)}
							>
								<img
									class="bb-activate-bg"
									src={staticUrl('img/buy_bonus_button.png')}
									alt=""
									aria-hidden="true"
								/>
								<span class="bb-activate-text">
									{#if affordable}Activate <span class="bb-price">{formatMoney(price)}</span>{:else}Low balance{/if}
								</span>
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
		/* Shared depth recipe with .bb-card-desc / .bb-card-total so every line reads with the same
		 * contrast against the textured panel (no per-line brightness/glow mismatch). */
		text-shadow: 0 2px 4px rgba(0, 0, 0, 0.85);
	}

	.bb-card-desc {
		margin: 0;
		/* PotatoSans (the game's display face) in uppercase to match the reference tagline styling. */
		font-family: 'PotatoSans', sans-serif;
		/* px/vw based — the game halves the root font-size on narrow screens (see title note).
		 * Small caps, matching the reference (desktop caps at 10px). */
		font-size: clamp(8.5px, 1.05vw, 10px);
		line-height: 1.3;
		/* Tracked-out caps, matching the reference spacing. */
		letter-spacing: 0.05em;
		text-transform: uppercase;
		/* Near-white cream, matching the reference; double shadow lifts it clear of the textured panel. */
		color: #f4efe4;
		text-shadow:
			0 1px 3px rgba(0, 0, 0, 0.95),
			0 0 3px rgba(0, 0, 0, 0.85);
	}

	.bb-card-art {
		width: auto;
		/* Larger art, matching the reference (the chest is the card's dominant visual). */
		max-width: 86%;
		max-height: 48%;
		object-fit: contain;
		margin: 0.1rem auto;
		flex: 0 1 auto;
		min-height: 0;
		filter: drop-shadow(0 3px 6px rgba(0, 0, 0, 0.5));
		user-select: none;
	}

	/* Super Fury's art reads smaller than the others, so scale it up 35%. transform (not max-width/height)
	 * so it grows purely visually and does NOT reflow this card or affect any other layout. */
	.bb-card-art--superfury {
		transform: scale(1.35);
		transform-origin: center;
	}

	.bb-card-total {
		font-family: 'PotatoSans', sans-serif;
		/* px/vw based (NOT rem) so it stays prominent on narrow screens (see title note). */
		font-size: clamp(16px, 2.7vw, 24px);
		color: #ffffff;
		text-shadow: 0 1px 3px rgba(0, 0, 0, 0.9);
		/* Keep "<n> FREE BALLS" on one line even for the wide 3-digit tiers (matches the reference). */
		white-space: nowrap;
	}

	.bb-free {
		/* Numbers use Poppins Black (900) — the heaviest weight in the project and a clean geometric sans
		 * that reads as a thicker cousin of the PotatoSans "FREE BALLS" label beside it. Already registered
		 * and preloaded (see +layout.svelte / preloadAssets.ts), so no faux-bold and no first-open FOUT. */
		font-family: 'Poppins', sans-serif;
		font-weight: 900;
		/* Gold gradient fill clipped to the glyphs (reference design); the "FREE BALLS" label stays white. */
		background: linear-gradient(180deg, #f5b936 0%, #ebad26 56.7%, #d18a16 81.67%);
		-webkit-background-clip: text;
		background-clip: text;
		-webkit-text-fill-color: transparent;
		color: transparent;
		/* Clear the text-shadow inherited from .bb-card-total (text-shadow is an inherited property) — it
		 * would otherwise paint on top of the gradient too (same overlap bug the filter below fixes). */
		text-shadow: none;
		/* Use filter drop-shadow — NOT text-shadow. With background-clip:text the gradient paints in the
		 * element's background layer (behind), while text-shadow paints in the text layer (in front), so a
		 * text-shadow lands ON TOP of the gradient. drop-shadow composites the shadow behind the rendered
		 * glyphs, matching the reference (shadow behind the number). */
		filter:
			drop-shadow(0px 2.42262px 2.42262px #000000)
			drop-shadow(0.605655px 1.21131px 0px #000000)
			drop-shadow(0px 0px 12px rgba(237, 176, 42, 0.6));
	}

	.bb-activate {
		position: relative;
		width: 100%;
		/* Pin to the bottom of the card; the card-inner bottom padding leaves a small margin below. */
		margin-top: auto;
		/* Match the button image's native ratio (191×44) so the artwork isn't distorted. */
		aspect-ratio: 191 / 44;
		display: flex;
		align-items: center;
		justify-content: center;
		border: none;
		background: none;
		cursor: pointer;
		padding: 0;
		transition:
			transform 0.1s ease,
			filter 0.1s ease;
	}

	.bb-activate-bg {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: fill;
		pointer-events: none;
		user-select: none;
	}

	.bb-activate-text {
		position: relative;
		z-index: 1;
		font-family: 'PotatoSans', sans-serif;
		/* px/vw based — the game halves the root font-size on narrow screens (see title note). */
		font-size: clamp(12px, 1.6vw, 16px);
		letter-spacing: 0.03em;
		text-transform: uppercase;
		/* White with a black outline. -webkit-text-stroke draws the outline where supported; the layered
		 * text-shadow gives a solid black edge everywhere else. */
		color: #ffffff;
		-webkit-text-stroke: 1px #000000;
		paint-order: stroke fill;
		text-shadow:
			1px 1px 0 #000000,
			-1px 1px 0 #000000,
			1px -1px 0 #000000,
			-1px -1px 0 #000000,
			0 2px 2px rgba(0, 0, 0, 0.6);
		white-space: nowrap;
	}

	.bb-price {
		/* Poppins Bold (700) — lighter than the free-ball number's Black (900) so the price doesn't
		 * overpower the small "Activate" label. 700 is a real registered face (no faux-weight).
		 * Keeps the white fill + black outline/shadow inherited from .bb-activate-text for legibility. */
		font-family: 'Poppins', sans-serif;
		font-weight: 700;
	}

	.bb-activate:hover:not(:disabled) {
		filter: brightness(1.06);
		transform: translateY(-1px);
	}
	.bb-activate:active:not(:disabled) {
		transform: translateY(1px);
	}
	.bb-activate:disabled {
		cursor: not-allowed;
		filter: grayscale(0.6) brightness(0.75);
	}

	/* Tablet / portrait — 2×2 grid */
	@media (max-width: 760px) {
		.bb-cards {
			grid-template-columns: repeat(2, 1fr);
			gap: 0.9rem;
		}
	}
</style>
