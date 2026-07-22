<script lang="ts">
	import { onMount } from 'svelte';
	import { scale } from 'svelte/transition';
	import { cubicIn, cubicOut } from 'svelte/easing';
	import { innerHeight, innerWidth } from 'svelte/reactivity/window';

	import { stateGame } from '../game/stateGame.svelte';
	import { frameImagePoint, framePaintedWidth, SKULL_MOUTH_CAVITY } from '../lib/frameArt';
	import { staticUrl } from '../lib/staticUrl';
	import {
		WIN_RAYS_ART,
		winDigitArt,
		WIN_DOT_ART,
		WIN_TIER_BANNER,
		winTierForMultiplier,
		type WinTier,
	} from '../lib/winCelebration';
	import {
		RAPID_SPARKLE_BASE_SIZE_RATIO,
		rapidSparkleSizeScale,
	} from '../lib/rapidWinSparkle';

	// The 1-ball rapid win reveal: small shine-ray sparkles with the win value + tier label printed over
	// them. Every sparkle SPAWNS AT THE SKULL'S MOUTH (no random scatter) and slowly floats UPWARD across
	// its lifetime, then shrinks + fades. State (max 3, `multiplier` sizes it) is managed by the
	// gameOrchestrator; this only draws it.

	const FALLBACK_FRAME_W = 900;

	// Base label (text) height as a fraction of the sparkle size, before the per-tier canvas multiplier.
	const BANNER_BASE_H = 0.13;

	// Per-tier banner image-height multiplier (off the sparkle's base label height). Matches the big-win
	// popup: the three banner PNGs fill a different share of their canvas, so the taller multipliers on
	// epic/captain make the visible TEXT read at roughly one height across all three tiers.
	const BANNER_TIER_H: Record<WinTier, number> = {
		massive: 0.976,
		epic: 2.04,
		captain: 2.7209,
	};

	// VISIBLE-text bottom padding of each banner PNG, as a fraction of the image height. Earlier I
	// measured this off alpha bounds (`alpha>24`), which caught faint drop-shadow tails BELOW the actual
	// text and under-counted epic/captain by ~8% each — the label→value gap ended up ~2–3× wider on those
	// tiers than on Massive. Now measured off the row DENSITY profile (half-max ink cutoff, see
	// `scratchpad/measure_banners_v2.mjs`): the row where the opaque density drops below half of the
	// banner's peak — that's where the eye actually reads "text ends". Cancelled with a negative
	// `margin-bottom` so every tier's visible gap matches Massive Plunder's.
	const BANNER_BOTTOM_PAD: Record<WinTier, number> = {
		massive: 0.07,
		epic: 0.22,
		captain: 0.22,
	};

	// How far a sparkle floats upward across its full lifetime, as a fraction of the sparkle size.
	// Modest so it drifts visibly during the ~1.5s TTL without leaving the frame.
	const FLOAT_DIST_RATIO = 0.65;

	// Per-pair spacing coefficient — the minimum vertical distance between the centres of two adjacent
	// stacked sparkles is `SPACING_COEFF × (size_lower + size_upper)`. The text region on each sparkle
	// covers ~55% of its height (banner + digits), so half of that on each side is 0.275; we use 0.28
	// with a hair of margin so the label of the newer sparkle sits just below the value of the older
	// one, no overlap. The rays' outermost tips may still kiss on same-tier stacks — that reads fine
	// (they're semi-transparent, brighter not scrambled).
	const STACK_SPACING_COEFF = 0.28;

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
		sizePx: number;
		digitH: number;
		bannerH: number;
		bannerMb: number;
		bannerSrc: string;
		floatPx: number;
		stackOffsetPx: number;
		chars: string[];
	};

	// Re-resolve on every layout change (the sparkles are fixed, outside the mobile layout class, so we
	// track window size like the other overlays do) and whenever the sparkle set changes.
	const placed = $derived.by<PlacedSparkle[]>(() => {
		innerWidth.current;
		innerHeight.current;
		const frameW = framePaintedWidth() ?? FALLBACK_FRAME_W;
		// Anchor at the vertical CENTRE LINE of the board (x = 0.5) instead of the skull-mouth cavity's
		// off-centre 0.5105 — the mouth art is drawn ~1% right-of-centre and it read as visibly out of
		// alignment with the play button + centre "0" slot, which are both dead-centred at 0.5.
		const mouth = frameImagePoint(0.5, SKULL_MOUTH_CAVITY.y);

		// Cumulative stack offsets keyed by id — walk the sparkles bottom→up (stackIndex 0 = at mouth)
		// and accumulate `SPACING_COEFF × (size_below + size_this)` per adjacent pair. This ensures the
		// TEXT REGIONS of neighbouring sparkles never overlap regardless of tier mix, since each pair
		// gets exactly the spacing IT needs — a captain-below-massive pair leaves more room than
		// massive-below-massive, and a captain-below-captain pair leaves the most.
		const sortedByStack = [...stateGame.rapidWinSparkles].sort((a, b) => a.stackIndex - b.stackIndex);
		const sizeById = new Map<number, number>();
		for (const s of sortedByStack) {
			sizeById.set(s.id, frameW * RAPID_SPARKLE_BASE_SIZE_RATIO * rapidSparkleSizeScale(s.multiplier));
		}
		const offsetById = new Map<number, number>();
		for (let i = 0; i < sortedByStack.length; i++) {
			if (i === 0) {
				offsetById.set(sortedByStack[0].id, 0);
			} else {
				const prev = sortedByStack[i - 1], curr = sortedByStack[i];
				const spacing = STACK_SPACING_COEFF * (sizeById.get(prev.id)! + sizeById.get(curr.id)!);
				offsetById.set(curr.id, offsetById.get(prev.id)! + spacing);
			}
		}

		return stateGame.rapidWinSparkles.map((s) => {
			const p = mouth ?? {
				x: (innerWidth.current ?? window.innerWidth) * 0.5,
				y: (innerHeight.current ?? window.innerHeight) * SKULL_MOUTH_CAVITY.y,
			};
			const sizePx = sizeById.get(s.id)!;
			const chars = fmt(s.amount).split('');
			// Fit the number within ~1.15× the ray width, capped so short amounts stay bold.
			let units = 0;
			for (const c of chars) units += c === ',' || c === '.' ? 0.42 : 0.72;
			units = Math.max(units, 1);
			const digitH = Math.max(12, Math.min(sizePx * 0.2, (sizePx * 1.15) / units));
			const tier = winTierForMultiplier(s.multiplier);
			const bannerH = sizePx * BANNER_BASE_H * BANNER_TIER_H[tier];
			// Pull the number up by this banner's transparent bottom padding IN EXCESS of Massive's, so the
			// label→value gap ends up identical across all three tiers (= Massive Plunder's gap).
			const massivePadPx = sizePx * BANNER_BASE_H * BANNER_TIER_H.massive * BANNER_BOTTOM_PAD.massive;
			const bannerMb = -(bannerH * BANNER_BOTTOM_PAD[tier] - massivePadPx);
			return {
				id: s.id,
				leftPx: p.x,
				topPx: p.y,
				sizePx,
				digitH,
				bannerH,
				bannerMb,
				bannerSrc: staticUrl(WIN_TIER_BANNER[tier]),
				floatPx: sizePx * FLOAT_DIST_RATIO,
				stackOffsetPx: offsetById.get(s.id) ?? 0,
				chars,
			};
		});
	});

	onMount(() => {
		// Preload the shared reveal art so the first sparkle never flashes an unloaded image.
		new Image().src = staticUrl(WIN_RAYS_ART);
		new Image().src = staticUrl(WIN_DOT_ART);
		for (let d = 0; d < 10; d++) new Image().src = staticUrl(winDigitArt(String(d)));
		for (const banner of Object.values(WIN_TIER_BANNER)) new Image().src = staticUrl(banner);
	});
