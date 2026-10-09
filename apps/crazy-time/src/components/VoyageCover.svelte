<script lang="ts">
	/**
	 * The covers Ocean Voyage comes on and goes off under, over the whole game frame.
	 *
	 * The way in (`flood`, Game.svelte's `enterRoom`): the sea rises up the screen over the table (or
	 * the Buy Bonus screen) — the same water the kraken's ending brings up — and the ship that sailed
	 * off the wedge, waiting in the middle of the screen (VoyageReveal's `sailOff`, handed over here),
	 * is caught by it and floats up on its crest, rides there a moment, and sails off as the water
	 * closes over the top. The room is put on under the water, and the water drains away off it.
	 *
	 * The way out, as the voyage ended (Game.svelte's `coverRoomExit`), put up over the room and taken
	 * off the table:
	 *
	 * - `gold` — the voyage made port: the cave has already zoomed in on its treasure, and the zoom
	 *   carries on into a bloom of gold light, opening out from the treasure until it fills the
	 *   screen. Taken off, it fades away to the table, swelling a little as it goes.
	 *
	 * - `sink` — the kraken took the ship: the room lists over (`screen`, tilted about its foot) as
	 *   the sea rises up the screen from the bottom, a crest of water on its top edge and bubbles
	 *   going up through it, until the screen is under. Taken off, the water drains away down the
	 *   screen to the table.
	 *
	 * Either way the room goes unseen under it, and the wedge's ship then sails home onto the table
	 * (VoyageReveal's `land`), as it does after every voyage. Every beat waits on the clock, not on
	 * animation events, so a tab in the background cannot leave the round waiting on a frame.
	 */
	import { tick } from 'svelte';
	import { waitForTimeout } from 'utils-shared/wait';

	import { ROOM_ICON } from '../game/constants';
	import { playSound } from '../game/sound';
	import { staticCssUrl, staticUrl } from '../lib/staticUrl';

	type EndingKind = 'gold' | 'sink';
	type Frame = { w: number; h: number };
	/** A ship as VoyageReveal lays it out: its middle, and its width. */
	type Box = { x: number; y: number; size: number };

	const SHIP = staticUrl(ROOM_ICON.oceanVoyage.src);
	const ASPECT = ROOM_ICON.oceanVoyage.aspect;
	/**
	 * The flood's beats: the water rising to the ship (FLOOD_REACH_MS), lifting it on its crest to
	 * FLOAT_AT of the way down the screen (FLOOD_LIFT_MS), riding there (FLOAT_MS), and closing over
	 * the top as the ship sails off to the right (FLOOD_CLOSE_MS).
	 */
	const FLOOD_REACH_MS = 650;
	const FLOOD_LIFT_MS = 650;
	const FLOAT_MS = 500;
	const FLOOD_CLOSE_MS = 650;
	const FLOAT_AT = 0.4;
	/** Where on the ship's drawing the water comes to, down from its middle (share of its height). */
	const SHIP_WATERLINE = 0.3;

	/** The bloom opening out to fill the screen, and fading off the table. */
	const BLOOM_MS = 750;
	const BLOOM_OFF_MS = 800;
	/** Where the bloom opens from: the treasure, which the zoom leaves in the middle of the screen. */
	const BLOOM_AT = '50% 48%';
	/** The sea rising over the screen, and draining off the table. */
	const RISE_MS = 1100;
	const DRAIN_MS = 950;
	/** The room listing over as it goes under. */
	const LIST_DEG = -4;
	/** The crest on the water's top edge, against the frame's shorter side. */
	const CREST_SHARE = 0.09;
	/** The ripples laid over the water: the room's own (`sea_overlay`). */
	const RIPPLES = staticCssUrl('img/ocean-voyage/sea_overlay.webp');
	/** Bubbles going up through the water: where across (share of the width), how big (share of the
	    crest), and when each starts (share of its loop). */
	const BUBBLES = [
		[0.08, 0.35, 0.1],
		[0.19, 0.22, 0.55],
		[0.31, 0.5, 0.3],
		[0.44, 0.28, 0.8],
		[0.52, 0.4, 0.05],
		[0.63, 0.25, 0.45],
		[0.74, 0.45, 0.7],
		[0.86, 0.3, 0.2],
		[0.93, 0.2, 0.6],
	];

	let kind = $state<EndingKind | 'flood' | null>(null);
	/** The ship riding the flood, where VoyageReveal left it. */
	let rider = $state<Box | null>(null);
	let riderEl: HTMLDivElement | undefined = $state();
	/** How far through a swell the ship's riding was when it was handed over, to carry on from there. */
	let riderPhase = $state(0);
	let frame = $state<Frame>({ w: 0, h: 0 });
	let bloomEl: HTMLDivElement | undefined = $state();
	let waterEl: HTMLDivElement | undefined = $state();

	const crest = $derived(Math.min(frame.w, frame.h) * CREST_SHARE);

	/** Put the cover up over the room (`screen`, the bonus screen, which the sinking tilts). */
	export const cover = async (
		by: EndingKind,
		size: Frame,
		screen: HTMLElement | null,
	): Promise<void> => {
		frame = size;
		kind = by;
		await tick();
		if (by === 'gold') {
			playSound('whoosh', 1.15);
			bloomEl?.animate(
				[
					{ clipPath: `circle(0% at ${BLOOM_AT})`, opacity: 0.7, filter: 'brightness(1.8)' },
					{ clipPath: `circle(85% at ${BLOOM_AT})`, opacity: 1, filter: 'brightness(1)' },
				],
				{ duration: BLOOM_MS, easing: 'cubic-bezier(0.5, 0, 0.75, 0.4)', fill: 'forwards' },
			);
			await waitForTimeout(BLOOM_MS);
			return;
		}
		playSound('whoosh', 0.6);
		screen?.animate(
			[
				{ transform: 'none', transformOrigin: '50% 100%' },
				{ transform: `rotate(${LIST_DEG}deg) translateY(3%) scale(1.04)`, transformOrigin: '50% 100%' },
			],
			{ duration: RISE_MS, easing: 'ease-in', fill: 'forwards' },
		);
		waterEl?.animate(
			[{ transform: `translateY(${size.h + crest}px)` }, { transform: 'translateY(0)' }],
			{ duration: RISE_MS, easing: 'cubic-bezier(0.45, 0, 0.7, 0.6)', fill: 'forwards' },
		);
		await waitForTimeout(RISE_MS);
	};

	/** Animate `el` from `a` to `b`, dropping whatever it was doing once the new move holds. */
	const slide = (el: HTMLElement | undefined, a: string, b: string, ms: number, easing: string) => {
		const old = el?.getAnimations() ?? [];
		el?.animate([{ transform: a }, { transform: b }], { duration: ms, easing, fill: 'forwards' });
		old.forEach((x) => x.cancel());
	};
	/** The water's place for its surface (the middle of the crest) to be `y` down the frame. */
	const waterAt = (y: number) => `translateY(${(y + crest / 2).toFixed(1)}px)`;

	/**
	 * The way in: the sea up over the screen, carrying `ship` (VoyageReveal's, handed over in the same
	 * frame) up on its crest and off. Resolves with the screen under water, for the room to be put on
	 * under it; `uncover` drains it off.
	 */
	export const flood = async (
		size: Frame,
		ship: Box | null,
		rideMs = 0,
	): Promise<void> => {
		frame = size;
		kind = 'flood';
		rider = ship;
		riderPhase = rideMs;
		await tick();
		const below = size.h + crest;
		// Where the surface meets the ship, and where it floats it up to.
		const reach = ship ? Math.min(size.h, ship.y + (ship.size / ASPECT) * SHIP_WATERLINE) : size.h;
		const float = Math.min(reach, size.h * FLOAT_AT);
		const lift = reach - float;

		playSound('whoosh', 0.6);
		slide(waterEl, `translateY(${below}px)`, waterAt(reach), FLOOD_REACH_MS, 'cubic-bezier(0.45, 0, 0.8, 0.6)');
		await waitForTimeout(FLOOD_REACH_MS);

		// Caught: the ship goes up with the water, by just as much, on the same curve.
		const lifting = 'cubic-bezier(0.2, 0.6, 0.35, 1)';
		slide(waterEl, waterAt(reach), waterAt(float), FLOOD_LIFT_MS, lifting);
		slide(riderEl, 'translate(0, 0)', `translate(0, ${-lift}px)`, FLOOD_LIFT_MS, lifting);
		await waitForTimeout(FLOOD_LIFT_MS + FLOAT_MS);

		// Over the top, and the ship away to the right on it.
		const closing = 'cubic-bezier(0.5, 0, 0.8, 0.5)';
		playSound('whoosh', 0.9);
		slide(waterEl, waterAt(float), 'translateY(0)', FLOOD_CLOSE_MS, closing);
		if (ship)
			slide(
				riderEl,
				`translate(0, ${-lift}px)`,
				`translate(${size.w / 2 + ship.size}px, ${-(lift + float + crest)}px)`,
				FLOOD_CLOSE_MS,
				closing,
			);
		await waitForTimeout(FLOOD_CLOSE_MS);
		rider = null;
	};

	/** Take the cover off the table: the gold fades, the water drains. */
	export const uncover = async (): Promise<void> => {
		if (kind === 'gold') {
			bloomEl?.animate(
				[
					{ opacity: 1, transform: 'scale(1)' },
					{ opacity: 0, transform: 'scale(1.08)' },
				],
				{ duration: BLOOM_OFF_MS, easing: 'ease-out', fill: 'forwards' },
			);
			await waitForTimeout(BLOOM_OFF_MS);
		} else if (kind === 'sink' || kind === 'flood') {
			playSound('whoosh', 0.75);
			waterEl?.animate(
				[{ transform: 'translateY(0)' }, { transform: `translateY(${frame.h + crest}px)` }],
				{ duration: DRAIN_MS, easing: 'cubic-bezier(0.4, 0, 0.6, 1)', fill: 'forwards' },
			);
			await waitForTimeout(DRAIN_MS);
		}
		kind = null;
	};

	/** Gone at once (the game torn down mid-way). */
	export const clear = () => {
		kind = null;
		rider = null;
	};
