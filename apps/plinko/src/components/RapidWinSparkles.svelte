<script lang="ts">
	import { onMount } from 'svelte';
	import { scale } from 'svelte/transition';
	import { cubicIn, cubicOut } from 'svelte/easing';
	import { innerHeight, innerWidth } from 'svelte/reactivity/window';

	import { stateGame } from '../game/stateGame.svelte';
	import { frameImagePoint, framePaintedWidth, SKULL_MOUTH_CAVITY } from '../lib/frameArt';
	import { staticUrl } from '../lib/staticUrl';
	import { winDigitArt, WIN_DOT_ART } from '../lib/winCelebration';

	// The 1-ball rapid win reveal: just the win value, printed at the skull's mouth and floating slowly
	// upward before it shrinks + fades. No tier banner, no shine-ray glow — only the number. Its size is
	// FIXED (a fraction of the board width) and identical for every win, regardless of the amount's
	// magnitude or digit count. State (max 3) is managed by the gameOrchestrator; this only draws it.

	const FALLBACK_FRAME_W = 900;

	// Win-value glyph height as a fraction of the painted frame width. Constant across all wins so the
	// number reads at one size no matter the value (it just gets wider with more digits).
	const DIGIT_HEIGHT_RATIO = 0.045;

	// Centre-to-centre spacing between two stacked wins, as a multiple of the (fixed) glyph height. The
	// number occupies ~1 glyph-height; ~1.7 leaves a clean gap so stacked values never touch.
	const STACK_SPACING_COEFF = 1.7;

	// How far a value floats upward across its lifetime, as a multiple of the glyph height.
	const FLOAT_DIST_COEFF = 2.6;

	// Backdrop shade — a soft dark-navy vignette dimmed over the skull mouth + head so the win value
	// pops against it. It fades IN while any win value is on screen and OUT once none remain.
	const SHADE_SRC = 'img/win_popup/backdrop_shade.png';
	const SHADE_ASPECT = 4766 / 2989; // intrinsic w/h of the PNG
	// Where the shade's centre sits on the frame art (fractions of the painted frame). Biased slightly
	// below the skull's eyes so the vignette's opaque core covers the mouth + the floating values above it.
	const SHADE_CENTER = { x: 0.5, y: 0.31 };
	// Shade width as a fraction of the painted frame width. Centred on SHADE_CENTER via translate(-50%),
	// so shrinking it keeps it anchored on the skull's mouth + head. 0.5 = half the earlier 1.0 size.
	const SHADE_WIDTH_RATIO = 0.5;

	// Format the win value: up to 4 decimals, but with trailing zeros stripped so 0.4000 → "0.4" and
	// 0.1230 → "0.123" (and a whole number shows no decimals). `maximumFractionDigits` already drops
	// trailing zeros; `minimumFractionDigits: 0` lets it fall all the way to an integer.
	function fmt(amount: number): string {
		if (!Number.isFinite(amount)) return '0';
		return amount.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 4 });
	}

	type PlacedSparkle = {
		id: number;
		leftPx: number;
		topPx: number;
		digitH: number;
		floatPx: number;
		stackOffsetPx: number;
		chars: string[];
	};

	// Re-resolve on every layout change (the values are fixed, outside the mobile layout class, so we
	// track window size like the other overlays do) and whenever the sparkle set changes.
	const placed = $derived.by<PlacedSparkle[]>(() => {
		innerWidth.current;
		innerHeight.current;
		const frameW = framePaintedWidth() ?? FALLBACK_FRAME_W;
		// Anchor at the vertical CENTRE LINE of the board (x = 0.5) instead of the skull-mouth cavity's
		// off-centre 0.5105 — the mouth art is drawn ~1% right-of-centre and it read as visibly out of
		// alignment with the play button + centre "0" slot, which are both dead-centred at 0.5.
		const mouth = frameImagePoint(0.5, SKULL_MOUTH_CAVITY.y);

		// Every value is the same fixed size now, so the stack offset is simply the slot index times a
		// uniform spacing (stackIndex 0 = newest, sits at the mouth; older ones slide upward).
		const digitH = frameW * DIGIT_HEIGHT_RATIO;
		const spacing = digitH * STACK_SPACING_COEFF;

		return stateGame.rapidWinSparkles.map((s) => {
			const p = mouth ?? {
				x: (innerWidth.current ?? window.innerWidth) * 0.5,
				y: (innerHeight.current ?? window.innerHeight) * SKULL_MOUTH_CAVITY.y,
			};
			return {
				id: s.id,
				leftPx: p.x,
				topPx: p.y,
				digitH,
				floatPx: digitH * FLOAT_DIST_COEFF,
				stackOffsetPx: s.stackIndex * spacing,
				chars: fmt(s.amount).split(''),
			};
		});
	});

	// Geometry for the backdrop shade, re-resolved on every layout change like the values above.
	const shade = $derived.by(() => {
		innerWidth.current;
		innerHeight.current;
		// `framePaintedWidth`/`frameImagePoint` aren't reactive, so — like `placed` — depend on the win
		// set: this re-resolves the (by then laid-out) frame geometry whenever a win appears or clears,
		// instead of being stuck on the fallback captured before the frame art was first laid out.
		void stateGame.rapidWinSparkles.length;
		const frameW = framePaintedWidth() ?? FALLBACK_FRAME_W;
		const center = frameImagePoint(SHADE_CENTER.x, SHADE_CENTER.y) ?? {
			x: (innerWidth.current ?? window.innerWidth) * SHADE_CENTER.x,
			y: (innerHeight.current ?? window.innerHeight) * SHADE_CENTER.y,
		};
		const widthPx = frameW * SHADE_WIDTH_RATIO;
		return { leftPx: center.x, topPx: center.y, widthPx, heightPx: widthPx / SHADE_ASPECT };
	});
	// The shade is visible whenever at least one win value is on screen; when the last one clears it
	// fades back out (see the CSS opacity transition).
	const shadeVisible = $derived(stateGame.rapidWinSparkles.length > 0);

	onMount(() => {
		// Preload the digit art so the first value never flashes an unloaded glyph.
		new Image().src = staticUrl(WIN_DOT_ART);
		for (let d = 0; d < 10; d++) new Image().src = staticUrl(winDigitArt(String(d)));
		// Preload the shade so its first fade-in isn't blank.
		new Image().src = staticUrl(SHADE_SRC);
	});
