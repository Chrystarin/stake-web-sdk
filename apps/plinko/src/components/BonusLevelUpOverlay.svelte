<script lang="ts">
	import { innerHeight, innerWidth } from 'svelte/reactivity/window';

	import { eventEmitter } from '../game/eventEmitter';
	import { stateGame } from '../game/stateGame.svelte';
	import { isPortraitGameLayout } from '../lib/format';
	import { staticUrl } from '../lib/staticUrl';

	/**
	 * Match Game/Background/Result: this overlay is fixed and lives outside `.game-root`, so it can't
	 * inherit the layout class. Read it off the live viewport instead of sampling once at mount, so a
	 * rotation or a window resize re-picks the layout — landscape sizing while the viewport is wide,
	 * portrait sizing the moment it's taller than it is wide.
	 */
	const portrait = $derived.by(() => {
		innerWidth.current;
		innerHeight.current;
		return isPortraitGameLayout();
	});

	// Fire the level-up chime on the rising edge of the overlay opening, so the sound lands the
	// moment the card pops. The sprite window (see EnableSound) trims the file's leading silence so
	// there's no dead air before it's heard.
	let wasOpen = false;
	$effect(() => {
		const open = stateGame.bonusLevelUpOverlayOpen;
		if (open && !wasOpen) {
			eventEmitter.broadcast({ type: 'soundOnce', name: 'bonusLevelUp' });
		}
		wasOpen = open;
	});

	const levelTitle = $derived(`LEVEL ${stateGame.bonusLevelUpLevel}`);
	const freeBallsCount = $derived(`+${stateGame.bonusLevelUpAddedBalls}`);
	const FREE_BALLS_LABEL = 'FREE BALLS';
</script>

