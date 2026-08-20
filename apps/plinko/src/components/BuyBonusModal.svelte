<script lang="ts">
	import { stateBet } from 'state-shared';

	import { getContext } from '../game/context';
	import { buyBonusPrice, canAffordBuyBonus } from '../game/plinkoBet';
	import { BUY_BONUS_TIERS, type BuyBonusTier } from '../game/plinkoBetMode';
	import { stateGame } from '../game/stateGame.svelte';
	import { currencySign as currencySignFor, formatBalanceAmount } from '../lib/format';
	import { staticUrl } from '../lib/staticUrl';
	import BetPerBallField from './BetPerBallField.svelte';

	const context = getContext();

	type Props = {
		/** Disabled while a round/bonus is in progress (can't buy mid-round). */
		disabled?: boolean;
		betAmount: number;
		onBetAmountChange: (value: number) => void;
		onActivate: (tier: BuyBonusTier) => void;
	};

	const props: Props = $props();

	// The bet stepper's presets popup. Local to the modal — the HUD's own click-outside handler only
	// governs the panel down in the betting bar.
	let betPresetsOpen = $state(false);

	const currencySign = $derived(currencySignFor(stateBet.currency));

	function formatMoney(value: number) {
		return `${currencySign}${value.toLocaleString('en-US', {
			minimumFractionDigits: 2,
			maximumFractionDigits: 2,
		})}`;
	}

	/** The BALANCE line only — 2 decimals, expanding to 4 for sub-cent dust. Tier prices keep `formatMoney`. */
	function formatBalance(value: number) {
		return formatBalanceAmount(value, currencySign);
	}

	function close() {
		stateGame.buyBonusModalOpen = false;
		betPresetsOpen = false;
		// Same click SFX as the bet-panel steppers.
		context.eventEmitter.broadcast({ type: 'soundOnce', name: 'clickUIButton' });
	}

	function activate(tier: BuyBonusTier) {
		if (props.disabled || !canAffordBuyBonus(tier.key)) return;
		props.onActivate(tier);
	}

	/**
	 * A click anywhere in the modal that isn't the bet field dismisses its presets popup — the modal's
	 * own stand-in for the HUD's document-level click-outside handler (which only knows about the
	 * betting bar). The stopPropagation keeps the same click off the backdrop, which would close the
	 * whole modal.
	 */
	function onModalClick(event: MouseEvent) {
		event.stopPropagation();
		if (!betPresetsOpen) return;
		const target = event.target as HTMLElement | null;
		if (target?.closest('.bp-bet-presets-wrap')) return;
		betPresetsOpen = false;
	}
</script>