</script>

{#if stateGame.ballPerDrop === 1}
	<!-- Overlay stays mounted for the whole 1-ball tier (idle when empty) so a value removed from the
	     state array still gets its full out:scale/fade — an {#if placed.length > 0} guard would tear the
	     parent down before the child transition could play. -->
	<div class="rws-overlay" aria-hidden="true">
		<!-- Backdrop shade over the skull mouth + head, behind the values (first in DOM = painted under
		     them). Permanently mounted; shown/hidden purely via the `--visible` opacity toggle so it can
		     fade both in (first win) and out (last win cleared) without an {#if} tearing it out mid-fade. -->
		<img
			class="rws-shade"
			class:rws-shade--visible={shadeVisible}
			src={staticUrl(SHADE_SRC)}
			alt=""
			style="left:{shade.leftPx}px; top:{shade.topPx}px; width:{shade.widthPx}px; height:{shade.heightPx}px;"
		/>
		{#each placed as s (s.id)}
			<!-- Anchor pinned at the skull's mouth. `.rws-stack` owns the vertical slot offset (newest at
			     mouth, older ones slid upward, smooth transition when the index changes so a bumped value
			     glides rather than jumps). `.rws-float` owns the slow lifetime drift (CSS animation on
			     translateY). `.rws-sparkle` owns the in/out transitions. Each level owns a different
			     transform axis so they compose cleanly. -->
			<div class="rws-anchor" style="left:{s.leftPx}px; top:{s.topPx}px;">
				<div class="rws-stack" style="--rws-stack-offset: {s.stackOffsetPx}px;">
					<div class="rws-float" style="--rws-float: -{s.floatPx}px;">
						<div class="rws-sparkle" style="--rws-digit-h:{s.digitH}px;">
							<!-- The in/out scale lives on the NUMBER, not on `.rws-sparkle`. `.rws-sparkle` owns
							     the `translate(-50%,-50%)` centring; if the scale transition sat on the same
							     element, Svelte would snapshot that translate as pixels at transition start —
							     and on first spawn the digit <img>s haven't decoded, so the width reads ~0 and
							     `-50%` ≈ 0, parking the value right-of-centre until it snapped back on end. -->
							<div
								class="rws-number"
								in:scale={{ start: 0.35, opacity: 0, duration: 340, easing: cubicOut }}
								out:scale={{ start: 0.4, opacity: 0, duration: 360, easing: cubicIn }}
							>
								{#each s.chars as ch, i (i)}
									{#if ch === ','}
										<span class="rws-sep">{ch}</span>
									{:else if ch === '.'}
										<img class="rws-digit rws-dot" src={staticUrl(WIN_DOT_ART)} alt="." />
									{:else}
										<img class="rws-digit" src={staticUrl(winDigitArt(ch))} alt={ch} />
									{/if}
								{/each}
							</div>
						</div>
					</div>
				</div>
			</div>
		{/each}
	</div>
{/if}

<style>
	.rws-overlay {
		position: fixed;
		inset: 0;
		z-index: 14000;
		pointer-events: none;
		overflow: hidden;
	}

	/* Backdrop shade, centred on its anchor point over the skull head. Base state = hidden with the
	   slower FADE-OUT duration; `--visible` flips to opaque with the quicker FADE-IN duration. */
	.rws-shade {
		position: absolute;
		transform: translate(-50%, -50%);
		opacity: 0;
		transition: opacity 460ms ease;
		pointer-events: none;
		will-change: opacity;
	}
	.rws-shade--visible {
		/* 30% more transparent than fully opaque so the skull reads through the shade. */
		opacity: 0.7;
		transition: opacity 240ms ease;
	}

	/* Fixed spawn point at the skull's mouth. No transform of its own; the float + centring live below. */
	.rws-anchor {
		position: absolute;
	}

	/* Vertical stack slot offset. Newest value has stackOffset=0 (sits at the mouth); when a new one is
	   pushed, every older value's `--rws-stack-offset` bumps by one slot's worth and this element glides
	   upward — the transition here is what turns the slot bump into a smooth slide instead of a jump.
	   Composed on top of the .rws-float animation below (each level owns a different transform). */
	.rws-stack {
		transform: translateY(calc(-1 * var(--rws-stack-offset, 0px)));
		transition: transform 340ms cubic-bezier(0.2, 0.8, 0.3, 1);
	}

	/* Slow upward drift over the value's lifetime (enter + live + exit ≈ 1860ms). `forwards` fill so it
	   holds at the top-most position after the animation completes, in case the exit hasn't quite
	   finished. Linear so the drift reads as a steady float, not an ease-in landing. */
	.rws-float {
		animation: rws-float 1860ms linear forwards;
		transform-origin: center;
	}
	@keyframes rws-float {
		from {
			transform: translateY(0);
		}
		to {
			transform: translateY(var(--rws-float, -60px));
		}
	}

	/* Each value is centred on the (floated) anchor point. */
	.rws-sparkle {
		position: absolute;
		left: 0;
		top: 0;
		transform: translate(-50%, -50%);
		display: grid;
		place-items: center;
	}

	/* Silver digit number (same glyph art as the big-win counter). */
	.rws-number {
		display: flex;
		align-items: flex-end;
		justify-content: center;
		filter: drop-shadow(0 0.25vh 0.4vh rgba(0, 0, 0, 0.55));
	}
	.rws-digit {
		height: var(--rws-digit-h);
		width: auto;
		display: block;
		margin: 0 calc(var(--rws-digit-h) * -0.008);
	}
	.rws-dot {
		height: calc(var(--rws-digit-h) * 0.27);
		align-self: flex-end;
		margin: 0 calc(var(--rws-digit-h) * 0.008);
	}
	.rws-sep {
		align-self: flex-end;
		font-family: 'Arial Black', Arial, sans-serif;
		font-weight: 900;
		font-size: calc(var(--rws-digit-h) * 0.52);
		line-height: 1;
		color: #eef2f7;
		-webkit-text-stroke: calc(var(--rws-digit-h) * 0.022) #2b3038;
		paint-order: stroke fill;
		padding-bottom: calc(var(--rws-digit-h) * 0.05);
		margin: 0 calc(var(--rws-digit-h) * 0.008);
	}
</style>