</script>

{#if stateGame.ballPerDrop === 1}
	<!-- Overlay stays mounted for the whole 1-ball tier (idle when empty) so a sparkle removed from
	     the state array still gets its full out:scale/fade — an {#if placed.length > 0} guard would
	     tear the parent down before the child transition could play. -->
	<div class="rws-overlay" aria-hidden="true">
		{#each placed as s (s.id)}
			<!-- Anchor pinned at the skull's mouth. `.rws-stack` owns the vertical slot offset (newest at
			     mouth, older ones slid upward, smooth transition when the index changes so a bumped sparkle
			     glides rather than jumps). `.rws-float` owns the slow lifetime drift (CSS animation on
			     translateY). `.rws-sparkle` owns the in/out transitions. Each level owns a different
			     transform axis so they compose cleanly. -->
			<div class="rws-anchor" style="left:{s.leftPx}px; top:{s.topPx}px;">
				<div class="rws-stack" style="--rws-stack-offset: {s.stackOffsetPx}px;">
					<div class="rws-float" style="--rws-float: -{s.floatPx}px;">
						<div
							class="rws-sparkle"
							style="--rws-size:{s.sizePx}px; --rws-digit-h:{s.digitH}px; --rws-banner-h:{s.bannerH}px; --rws-banner-mb:{s.bannerMb}px;"
							in:scale={{ start: 0.35, opacity: 0, duration: 340, easing: cubicOut }}
							out:scale={{ start: 0.4, opacity: 0, duration: 360, easing: cubicIn }}
						>
						<img class="rws-rays" src={staticUrl(WIN_RAYS_ART)} alt="" />
						<div class="rws-content">
							<img class="rws-banner" src={s.bannerSrc} alt="" />
							<div class="rws-number">
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

	/* Fixed spawn point at the skull's mouth. No transform of its own; the float + centring live below. */
	.rws-anchor {
		position: absolute;
	}

	/* Vertical stack slot offset. Newest sparkle has stackOffset=0 (sits at the mouth); when a new one
	   is pushed, every older sparkle's `--rws-stack-offset` bumps by one slot's worth and this element
	   glides upward — the transition here is what turns the slot bump into a smooth slide instead of a
	   jump. Composed on top of the .rws-float animation below (each level owns a different transform). */
	.rws-stack {
		transform: translateY(calc(-1 * var(--rws-stack-offset, 0px)));
		transition: transform 340ms cubic-bezier(0.2, 0.8, 0.3, 1);
	}

	/* Slow upward drift over the sparkle's lifetime (enter + live + exit ≈ 1860ms). `forwards` fill so it
	   holds at the top-most position after the animation completes, in case the sparkle's exit hasn't
	   quite finished. Linear so the drift reads as a steady float, not an ease-in landing. */
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

	/* Each sparkle is centred on the (floated) anchor point; rays sit behind the label + value. */
	.rws-sparkle {
		position: absolute;
		left: 0;
		top: 0;
		width: var(--rws-size);
		height: var(--rws-size);
		transform: translate(-50%, -50%);
		display: grid;
		place-items: center;
	}

	.rws-rays {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		opacity: 0.92;
		animation: rws-spin 18s linear infinite;
		transform-origin: center;
	}
	@keyframes rws-spin {
		to {
			transform: rotate(360deg);
		}
	}

	/* Tier label above the value, both stacked over the centre of the rays. */
	.rws-content {
		position: relative;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: calc(var(--rws-size) * 0.01);
	}
	.rws-banner {
		height: var(--rws-banner-h);
		width: auto;
		max-width: calc(var(--rws-size) * 1.25);
		display: block;
		/* Cancel this banner's excess transparent bottom padding so the label→value gap matches Massive
		   Plunder's across every tier (the `.rws-content` gap is then the single, uniform spacing). */
		margin-bottom: var(--rws-banner-mb, 0px);
		filter: drop-shadow(0 0.2vh 0.35vh rgba(0, 0, 0, 0.55));
	}

	/* Silver digit number over the rays (same glyph art as the big-win counter). */
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