{#if stateGame.buyBonusModalOpen}
	<div class="bb-backdrop" role="presentation" onclick={close}>
		<div class="bb-modal" role="dialog" aria-label="Buy Plinko Bonus" onclick={onModalClick}>
			<button type="button" class="bb-close" aria-label="Close" onclick={close}>
				<img src={staticUrl('img/close_btn.webp')} alt="" aria-hidden="true" />
			</button>

			<h2 class="bb-title">Buy Plinko Bonus</h2>

			<!-- Bet, centred between the title and the tiers. Every tier price is cost × bet-per-ball (see
			     `buyBonusPrice`), so stepping the stake here re-prices all four cards live. It is the
			     betting bar's control (BetPerBallField.svelte) in its `panel` skin — the delivered bet
			     container art with its own wooden − / + buttons. `.bp-field-host` hands it the same plaque
			     metrics the bottom panel uses. -->
			<div class="bb-bet-row bp-field-host">
				<!-- The control is sized in vw against the LANDSCAPE bottom panel, so a straight copy reads
				     tiny in portrait (where the HUD swaps to its own mobile cards instead) and smaller than
				     this screen wants everywhere. Scaling the whole thing keeps every part of it — frame,
				     steppers, type, popup — in proportion, which per-property overrides could not.
				     `.bb-bet-row` reserves the SCALED height, since a transform doesn't affect layout. -->
				<div class="bb-bet-scale">
					<BetPerBallField
						betAmount={props.betAmount}
						onBetAmountChange={props.onBetAmountChange}
						locked={props.disabled}
						bind:presetsOpen={betPresetsOpen}
						presetsBelow
						variant="panel"
						shortLabel
					/>
				</div>
			</div>

			<div class="bb-cards">
				{#each BUY_BONUS_TIERS as tier}
					{@const price = buyBonusPrice(tier.key)}
					{@const affordable = canAffordBuyBonus(tier.key)}
					<div class="bb-card">
						<img
							class="bb-card-frame"
							src={staticUrl('img/buy_bonus_panel.webp')}
							alt=""
							aria-hidden="true"
						/>
						<div class="bb-card-inner">
							<h3 class="bb-card-title">{tier.name}</h3>
							<p class="bb-card-desc">{tier.tagline}</p>
							<img
								class="bb-card-art"
								class:bb-card-art--superfury={tier.key === 'superfury'}
								src={staticUrl(`img/buy_bonus_${tier.key}.webp`)}
								alt=""
								aria-hidden="true"
							/>
							<div class="bb-card-total">
								<span class="bb-free">{tier.freeBalls}</span> Free Balls
							</div>
							<!-- Price on its own line ABOVE the button, not inside its label. Shown on every tier,
							     affordable or not — with the button now permanently labelled "Activate", this line
							     and the balance under the grid are what tell the player why a tier is greyed out. -->
							<div class="bb-price">{formatMoney(price)}</div>
							<button
								type="button"
								class="bb-activate"
								disabled={props.disabled || !affordable}
								onclick={() => activate(tier)}
							>
								<img
									class="bb-activate-bg"
									src={staticUrl('img/buy_bonus_button.webp')}
									alt=""
									aria-hidden="true"
								/>
								<!-- Always reads "Activate": an unaffordable tier is communicated by the button being
								     disabled (greyed via .bb-activate:disabled), not by relabelling it. The reason is
								     right there anyway — the price above it and the balance under the grid. -->
								<span class="bb-activate-text">Activate</span>
							</button>
						</div>
					</div>
				{/each}
			</div>

			<!-- Wallet balance under the tiers. Deliberately `stateBet.balanceAmount` — the very figure
			     `canAffordBuyBonus` tests each price against — so this line can never read as affording a
			     tier the card below has already greyed out as "Low balance". (The HUD's own balance is the
			     held-back/counting-up display value, which lags the authoritative one mid-reveal.) -->
			<p class="bb-balance">Balance: {formatBalance(stateBet.balanceAmount)}</p>
		</div>
	</div>
{/if}

<style>
	/* This is the one modal in the game that is allowed to SCROLL — the four tier cards plus the bet row
	   and balance don't always fit a phone in portrait — and a scrolling overlay has two mobile traps
	   that a merely-centred one doesn't. Both are handled here; see the two notes below.

	   ⚠️ Whatever you change, keep the pair intact: `svh` alone still leaves the top of an overflowing
	   column unreachable, and the `margin: auto` alone still centres inside a box taller than the
	   screen. QA hit both together on Brave for Android (the title scrolled off above the viewport and
	   the close button sat under the toolbar) while Chrome looked fine — Chrome's toolbar auto-hides, so
	   the column happened to fit and neither trap fired. */
	.bb-backdrop {
		position: fixed;
		inset: 0;
		/* (1) A `position: fixed` box is laid out against the LAYOUT viewport, which on Android Chromium
		   is the browser-chrome-HIDDEN height — so with a toolbar on screen (Brave keeps one that Chrome
		   hides on scroll) `inset: 0` describes a box taller than what the player can actually see, and
		   the part of it under the toolbar is simply unreachable. `svh` is the chrome-MAXIMISED height,
		   i.e. the smallest the visible area can ever be, so the overlay fits every chrome state of
		   every browser. Same unit and same reasoning as `.game-root` / `.plinko-app-shell`, which is
		   also why the strip this leaves uncovered when the toolbar does hide is a non-issue: the game
		   root ends there too, and what shows through is the flat dark body colour behind a 93%-black
		   dim. Left after `inset` so a browser without `svh` keeps exactly the old behaviour.
		   `border-box` is required with it — there is no global box-sizing reset in this app, so a
		   content-box height of 100svh plus this padding would overflow the screen by the padding. */
		height: 100svh;
		box-sizing: border-box;
		z-index: 60;
		display: flex;
		/* (2) NOT `align-items: center` — that is the classic centred-scroll-container trap. When the
		   column is taller than the backdrop, centring splits the overflow evenly above and below, and
		   the half above is unscrollable: `scrollTop` cannot go negative, so the title and close button
		   are gone for good. `flex-start` here plus `margin: auto` on `.bb-modal` centres exactly as
		   before while it fits (auto margins split the free space) and falls back to top-aligned the
		   moment it doesn't (auto margins resolve to zero against negative free space), which keeps the
		   top of the column reachable. */
		align-items: flex-start;
		justify-content: center;
		background: rgba(0, 0, 0, 0.93);
		/* The safe-area insets are what hold the close button clear of a notch/cutout or a gesture bar;
		   `viewport-fit=cover` is set in app.html, so without them the overlay draws under both. They
		   add nothing (0px) on a desktop or an iframe, so the tuned landscape budget is untouched — see
		   the portrait override below for the one place that asks for more than 3vh. */
		padding: calc(3vh + env(safe-area-inset-top, 0px)) calc(2vw + env(safe-area-inset-right, 0px))
			calc(3vh + env(safe-area-inset-bottom, 0px)) calc(2vw + env(safe-area-inset-left, 0px));
		overflow: auto;
		/* Keeps a flick inside the modal from chaining to the document once this list hits its end —
		   that chained scroll is what makes a mobile browser re-show its toolbar mid-gesture, resizing
		   the visible area under the player's finger. */
		overscroll-behavior: contain;
	}

	/* Portrait/mobile only: the close button hangs 8ui-px ABOVE the modal box (see `.bb-close`), so the
	   backdrop's own top padding is all that stands between it and the browser's toolbar. 3vh is ample
	   on a tall phone in the abstract, but this states an absolute floor so the button keeps a full
	   finger's clearance rather than a fraction of whatever the viewport happens to be. Portrait only
	   because landscape's vertical budget is spent to ~5px at the 1024×576 reference frame (see the
	   notes on `.bb-bet-row` and `.bb-balance`) and must not be charged for this. */
	@media (max-aspect-ratio: 1/1) {
		.bb-backdrop {
			padding-top: calc(max(3vh, calc(34 * var(--ui-px))) + env(safe-area-inset-top, 0px));
		}
	}

	/* Every absolute length in this modal (px AND rem — rem is just as fixed, the app never rescales the
	   root font-size) is stated in --ui-px, so the tier grid is a uniform scale of its 1024×576 reference
	   self. Left raw, the cards keep their full-size chrome on Stake's 400×225 popout and the four tiers
	   no longer fit the frame. */
	.bb-modal {
		position: relative;
		width: min(calc(1100 * var(--ui-px)), 96vw);
		/* Carries the vertical centring that used to be `align-items: center` on the backdrop — and the
		   reason it moved (the top of an overflowing column being unreachable) is written up there.
		   Horizontally it does nothing the backdrop's `justify-content` wasn't already doing. */
		margin: auto;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: calc(35.2 * var(--ui-px)); /* 2.2rem */
	}

	.bb-close {
		position: absolute;
		top: calc(-8 * var(--ui-px)); /* -0.5rem */
		right: calc(-8 * var(--ui-px));
		width: calc(41.6 * var(--ui-px)); /* 2.6rem */
		height: calc(41.6 * var(--ui-px));
		border: none;
		background: none;
		cursor: pointer;
		padding: 0;
		z-index: 2;
	}
	/* The X art is 41.6ui-px square, which lands under the ~44px a thumb needs and reads as "missed the
	   button" on a phone. This pads the HIT area out to ~58ui-px without touching how big the X draws —
	   growing the button itself would scale the delivered art with it. Cheap insurance rather than the
	   main fix: what actually put this button out of reach on Brave was the backdrop above it. */
	.bb-close::after {
		content: '';
		position: absolute;
		inset: calc(-8 * var(--ui-px));
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
		font-size: clamp(calc(32 * var(--ui-px)), 5vw, calc(54.4 * var(--ui-px))); /* 2rem … 3.4rem */
		letter-spacing: 0.02em;
		color: #f6c54a;
		text-shadow:
			0 0 calc(12 * var(--ui-px)) rgba(246, 168, 32, 0.65),
			0 calc(2 * var(--ui-px)) calc(2 * var(--ui-px)) rgba(0, 0, 0, 0.8);
	}

	/* Bet row between the title and the tier grid. `--bb-bet-scale` is the single knob for how big the
	   shared control renders here (1 = the size it is in the landscape betting bar). */
	.bb-bet-row {
		--bb-bet-scale: 1.2;
		/* Taller than the betting bar's 4.5vw. Feeds --bp-field-height / --bp-field-plaque-height through
		   the `bp-field-metrics` chain, so the row height (and now the WIDTH — see below) follows it.
		   The panel skin's frame spends the top 16% of its canvas on drop shadow plus band, and the same
		   at the bottom, leaving 67% of it for the label/value pair, which centres itself in whatever height
		   it is given: ~67px of cavity for ~37px of text at the reference width, so this is no longer bound
		   by the text the way the old 9-sliced card frame was. What binds it now is the MODAL's vertical budget — the
		   row's rendered height is this × --bb-bet-scale, and the column clears the reference 1024×576
		   frame by only ~5px (see the margin below). Raising it also widens the control, since the two are
		   locked together by the frame ratio.
		   7.5vw (up from the 6vw the old frame used) is what puts the VISIBLE frame back at the ~82px it
		   painted before, since 17.5% of the new art's canvas height is transparent drop shadow — see the
		   margin below, which hands that 17.5% back to the column so the swap costs it only ~2px. */
		--bp-item-height: 7.5vw;
		/* The delivered container is a finished 661×308 bar, not a square frame to be re-cut, so it is
		   drawn as a plain stretched image and the plaque has to carry the art's ratio or the rivets go
		   oval. This overrides the shared 16.38846vw (which would have stretched it 43% wide) and is the
		   ONLY thing that makes --panel-art-px in BetPerBallField.svelte — and with it the stepper
		   placement — a true fraction of the art. Everything downstream (--bp-field-base-width, the
		   gutters) is derived, so this is the single width knob. */
		--bp-field-plaque-width: calc(var(--bp-field-plaque-height) * 661 / 308);
		/* The bar lifts its label/value pair off the field's centre line to suit its own frame art (see
		   --bp-field-label-rise in GameHud.scss). This frame is symmetric top-to-bottom, so the lift just
		   pushes the pair towards the upper band — zero it and the pair centres between the two bands. */
		--bp-field-label-rise: 0px;
		position: relative;
		/* Over the cards below: the presets popup opens downward, across the top of the grid. */
		z-index: 3;
		display: flex;
		align-items: center;
		justify-content: center;
		/* The plaque is painted by a transform, which leaves the layout box unscaled — so state the
		   scaled height here or the modal's gap would be measured against the unscaled plaque. */
		height: calc(var(--bp-field-plaque-height) * var(--bb-bet-scale));
		/* Two things at once.
		   (1) The −12ui-px trims the modal's own `gap` (2.2rem) down to the ~23px that four blocks can
		   afford. The binding case is the REFERENCE 1024×576 frame, not this one: --ui-px is 1px at both
		   1024×576 and 1280×720, so these gaps are the same pixel size in each, while the tier cards scale
		   with vw — 1024×576 is where the column is tightest and the backdrop would start scrolling. It
		   clears that frame by ~5px, so treat this and the balance's margin below as one budget: buy a
		   bigger gap by shortening a block, not by loosening both.
		   (2) The container art bakes its drop shadow into its own canvas — the frame's solid edge starts
		   24 px down a 308 px canvas — so `height` above reserves 7.8% of transparent air at the top and
		   the same at the bottom. Pulling exactly that back means the column spaces the VISIBLE frame
		   rather than the canvas, which is what keeps the taller --bp-item-height affordable. Derived, not
		   a constant: it tracks the row height, so it stays right at every viewport and scale. */
		margin: calc(
				-12 * var(--ui-px) - var(--bp-field-plaque-height) * var(--bb-bet-scale) * 24 / 308
			)
			0;
	}

	.bb-bet-scale {
		display: flex;
		transform: scale(var(--bb-bet-scale));
		transform-origin: center;
	}

	/* Portrait: 1vw is a fraction of what it is in landscape, so the landscape-tuned control would render
	   at ~16px tall with 4px type. 2.6 is the landscape 1.2 carried over times the ~2.1 that portrait's
	   smaller vw costs — it keeps the VALUE at the ~11px the portrait HUD's own bet card uses
	   (`.mobile-top-card-value`), which is the readable floor here and what stops this shrinking further. */
	@media (max-aspect-ratio: 1/1) {
		.bb-bet-row {
			--bb-bet-scale: 2.6;
		}
	}

	/* Plain white readout under the tier grid — no plaque, no gold, so it reads as information rather
	   than as a fifth control. Sized between the card tagline and the free-ball count, and in --ui-px
	   like the rest of this modal so it scales with the frame (see the note on .bb-modal). */
	.bb-balance {
		/* Trims the modal's block gap the same way the bet row above does (same shared budget — see the
		   note there): the full 2.2rem under a 4-row column would push it past the reference frame. */
		margin: calc(-16 * var(--ui-px)) 0 0;
		font-family: 'Poppins', 'Instrument Sans', sans-serif;
		font-weight: 600;
		font-synthesis: none;
		font-size: clamp(calc(18 * var(--ui-px)), 2.1vw, calc(28 * var(--ui-px)));
		letter-spacing: -0.01em;
		color: #ffffff;
		text-shadow: 0 calc(2 * var(--ui-px)) calc(4 * var(--ui-px)) rgba(0, 0, 0, 0.85);
		white-space: nowrap;
	}

	.bb-cards {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: calc(19.2 * var(--ui-px)); /* 1.2rem */
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
		gap: calc(4.48 * var(--ui-px)); /* 0.28rem */
	}

	.bb-card-title {
		margin: 0;
		font-family: 'PiecesOfEight', serif;
		font-weight: 400;
		/* px/vw based (NOT rem): the game halves the root font-size on narrow screens, so a rem title
		 * clamps tiny. This keeps the tier title prominent at every width. */
		font-size: clamp(calc(20 * var(--ui-px)), 4.2vw, calc(34 * var(--ui-px)));
		line-height: 1.05;
		color: #ffffff;
		/* Shared depth recipe with .bb-card-desc / .bb-card-total so every line reads with the same
		 * contrast against the textured panel (no per-line brightness/glow mismatch). */
		text-shadow: 0 calc(2 * var(--ui-px)) calc(4 * var(--ui-px)) rgba(0, 0, 0, 0.85);
	}

	.bb-card-desc {
		margin: 0;
		/* PotatoSans (the game's display face) in uppercase to match the reference tagline styling. */
		font-family: 'PotatoSans', sans-serif;
		/* px/vw based — the game halves the root font-size on narrow screens (see title note).
		 * Small caps, matching the reference (desktop caps at 10px). */
		font-size: clamp(calc(8.5 * var(--ui-px)), 1.05vw, calc(10 * var(--ui-px)));
		line-height: 1.3;
		/* Tracked-out caps, matching the reference spacing. */
		letter-spacing: 0.05em;
		text-transform: uppercase;
		/* Near-white cream, matching the reference; double shadow lifts it clear of the textured panel. */
		color: #f4efe4;
		text-shadow:
			0 var(--ui-px) calc(3 * var(--ui-px)) rgba(0, 0, 0, 0.95),
			0 0 calc(3 * var(--ui-px)) rgba(0, 0, 0, 0.85);
	}

	.bb-card-art {
		width: auto;
		/* Larger art, matching the reference (the chest is the card's dominant visual). */
		max-width: 86%;
		max-height: 48%;
		object-fit: contain;
		margin: calc(1.6 * var(--ui-px)) auto; /* 0.1rem */
		flex: 0 1 auto;
		min-height: 0;
		filter: drop-shadow(0 calc(3 * var(--ui-px)) calc(6 * var(--ui-px)) rgba(0, 0, 0, 0.5));
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
		font-size: clamp(calc(16 * var(--ui-px)), 2.7vw, calc(24 * var(--ui-px)));
		color: #ffffff;
		text-shadow: 0 var(--ui-px) calc(3 * var(--ui-px)) rgba(0, 0, 0, 0.9);
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
		filter: drop-shadow(0 calc(2.42262 * var(--ui-px)) calc(2.42262 * var(--ui-px)) #000000)
			drop-shadow(calc(0.605655 * var(--ui-px)) calc(1.21131 * var(--ui-px)) 0 #000000)
			drop-shadow(0 0 calc(12 * var(--ui-px)) rgba(237, 176, 42, 0.6));
	}

	.bb-activate {
		position: relative;
		width: 100%;
		/* The bottom of the card is now pinned by the PRICE line above (it carries the `margin-top: auto`
		   that used to live here); this button just follows it, with the card-inner bottom padding
		   leaving a small margin below. */
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
		font-size: clamp(calc(12 * var(--ui-px)), 1.6vw, calc(16 * var(--ui-px)));
		letter-spacing: 0.03em;
		text-transform: uppercase;
		/* White with a black outline. -webkit-text-stroke draws the outline where supported; the layered
		 * text-shadow gives a solid black edge everywhere else. */
		color: #ffffff;
		-webkit-text-stroke: var(--ui-px) #000000;
		paint-order: stroke fill;
		text-shadow:
			var(--ui-px) var(--ui-px) 0 #000000,
			calc(-1 * var(--ui-px)) var(--ui-px) 0 #000000,
			var(--ui-px) calc(-1 * var(--ui-px)) 0 #000000,
			calc(-1 * var(--ui-px)) calc(-1 * var(--ui-px)) 0 #000000,
			0 calc(2 * var(--ui-px)) calc(2 * var(--ui-px)) rgba(0, 0, 0, 0.6);
		white-space: nowrap;
	}

	/* Price line, sitting directly on top of the Activate button. It no longer inherits the button
	 * label's colour and outline (it used to live inside .bb-activate-text), so it restates the white
	 * fill + black edge that keeps small text legible over the textured panel.
	 * `margin-top: auto` moved down here with it: the price is now the first of the two bottom-pinned
	 * rows, so it — not the button — is what takes up the card's free space. */
	.bb-price {
		margin-top: auto;
		/* Poppins Bold (700) — lighter than the free-ball number's Black (900) so the price doesn't
		 * overpower the tier's headline count. 700 is a real registered face (no faux-weight). */
		font-family: 'Poppins', sans-serif;
		font-weight: 700;
		/* A step above the button label: this is the number the player is comparing across tiers. */
		font-size: clamp(calc(13 * var(--ui-px)), 1.75vw, calc(19 * var(--ui-px)));
		line-height: 1;
		/* Small gap to the button below; the pair reads as one price-and-buy block. */
		margin-bottom: calc(5 * var(--ui-px));
		color: #ffffff;
		-webkit-text-stroke: var(--ui-px) #000000;
		paint-order: stroke fill;
		text-shadow:
			0 var(--ui-px) calc(3 * var(--ui-px)) rgba(0, 0, 0, 0.95),
			0 0 calc(3 * var(--ui-px)) rgba(0, 0, 0, 0.85);
		white-space: nowrap;
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

	/* Tablet / portrait — 2×2 grid.
	   ⚠️ Gated on the PORTRAIT aspect, not width alone. A 2×2 grid is twice as tall as 4×1, which is
	   fine on a tall phone but not in a short landscape frame: Stake's 400×225 popout is under 760px
	   wide, so the unqualified query used to flip it to 2×2 there and the second row fell off the
	   225px-tall viewport. `max-aspect-ratio: 1/1` is height ≥ width — the complement of the landscape
	   query --ui-px is defined under (routes/+layout.svelte), so the two can never both apply. */
	@media (max-width: 760px) and (max-aspect-ratio: 1/1) {
		.bb-cards {
			grid-template-columns: repeat(2, 1fr);
			gap: 0.9rem;
		}
	}
</style>
