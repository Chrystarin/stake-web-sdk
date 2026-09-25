<script lang="ts">
	/**
	 * The way into Ocean Voyage, sailed by the ship on the wedge the wheel landed on.
	 *
	 * On the table (`sailOff`): the ship, which has just ridden a swell on its wedge (the landed
	 * badge's `rock`), lifts off the disc and comes into the middle of the screen, growing as it
	 * comes and still riding the waves, then sails off the right-hand edge.
	 *
	 * Into the room (`cross`): it comes back in from the right, turned about, and sails the width of
	 * the screen to the left — and the room is drawn in behind it, the bonus screen's left edge held
	 * just off the ship's stern, so the ship wipes the table off and the voyage on. A wall of breaking
	 * water (the divider) stands on that edge and is carried across with it, so the two screens meet
	 * in the wave the ship is pushing rather than at a hard line. It leaves by the left.
	 *
	 * And to the helm (`dock`): it comes in once more from the left, smaller, and sails down onto the
	 * harbour, where the room's own ship is waiting to be steered; there it hands over to that ship
	 * (the caller shows it as this one fades), so the ship the player drives is the one that
	 * brought them.
	 *
	 * Laid out in the game frame's own pixels (the caller converts client rects, see `centreIn` in
	 * Game.svelte), and every beat timed by the clock rather than by animation events, so a tab in
	 * the background cannot leave the round waiting on a frame that never comes.
	 */
	import { tick } from 'svelte';
	import { waitForTimeout } from 'utils-shared/wait';

	import { ROOM_ICON } from '../game/constants';
	import { playSound } from '../game/sound';
	import { staticCssUrl, staticUrl } from '../lib/staticUrl';

	type Box = { x: number; y: number; size: number; angle?: number };
	type Frame = { w: number; h: number };

	const SHIP = staticUrl(ROOM_ICON.oceanVoyage.src);
	const ASPECT = ROOM_ICON.oceanVoyage.aspect;
	/**
	 * The wave wall between the table and the room. It tiles top to bottom, so it runs any height: the
	 * file is one loop of divider.png (rows 520-1664, the two places its water matches), its last
	 * rows blended into the ones before the loop starts so each copy flows into the next.
	 */
	const DIVIDER = staticCssUrl('img/ocean-voyage/divider.webp');
	/** Its height over its width. */
	const DIVIDER_ASPECT = 1144 / 840;

	/** The beats, in ms. */
	/** The hop up off its wedge — as long as the chest's (RoomReveal's `POP_MS`). */
	const POP_MS = 320;
	/** From the top of that hop into the middle of the screen, growing all the way. */
	const IN_MS = 850;
	/** Riding the waves in the middle before it sets off. */
	const HOLD_MS = 550;
	/** Off the right-hand edge. */
	const OFF_MS = 650;
	/** Across the screen right to left, drawing the room in behind it. */
	const CROSS_MS = 1500;
	/** In from the left and down onto the harbour. */
	const DOCK_MS = 1100;
	/** The hand-over to the room's own ship. */
	const FADE_MS = 320;

	/** How big it is drawn in the middle of the screen, as a share of the frame's shorter side. */
	const MIDDLE_SHARE = 0.5;
	/** How big it comes back in from the left, against that. */
	const DOCK_SHARE = 0.5;
	/** The wave wall across, against the ship's middle size. */
	const DIVIDER_SHARE = 0.7;
	/** From the ship's middle to the seam the wall stands on, against its size: just off the stern,
	    so the ship rides the front of the wave with its stern in the water. */
	const SEAM_SHARE = 0.45;

	let shown = $state(false);
	/** Laid out in the middle of the frame at its middle size; every leg is a transform off that. */
	let box = $state<Box>({ x: 0, y: 0, size: 0 });
	/** Facing left: turned about for the crossing. */
	let flipped = $state(false);
	let riding = $state(false);
	/** The wave wall, while the ship is crossing: how wide it is, laid out on the frame's middle. */
	let wall = $state<{ x: number; w: number } | null>(null);

	let iconEl: HTMLDivElement | undefined = $state();
	let wallEl: HTMLDivElement | undefined = $state();

	type Pose = { dx: number; dy: number; k: number; r?: number };
	const pose = (p: Pose) => `translate(${p.dx}px, ${p.dy}px) scale(${p.k}) rotate(${p.r ?? 0}deg)`;
	/** Move from `a` to `b`, cancelling whatever leg was running only once the new one holds. */
	const move = (a: Pose, b: Pose, duration: number, easing: string) => {
		const old = iconEl?.getAnimations() ?? [];
		const anim = iconEl?.animate([{ transform: pose(a) }, { transform: pose(b) }], {
			duration,
			easing,
			fill: 'both',
		});
		old.forEach((x) => x.cancel());
		return anim;
	};

	/** Off the table: wedge (`from`) to the middle, and away to the right. */
	export const sailOff = async (from: Box, frame: Frame): Promise<void> => {
		const size = Math.min(frame.w, frame.h) * MIDDLE_SHARE;
		box = { x: frame.w / 2, y: frame.h / 2, size };
		flipped = false;
		riding = true;
		shown = true;
		await tick();

		// The wedge's angle carries every turn the wheel made to land it (1803deg, not 3deg), and
		// easing that back to level would spin the ship in place. Folded to the nearest way round,
		// the hop only levels the few degrees the wedge sits off the pointer; the riding does the rest.
		const lean = ((((from.angle ?? 0) % 360) + 540) % 360) - 180;
		const wedge: Pose = {
			dx: from.x - box.x,
			dy: from.y - box.y,
			k: from.size / size,
			r: lean,
		};
		const popped: Pose = { ...wedge, dy: wedge.dy - from.size * 1.4, k: wedge.k * 1.8, r: 0 };
		playSound('pop', 1.1);
		move(wedge, popped, POP_MS, 'cubic-bezier(0.2, 0.9, 0.4, 1)');
		await waitForTimeout(POP_MS);

		const middle: Pose = { dx: 0, dy: 0, k: 1 };
		playSound('whoosh', 0.9);
		move(popped, middle, IN_MS, 'cubic-bezier(0.45, 0, 0.25, 1)');
		await waitForTimeout(IN_MS + HOLD_MS);

		// Away to the right, gathering speed, bow a touch down into the swell.
		const gone: Pose = { dx: frame.w / 2 + size * 0.75, dy: -size * 0.04, k: 1, r: 4 };
		playSound('whoosh');
		move(middle, gone, OFF_MS, 'cubic-bezier(0.55, 0, 0.9, 0.5)');
		await waitForTimeout(OFF_MS);
	};

	/**
	 * Back in from the right, turned about, and across to the left while `screen` — the bonus
	 * screen, already up and clipped away to nothing — is drawn in behind it.
	 */
	export const cross = async (screen: HTMLElement | null, frame: Frame): Promise<void> => {
		const size = Math.min(frame.w, frame.h) * MIDDLE_SHARE;
		box = { x: frame.w / 2, y: frame.h / 2, size };
		flipped = true;
		riding = true;
		shown = true;
		const wallW = size * DIVIDER_SHARE;
		wall = { x: frame.w / 2, w: wallW };
		await tick();

		// Far enough that the wall is off the frame at both ends, not just the ship.
		const seam = size * SEAM_SHARE;
		const reach = frame.w / 2 + seam + wallW / 2 + size * 0.05;
		// All three share one clock and one curve, so the room's edge stays under the wave and the
		// wave on the ship's stern.
		const easing = 'cubic-bezier(0.4, 0.1, 0.6, 0.9)';
		playSound('whoosh', 0.8);
		move({ dx: reach, dy: 0, k: 1 }, { dx: -reach, dy: 0, k: 1 }, CROSS_MS, easing);
		wallEl?.animate(
			[
				{ transform: `translateX(${reach + seam}px)` },
				{ transform: `translateX(${-reach + seam}px)` },
			],
			{ duration: CROSS_MS, easing, fill: 'both' },
		);
		screen?.animate(
			[
				{ clipPath: `inset(0 0 0 ${frame.w / 2 + reach + seam}px)` },
				{ clipPath: `inset(0 0 0 ${frame.w / 2 - reach + seam}px)` },
			],
			{ duration: CROSS_MS, easing, fill: 'forwards' },
		);
		await waitForTimeout(CROSS_MS);
		wall = null;
	};

	/**
	 * In from the left, smaller, and down onto `harbour` — the room's own ship, in frame pixels —
	 * where it fades into it. `onArrive` is the hand-over: the caller puts the room's ship up as
	 * this one goes. With no harbour to find it simply sails into the middle and fades.
	 */
	export const dock = async (
		harbour: Box | null,
		frame: Frame,
		onArrive?: () => void,
	): Promise<void> => {
		const size = Math.min(frame.w, frame.h) * MIDDLE_SHARE;
		box = { x: frame.w / 2, y: frame.h / 2, size };
		flipped = false;
		riding = true;
		shown = true;
		await tick();

		const end = harbour ?? { x: frame.w / 2, y: frame.h * 0.75, size: size * 0.3 };
		const k0 = DOCK_SHARE;
		const start: Pose = {
			dx: -(frame.w / 2 + size * k0 * 0.75),
			dy: end.y - box.y - size * 0.1,
			k: k0,
		};
		// Sized down onto the room's ship — the same drawing, so height for height.
		const berth: Pose = { dx: end.x - box.x, dy: end.y - box.y, k: (end.size * ASPECT) / size };
		playSound('whoosh', 0.9);
		move(start, berth, DOCK_MS, 'cubic-bezier(0.25, 0.6, 0.3, 1)');
		await waitForTimeout(DOCK_MS);

		riding = false;
		onArrive?.();
		playSound('pop', 0.9);
		iconEl?.animate([{ opacity: 1 }, { opacity: 0 }], {
			duration: FADE_MS,
			easing: 'ease-in',
			fill: 'forwards',
		});
		await waitForTimeout(FADE_MS);
		hide();
	};

	export const hide = () => {
		iconEl?.getAnimations().forEach((a) => a.cancel());
		shown = false;
		riding = false;
		flipped = false;
		wall = null;
	};