{#if stateGame.bonusLevelUpOverlayOpen}
	<div
		class="bonus-level-up-overlay"
		class:bonus-level-up-overlay--visible={stateGame.bonusLevelUpOverlayVisible}
		class:bonus-level-up-overlay--portrait={portrait}
	>
		<div
			class="bonus-level-up-card"
			style:background-image="url({staticUrl('img/bonus-level-up-base.webp')})"
		>
			<!-- Every row is an outlined-glyph sandwich, the same construction the congratulations screens
			     use (BonusRoulette.svelte): a stroke span carries the rim, a fill span sits on top of it, and
			     the two are stacked in one grid cell so they stay registered. The rim has to be its own layer
			     because `-webkit-text-stroke` paints the outline UNDER the fill of the same span — a single
			     span would let the stroke eat into the glyph's face instead of hugging it. -->
			<div class="bonus-level-up-level">
				<span class="bonus-level-up-level-stroke" aria-hidden="true">{levelTitle}</span>
				<span class="bonus-level-up-level-fill">{levelTitle}</span>
			</div>

			<!-- Free-ball COUNT: flat cream face over a solid dark-gold rim (the treasure screen's win value). -->
			<div class="bonus-level-up-count">
				<span class="bonus-level-up-count-stroke" aria-hidden="true">{freeBallsCount}</span>
				<span class="bonus-level-up-count-fill">{freeBallsCount}</span>
			</div>

			<!-- Free-ball LABEL: same size as the count, but its own gradient face and gradient rim. -->
			<div class="bonus-level-up-label">
				<span class="bonus-level-up-label-stroke" aria-hidden="true">{FREE_BALLS_LABEL}</span>
				<span class="bonus-level-up-label-fill">{FREE_BALLS_LABEL}</span>
			</div>
		</div>
	</div>
{/if}

<style>
	.bonus-level-up-overlay {
		position: fixed;
		inset: 0;
		z-index: 14000;
		display: flex;
		align-items: center;
		justify-content: center;
		pointer-events: none;
		opacity: 0;
		transition: opacity 0.28s ease;
		backdrop-filter: blur(10px);
		-webkit-backdrop-filter: blur(10px);
		/* Scrim, tuned so the game BEHIND it measures ~30% darker than it did at the old 0.28.
		   Note the alpha is not simply 0.28 x 1.3: this colour isn't black, so as alpha rises the scrim
		   also adds its own light back, and the two effects partly cancel. Solving on measured backdrop
		   luminance instead of on the alpha number lands at 0.63 (verified: 34.1 -> 24.2, i.e. -29%).
		   Portrait keeps its slightly stronger 0.65, the same nudge it had over desktop before. */
		background: rgba(6, 14, 28, 0.63);
	}
	.bonus-level-up-overlay--visible {
		opacity: 1;
	}
	.bonus-level-up-overlay--portrait {
		background: rgba(6, 14, 28, 0.65);
	}

	/* Phones and tablets get a stronger scrim INSTEAD of the blur. A full-screen `backdrop-filter`
	   makes WebKit snapshot everything composited beneath this fixed overlay — all five WebGL
	   canvases and the coin-shower canvas — into an offscreen surface at NATIVE device scale
	   (DPR 3 = 1170x2532 on an iPhone 12 Pro; the Pixi apps' own min(2, DPR) caps don't apply to
	   the compositor) and run a two-pass Gaussian over it, every frame the overlay is up. That is
	   real GPU memory + fill on exactly the devices where iOS reaps WebGL contexts under pressure,
	   and it lands mid-bonus, the busiest the game ever is. The extra ~0.09 alpha stands in for the
	   legibility the blur was buying behind the card; `any-pointer: coarse` is the same touch signal
	   `isTouchDevice()` (lib/format.ts) keys on, so it tracks the game's own idea of a handheld. */
	@media (any-pointer: coarse) {
		.bonus-level-up-overlay {
			backdrop-filter: none;
			-webkit-backdrop-filter: none;
			background: rgba(6, 14, 28, 0.72);
		}
		.bonus-level-up-overlay--portrait {
			background: rgba(6, 14, 28, 0.74);
		}
	}

	/* The box is sized to the ARTWORK's own aspect (bonus-level-up-base.png is 1919x721) so container
	   units land on the plaque instead of on letterbox: 1cqw = 1% of the art's width, 1cqh = 1% of its
	   height. Every type size and position below is expressed in those units, so the whole card scales
	   as one piece. The plaque itself occupies the middle ~66% of the art's width (the rest is glow). */
	.bonus-level-up-card {
		container-type: size;
		position: relative;
		width: min(64vw, 920px);
		aspect-ratio: 1919 / 721;
		background-position: center;
		background-repeat: no-repeat;
		background-size: contain;
		box-sizing: border-box;
		/* Overall size of the whole card (art + type together). Portrait overrides it below. */
		--card-scale: 1.25;
		transform: scale(var(--card-scale));
		transform-origin: center center;

		/* ═══ TUNING KNOBS ═══════════════════════════════════════════════════════════════════════════
		   Three numbers per row. They are plain NUMBERS, not lengths — don't add units.

		     ...-size  type size, in % of the ARTWORK's width. Bigger = bigger. Because every row is
		               measured against the same artwork, these three are directly comparable: a row at
		               7.4 is exactly twice the type of a row at 3.7, on every screen size.
		     ...-x     sideways nudge, in % of the artwork's width. 0 = centred on the plaque.
		               Negative = left, positive = right.
		     ...-y     vertical position, in % of the artwork's height, measured to the CENTRE of the
		               line (not its top). 0 = artwork's top edge, 100 = its bottom. Bigger = lower.

		   Useful landmarks, all in those same % of the artwork:
		     wood plaque  x 22 → 77,  y 8 → 48   (coin piles sit at x 23→31 and x 69→77, below y 28)
		     red plaque   x 27 → 73,  y 55 → 87
		   Keep a row's type inside those bounds and it can't collide with the rope or the coins.

		   Rim thickness is separate — see `-webkit-text-stroke-width` on each row's `-stroke` rule near
		   the bottom of this file (it's in `em`, so it already tracks whatever size you set here). */

		/* LEVEL n */
		--level-size: 8;
		--level-x: 0;
		--level-y: 32.5;

		/* +n */
		--count-size: 6;
		--count-x: -1;
		--count-y: 65;

		/* FREE BALLS */
		--label-size: 5;
		--label-x: 0;
		--label-y: 81.5;
	}
	.bonus-level-up-overlay--portrait .bonus-level-up-card {
		width: min(92vw, 760px);
		/* Portrait runs the card 20% larger than landscape (1.25 x 1.2). The artwork is mostly glow —
		   the plaque is only the middle ~66% of it — so the extra width bleeds off-screen as glow rather
		   than cropping the plaque. */
		--card-scale: 1.5;
	}

	/* Each line is centred on its plaque by pinning the line box's own centre to a share of the art
	   height (top + translateY(-50%)), so changing a font size never drifts the text off its board.
	   The knobs above feed in here via --row-x / --row-y, which each row assigns from its own trio. */
	.bonus-level-up-level,
	.bonus-level-up-count,
	.bonus-level-up-label {
		position: absolute;
		left: 0;
		right: 0;
		top: calc(var(--row-y) * 1%);
		display: flex;
		align-items: center;
		justify-content: center;
		transform: translate(calc(var(--row-x) * 1cqw), -50%);
		text-align: center;
		text-transform: uppercase;
		white-space: nowrap;
		pointer-events: none;
		user-select: none;
	}

	/* Stack the rim layer and the face layer in the same grid cell. `place-items: center` shrink-wraps
	   both spans; since they carry identical text, metrics and padding they come out the same width and
	   stay registered on top of each other. */
	.bonus-level-up-level,
	.bonus-level-up-count,
	.bonus-level-up-label {
		display: grid;
		place-items: center;
	}
	.bonus-level-up-level > *,
	.bonus-level-up-count > *,
	.bonus-level-up-label > * {
		grid-area: 1 / 1;
		font: inherit;
		letter-spacing: inherit;
	}

	/* Gradient faces: the ink is a background clipped to the glyphs, so the glyphs themselves are
	   transparent and the gradient shows through. */
	.bonus-level-up-level-fill,
	.bonus-level-up-label-fill {
		background-clip: text;
		-webkit-background-clip: text;
		-webkit-text-fill-color: transparent;
		color: transparent;
	}

	/* GRADIENT rims. `-webkit-text-stroke-color` can't take a gradient, so the trick the congratulations
	   screens use is repeated here: stroke the glyph with a TRANSPARENT stroke — which still widens the
	   shape that `background-clip: text` masks against — and paint that widened shape with the gradient.
	   Only the part sticking out past the face span reads as the rim. */
	.bonus-level-up-level-stroke,
	.bonus-level-up-count-stroke,
	.bonus-level-up-label-stroke {
		color: transparent;
		-webkit-text-stroke-color: transparent;
		paint-order: stroke fill;
		background-clip: text;
		-webkit-background-clip: text;
		-webkit-text-fill-color: transparent;
	}
	/* `background-clip: text` only paints inside each span's own box, but the stroke ink of the first and
	   last glyphs pokes OUT of it — without this padding those outer rims have no gradient behind them and
	   disappear. Applied to both spans equally so they stay registered. */
	.bonus-level-up-level > *,
	.bonus-level-up-count > *,
	.bonus-level-up-label > * {
		padding: 0.16em 0.18em;
	}

	/* LEVEL n — Pieces of Eight. Gold face over the CONGRATULATIONS headline's gradient rim, plus the
	   hard offset drop shadow. The shadow is a `filter`, not a text-shadow: a filter runs on the finished
	   layer, so it casts from the OUTLINE's silhouette rather than from the bare glyph, and it can't be
	   painted over by the clipped-gradient background the way a text-shadow would be. */
	.bonus-level-up-level {
		--row-x: var(--level-x);
		--row-y: var(--level-y);
		font-size: calc(var(--level-size) * 1cqw);
		font-family: 'PiecesOfEight', serif;
		font-weight: 400;
		line-height: 1.152;
		letter-spacing: 0.14em;
		/* letter-spacing is added AFTER the last glyph too, which shifts centred text left by half of
		   it — cancel that so the line sits on the plaque's true centre. */
		margin-right: -0.14em;
		filter: drop-shadow(0.0443em 0.0696em 0.038em #000000);
	}
	.bonus-level-up-level-fill {
		background-image: linear-gradient(180deg, #f5b936 0%, #ebad26 56.7%, #d18a16 81.67%);
	}
	/* Rim gradient, each stop lightened 25% — HSL lightness x1.25 with hue and saturation held, so it
	   brightens as gold instead of washing out towards white the way mixing in white would.
	   Was #bd8018 / #9a6011 / #6e430b. */
	.bonus-level-up-level-stroke {
		-webkit-text-stroke-width: 0.08em;
		background-image: linear-gradient(180deg, #e49e27 6%, #c07815 48%, #8a540e 100%);
	}

	/* +n — the hero line: flat cream face over a BRIGHT gold rim (its own gradient, lighter and more
	   saturated than the label's dark-gold one below).
	   Poppins rather than the label's PotatoSans, and unlike PotatoSans it ships real weights (400-900,
	   see +layout.svelte), so `font-weight` here picks an actual face instead of triggering the
	   browser's synthetic-bold smear. */
	.bonus-level-up-count {
		--row-x: var(--count-x);
		--row-y: var(--count-y);
		font-size: calc(var(--count-size) * 1cqw);
		font-family: 'Poppins', sans-serif;
		font-weight: 600;
		line-height: 0.948;
		letter-spacing: 0.06em;
		margin-right: -0.06em;
		filter: drop-shadow(0 0.0547em 0.0471em #000000);
	}
	/* Flat rim, so it skips the gradient trick above and just paints the stroke itself — no gradient to
	   clip means the `background-clip: text` machinery inherited from the shared rule paints nothing. */
	.bonus-level-up-count-stroke {
		-webkit-text-stroke: 0.09em #d08a1b;
	}
	.bonus-level-up-count-fill {
		color: #ffecca;
	}

	/* FREE BALLS — Potato Sans, a step smaller than the count, over the "YOU HAVE WON" row's gradient
	   rim (a touch heavier than the headline's, and a warmer dark gold). */
	.bonus-level-up-label {
		--row-x: var(--label-x);
		--row-y: var(--label-y);
		font-size: calc(var(--label-size) * 1cqw);
		font-family: 'PotatoSans', sans-serif;
		font-weight: 700;
		line-height: 0.948;
		letter-spacing: 0.06em;
		margin-right: -0.06em;
		filter: drop-shadow(0 0.0729em 0.0471em #000000);
	}
	.bonus-level-up-label-fill {
		background-image: linear-gradient(180deg, #fbeccd 0%, #d4b777 56.7%, #ffe5bc 81.67%);
	}
	.bonus-level-up-label-stroke {
		-webkit-text-stroke-width: 0.1em;
		background-image: linear-gradient(180deg, #c8912a 4%, #a06818 50%, #6e440c 100%);
	}
</style>
