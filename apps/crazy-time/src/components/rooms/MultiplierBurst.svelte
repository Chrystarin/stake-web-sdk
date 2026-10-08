<script lang="ts">
	/**
	 * A room's multiplier, bursting into view: the Treasure Chest's number, lifted out of the chest
	 * so every bonus room says what it paid the same way. The chest writes it on each chest's front
	 * as the lid comes off; the other three rooms have it struck over the middle of the screen once
	 * they settle (`BonusRound`). Change it here and all four change with it.
	 *
	 * It is cut in the table's own letters (`.mult-badge`, global) on a warm glow of its own, so a
	 * gold number still reads over gold coins, gilded wood or open water. Every measurement is in
	 * `em`: the size comes from whatever sets `font-size` on it, and where it sits is the caller's.
	 */
	type Props = {
		value: number;
		/** Hidden until this goes true; the burst plays each time it does. */
		shown?: boolean;
		/**
		 * Gold rays turning slowly behind the number: for a room's FINAL result only, so the one
		 * number that is the round's payout stands apart from the decoys the chest room shows first.
		 */
		rays?: boolean;
		/**
		 * Where the number is coming FROM, when it is already on the screen somewhere — Ocean Voyage's
		 * total on its barrel of gold: how far off it is (in this burst's own layout pixels, from where
		 * it will rest) and its size against this one. The burst then lifts off there at that size and
		 * flies in, growing, rather than swelling up out of nothing.
		 */
		from?: { x: number; y: number; scale: number } | null;
	};
	let { value, shown = true, rays = false, from = null }: Props = $props();
</script>

<div
	class="burst"
	class:shown
	class:from={Boolean(from)}
	style={from ? `--from-x:${from.x.toFixed(1)}px; --from-y:${from.y.toFixed(1)}px; --from-s:${from.scale.toFixed(3)}` : undefined}
>
	{#if rays}
		<div class="rays" aria-hidden="true"></div>
	{/if}
	<div class="mult-badge">
		<span class="mult-stroke" aria-hidden="true">{value}x</span>
		<span class="mult-fill">{value}x</span>
	</div>
</div>

<style>
	/* The box the glow is laid behind: a little over four numerals wide and one and a half tall —
	   the chest front it was first drawn for — and wider still for a long number. */
	.burst {
		position: relative;
		isolation: isolate;
		display: grid;
		place-items: center;
		box-sizing: border-box;
		min-width: 4.2em;
		height: 1.6em;
		padding: 0 0.6em;
		pointer-events: none;
		opacity: 0;
	}
	/* A gradient rather than a blur filter: a filter is rasterised afresh at every size a scaled
	   parent passes through (the last chest grows to four times its own), and a gradient is painted
	   by the compositor for nothing. `isolation` keeps the negative z-index under the number. */
	.burst::before {
		content: '';
		position: absolute;
		inset: -22% -8%;
		z-index: -1;
		border-radius: 50%;
		background: radial-gradient(
			ellipse closest-side,
			rgba(255, 214, 90, 0.85) 50%,
			rgba(255, 180, 50, 0.45) 72%,
			rgba(255, 160, 30, 0.12) 88%,
			rgba(255, 160, 30, 0) 100%
		);
	}
	/* Rays of light turning slowly behind the glow, faded out towards their tips. A square centred
	   on the number, several numbers tall, so they reach well past it on every side. */
	.rays {
		position: absolute;
		left: 50%;
		top: 50%;
		width: 7em;
		height: 7em;
		margin: -3.5em 0 0 -3.5em;
		z-index: -2;
		border-radius: 50%;
		background: repeating-conic-gradient(
			rgba(255, 226, 130, 0.6) 0deg 7deg,
			rgba(255, 226, 130, 0) 7deg 22.5deg
		);
		-webkit-mask-image: radial-gradient(circle closest-side, #000 20%, transparent 100%);
		mask-image: radial-gradient(circle closest-side, #000 20%, transparent 100%);
		animation: rays-turn 9s linear infinite;
	}
	@keyframes rays-turn {
		to {
			rotate: 360deg;
		}
	}
	/*
	 * The number comes OUT of something: it starts tiny and unseen a little above where it will
	 * rest, then swells towards the player as it fades in, overshoots, rebounds and settles. The
	 * short wait is for a chest's lid to come off (its drawings cross in 200ms); on the open screen
	 * it is just a breath after the landing.
	 */
	.burst.shown {
		opacity: 1;
		animation: burst 900ms 90ms both;
	}
	@keyframes burst {
		0% {
			opacity: 0;
			transform: translateY(-0.42em) scale(0.2);
			animation-timing-function: cubic-bezier(0.2, 0.7, 0.4, 1);
		}
		42% {
			opacity: 1;
			transform: translateY(-0.04em) scale(1.16);
			animation-timing-function: ease-in-out;
		}
		62% {
			transform: translateY(0) scale(0.93);
			animation-timing-function: ease-in-out;
		}
		80% {
			transform: translateY(0) scale(1.04);
			animation-timing-function: ease-in-out;
		}
		100% {
			opacity: 1;
			transform: translateY(0) scale(1);
		}
	}
	/*
	 * Or the number is taken off something already showing it (`from`): it starts there, at that
	 * size and already lit, and is carried in to the middle, swelling past its size as it arrives,
	 * then rebounds and settles as the plain burst does. No wait: what it leaves is gone the same
	 * frame, so any pause would be a blink.
	 */
	.burst.shown.from {
		animation: burst-from 1000ms both;
	}
	@keyframes burst-from {
		0% {
			opacity: 1;
			transform: translate(var(--from-x), var(--from-y)) scale(var(--from-s));
			animation-timing-function: cubic-bezier(0.35, 0.1, 0.25, 1);
		}
		58% {
			transform: translate(0, 0) scale(1.16);
			animation-timing-function: ease-in-out;
		}
		76% {
			transform: translate(0, 0) scale(0.94);
			animation-timing-function: ease-in-out;
		}
		90% {
			transform: translate(0, 0) scale(1.03);
			animation-timing-function: ease-in-out;
		}
		100% {
			opacity: 1;
			transform: translate(0, 0) scale(1);
		}
	}
</style>
