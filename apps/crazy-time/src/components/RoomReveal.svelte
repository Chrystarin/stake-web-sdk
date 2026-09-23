<script lang="ts">
	/**
	 * The way into the Treasure Chest: the chest on the wedge the wheel landed on is lifted off the
	 * disc, carried to the middle of the wheel and grown there, held in a pulse of gold, and opened
	 * — and the light of what is inside pours out of it until it is the whole screen. The room is
	 * put up under that light (see BonusRound's `litEntrance`), and `clear` fades it away off the
	 * room, so the chest's light IS the cut from the table to the room.
	 *
	 * Everything is laid out in the game frame's own pixels (the caller converts client rects, see
	 * `centreIn` in Game.svelte), and every beat is timed by the clock rather than by animation
	 * events, so a tab in the background cannot leave the round waiting on a frame that never comes.
	 */
	import { tick } from 'svelte';
	import { waitForTimeout } from 'utils-shared/wait';

	import { playSound } from '../game/sound';
	import { staticUrl } from '../lib/staticUrl';

	type Box = { x: number; y: number; size: number };

	const CLOSED = staticUrl('img/treasure_chest/wheel_icon_chest_closed.webp');
	const OPENED = staticUrl('img/treasure_chest/wheel_icon_chest_opened.webp');
	/**
	 * Where the treasure is in the open drawing, off the box's centre as a share of its size: the
	 * heap of coins and the crown sit about 0.47 down the square canvas. The light starts there.
	 */
	const TREASURE_DY = -0.03;

	/** The beats, in ms. */
	const LIFT_MS = 650;
	const PULSE_MS = 760;
	const OPEN_MS = 520;
	const POUR_MS = 900;
	const CLEAR_MS = 700;

	let shown = $state(false);
	let opened = $state(false);
	let box = $state<Box>({ x: 0, y: 0, size: 0 });
	let light = $state({ x: 0, y: 0, d: 0 });

	let iconEl: HTMLDivElement | undefined = $state();
	let lightEl: HTMLDivElement | undefined = $state();
	let washEl: HTMLDivElement | undefined = $state();

	/**
	 * From the chest on its wedge (`from`) to the chest opened in the middle of the wheel (`to`),
	 * and on to a screen of light. Resolves with the screen white: whatever is put up now is hidden
	 * until `clear`. `frame` is the game frame's size, which the light has to cover corner to corner.
	 */
	export const play = async (
		from: Box,
		to: Box,
		frame: { w: number; h: number },
	): Promise<void> => {
		box = to;
		opened = false;
		shown = true;
		// The chest is laid out where it ends up, and starts from its wedge by transform alone.
		await tick();

		// Lifted off the wedge and grown into the middle of the wheel, overshooting a little.
		playSound('whoosh');
		const k = from.size / to.size;
		iconEl?.animate(
			[
				{ transform: `translate(${from.x - to.x}px, ${from.y - to.y}px) scale(${k})` },
				{ transform: 'translate(0, 0) scale(1.06)', offset: 0.75 },
				{ transform: 'translate(0, 0) scale(1)' },
			],
			{ duration: LIFT_MS, easing: 'cubic-bezier(0.3, 0.8, 0.3, 1)', fill: 'both' },
		);
		await waitForTimeout(LIFT_MS);

		// Held there in two pulses of gold, the rays turning behind it.
		iconEl?.animate(
			[
				{ transform: 'scale(1)' },
				{ transform: 'scale(1.09)' },
				{ transform: 'scale(1)' },
				{ transform: 'scale(1.09)' },
				{ transform: 'scale(1)' },
			],
			{ duration: PULSE_MS, easing: 'ease-in-out' },
		);
		await waitForTimeout(PULSE_MS);

		// Opened: the lid comes up with a jolt.
		opened = true;
		playSound('doorOpen');
		iconEl?.animate(
			[{ transform: 'scale(1.16)' }, { transform: 'scale(0.97)' }, { transform: 'scale(1)' }],
			{ duration: 360, easing: 'ease-out' },
		);
		await waitForTimeout(OPEN_MS);

		// The light pours out of the treasure until it is the whole screen. The disc is drawn at
		// full size and scaled up from the chest's mouth; its solid core is half its diameter, so the
		// core alone has to reach the farthest corner of the frame.
		const lx = to.x;
		const ly = to.y + TREASURE_DY * to.size;
		const reach = Math.hypot(Math.max(lx, frame.w - lx), Math.max(ly, frame.h - ly));
		light = { x: lx, y: ly, d: reach * 2 * 2.1 };
		await tick();
		playSound('whoosh');
		lightEl?.animate(
			[
				{ transform: `scale(${(to.size * 0.35) / light.d})`, opacity: 0 },
				{ opacity: 1, offset: 0.15 },
				{ transform: 'scale(1)', opacity: 1 },
			],
			{ duration: POUR_MS, easing: 'cubic-bezier(0.55, 0, 0.75, 0.5)', fill: 'both' },
		);
		await waitForTimeout(POUR_MS);
		washEl?.animate([{ opacity: 1 }], { duration: 0, fill: 'forwards' });
	};

	/** The light fades off whatever is under it now. Resolves once it is gone. */
	export const clear = async (): Promise<void> => {
		if (!shown) return;
		// The chest and the light disc go at once, unseen under the wash.
		iconEl?.getAnimations().forEach((a) => a.cancel());
		lightEl?.getAnimations().forEach((a) => a.cancel());
		opened = false;
		box = { ...box, size: 0 };
		const fade = washEl?.animate([{ opacity: 1 }, { opacity: 0 }], {
			duration: CLEAR_MS,
			easing: 'ease-in',
			fill: 'forwards',
		});
		await waitForTimeout(CLEAR_MS);
		fade?.cancel();
		washEl?.getAnimations().forEach((a) => a.cancel());
		shown = false;
	};
