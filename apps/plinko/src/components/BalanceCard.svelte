<script lang="ts">
	import { onMount } from 'svelte';
	import { stateBet } from 'state-shared';

	import { stateGame } from '../game/stateGame.svelte';
	import { plinkoDisplayBalance } from '../game/plinkoBet';
	import { currencySign as currencySignFor, formatWinAmount } from '../lib/format';
	import { staticUrl } from '../lib/staticUrl';
	import { BalanceCoinGlowRenderer } from '../lib/spine/BalanceCoinGlowRenderer';
	import { i18nDerived } from '../i18n/i18nDerived';

	let glowHostEl: HTMLDivElement;
	let sparkleHostEl: HTMLDivElement;
	let glowRenderer: BalanceCoinGlowRenderer | undefined;

	onMount(() => {
		// Mounted once for the session and left idle — never torn down/recreated on a state change, since
		// churning a WebGL canvas mid-game can flash white for a frame on slower GPUs.
		glowRenderer = new BalanceCoinGlowRenderer({ back: glowHostEl, front: sparkleHostEl });
		void glowRenderer.init();
		return () => {
			glowRenderer?.destroy();
			glowRenderer = undefined;
		};
	});

	// Run each layer only around win coins merging into the coin (driven by CoinFountain). Separate
	// effects, not one: the sparkle brackets the glow, lighting earlier and holding longer, so reading
	// both flags in a single effect would restart whichever layer the OTHER one just toggled.
	$effect(() => {
		glowRenderer?.setActive('back', stateGame.balanceGlowActive);
	});
	$effect(() => {
		glowRenderer?.setActive('front', stateGame.balanceSparkleActive);
	});

	const currencySign = $derived(currencySignFor(stateBet.currency));
	// Held-back / counting-up display balance (rapid shadow, multi-ball win hold, or authoritative) —
	// see plinkoDisplayBalance. NOT for affordability (that uses plinkoSpendableBalance).
	const displayBalance = $derived(plinkoDisplayBalance());
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
			<!-- Spine light burst, straddling the coin: `glow` behind it, `sparkle` over it (one canvas
			     each — see BalanceCoinGlowRenderer). The renderer only animates while coins are merging;
			     these hosts do the fade, so it keeps working with the tickers stopped. -->
			<div
				class="balance-card-coin-burst balance-card-coin-burst--back"
				class:balance-card-coin-burst--active={stateGame.balanceGlowActive}
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
			<div
				class="balance-card-coin-burst balance-card-coin-burst--front"
				class:balance-card-coin-burst--active={stateGame.balanceSparkleActive}
				bind:this={sparkleHostEl}
				aria-hidden="true"
			></div>
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

		/* Size of the plaque.
		   Width MATCHES the betting fields' rendered plaque exactly (--balance-field-width, itself the
		   mirror of GameHud.scss --bp-field-plaque-width) so the left Balance | Win pair is a true mirror
		   of the right Bet per ball | Ball per drop pair — same width both sides. (Historically this was
		   kept 16.554vw, deliberately wider, when the fields shrank; that asymmetry is now removed.)
		   Height DOES still match the fields: they are `content-box`, so their padding lands OUTSIDE the
		   size they state — --bp-field-height (--bp-item-height 4.5vw × 0.7 = 3.15vw) + 0.35vw each side.
		   `.balance-card` is `border-box`, so it states the total. */
		--balance-card-width: var(--balance-field-width);
		/* Mirrors the betting fields' RENDERED height so the Balance plaque matches them. The fields carry
		   a desktop height bump (GameHud.scss `--bp-height-boost` 1.0925 = +15% then −5%): their content
		   height went 3.15 → 3.506125vw, and with the same 2×0.35vw padding the plaque is 3.85 → 4.206125vw.
		   This card is OUTSIDE that stylesheet, so the factor is baked in here by hand — keep in step. */
		--balance-card-height: calc(3.506125vw + 2 * 0.35vw);

		/* ⚠️ The frame art is NOT centred in its own canvas. betting-component-frame.png is 512×124, but
		   the plaque BODY only occupies rows 0..109 — the bottom 14 are a soft shadow tail that fades to
		   alpha 0. The img is stretched to fill this card (`object-fit: fill`, inset 0), so the plaque
		   the player SEES is centred 7/124 = 5.645% of the card height ABOVE the card's box centre, and
		   anything box-centred on the card reads ~4.2px LOW against the frame around it. = 0.217vw.
		   🔑 Measure this off the OPAQUE body, never off "dark" pixels: the bottom bevel (rows 103..109)
		   is lit from above, so it is nearly as dark as the recess and a darkness threshold swallows it
		   — that under-reports the rise as 3.2% and leaves the coin visibly low. Cross-check: the recess
		   alone (rows 6..102) puts it at 6.05%, agreeing to within 0.3px.
		   Derived from the height so it tracks if the plaque is ever resized.
		   ⚠️ The betting fields use this same art, so the same offset applies to them. */
		--balance-frame-art-rise: calc(var(--balance-card-height) * 0.05645);

		/* MIRRORS --bp-field-label-rise in GameHud.scss (hand-synced). The betting fields lift their
		   label/value block off their plaque's centre line; this card's text is still centred, so
		   without the same lift it reads exactly this much lower than theirs — measured at 3.11px on a
		   1920 viewport, which is precisely this 0.162vw. The plaques themselves already line up (same
		   height, same centre line), so this is the whole of the difference.
		   Applied to the TEXT only, not through the padding the way the fields do it: this card's
		   padding also positions the coin, and the coin is meant to stay centred in the plaque. */
		--balance-label-rise: 0.162vw;

		/* The betting fields' rendered width — MIRRORS --bp-field-plaque-width in GameHud.scss
		   (hand-synced; this component is outside the bottom-panel subtree, so it can't inherit it).
		   Not this card's width — it is needed because the centred group that `left` is solved against
		   is built from the FIELD width. Keep in sync with GameHud.scss. */
		--balance-field-width: 16.38846vw;

		/* Gold coin at the right. Sized off the card height rather than its width, matching the
		   reference art, where the coin fills most of the plaque's inner height and clears the frame's
		   bevel by a hair. Base fit was 2.8678vw (2.73125 × 1.05, ~74% of the 3.85vw card, AT the
		   frame-recess ceiling); this is that value scaled to 81% (2.8678 × 0.9 × 0.9), so the coin
		   sits well inside the bevel with plenty of air above and below. Then × the 1.0925 desktop height
		   boost so the coin keeps filling the plaque: 2.322918 × 1.0925 = 2.537788vw. */
		--balance-coin-size: 2.537788vw;

		/* Coin's right edge to the plaque's right edge: the card's own right padding plus the coin's
		   margin (the card is `space-between`, so the coin would otherwise sit hard against the frame).
		   Named because the "+win" float centres on the coin and has to find it. */
		--balance-coin-inset: calc(0.45vw + 0.4vw);

		/* Light burst around the coin. Pinned in vw INSTEAD of being sized off --balance-coin-size: it
		   already sits against two hard edges (see `.balance-card-coin-burst`), so a bigger coin must
		   not drag it out any further. This is the size it had when the coin was 2.1vw — 322.5% of it —
		   which is where that clearance was measured, and the coin growing inside it only tightens the
		   halo, it doesn't move it. */
		--balance-coin-burst-size: 6.7725vw;

		/* Row geometry (GameHud.scss): the panel is scaled 90% from its bottom-centre and lifted 0.95vw
		   off the viewport bottom (see `.game-bottom-panel`); the row centres on its tallest item, the
		   PLAY button. At the current --bp-height-boost (1.0925) the row centre sits 4.714vw above the
		   viewport bottom (measured at 16:9: 56.25vw viewport height − PLAY/row centre 51.536vw). This card
		   is also scaled 90% (see `transform` below), so its visual height is 0.9 × 4.206125 = 3.785vw.
		   Centring 3.785vw on 4.714vw puts its visual bottom edge at 4.714 − 1.8925 = 2.822vw. Since the
		   transform-origin is bottom-centre, the DECLARED `bottom` equals the visual bottom.
		   ⚠️ Re-solved empirically whenever the boost changes PLAY's height (and thus the row); keep in
		   step with --bp-height-boost. */
		bottom: 2.822vw;
		/* Match the panel's 10% shrink from bottom-centre — same scale, same origin metric — so the
		   card and the row read as one visual group. Scaling around the card's own bottom-centre keeps
		   its horizontal centre anchored (declared centre-x is unchanged), and shrinks the box symmetrically
		   on both sides. See the `left` calc below for how its adjacency to the (scaled) panel is preserved. */
		transform: scale(0.9);
		transform-origin: 50% 100%;
		/* Clearance between this card's right edge and the Win-bet field's left edge. Tuned EMPIRICALLY
		   (this term carries a ~0.7vw offset from the `left`-calc scale correction, so it is NOT a pure
		   visual gap) so the measured Balance → Win gap equals the visual gap between the Bet per ball |
		   Ball per drop pair on the right — making the left Balance | Win pair a true mirror of it. That
		   right pair is spaced by GameHud.scss --bp-column-gap (1.1vw declared) at the panel's 0.9 scale
		   = 0.99vw ≈ 14px @1416vw; 1.68vw here lands the Balance → Win gap on that same 14px. */
		--balance-card-gap: 1.68vw;

		/* The row centres a fixed group on the viewport, so the Bet-per-ball field's left edge is
		   deterministic. With f = --balance-field-width, c = --balance-card-width, and the cluster =
		   auto 4.982 + 0.9 + PLAY 6.469 + 0.9 + fast 4.982 = 18.233vw (--bp-side-btn-width in
		   GameHud.scss, itself solved off the plaque height):
		     group    = f + gap 1.1 + cluster 18.233 + gap 1.1 + f = 2f + 20.433vw
		     bet.left = 50vw − group/2        = 50vw − f − 10.217vw
		     left     = bet.left − gap − c    = 39.783vw − gap − f − c
		   ⚠️ f and c are SEPARATE terms. This used to read `2 × width` because the card mirrored the
		   field; they are independent sizes now, and collapsing them back would silently mis-place the
		   card by their difference. Only the ROW's own geometry is baked into the constant.
		   ⚠️ Resizing the Autobet/Fast buttons or PLAY moves this card too — they make up the centred
		   cluster, and this constant absorbs half of any change to its total width.

		   Panel-scale correction (0.9). The formula above places the DECLARED right edge of the card at
		   the DECLARED bet-per-ball left minus the DECLARED gap, but the panel is now visually scaled
		   90% from its bottom-centre, so bet-per-ball's VISUAL left is at 50 − 0.9 × (50 − bet.left).
		   This card is ALSO visually scaled 90% from its own bottom-centre, so its VISUAL right edge =
		   card_centre_x + 0.9 × width/2 (declared centre-x is unchanged). Reworking the invariant
		   "visual right of card is `--balance-card-gap` left of visual bet-per-ball left" and solving
		   for the constant that replaces 39.783 gives 43.275vw (a +3.492vw nudge on the constant only,
		   the same solve as before with 0.9-scaled panel geometry). Everything else in the calc still
		   works — --balance-card-gap, f, c stay in their declared vw's; visual adjacency is what matters. */
		left: calc(
			43.275vw - var(--balance-card-gap) - var(--balance-field-width) -
				var(--balance-card-width)
		);
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
		/* The left inset is deliberately much deeper than the right one (reference art): the label and
		   amount start well clear of the frame's rounded corner, while the coin only needs
		   --balance-coin-inset to clear the bevel on its side. */
		padding: 0.35vw 0.45vw 0.35vw 1.2vw;
		box-sizing: border-box;
		/* Deliberately NOT `overflow: hidden` (and so no border-radius to clip to): the coin sits near
		   the right edge, so a clip to this box cuts the light burst off mid-ray on the right, top and
		   bottom. It is meant to bloom past the plaque. Nothing else here overflows — the frame art and
		   the text are sized inside it. */

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
		/* Lifted to land on the betting fields' label/value line — see --balance-label-rise. `top` on a
		   `relative` box shifts the paint without touching layout, so the coin (a sibling flex item,
		   centred by the card's own padding) stays exactly where it is. */
		top: calc(-1 * var(--balance-label-rise));
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
		/* Raised onto the frame's VISIBLE centre — see --balance-frame-art-rise. Applied to the whole
		   cluster, not the coin img, so the light burst (absolutely positioned in here) rides along and
		   stays centred on the coin. `top` on an already-`relative` box moves paint only, so the flex
		   layout and the card's own padding are untouched. */
		top: calc(-1 * var(--balance-frame-art-rise));
		z-index: 2;
		flex-shrink: 0;
		width: var(--balance-coin-size);
		height: var(--balance-coin-size);
		display: grid;
		place-items: center;
		/* Breathing room on the coin's right, on top of the card's own 0.45vw padding — the card is
		   `justify-content: space-between`, so without this the coin sits hard against the frame edge.
		   The pair of them is --balance-coin-inset; keep the two in step. */
		margin-right: 0.4vw;
	}

	/* Light burst around the coin — the `glow` + `sparkle` spine skeletons (BalanceCoinGlowRenderer),
	   replacing the old static balance_coin_light.png. One Pixi canvas each, straddling the coin img:
	   `glow` behind it (--back, under the coin's z-index 1) and `sparkle` on top (--front). Sized past
	   the coin so the rays reach out like the old art did, and NOT clipped to the plaque — see
	   `.balance-card`. HIDDEN by default — they only fade in WHILE coins are merging into the balance coin
	   (`--active`, driven per-arrival by CoinFountain), then fade back out once arrivals stop. The FADE
	   lives here rather than in the renderer, so it still runs while the tickers are stopped.

	   Both hosts are the SAME box, so the renderer's shared fit scale centres the two on the same point
	   and holds the sizes they were authored at relative to each other. The box holds the EMPHASISED
	   glow (its `emphasis` in balanceCoinGlowAsset.ts is baked into the fit basis), so growing the glow
	   means growing both this box and that multiplier by the same factor — sparkle stays put.

	   Headroom for growing it further is thin on two sides, and both are hard edges rather than the
	   soft plaque overflow above: the box bottom clears the viewport by only ~0.14vw (the card sits
	   1.6vw up and this is centred on the coin), below which the app shell's overflow cuts it; and its
	   right tips stop just inside the 1.1vw gutter before the Bet-per-ball field. */
	.balance-card-coin-burst {
		position: absolute;
		left: 50%;
		top: 50%;
		/* Absolute (--balance-coin-burst-size), not a % of this coin box — the box is at its clipping
		   limit, so the coin has to be free to grow inside it. Still centred on the coin either way. */
		width: var(--balance-coin-burst-size);
		height: var(--balance-coin-burst-size);
		transform: translate(-50%, -50%);
		pointer-events: none;
		opacity: 0;
		transition: opacity 0.18s ease;
	}

	/* Straddle `.balance-card-coin-img` (z-index 1). Both stay inside this cluster's own stacking
	   context (`.balance-card-coin`, z-index 2), so neither can wash over the label/amount at 3. */
	.balance-card-coin-burst--back {
		z-index: 0;
	}

	.balance-card-coin-burst--front {
		z-index: 2;
	}

	.balance-card-coin-burst--active {
		opacity: 1;
	}

	.balance-card-coin-burst :global(canvas) {
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
		/* Centre over the coin: `right` + translateX(50%) puts the text's centre on the coin's centre,
		   which sits --balance-coin-inset + half a coin in from the plaque's right edge. Derived rather
		   than measured so resizing the coin can't leave the float behind. */
		right: calc(var(--balance-coin-inset) + var(--balance-coin-size) / 2);
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