</script>

{#if shown}
	<div class="reveal" aria-hidden="true">
		{#if wall}
			<!-- Under the ship: it is the ship that pushes the wave. The strip inside is a tile taller
			     than the frame and rolls up by one tile, so the water keeps moving as it crosses. -->
			<div
				class="wall"
				bind:this={wallEl}
				style="left:{wall.x - wall.w / 2}px; width:{wall.w}px; --tile:{wall.w * DIVIDER_ASPECT}px"
			>
				<div class="water" style="background-image:{DIVIDER}"></div>
			</div>
		{/if}
		<div
			class="icon"
			bind:this={iconEl}
			style="left:{box.x - box.size / 2}px; top:{box.y - box.size / ASPECT / 2}px; width:{box.size}px; height:{box.size / ASPECT}px"
		>
			<div class="flip" class:flipped>
				<div class="ride" class:riding>
					<img src={SHIP} alt="" draggable="false" />
				</div>
			</div>
		</div>
	</div>
{/if}

<style>
	/* Over the table and the bonus screen both: the ship is what the eye follows between them. */
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
		will-change: transform;
	}
	.wall {
		position: absolute;
		top: 0;
		bottom: 0;
		overflow: hidden;
		will-change: transform;
		/* Off the frame until its first frame of motion puts it on the right-hand edge. */
		transform: translateX(200vw);
	}
	.water {
		position: absolute;
		inset: 0 0 auto 0;
		height: calc(100% + var(--tile));
		background-repeat: repeat-y;
		background-size: 100% auto;
		background-position: 50% 0;
		filter: drop-shadow(0 0 0.8vw rgba(0, 20, 60, 0.55));
		animation: surge 1600ms linear infinite;
	}
	@keyframes surge {
		to {
			transform: translateY(calc(var(--tile) * -1));
		}
	}
	.flip,
	.ride {
		width: 100%;
		height: 100%;
	}
	/* The drawing's bow is on the right; turned about, it sails left. */
	.flip.flipped {
		scale: -1 1;
	}
	/* Riding the waves: rolled one way and the other about its waterline, lifting on each crest. */
	.ride.riding {
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
	img {
		display: block;
		width: 100%;
		height: 100%;
		filter: drop-shadow(0 0.4vw 0.8vw rgba(0, 0, 0, 0.6));
	}
	@media (prefers-reduced-motion: reduce) {
		.ride.riding,
		.water {
			animation: none;
		}
	}
</style>