</script>

{#if shown}
	<div class="reveal" aria-hidden="true">
		{#if box.size > 0}
			<div
				class="icon"
				class:opened
				bind:this={iconEl}
				style="left:{box.x - box.size / 2}px; top:{box.y - box.size / 2}px; width:{box.size}px; height:{box.size}px"
			>
				<div class="rays"></div>
				<div class="halo"></div>
				<img class="art closed" src={CLOSED} alt="" draggable="false" />
				<img class="art open" src={OPENED} alt="" draggable="false" />
			</div>
		{/if}
		<!-- Over the chest, not behind it: the light comes out of the treasure and swallows the chest
		     it came from on its way to the edges of the screen. -->
		<div
			class="light"
			bind:this={lightEl}
			style="left:{light.x - light.d / 2}px; top:{light.y - light.d / 2}px; width:{light.d}px; height:{light.d}px"
		></div>
		<div class="wash" bind:this={washEl}></div>
	</div>
{/if}

<style>
	/* Over everything in the frame, the balance and the wager included: the light is the screen. */
	.reveal {
		position: absolute;
		inset: 0;
		z-index: 60;
		pointer-events: none;
		overflow: hidden;
	}
	.icon {
		position: absolute;
		transform-origin: center center;
	}
	.art {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: contain;
	}
	.art.open {
		opacity: 0;
	}
	.opened .art.open {
		opacity: 1;
	}
	.opened .art.closed {
		opacity: 0;
	}
	/* A pool of gold behind the chest, breathing with the pulse, and brighter once it is open. */
	.halo {
		position: absolute;
		inset: -30%;
		border-radius: 50%;
		background: radial-gradient(
			circle closest-side,
			rgba(255, 244, 190, 0.95) 0%,
			rgba(255, 210, 90, 0.7) 35%,
			rgba(255, 170, 40, 0.28) 65%,
			rgba(255, 160, 30, 0) 100%
		);
		opacity: 0.75;
		animation: halo-in 400ms ease-out both;
		transition: opacity 200ms ease;
	}
	.opened .halo {
		opacity: 1;
	}
	@keyframes halo-in {
		from {
			opacity: 0;
			transform: scale(0.4);
		}
	}
	/* Rays of light turning slowly behind it, faded out towards their tips. */
	.rays {
		position: absolute;
		inset: -75%;
		border-radius: 50%;
		background: repeating-conic-gradient(
			rgba(255, 226, 130, 0.55) 0deg 7deg,
			rgba(255, 226, 130, 0) 7deg 22.5deg
		);
		-webkit-mask-image: radial-gradient(circle closest-side, #000 20%, transparent 100%);
		mask-image: radial-gradient(circle closest-side, #000 20%, transparent 100%);
		animation:
			rays-in 500ms ease-out both,
			rays-turn 9s linear infinite;
	}
	@keyframes rays-in {
		from {
			opacity: 0;
		}
	}
	@keyframes rays-turn {
		to {
			rotate: 360deg;
		}
	}
	/* The light out of the chest: a white core half its diameter, warming to gold at its edge. */
	.light {
		position: absolute;
		border-radius: 50%;
		opacity: 0;
		background: radial-gradient(
			circle closest-side,
			#fffdf4 0%,
			#fff8dc 50%,
			rgba(255, 226, 140, 0.75) 72%,
			rgba(255, 200, 80, 0) 100%
		);
	}
	/* The screen once the light has filled it — the same white as the core — and the thing that
	   fades off the room. */
	.wash {
		position: absolute;
		inset: 0;
		background: #fffdf4;
		opacity: 0;
	}
</style>
