<script lang="ts">
	import { onMount } from 'svelte';

	import { playSound } from '../game/sound';
	import { staticUrl } from '../lib/staticUrl';
	import {
		WIN_BACKDROP_ART,
		WIN_DOT_ART,
		WIN_POPUP_TIMING,
		WIN_RAYS_ART,
		WIN_TIER_BANNER,
		popupDecimals,
		popupFormat,
		winDigitArt,
		winTierForMultiplier,
	} from '../lib/winPopup';

	/**
	 * One-Eyed Willy's win popup (apps/plinko WinCelebration.svelte), for the table: a shade, a
	 * spinning burst of rays, the tier's banner popping in over a silver counter that climbs to the
	 * win, then all of it fading off. The coins are not part of it — the table's own collect carries
	 * the win to the balance. Mounted for the length of the reveal; `show` is a new object per win.
	 */
	let {
		show,
		portrait = false,
	}: {
		show: { id: number; amount: number; multiplier: number } | null;
		portrait?: boolean;
	} = $props();

	let entered = $state(false);
	let exiting = $state(false);
	let numberVisible = $state(false);
	let chars = $state<string[]>([]);

	// The row's width in digit-heights (a dot is narrower), so a long win is fitted to the screen.
	const units = $derived(
		Math.max(
			1,
			(show ? popupFormat(show.amount, popupDecimals(show.amount)) : '')
				.split('')
				.reduce((sum, c) => sum + (c === '.' ? 0.42 : 0.74), 0),
		),
	);

	const tier = $derived(winTierForMultiplier(show?.multiplier ?? 0));

	const timers = new Set<ReturnType<typeof setTimeout>>();
	let countRaf = 0;
	const later = (fn: () => void, ms: number) => {
		const id = setTimeout(() => {
			timers.delete(id);
			fn();
		}, ms);
		timers.add(id);
	};
	const stop = () => {
		timers.forEach(clearTimeout);
		timers.clear();
		if (countRaf) cancelAnimationFrame(countRaf);
		countRaf = 0;
	};

	const countUp = (amount: number, decimals: number) => {
		const t0 = performance.now();
		let shown = chars.join('');
		const tick = (now: number) => {
			const p = Math.min(1, (now - t0) / WIN_POPUP_TIMING.countUp);
			const eased = 1 - Math.pow(1 - p, 2.2);
			const next = popupFormat(p < 1 ? amount * eased : amount, decimals);
			// Only written when the digits change: the ease-out spends its tail barely moving.
			if (next !== shown) {
				shown = next;
				chars = next.split('');
			}
			countRaf = p < 1 ? requestAnimationFrame(tick) : 0;
		};
		countRaf = requestAnimationFrame(tick);
	};

	const begin = (amount: number) => {
		stop();
		entered = false;
		exiting = false;
		numberVisible = false;
		const decimals = popupDecimals(amount);
		chars = popupFormat(0, decimals).split('');
		playSound('openPopup');
		// A double rAF, so the hidden start paints before the transitions engage; a single one batches
		// with the mount and the reveal snaps in instead of growing.
		requestAnimationFrame(() => requestAnimationFrame(() => (entered = true)));
		later(() => {
			numberVisible = true;
			playSound('coinShuffle');
			countUp(amount, decimals);
		}, WIN_POPUP_TIMING.countDelay);
		later(
			() => (exiting = true),
			WIN_POPUP_TIMING.countDelay + WIN_POPUP_TIMING.countUp + WIN_POPUP_TIMING.hold,
		);
	};

	let shownId = 0;
	$effect(() => {
		if (!show) {
			if (shownId) {
				shownId = 0;
				stop();
				entered = false;
				exiting = false;
				numberVisible = false;
			}
			return;
		}
		if (show.id === shownId) return;
		shownId = show.id;
		begin(show.amount);
	});

	onMount(() => stop);
</script>

