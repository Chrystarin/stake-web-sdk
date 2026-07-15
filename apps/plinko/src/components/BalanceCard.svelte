<script lang="ts">
	import { onMount } from 'svelte';
	import { stateBet } from 'state-shared';

	import { stateGame } from '../game/stateGame.svelte';
	import { currencySign as currencySignFor, formatWinAmount } from '../lib/format';
	import { staticUrl } from '../lib/staticUrl';
	import { BalanceCoinGlowRenderer } from '../lib/spine/BalanceCoinGlowRenderer';
	import { i18nDerived } from '../i18n/i18nDerived';

	let glowHostEl: HTMLDivElement;
	let glowRenderer: BalanceCoinGlowRenderer | undefined;

	onMount(() => {
		// Mounted once for the session and left idle — never torn down/recreated on a state change, since
		// churning a WebGL canvas mid-game can flash white for a frame on slower GPUs.
		glowRenderer = new BalanceCoinGlowRenderer(glowHostEl);
		void glowRenderer.init();
		return () => {
			glowRenderer?.destroy();
			glowRenderer = undefined;
		};
	});

	// Run the burst only while win coins are merging into the coin — the same signal that used to fade
	// the old static light PNG (driven per-arrival by CoinFountain).
	$effect(() => {
		glowRenderer?.setActive(stateGame.coinFountainActive);
	});

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

