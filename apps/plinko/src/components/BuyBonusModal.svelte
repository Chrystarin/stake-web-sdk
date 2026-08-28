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
								<span class="bb-free">{tier.freeBalls}</span>
								<span class="bb-free-label">Free Balls</span>
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
								<!-- The design's hover state is a whole second plate, not a tint: the gold button turns
								     BLUE under the cursor. Stacked over the gold one and cross-faded by opacity (see
								     .bb-activate-bg--hover) rather than swapped through `src`, so the blue frame is already
								     decoded when the pointer arrives and the swap can't flash. -->
								<img
									class="bb-activate-bg bb-activate-bg--hover"
									src={staticUrl('img/buy_bonus_button_hover.webp')}
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
	/* This is the one modal in the game that is allowed to SCROLL — and a scrolling overlay has two mobile
	   traps that a merely-centred one doesn't. Both are handled here; see the two notes below.
	   It should no longer ever need to: the PORTRAIT FIT block at the bottom of this stylesheet solves the
	   tier cards against the viewport's height, so the column fits by construction. The scroll stays as
	   the safety net behind that, which is exactly why these two traps still have to be kept shut — if it
	   ever does fire, it has to fire correctly.

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
			/* PORTRAIT UI SCALE. The root only scales --ui-px in LANDSCAPE (see +layout.svelte) — portrait
			   holds it at a flat 1px, which is why this column used to be a fixed 667px tall no matter how
			   short the viewport was, and why anything under ~730px of height scrolled. Re-pointing the
			   unit here makes the whole modal a uniform scale of its portrait reference self, exactly the
			   way the landscape rule does for 1024×576: every absolute length in this file is stated in
			   --ui-px, so one declaration moves the title, the four gaps, the balance and (through
			   --bb-card-w below) the tier cards together.
			   812 is the height this portrait layout was tuned at (375×812), and the `1px` cap is what
			   keeps a taller phone rendering EXACTLY as it does today — this only ever shrinks.
			   WIDTH is deliberately absent: the column's width budget is already 96vw (see `.bb-modal`),
			   so a second width term would double-count it and shrink the chrome on narrow phones for no
			   reason. Scoped to `.bb-backdrop`, so it reaches this modal's subtree and nothing else —
			   neither GameHud.scss nor BetPerBallField.svelte reads --ui-px. */
			--ui-px: min(1px, calc(100svh / 812));
			/* The backdrop's own vertical padding, restated as a value the card budget below can read, so
			   the two can never drift. Mirrors the shorthand in the base rule plus the floor below. */
			--bb-pad-y: calc(
				max(3vh, calc(34 * var(--ui-px))) + env(safe-area-inset-top, 0px) + 3vh +
					env(safe-area-inset-bottom, 0px)
			);
			padding-top: calc(max(3vh, calc(34 * var(--ui-px))) + env(safe-area-inset-top, 0px));
			/* The other scrollbar, and a portrait-only one. `.bb-close::after` pads the X's TAP target 8ui-px
			   past the button, which itself hangs 8ui-px past the modal's corner — 16ui-px of reach against
			   the 2vw the backdrop keeps on that side. Landscape has 20px of it and swallows the overhang;
			   portrait has ~8px, so the tap target stuck out and `overflow: auto` answered with a horizontal
			   scrollbar over an invisible box. Clipping X costs nothing: it trims dead hit area that was off
			   the side of the screen anyway, and the visible X still sits inside the viewport. */
			overflow-x: hidden;
		}
	}

	/* Every absolute length in this modal (px AND rem — rem is just as fixed, the app never rescales the
	   root font-size) is stated in --ui-px, so the tier grid is a uniform scale of its 1024×576 reference
	   self. Left raw, the cards keep their full-size chrome on Stake's 400×225 popout and the four tiers
	   no longer fit the frame. */
	.bb-modal {
		position: relative;
		/* Held as a variable because the portrait card budget has to divide it between the columns, and a
		   literal `100%` cannot be used there — that value is divided down into a font scale on `.bb-card`,
		   where a percentage would resolve against the font size instead of the grid. */
		--bb-modal-width: min(calc(1100 * var(--ui-px)), 96vw);
		width: var(--bb-modal-width);
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
		/* Grid shape, restated as data so the portrait fit block at the bottom of this file can solve a
		   card size against it without having to know which of the two grids is in play. */
		--bb-cols: 4;
		--bb-rows: 1;
		--bb-card-gap: calc(19.2 * var(--ui-px)); /* 1.2rem */
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: var(--bb-card-gap);
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
		/* Design metrics: 24px of air above the title and 25px below the button on the 324×442 reference
		   card. ⚠️ Percentage padding resolves against the containing block's WIDTH on every side, top
		   and bottom included — so those two are 24/324 and 25/324, NOT /442. The 4% sides are what let
		   the two-line tagline run to ~90% of the card the way the design does; the button no longer
		   takes its width from this box (see .bb-activate), so widening it costs nothing there. */
		padding: 7.4% 4% 7.7%;
		gap: calc(4.48 * var(--ui-px)); /* 0.28rem */
	}

	.bb-card-title {
		margin: 0;
		font-family: 'PiecesOfEight', serif;
		font-weight: 400;
		/* px/vw based (NOT rem): the game halves the root font-size on narrow screens, so a rem title
		 * clamps tiny. 55px on the design's 324px-wide card = 0.17 of the card. The vw term is what actually holds
		 * that ratio: in landscape the card is 22.59vw wide (see the .bb-cards grid against
		 * --bb-modal-width), so 0.17 × 22.59 = 3.84vw. The --ui-px cap takes over past ~1146px, where
		 * the modal stops growing and the card settles at 260.6ui-px — 0.17 of which is 44. */
		font-size: clamp(calc(24 * var(--ui-px)), 3.84vw, calc(44 * var(--ui-px)));
		/* 52/55 in the design — tighter than a default, which is what keeps a two-word title like
		 * "Super Fury" from eating the tagline's row. */
		line-height: 0.95;
		color: #ffffff;
		text-shadow: 0 calc(4 * var(--ui-px)) calc(4 * var(--ui-px)) rgba(0, 0, 0, 0.8);
	}

	.bb-card-desc {
		margin: 0;
		/* Noto Sans Bold, per the design — not the display face. Registered as a 100..900 variable in
		 * +layout.svelte, so 700 is a real weight and never faux-bold. */
		font-family: 'Noto Sans', sans-serif;
		font-weight: 700;
		font-synthesis: none;
		/* The design's 16px is 0.049 of its card, i.e. 1.11vw of the 22.59vw landscape card — but this
		 * line is the ONE that can't be sized on ratio alone. Uppercase Noto Sans Bold runs ~18.3× the
		 * font size for the longest tagline ("A STARTER BATCH OF FREE BALLS"), which is ~90% of the
		 * design's card: the design has almost no slack, so a straight 1.11vw would wrap it to three
		 * lines the moment a font metric rounds the wrong way. 1.06vw keeps ~7% in hand against the 92%
		 * the padding above leaves, at every landscape width — the tightest case being 1024×576, where
		 * the modal is 96vw rather than its 1100ui-px cap. Re-check both if either number moves. */
		font-size: clamp(calc(9.5 * var(--ui-px)), 1.06vw, calc(12 * var(--ui-px)));
		line-height: 1.3;
		text-transform: uppercase;
		color: #d4d0c4;
		text-shadow: 0 calc(4 * var(--ui-px)) calc(4 * var(--ui-px)) rgba(0, 0, 0, 0.7);
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

	/* Count and label are ONE face in the comp — Noto Sans Black, differing only in fill — which is
	   what makes their cap heights line up. (The Figma layer names the count "Potato sans Black", but
	   a shape match of the comp's own "71" puts Noto Sans 900 at 0.93 IoU against PotatoSans's 0.52:
	   the display face is a good deal narrower and sits shorter per em, so taking the layer name here
	   left the number visibly small beside its label. The button's label IS PotatoSans — 0.76 there —
	   so this is a per-line fact, not a blanket one.) */
	.bb-card-total {
		display: flex;
		align-items: baseline;
		justify-content: center;
		gap: 0.33em;
		font-family: 'Noto Sans', sans-serif;
		font-weight: 900;
		font-synthesis: none;
		/* 30px on the design's 324px card = 0.0926 of it, i.e. 2.09vw of the 22.59vw landscape card;
		 * the cap is 0.0926 of the 260.6ui-px card the modal settles at. Both children inherit it. */
		font-size: clamp(calc(16 * var(--ui-px)), 2.09vw, calc(24 * var(--ui-px)));
		/* Keep "<n> FREE BALLS" on one line even for the wide 3-digit tiers (matches the reference). */
		white-space: nowrap;
	}

	.bb-free-label {
		text-transform: uppercase;
		color: #ffffff;
		text-shadow: 0 calc(4 * var(--ui-px)) calc(5.8 * var(--ui-px)) #000000;
	}

	.bb-free {
		/* Face and weight come from .bb-card-total — see the note there. All this line adds is the fill. */
		/* Gold gradient fill clipped to the glyphs (reference design); the "FREE BALLS" label stays white. */
		background: linear-gradient(180deg, #f5b936 0%, #ebad26 56.7%, #d18a16 81.67%);
		-webkit-background-clip: text;
		background-clip: text;
		-webkit-text-fill-color: transparent;
		color: transparent;
		/* Belt and braces: .bb-card-total no longer sets one, but text-shadow IS inherited, and any
		 * shadow here would paint on top of the gradient (the same overlap bug the filter below fixes). */
		text-shadow: none;
		/* Use filter drop-shadow — NOT text-shadow. With background-clip:text the gradient paints in the
		 * element's background layer (behind), while text-shadow paints in the text layer (in front), so a
		 * text-shadow lands ON TOP of the gradient. drop-shadow composites the shadow behind the rendered
		 * glyphs, matching the reference (shadow behind the number). */
		filter: drop-shadow(0 calc(4 * var(--ui-px)) calc(4 * var(--ui-px)) #000000)
			drop-shadow(var(--ui-px) calc(2 * var(--ui-px)) 0 #000000)
			drop-shadow(0 0 calc(28.5 * var(--ui-px)) rgba(237, 176, 42, 0.64));
	}

	.bb-activate {
		position: relative;
		/* 190.8px of the design's 324px card = 58.9% of it. `.bb-card-inner` leaves 92% of the card for
		   its text column (the tagline wants that width), so the button takes 64% of THAT to land on
		   the design's own width — and, through the aspect ratio below, its height. */
		width: 64%;
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

	/* The blue plate rides on top of the gold one and is faded in on hover. Both are the same 191×44
	   art box, so they register exactly. */
	.bb-activate-bg--hover {
		opacity: 0;
		transition: opacity 0.12s ease;
	}
	/* :focus-visible too — a keyboard user gets the same read on which tier is armed. */
	.bb-activate:hover:not(:disabled) .bb-activate-bg--hover,
	.bb-activate:focus-visible:not(:disabled) .bb-activate-bg--hover {
		opacity: 1;
	}

	.bb-activate-text {
		position: relative;
		z-index: 1;
		font-family: 'PotatoSans', sans-serif;
		/* 23px on the design's 324px card = 0.071 of it, which the existing 1.6vw already happened to
		 * be — only the caps moved (0.071 of the 260.6ui-px card the modal settles at). */
		font-size: clamp(calc(14 * var(--ui-px)), 1.6vw, calc(18.5 * var(--ui-px)));
		/* The design's own 1.61px on 23px. It only sets correctly alongside the inward stroke below —
		 * see the note there. */
		letter-spacing: 0.07em;
		text-transform: uppercase;
		/* White with a black outline. The design HAS this outline — it just doesn't survive Figma's
		 * code export, which reports the soft shadow alone; a 4× render of the button node measures a
		 * visible edge of 0.75–1ui-px on the 23px label.
		 *
		 * ⚠️ NO `paint-order: stroke fill` here, deliberately, and it is the only lever this label has
		 * on its weight: Potato sans ships as a single BLACK face (see +layout.svelte), so
		 * `font-weight` selects nothing and there is no lighter cut to ask for. Left at the CSS
		 * default the stroke paints OVER the fill, so the centred edge eats half its width back into
		 * every stem and thins the white letterforms towards the Bold the comp is set in.
		 * `paint-order: stroke fill` would put the fill back on top and restore the full Black weight.
		 * The design's 0.07em tracking depends on this: against the fatter un-eroded glyphs the word
		 * ran 4% wide and the letters drifted apart.
		 *
		 * That paint order is also why the width is 0.04em and not the 0.08em it would be if the edge
		 * sat outside the glyph. With the stroke centred, the WHOLE width reads as black — half
		 * outside the glyph and half in — so 0.04em is what draws the 0.92px band on a 23px label,
		 * inside the 0.75–1px the 4× render measures. Doubling it to get the same OUTER reach paints
		 * a band twice as heavy as the design's.
		 *
		 * Stated in em, NOT --ui-px, so the edge stays that fraction of the label at every card size.
		 * The four offset shadows carry the outer edge for anything without -webkit-text-stroke; the
		 * last one is the design's own soft drop shadow (1.467px on 23px). */
		color: #ffffff;
		-webkit-text-stroke: 0.04em #000000;
		text-shadow:
			0.02em 0.02em 0 #000000,
			-0.02em 0.02em 0 #000000,
			0.02em -0.02em 0 #000000,
			-0.02em -0.02em 0 #000000,
			0 0.064em 0.064em rgba(0, 0, 0, 0.25);
		white-space: nowrap;
	}

	/* Price line, sitting directly on top of the Activate button. It no longer inherits the button
	 * label's colour and outline (it used to live inside .bb-activate-text), so it restates the white
	 * fill + black edge that keeps small text legible over the textured panel.
	 * `margin-top: auto` moved down here with it: the price is now the first of the two bottom-pinned
	 * rows, so it — not the button — is what takes up the card's free space. */
	.bb-price {
		margin-top: auto;
		/* ⚠️ NOT the display face, even though the Figma layer is labelled "Potato sans Bold" — the
		 * shipped Potato_sans-Black.otf HAS NO `$` GLYPH (nor € or £), so this line would fall back
		 * mid-string and render the sign in a different face from the digits. The comp itself shows
		 * the substituted face rather than Potato sans for exactly that reason, and matching what the
		 * comp shows is also the only thing that can render every currency the game serves.
		 * Noto Sans Bold is that face: shape-matched against the comp's own "$80.00" at 0.85 IoU, ahead
		 * of Poppins Bold (0.80) and Instrument Sans Bold (0.67), and already the tagline's family. */
		font-family: 'Noto Sans', sans-serif;
		font-weight: 700;
		font-synthesis: none;
		/* 27px on the design's 324px card = 0.083 of it → 1.88vw of the 22.59vw landscape card, capped
		 * at 0.083 of the 260.6ui-px card the modal settles at. */
		font-size: clamp(calc(14 * var(--ui-px)), 1.88vw, calc(21.7 * var(--ui-px)));
		line-height: 1;
		/* Small gap to the button below; the pair reads as one price-and-buy block. */
		margin-bottom: calc(5 * var(--ui-px));
		/* The design drops the black outline this line used to carry, in favour of one soft drop
		 * shadow — the type is now big enough to hold its own against the textured panel. */
		color: #ffffff;
		text-shadow: 0 calc(3 * var(--ui-px)) calc(4.5 * var(--ui-px)) rgba(0, 0, 0, 0.79);
		white-space: nowrap;
	}

	.bb-activate:hover:not(:disabled) {
		/* No brightness lift any more — the gold-to-blue plate swap is the whole hover treatment, and
		   brightening on top of it only washed the blue out. */
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
			--bb-cols: 2;
			--bb-rows: 2;
			/* 7.2ui-px, not the 0.9rem this used to say: the app halves the root font-size on narrow
			   screens, so that rem resolved to 7.2px — the same number, but now it scales with the rest of
			   the column instead of standing still. */
			--bb-card-gap: calc(7.2 * var(--ui-px));
			grid-template-columns: repeat(2, 1fr);
			gap: var(--bb-card-gap);
		}
	}

	/* ── PORTRAIT FIT ────────────────────────────────────────────────────────────────────────────────
	   The tier cards are the whole vertical budget: they carry a fixed `aspect-ratio`, so their HEIGHT
	   is decided by the modal's WIDTH, and in portrait that width is 96vw. Nothing in the column ever
	   consulted the viewport's HEIGHT, which is why a 375×667 phone overflowed by 54px and scrolled
	   while the same layout cleared 375×812 by 86px.

	   So the card is now sized from BOTH budgets and takes the smaller:
	     • WIDTH  — the modal's own width, split between the columns (what it always did), and
	     • HEIGHT — whatever `100svh` has left after the backdrop's padding and the other three blocks.
	   Everything else in the column is stated in --ui-px, which the portrait rule at the top of this
	   stylesheet now shrinks with `svh`, so the chrome gives ground on a short screen instead of
	   leaving the cards to absorb the whole shortfall. Together the two make the column fit by
	   construction at every portrait size — the backdrop keeps `overflow: auto` purely as a safety net
	   that should now never fire.

	   ⚠️ `137.6` is the rest of the column MEASURED, in --ui-px, and has to be re-derived if any of it
	   changes:
	       37.0  .bb-title       (32ui-px × the 1.16 line-height pinned below)
	      105.6  three .bb-modal gaps (3 × 35.2)
	      −24.0  .bb-bet-row's two −12ui-px margins (its art-shadow term is in the vw figure below)
	      −16.0  .bb-balance's negative margin-top
	       27.0  .bb-balance     (18ui-px × the 1.5 line-height pinned below)
	        8.0  slack, so a rounding or font-metric surprise costs a slightly smaller card rather than
	             a scrollbar
	   and `14.265vw` is the bet row, the one block that stays vw-driven (its plaque is solved by the
	   shared `bp-field-metrics` chain, which is vw throughout): 6.4993vw of plaque × the 2.6 portrait
	   scale × the 0.844 left of it after its own negative margins. Both line-heights are pinned rather
	   than left at `normal` so that sum is exact even before the display faces have loaded.

	   @supports, because every one of these values is invalid on a browser without `svh` — and an
	   invalid `var()` in `grid-template-columns` computes to `none`, i.e. one card per row. Guarded, such
	   a browser simply keeps the pre-fit layout (which is all it could ever have had). */
	@supports (height: 100svh) {
		@media (max-aspect-ratio: 1/1) {
			.bb-title {
				/* Portrait drops the vw term — 5vw is only ~19px on a phone, so the clamp's --ui-px floor was
				   already winning; stating it plainly keeps the title a true multiple of the unit at every
				   height instead of catching on the vw preference once --ui-px shrinks. */
				font-size: calc(32 * var(--ui-px));
				line-height: 1.16;
			}

			.bb-balance {
				font-size: calc(18 * var(--ui-px));
				line-height: 1.5;
			}

			.bb-cards {
				--bb-cards-budget: calc(100svh - var(--bb-pad-y) - 137.6 * var(--ui-px) - 14.265vw);
				/* The tighter of the two budgets. The height one is turned into a WIDTH by the same 0.74 the
				   card carries as its `aspect-ratio`, so one number can drive the tracks. The outer `max()` is
				   a floor for a viewport so short the budget goes negative — a negative track size would drop
				   the declaration outright and take the grid with it. */
				--bb-card-w: max(
					calc(48 * var(--ui-px)),
					min(
						calc(
							(var(--bb-modal-width) - (var(--bb-cols) - 1) * var(--bb-card-gap)) / var(--bb-cols)
						),
						calc(
							(var(--bb-cards-budget) - (var(--bb-rows) - 1) * var(--bb-card-gap)) /
								var(--bb-rows) * 0.74
						)
					)
				);
				/* Explicit tracks, not `1fr`: the cards have to be free to sit NARROWER than the modal once the
				   height budget is the binding one. `justify-content` then centres them under the title. */
				grid-template-columns: repeat(var(--bb-cols), var(--bb-card-w));
				justify-content: center;
			}

			/* The same trick as the backdrop, one level down: inside a card, "one pixel" means one pixel of a
			   REFERENCE CARD — 176ui-px across, which is what a card measures on the 375×812 phone this
			   layout was tuned at. Every size in the card (both headings, the tagline, the free-ball count,
			   the price, the button label, their strokes and shadows) is already stated in --ui-px, so this
			   one line keeps a card's contents a fixed fraction of the card at whatever size it lands on.
			   Without it the type held still while the card shrank, and the tagline overran the panel. */
			.bb-card {
				--ui-px: calc(var(--bb-card-w) / 176);
			}
		}
	}
</style>