{#if show}
	<div
		class="wp-overlay"
		class:wp-overlay--portrait={portrait}
		class:entered
		class:exiting
		style="--wp-units:{units}"
		aria-hidden="true"
	>
		<img class="wp-backdrop" src={staticUrl(WIN_BACKDROP_ART)} alt="" decoding="sync" />
		<div class="wp-rays-wrap">
			<img class="wp-rays-img" src={staticUrl(WIN_RAYS_ART)} alt="" decoding="sync" />
		</div>
		<img class="wp-banner" src={staticUrl(WIN_TIER_BANNER[tier])} alt="" data-tier={tier} />
		<div class="wp-number" class:visible={numberVisible}>
			<div class="wp-number-row">
				{#each chars as ch, i (i)}
					{#if ch === '.'}
						<img class="wp-digit wp-dot" src={staticUrl(WIN_DOT_ART)} alt="." />
					{:else}
						<img class="wp-digit" src={staticUrl(winDigitArt(ch))} alt={ch} />
					{/if}
				{/each}
			</div>
		</div>
	</div>
{/if}

<style>
	/* Outside the framed, zoomed game, over everything on the table. Sized in viewport units so it is
	   the same reveal at any window, the way Willy's is. */
	.wp-overlay {
		position: fixed;
		inset: 0;
		z-index: 15000;
		pointer-events: none;
		overflow: hidden;
		--wp-cx: 50vw;
		--wp-number-y: 46vh;
		--wp-banner-y: 30vh;
		--wp-rays: clamp(575px, 81vw, 1284px);
		--wp-banner-h: clamp(39px, 5.7vw, 96px);
		--wp-digit-h: max(34px, min(16vh, 7.2vw, calc(82vw / var(--wp-units, 6))));
		--wp-banner-max-w: 92vw;
	}
	.wp-overlay--portrait {
		--wp-cx: 50vw;
		--wp-number-y: 42vh;
		--wp-banner-y: 30vh;
		--wp-rays: 196vw;
		--wp-banner-h: 11.2vw;
		--wp-digit-h: max(34px, min(15vw, calc(82vw / var(--wp-units, 6))));
	}

	/* The biggest layer on the page: kept on its own composited layer for the whole reveal so that
	   finishing its fade cannot demote it and re-raster it a frame late (a one-frame flash of the
	   bright table on phones). Willy's own note; the art is a small pure radial blur on purpose. */
	.wp-backdrop {
		position: absolute;
		left: var(--wp-cx);
		top: var(--wp-number-y);
		width: calc(var(--wp-rays) * 1.35);
		height: calc(var(--wp-rays) * 1.35);
		transform: translate(-50%, -50%) translateZ(0);
		backface-visibility: hidden;
		will-change: opacity;
		object-fit: fill;
		z-index: 0;
		opacity: 0;
		transition: opacity 0.3s ease;
	}
	.wp-overlay.entered .wp-backdrop {
		opacity: 1;
	}

	/* The wrap owns the grow-in, the img the endless spin, so the two transforms never fight; the
	   opacity sits on the img, because group opacity on a rotating wrap re-renders it every frame. */
	.wp-rays-wrap {
		position: absolute;
		left: var(--wp-cx);
		top: var(--wp-number-y);
		width: var(--wp-rays);
		height: var(--wp-rays);
		transform: translate(-50%, -50%) scale(0.55);
		z-index: 1;
		will-change: transform;
		transition: transform 0.55s cubic-bezier(0.2, 0.8, 0.3, 1);
	}
	.wp-overlay.entered .wp-rays-wrap {
		transform: translate(-50%, -50%) scale(1);
	}
	.wp-rays-img {
		width: 100%;
		height: 100%;
		opacity: 0;
		animation: wp-rays-spin 30s linear infinite;
		transform-origin: center;
		backface-visibility: hidden;
		will-change: transform, opacity;
		transition: opacity 0.4s ease;
	}
	.wp-overlay.entered .wp-rays-img {
		opacity: 0.9;
	}
	@keyframes wp-rays-spin {
		to {
			transform: rotate(360deg);
		}
	}

	/* The banner pops: small and fading in, past its size, then settling. `backwards` fill, so it falls
	   back to the rule's own opacity afterwards and the exit can still take over. Height is the
	   orientation's base times the tier's scale; `contain` keeps the art from stretching once the
	   width cap binds. Scales are Willy's. */
	.wp-banner {
		position: absolute;
		left: var(--wp-cx);
		top: var(--wp-banner-y);
		--wp-banner-scale: 1;
		height: calc(var(--wp-banner-h) * var(--wp-banner-scale));
		width: auto;
		max-width: var(--wp-banner-max-w);
		object-fit: contain;
		z-index: 3;
		transform: translate(-50%, -50%);
		opacity: 0;
		filter: drop-shadow(0 0.4vh 0.6vh rgba(0, 0, 0, 0.55));
		transition: opacity 0.6s ease;
	}
	.wp-overlay.entered .wp-banner {
		opacity: 1;
		animation: wp-banner-pop 0.72s ease-out backwards;
	}
	.wp-banner[data-tier='massive'] {
		--wp-banner-scale: 3.25;
	}
	.wp-banner[data-tier='epic'] {
		--wp-banner-scale: 4.04;
	}
	.wp-banner[data-tier='captain'] {
		--wp-banner-scale: 4.7209;
	}
	.wp-overlay--portrait .wp-banner[data-tier='massive'] {
		--wp-banner-scale: 2.2;
	}
	.wp-overlay--portrait .wp-banner[data-tier='epic'] {
		--wp-banner-scale: 2.5;
	}
	.wp-overlay--portrait .wp-banner[data-tier='captain'] {
		--wp-banner-scale: 5;
	}
	@keyframes wp-banner-pop {
		0% {
			opacity: 0;
			transform: translate(-50%, -50%) scale(0.25);
		}
		60% {
			opacity: 1;
			transform: translate(-50%, -50%) scale(1.18);
		}
		100% {
			opacity: 1;
			transform: translate(-50%, -50%) scale(1);
		}
	}

	/* The silver counter rises into place from below while it fades in. */
	.wp-number {
		position: absolute;
		left: var(--wp-cx);
		top: var(--wp-number-y);
		transform: translate(-50%, -50%);
		z-index: 3;
	}
	.wp-number-row {
		display: flex;
		align-items: flex-end;
		justify-content: center;
		opacity: 0;
		transform: translateY(calc(var(--wp-digit-h) * 0.55));
		transition:
			opacity 0.4s ease,
			transform 0.5s cubic-bezier(0.2, 0.85, 0.3, 1);
		filter: drop-shadow(0 0.5vh 0.7vh rgba(0, 0, 0, 0.5));
		will-change: transform, filter;
	}
	.wp-number.visible .wp-number-row {
		opacity: 1;
		transform: translateY(0);
	}
	.wp-digit {
		height: var(--wp-digit-h);
		width: auto;
		display: block;
		margin: 0 calc(var(--wp-digit-h) * -0.008);
	}
	/* The dot's art is cropped tight to the dot, so it is scaled to a dot's share of a digit. */
	.wp-dot {
		height: calc(var(--wp-digit-h) * 0.27);
		align-self: flex-end;
		margin: 0 calc(var(--wp-digit-h) * 0.008);
	}

	.wp-overlay.exiting .wp-backdrop,
	.wp-overlay.exiting .wp-rays-img,
	.wp-overlay.exiting .wp-banner,
	.wp-overlay.exiting .wp-number-row {
		opacity: 0;
		transition: opacity 0.6s ease;
	}
</style>