<div class="balance-card-root">
	<div class="balance-card" aria-label="Balance">
		<img
			class="balance-card-frame"
			src={staticUrl('img/betting-component-frame.png')}
			alt=""
			aria-hidden="true"
		/>
		<div class="balance-card-text">
			<span class="balance-card-label">{label}</span>
			<span class="balance-card-value">{formatMoney(displayBalance)}</span>
		</div>
		<div class="balance-card-coin">
			<!-- Spine light burst behind the coin (glow + sparkle). The renderer only animates while
			     coins are merging; this host does the fade, so it keeps working with the ticker stopped. -->
			<div
				class="balance-card-coin-glow"
				class:balance-card-coin-glow--active={stateGame.coinFountainActive}
				bind:this={glowHostEl}
				aria-hidden="true"
			></div>
			<img
				class="balance-card-coin-img coin-fly-target"
				data-coin-fly-target="balance"
				src={staticUrl('img/coin_peg.png')}
				alt=""
				aria-hidden="true"
			/>
		</div>
	</div>

	<!-- "+<win>" that fades in, floats up from the balance coin, and fades out on each coin merge.
	     Keyed on the tick so re-mounting restarts the one-shot animation. -->
	{#if stateGame.balanceWinFloatTick > 0}
		{#key stateGame.balanceWinFloatTick}
			<span class="balance-win-float" aria-hidden="true">
				+{formatWinAmount(stateGame.balanceWinFloatAmount, currencySign)}
			</span>
		{/key}
	{/if}
</div>

<style>
	/* Balance card, sitting on the betting row's baseline just left of the Bet-per-ball field, spaced
	   from it by the same --bp-column-gap that separates every other control in the row.

	   It is a SIBLING of the bottom panel, not a row child: dropping it into `.bottom-panel-row` would
	   shift the centred group right (PLAY must stay on the viewport's centre line) and would break the
	   `> .bp-field:first-child/:last-child` width knobs. So it is placed by calc instead — see `left`.

	   It deliberately borrows the betting fields' chrome instead of having its own: the same
	   `betting-component-frame.png` art and the same label/value typography as `.bp-field-label` /
	   `.bp-select-display` in GameHud.scss (kept in sync by hand — this component is outside that
	   stylesheet). No gold ring, no glow. A gold coin sits at the right over a starburst that only
	   lights up while coins are merging in. */
	/* Positioning wrapper — holds the (clipped) plaque AND the "+win" float, which slides out above the
	   card, so it must NOT clip its overflow. */
	.balance-card-root {
		position: absolute;

		/* Size of the plaque, matched to the betting fields' rendered frame.
		   Width MIRRORS `--bp-field-plaque-width` in GameHud.scss (hand-synced — this component sits
		   outside the bottom-panel subtree, so it can't inherit that var).
		   Height: those fields are `content-box`, so their padding lands OUTSIDE the size they state —
		   --bp-field-height (--bp-item-height 4.5vw × 0.7 = 3.15vw) + 0.35vw each side. `.balance-card`
		   is `border-box`, so it states the total. */
		--balance-card-width: 16.554vw;
		--balance-card-height: calc(3.15vw + 2 * 0.35vw);

		/* Row geometry (GameHud.scss): the bottom panel's row centre sits 3.53vw off the viewport
		   bottom (0.15vw panel pad + 0.5vw chrome pad + half the 5.75vw PLAY button); centring this
		   3.85vw-tall card on that line puts its bottom edge at 1.6vw. */
		bottom: 1.6vw;
		/* One --bp-column-gap (1.1vw) to the left of the Bet-per-ball field. The row centres a fixed
		   group on the viewport, so that field's left edge is deterministic. With w = the shared field
		   width, and the cluster = auto 4.3 + 0.9 + PLAY 11.5 + 0.9 + fast 4.3 = 21.9vw:
		     group    = w + gap 1.1 + cluster 21.9 + gap 1.1 + w = 2w + 24.1vw
		     bet.left = 50vw − group/2       = 50vw − w − 12.05vw
		     left     = bet.left − 1.1vw − w = 36.85vw − 2w
		   Stated in terms of the width var so the two track automatically: the field width feeds the
		   centred group TWICE (both edge fields), so it shifts this card by 2× its own growth — which is
		   easy to get wrong by hand. Only the cluster's own size is baked in here. */
		left: calc(36.85vw - 2 * var(--balance-card-width));
		z-index: 22;
		width: max-content;
	}

	.balance-card {
		position: relative;

		display: flex;
		flex-direction: row;
		align-items: center;
		justify-content: space-between;
		gap: 0.6vw;

		/* Fixed size (no growing/shrinking with the amount) — see the vars on `.balance-card-root`, which
		   `left` is also derived from so the two can never drift apart. */
		width: var(--balance-card-width);
		height: var(--balance-card-height);
		padding: 0.35vw 0.45vw 0.35vw 0.7vw;
		box-sizing: border-box;
		overflow: hidden;
		border-radius: 0.3vw;

		pointer-events: none;
		user-select: none;
	}

	/* Frame art, stretched to the card exactly like `.bp-field-frame` does for the betting fields. */
	.balance-card-frame {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: fill;
		display: block;
		pointer-events: none;
		z-index: 0;
	}

	/* Text sits above the frame + starburst so neither washes over the label/amount. */
	.balance-card-text {
		position: relative;
		z-index: 3;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0;
		min-width: 0;
	}

	/* Mirrors `.bp-field-label`. */
	.balance-card-label {
		font-family: 'Poppins', 'Instrument Sans', sans-serif;
		font-size: clamp(0.82vw, 1vw, 1.3vw);
		font-weight: 600;
		font-synthesis: none;
		color: #a9a1a1;
		text-transform: uppercase;
		letter-spacing: -0.02em;
		/* --bp-label-value-gap */
		margin-bottom: 0.11em;
		line-height: 1;
		white-space: nowrap;
	}

	/* Mirrors `.bp-select-display`. */
	.balance-card-value {
		display: inline-block;
		font-family: 'Poppins', 'Instrument Sans', sans-serif;
		font-size: clamp(0.92vw, 1.12vw, 1.4vw);
		font-weight: 400;
		font-synthesis: none;
		letter-spacing: -0.02em;
		color: #f2f4f6;
		line-height: 1;
		white-space: nowrap;
	}

	/* Coin cluster on the right — the on-win coin burst collects into this coin (fly target). */
	.balance-card-coin {
		position: relative;
		z-index: 2;
		flex-shrink: 0;
		/* Sized to the shorter field height so it clears the frame's top/bottom edges. */
		width: 2.1vw;
		height: 2.1vw;
		display: grid;
		place-items: center;
		/* Breathing room on the coin's right, on top of the card's own 0.45vw padding — the card is
		   `justify-content: space-between`, so without this the coin sits hard against the frame edge. */
		margin-right: 0.4vw;
	}

	/* Light burst behind the coin — the `glow` + `sparkle` spine skeletons in a small Pixi canvas
	   (BalanceCoinGlowRenderer), replacing the old static balance_coin_light.png. Clipped to the plaque
	   by the card's overflow, and sized past the coin so the rays reach out like the old art did.
	   HIDDEN by default — it only fades in WHILE coins are merging into the balance coin (`--active`,
	   driven per-arrival by CoinFountain), then fades back out once arrivals stop. The FADE lives here
	   rather than in the renderer, so it still runs while the renderer's ticker is stopped. */
	.balance-card-coin-glow {
		position: absolute;
		left: 50%;
		top: 50%;
		width: 215%;
		height: 215%;
		transform: translate(-50%, -50%);
		z-index: 0;
		pointer-events: none;
		opacity: 0;
		transition: opacity 0.18s ease;
	}

	.balance-card-coin-glow--active {
		opacity: 1;
	}

	.balance-card-coin-glow :global(canvas) {
		display: block;
		width: 100%;
		height: 100%;
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

	/* "+<win>" that rises out of the balance coin on each merge: fades in, floats UP, fades out. The
	   card now sits on the viewport's bottom edge, so the float travels upward (downward would run it
	   straight off-screen). Lives in `.balance-card-root` (overflow visible) so it isn't clipped as it
	   leaves the plaque. */
	.balance-win-float {
		position: absolute;
		bottom: 46%;
		/* Centre over the coin: it sits ~1.5vw in from the plaque's right edge; `right` + translateX(50%)
		   places the text's centre on that point. */
		right: 1.5vw;
		z-index: 3;
		white-space: nowrap;
		font-family: 'Poppins', 'Instrument Sans', sans-serif;
		font-weight: 700;
		font-size: clamp(12px, 1.25vw, 20px);
		color: #ffffff;
		text-shadow: 0 0.14vw 0.3vw rgba(0, 0, 0, 0.8);
		pointer-events: none;
		opacity: 0;
		transform: translate(50%, 0.2vw);
		animation: balance-win-float-rise 1.35s ease-out forwards;
	}

	@keyframes balance-win-float-rise {
		0% {
			opacity: 0;
			transform: translate(50%, 0.2vw);
		}
		18% {
			opacity: 1;
			transform: translate(50%, -0.9vw);
		}
		68% {
			opacity: 1;
			transform: translate(50%, -2.6vw);
		}
		100% {
			opacity: 0;
			transform: translate(50%, -4vw);
		}
	}
</style>