</script>

{#if kind}
	<div class="ending" aria-hidden="true">
		{#if kind === 'gold'}
			<div class="bloom" bind:this={bloomEl} style="--at:{BLOOM_AT}"></div>
		{:else}
			<!-- The water's top edge is the crest, a crest's height above the frame's top once it is up;
			     the body below it covers the frame. -->
			<div
				class="water"
				bind:this={waterEl}
				style="top:{-crest}px; height:{frame.h + crest}px; --crest:{crest}px; transform:translateY({frame.h + crest}px)"
			>
				<div class="crest"></div>
				<div class="body" style="background-image:{RIPPLES}, linear-gradient(180deg, #0f4f7c 0%, #082f4f 35%, #04182b 75%, #020b15 100%)">
					{#each BUBBLES as [x, size, phase], i (i)}
						<span
							class="bubble"
							style="left:{x * 100}%; width:{(crest * size).toFixed(1)}px; height:{(crest * size).toFixed(1)}px; animation-delay:{(-phase * 1800).toFixed(0)}ms"
						></span>
					{/each}
				</div>
			</div>
			<!-- The ship the flood carries: laid out just where VoyageReveal had it, riding the waves as it
			     did there, and moved by the water from then on. -->
			{#if kind === 'flood' && rider}
				<div
					class="rider"
					bind:this={riderEl}
					style="left:{rider.x - rider.size / 2}px; top:{rider.y - rider.size / ASPECT / 2}px; width:{rider.size}px; height:{rider.size / ASPECT}px"
				>
					<div class="ride" style="animation-delay:{(-riderPhase).toFixed(0)}ms">
						<img src={SHIP} alt="" draggable="false" />
					</div>
				</div>
			{/if}
		{/if}
	</div>
{/if}

<style>
	/* Over the table and the bonus screen both, with the reveals (VoyageReveal's ship is at 60 too,
	   and is never up at the same time). */
	.ending {
		position: absolute;
		inset: 0;
		z-index: 60;
		pointer-events: none;
		overflow: hidden;
	}

	/* Gold light, white-hot at the treasure and deepening to old gold at the edges. */
	.bloom {
		position: absolute;
		inset: 0;
		clip-path: circle(0% at var(--at));
		background: radial-gradient(
			circle at var(--at),
			#fffbe6 0%,
			#ffe9a0 18%,
			#ffd45a 40%,
			#eba52a 72%,
			#a8650c 100%
		);
	}

	.water {
		position: absolute;
		left: 0;
		right: 0;
		will-change: transform;
	}
	/* A rolling crest: two rows of swells, the near one darker, sliding across against each other,
	   with a line of foam where the water breaks. Drawn, so it runs any width. */
	.crest {
		position: absolute;
		left: 0;
		right: 0;
		top: 0;
		height: var(--crest);
		background-image:
			url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 40' preserveAspectRatio='none'%3E%3Cpath d='M0 22 Q25 6 50 22 T100 22 T150 22 T200 22 V40 H0 Z' fill='%230f4f7c'/%3E%3Cpath d='M0 22 Q25 6 50 22 T100 22 T150 22 T200 22' fill='none' stroke='%23d8eef8' stroke-width='3' stroke-linecap='round' opacity='0.85'/%3E%3C/svg%3E"),
			url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 40' preserveAspectRatio='none'%3E%3Cpath d='M0 14 Q25 0 50 14 T100 14 T150 14 T200 14 V40 H0 Z' fill='%23176a9c' opacity='0.8'/%3E%3C/svg%3E");
		background-size:
			calc(var(--crest) * 5) 100%,
			calc(var(--crest) * 7) 100%;
		background-repeat: repeat-x;
		animation: crest-roll 1800ms linear infinite;
	}
	@keyframes crest-roll {
		to {
			background-position:
				calc(var(--crest) * 5) 0,
				calc(var(--crest) * -7) 0;
		}
	}
	.body {
		position: absolute;
		left: 0;
		right: 0;
		top: calc(var(--crest) - 1px);
		bottom: 0;
		overflow: hidden;
		background-size:
			calc(var(--crest) * 6) auto,
			100% 100%;
		background-blend-mode: screen, normal;
	}
	.bubble {
		position: absolute;
		bottom: -10%;
		border-radius: 50%;
		border: 2px solid rgba(200, 235, 255, 0.55);
		background: radial-gradient(circle at 35% 30%, rgba(255, 255, 255, 0.5), rgba(170, 220, 255, 0.08) 60%);
		animation: bubble-up 1800ms ease-in infinite;
	}
	@keyframes bubble-up {
		from {
			transform: translateY(0);
			opacity: 0;
		}
		15% {
			opacity: 1;
		}
		to {
			transform: translateY(-110vh);
			opacity: 0.2;
		}
	}
	/* The ship on the flood, riding the waves exactly as VoyageReveal's does (`ride`), so the hand-over
	   between the two is not seen. */
	.rider {
		position: absolute;
		will-change: transform;
	}
	.ride {
		width: 100%;
		height: 100%;
		transform-origin: 50% 85%;
		animation: ride 1400ms ease-in-out infinite;
	}
	@keyframes ride {
		0%,
		100% {
			transform: rotate(-7deg) translateY(0);
		}
		25% {
			transform: rotate(0deg) translateY(-4%);
		}
		50% {
			transform: rotate(7deg) translateY(0);
		}
		75% {
			transform: rotate(0deg) translateY(-3%);
		}
	}
	.rider img {
		display: block;
		width: 100%;
		height: 100%;
		filter: drop-shadow(0 0.4vw 0.8vw rgba(0, 0, 0, 0.6));
	}
	@media (prefers-reduced-motion: reduce) {
		.crest,
		.bubble,
		.ride {
			animation: none;
		}
	}
</style>
