<script lang="ts">
	/**
	 * The way into the Treasure Chest: the chest on the wedge the wheel landed on is lifted off the
	 * disc, carried to the middle of the wheel and grown there, shaken, and opened
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
	type Frame = { w: number; h: number };

	const CLOSED = staticUrl('img/treasure_chest/wheel_icon_chest_closed.webp');
	const OPENED = staticUrl('img/treasure_chest/wheel_icon_chest_opened.webp');
	/**
	 * Where the treasure is in the open drawing, off the box's centre as a share of its size: the
	 * heap of coins and the crown sit about 0.47 down the square canvas. The light starts there.
	 */
	const TREASURE_DY = -0.03;

	/** The beats, in ms. */
	const LIFT_MS = 620;
	/** The chest popping up out of its wedge, before it is carried to the middle. */
	const POP_MS = 320;
	/** The chest rattling in the middle of the wheel before its lid comes off. */
	const SHAKE_MS = 700;
	/** How far before the shake ends the lid comes off and the light starts. */
	const OPEN_EARLY_MS = 100;
	const POUR_MS = 900;
	const CLEAR_MS = 700;
	/**
	 * The way out is quicker than the way in — the round is over and the table is waiting: the light
	 * over the room and back into the chest, the lid coming down, and the chest's fall back onto its
	 * wedge.
	 */
	const EXIT_POUR_MS = 550;
	const CLOSE_MS = 300;
	const SLAM_MS = 420;

	let shown = $state(false);
	let opened = $state(false);
	/** On its way back down onto the wedge: the glow goes out. */
	let returning = $state(false);
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
		frame: Frame,
	): Promise<void> => {
		box = to;
		opened = false;
		shown = true;
		// The chest is laid out where it ends up, and starts from its wedge by transform alone.
		await tick();

		// Popped out of its wedge: it jumps up off the disc, growing a little, and from the top of
		// that jump goes straight on towards the middle. Everything is written relative to where it
		// ends up, so the wedge is (dx, dy) away at a scale of k; `h` is how high it jumps.
		const k = from.size / to.size;
		const dx = from.x - to.x;
		const dy = from.y - to.y;
		const h = from.size * 1.5;
		const pose = (lift: number, grow: number) =>
			`translate(${dx}px, ${dy - h * lift}px) scale(${k * grow})`;
		playSound('pop', 1.1);
		iconEl?.animate(
			[{ transform: pose(0, 1) }, { transform: pose(1, 2.1) }],
			{ duration: POP_MS, easing: 'cubic-bezier(0.2, 0.9, 0.4, 1)', fill: 'both' },
		);
		await waitForTimeout(POP_MS);

		// Then grown into the middle of the wheel, where it lands and bounces: up off the spot,
		// down, a smaller hop, and still. `b` is the height of the first bounce.
		const b = to.size * 0.09;
		const at = (up: number, grow = 1) => `translate(0, ${-b * up}px) scale(${grow})`;
		playSound('whoosh');
		iconEl?.animate(
			[
				{ transform: pose(1, 2.1), easing: 'cubic-bezier(0.45, 0, 0.7, 1)' },
				{ transform: at(0, 1), offset: 0.52, easing: 'cubic-bezier(0.2, 0.8, 0.4, 1)' },
				{ transform: at(1, 1.03), offset: 0.7, easing: 'cubic-bezier(0.6, 0, 0.8, 0.4)' },
				{ transform: at(0, 1), offset: 0.84, easing: 'cubic-bezier(0.2, 0.8, 0.4, 1)' },
				{ transform: at(0.3, 1.01), offset: 0.92, easing: 'cubic-bezier(0.6, 0, 0.8, 0.4)' },
				{ transform: at(0, 1) },
			],
			{ duration: LIFT_MS, fill: 'both' },
		);
		await waitForTimeout(LIFT_MS);

		// Then it shakes, harder and harder, as if something inside wants out — and the lid gives.
		const shake = (deg: number, dx: number) => `translate(${dx}%, 0) rotate(${deg}deg)`;
		iconEl?.animate(
			[
				{ transform: shake(0, 0) },
				{ transform: shake(-3, -1) },
				{ transform: shake(3, 1) },
				{ transform: shake(-4, -1.5) },
				{ transform: shake(4, 1.5) },
				{ transform: shake(-6, -2) },
				{ transform: shake(6, 2) },
				{ transform: shake(-8, -2.5) },
				{ transform: shake(8, 2.5) },
				{ transform: shake(-9, -3) },
				{ transform: shake(9, 3) },
				{ transform: shake(0, 0) },
			],
			{ duration: SHAKE_MS, easing: 'linear' },
		);
		// The lid gives on the shake's last swing rather than after it has settled.
		await waitForTimeout(SHAKE_MS - OPEN_EARLY_MS);

		// Opened: the lid comes up with a jolt, and in the same moment the light starts pouring out of
		// the treasure until it is the whole screen — no beat between. The disc is drawn at
		// full size and scaled up from the chest's mouth; its solid core is half its diameter, so the
		// core alone has to reach the farthest corner of the frame.
		opened = true;
		playSound('doorOpen');
		iconEl?.animate(
			[{ transform: 'scale(1.16)' }, { transform: 'scale(0.97)' }, { transform: 'scale(1)' }],
			{ duration: 360, easing: 'ease-out' },
		);
		await pour(to.x, to.y + TREASURE_DY * to.size, to.size * 0.7, frame);
	};

	/**
	 * A disc of light grown from `start` px across at (x, y) until its core covers the frame, and
	 * then the frame held white by the wash.
	 */
	const pour = async (x: number, y: number, start: number, frame: Frame, ms = POUR_MS) => {
		const reach = Math.hypot(Math.max(x, frame.w - x), Math.max(y, frame.h - y));
		light = { x, y, d: reach * 2 * 2.1 };
		await tick();
		playSound('whoosh');
		lightEl?.animate(
			[
				// Bright from its very first frame — a flash in the chest's mouth — and already
				// growing, so the light reads as coming WITH the lid rather than a beat after it.
				{ transform: `scale(${start / light.d})`, opacity: 0.85 },
				{ opacity: 1, offset: 0.06 },
				{ transform: 'scale(1)', opacity: 1 },
			],
			{ duration: ms, easing: 'cubic-bezier(0.35, 0, 0.75, 0.6)', fill: 'both' },
		);
		await waitForTimeout(ms);
		washEl?.animate([{ opacity: 1 }], { duration: 0, fill: 'forwards' });
	};

	/**
	 * The way back out, first half: the room's own chest (`from`, the big one in the middle of the
	 * room) lights up until the screen is white again. Resolves white, so the room can be taken down
	 * unseen and the table put back under the light.
	 */
	export const cover = async (from: Box, frame: Frame): Promise<void> => {
		box = { ...box, size: 0 };
		opened = false;
		returning = false;
		shown = true;
		await pour(from.x, from.y, from.size * 0.35, frame, EXIT_POUR_MS);
	};

	/**
	 * The way back out, second half, with the table under the light: the opened chest is waiting in
	 * the middle of the wheel (`at`) as the light fades off, shuts, and is carried back down onto its
	 * wedge (`wedge`), where the caller shows the wedge's own badge again. With no wedge to go to it
	 * simply fades with the light.
	 */
	export const uncover = async (
		at: Box | null,
		wedge: Box | null,
		frame: Frame,
		onLand?: () => void,
	): Promise<void> => {
		if (!shown) return;
		lightEl?.getAnimations().forEach((a) => a.cancel());
		if (!at) {
			// Nothing to go back into: the light simply fades off the table.
			const fade = washEl?.animate([{ opacity: 1 }, { opacity: 0 }], {
				duration: CLEAR_MS,
				easing: 'ease-in',
				fill: 'forwards',
			});
			await waitForTimeout(CLEAR_MS);
			fade?.cancel();
			washEl?.getAnimations().forEach((a) => a.cancel());
			shown = false;
			return;
		}

		// The opened chest is put in the middle of the wheel, and the light — a disc again, big
		// enough to be the whole screen — goes back into its treasure, the way it came out.
		box = at;
		opened = true;
		const lx = at.x;
		const ly = at.y + TREASURE_DY * at.size;
		const reach = Math.hypot(Math.max(lx, frame.w - lx), Math.max(ly, frame.h - ly));
		light = { x: lx, y: ly, d: reach * 2 * 2.1 };
		await tick();
		lightEl?.animate([{ transform: 'scale(1)', opacity: 1 }], { duration: 0, fill: 'forwards' });
		washEl?.getAnimations().forEach((a) => a.cancel());
		playSound('whoosh', 0.8);
		lightEl?.animate(
			[
				{ transform: 'scale(1)', opacity: 1 },
				{ opacity: 1, offset: 0.8 },
				{ transform: `scale(${(at.size * 0.3) / light.d})`, opacity: 0 },
			],
			{ duration: EXIT_POUR_MS, easing: 'cubic-bezier(0.25, 0.5, 0.45, 1)', fill: 'forwards' },
		);
		await waitForTimeout(EXIT_POUR_MS);
		lightEl?.getAnimations().forEach((a) => a.cancel());
		light = { ...light, d: 0 };

		// The light is back in: the lid comes straight down on it, with a jolt.
		opened = false;
		playSound('doorClose');
		iconEl?.animate(
			[{ transform: 'scale(0.9)' }, { transform: 'scale(1.06)' }, { transform: 'scale(1)' }],
			{ duration: CLOSE_MS, easing: 'ease-out' },
		);
		await waitForTimeout(CLOSE_MS);

		// And slammed back down onto its wedge: a small wind-up, then faster and faster until it
		// hits. The caller shakes the wheel and the wedge with it (`onLand`).
		if (wedge) {
			returning = true;
			playSound('whoosh');
			iconEl?.animate(
				[
					{ transform: 'translate(0, 0) scale(1)' },
					{ transform: 'translate(0, 0) scale(1.1)', offset: 0.25 },
					{
						transform: `translate(${wedge.x - at.x}px, ${wedge.y - at.y}px) scale(${wedge.size / at.size})`,
					},
				],
				{ duration: SLAM_MS, easing: 'cubic-bezier(0.55, 0, 1, 0.45)', fill: 'forwards' },
			);
			await waitForTimeout(SLAM_MS);
			playSound('boom', 1.3, 0.5);
			onLand?.();
		}
		iconEl?.getAnimations().forEach((a) => a.cancel());
		box = { ...box, size: 0 };
		returning = false;
		shown = false;
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
				class:returning
				bind:this={iconEl}
				style="left:{box.x - box.size / 2}px; top:{box.y - box.size / 2}px; width:{box.size}px; height:{box.size}px"
			>
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
	/* A pool of gold behind the chest, brighter once it is open. */
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
	/* Going back onto the wedge: nothing glows on the wheel, so neither does the chest arriving. */
	.returning .halo {
		opacity: 0;
		transition: opacity 300ms ease;
	}
	@keyframes halo-in {
		from {
			opacity: 0;
			transform: scale(0.4);
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
