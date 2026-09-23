<script lang="ts">
	/**
	 * The way into the Bonus Wheel and back out of it, through the ship's wheel both rooms share.
	 *
	 * In (`play`, `clear`): the icon on the wedge the table's wheel landed on starts turning, pops up
	 * out of its wedge the way the Treasure Chest's does, and from the top of that jump, in one
	 * movement, comes into the middle of the wheel and on at the player until it IS the screen.
	 * The room is put up behind it (see BonusRound's `litEntrance`), and `clear` backs the icon off
	 * again, still turning, until it comes to rest exactly on the room wheel's own hub — the same
	 * drawing — and becomes it: the room's hub is held back until then. So the table's badge
	 * becomes the room's hub.
	 *
	 * Out (`cover`, `uncover`): the same the other way round. The room's hub starts turning and comes
	 * on over the screen; the room is taken down behind it, and it is slammed back into its wedge on
	 * the table, stopping dead at the wedge's own angle, and hands over to the badge drawn there —
	 * which the caller rattles, with the wheel, the way the Treasure Chest's return does.
	 *
	 * The turning never stops in between: it runs on an element of its own (`spinEl`) at one steady
	 * rate, apart from the moving and growing (`iconEl`), and only slows at the very end, eased out
	 * from the rate it was going at, so it comes to rest where it lands rather than pausing anywhere.
	 *
	 * Everything is laid out in the game frame's own pixels (the caller converts client rects, see
	 * `centreIn` in Game.svelte), and every beat is timed by the clock rather than by animation
	 * events, so a tab in the background cannot leave the round waiting on a frame that never comes.
	 */
	import { tick } from 'svelte';
	import { waitForTimeout } from 'utils-shared/wait';

	import { playSound } from '../game/sound';
	import { staticUrl } from '../lib/staticUrl';

	/**
	 * A centre, and the width of the icon's box there; its height follows `ASPECT`. `angle` is how
	 * far the icon is turned there, in degrees — only a wedge's badge is turned.
	 */
	type Box = { x: number; y: number; size: number; angle?: number };
	type Frame = { w: number; h: number };

	const ICON = staticUrl('img/bonus-wheel/wheel_icon.webp');
	/** The file is 577x586. */
	const ASPECT = 577 / 586;
	/**
	 * How far out from its centre the drawing is solid all the way round, as a share of the box's
	 * width: the gold ring holds to r = 175 px of the 577 px file, and past it the spokes leave gaps.
	 * The screen is covered when this circle reaches the frame's farthest corner.
	 */
	const SOLID_R = 170 / 577;

	/** The beats, in ms. */
	/** The jump up off the wedge, as long as the chest's (RoomReveal's `POP_MS`). */
	const POP_MS = 320;
	const IN_MS = 1200;
	const OUT_COVER_MS = 900;
	const BACK_MS = 1000;
	/** From the whole screen back down into its wedge on the way out. */
	const SLAM_MS = 700;
	const FADE_MS = 400;
	/** The turn: one revolution in this long, got up to from a standstill over `SPIN_UP_MS`. */
	const SPIN_PERIOD_MS = 700;
	const SPIN_UP_MS = 400;
	const SPIN_RATE = 360 / SPIN_PERIOD_MS; // degrees a ms

	let shown = $state(false);
	let box = $state<Box>({ x: 0, y: 0, size: 0 });
	/** Where the icon is while it fills the screen, which the next leg carries on from. */
	let covered = { dx: 0, dy: 0, k: 1 };

	let iconEl: HTMLDivElement | undefined = $state();
	let spinEl: HTMLDivElement | undefined = $state();

	/** `deg` brought to within half a turn of nothing. */
	const near = (deg: number) => ((((deg + 180) % 360) + 360) % 360) - 180;

	/** Scale at which the icon's solid middle, centred on `c`, reaches every corner of `frame`. */
	const coverScale = (c: Box, frame: Frame) =>
		(Math.hypot(Math.max(c.x, frame.w - c.x), Math.max(c.y, frame.h - c.y)) * 1.06) /
		(SOLID_R * c.size);

	/**
	 * One leg of the moving and growing, sampled rather than eased as a whole: the move and the
	 * growth each want their own curve, and growing reads as coming on at a steady pace only when it
	 * is steady in log scale — linear scale crawls at the start and leaps at the end.
	 */
	const leg = (
		from: { dx: number; dy: number; k: number },
		to: { dx: number; dy: number; k: number },
		move: (u: number) => number,
		grow: (u: number) => number,
		duration: number,
	) => {
		const frames: Keyframe[] = [];
		const STEPS = 40;
		for (let i = 0; i <= STEPS; i++) {
			const u = i / STEPS;
			const m = move(u);
			const k = from.k * Math.pow(to.k / from.k, grow(u));
			const dx = from.dx + (to.dx - from.dx) * m;
			const dy = from.dy + (to.dy - from.dy) * m;
			frames.push({ transform: `translate(${dx}px, ${dy}px) scale(${k})` });
		}
		const old = iconEl?.getAnimations() ?? [];
		iconEl?.animate(frames, { duration, fill: 'both' });
		old.forEach((a) => a.cancel());
	};
	const easeIn = (u: number) => u * u;
	const easeOut = (u: number) => 1 - (1 - u) * (1 - u);

	/** Set turning from `from` degrees: got up to speed, then round and round until `settle`. */
	const spinUp = (from: number) => {
		spinEl?.getAnimations().forEach((a) => a.cancel());
		// An ease-in whose end slope is 2 (control point 0.6, 0.2) reaches SPIN_RATE over this angle.
		const upDeg = (SPIN_RATE * SPIN_UP_MS) / 2;
		spinEl?.animate([{ rotate: `${from}deg` }, { rotate: `${from + upDeg}deg` }], {
			duration: SPIN_UP_MS,
			easing: 'cubic-bezier(0.5, 0, 0.6, 0.2)',
			fill: 'forwards',
		});
		spinEl?.animate(
			[{ rotate: `${from + upDeg}deg` }, { rotate: `${from + upDeg + 360}deg` }],
			{ duration: SPIN_PERIOD_MS, delay: SPIN_UP_MS, iterations: Infinity },
		);
	};

	/**
	 * Slow the turn to rest at `angle` (mod a whole turn) over `duration`, eased out from the rate it
	 * is going at so there is no jolt where the steady turn hands over.
	 */
	const settle = (angle: number, duration: number) => {
		if (!spinEl) return;
		const now = parseFloat(getComputedStyle(spinEl).rotate) || 0;
		// An ease-out starting at slope s covers its angle at s times the average rate; at least a
		// slope of 3 is kept off, which would kick the turn faster before slowing it.
		const least = (SPIN_RATE * duration) / 3;
		const end = angle + 360 * Math.ceil((now + least - angle) / 360);
		const slope = (SPIN_RATE * duration) / (end - now);
		const old = spinEl.getAnimations();
		spinEl.animate([{ rotate: `${now}deg` }, { rotate: `${end}deg` }], {
			duration,
			easing: `cubic-bezier(0.25, ${slope * 0.25}, 0.5, 1)`,
			fill: 'forwards',
		});
		old.forEach((a) => a.cancel());
	};

	/**
	 * From the icon on its wedge (`from`) into the middle of the wheel (`to`) and on over the whole
	 * frame (`frame`, its size), all in one movement. Resolves with the screen covered: whatever is
	 * put up now is hidden until `clear`.
	 */
	export const play = async (from: Box, to: Box, frame: Frame): Promise<void> => {
		box = to;
		shown = true;
		// The icon is laid out in the middle of the wheel, and starts from its wedge by transform.
		await tick();
		spinUp(near(from.angle ?? 0));

		// Popped out of its wedge first, the way the Treasure Chest's is (RoomReveal): it jumps up
		// off the disc, growing a little, already turning, and goes on from the top of that jump.
		const wedge = { dx: from.x - to.x, dy: from.y - to.y, k: from.size / to.size };
		const popped = { dx: wedge.dx, dy: wedge.dy - from.size * 1.5, k: wedge.k * 2.1 };
		playSound('pop', 1.1);
		iconEl?.animate(
			[
				{ transform: `translate(${wedge.dx}px, ${wedge.dy}px) scale(${wedge.k})` },
				{ transform: `translate(${popped.dx}px, ${popped.dy}px) scale(${popped.k})` },
			],
			{ duration: POP_MS, easing: 'cubic-bezier(0.2, 0.9, 0.4, 1)', fill: 'both' },
		);
		await waitForTimeout(POP_MS);

		// Then into the middle and on at the player in one movement. The move is mostly made early
		// and the growth mostly late, so it is seen to come into the middle as it starts to come on,
		// and is in the middle by the time it fills the screen.
		covered = { dx: 0, dy: 0, k: coverScale(to, frame) };
		leg(popped, covered, easeOut, (u) => Math.pow(u, 1.8), IN_MS);
		playSound('whoosh');
		await waitForTimeout(IN_MS);
	};

	/**
	 * Back off the screen onto `hub` — where the room wheel's hub goes, as a box of the same drawing —
	 * coming to rest square on it, and gone the moment it is there: `onLand` puts the hub up in its
	 * place. With no hub to land on it backs off where it is and fades. Resolves once it is gone.
	 */
	export const clear = async (hub: Box | null, onLand?: () => void): Promise<void> => {
		if (!shown) return;
		const end = hub ?? { ...box, size: box.size * 0.5 };
		settle(0, BACK_MS);
		leg(
			covered,
			{ dx: end.x - box.x, dy: end.y - box.y, k: end.size / box.size },
			easeIn,
			easeOut,
			BACK_MS,
		);
		await waitForTimeout(BACK_MS);
		if (!hub) {
			iconEl?.animate([{ opacity: 1 }, { opacity: 0 }], {
				duration: FADE_MS,
				easing: 'ease-in',
				fill: 'forwards',
			});
			await waitForTimeout(FADE_MS);
		}
		// The room's hub is held back while this is in the air (the caller's `onLand` puts it up):
		// the hub and this are one picture, so the hand-over is the same frame for both.
		onLand?.();
		hide();
	};

	/**
	 * The way out: the room wheel's hub (`hub`) starts turning and comes on over the whole frame.
	 * Resolves with the screen covered: the room can be taken down now, unseen.
	 */
	export const cover = async (hub: Box, frame: Frame): Promise<void> => {
		box = hub;
		shown = true;
		// Laid over the hub as the caller takes the hub down, in the same frame: this IS the hub now.
		await tick();
		spinUp(0);
		covered = { dx: 0, dy: 0, k: coverScale(hub, frame) };
		leg({ dx: 0, dy: 0, k: 1 }, covered, easeIn, (u) => Math.pow(u, 1.8), OUT_COVER_MS);
		playSound('whoosh');
		await waitForTimeout(OUT_COVER_MS);
	};

	/**
	 * Slammed off the screen into `wedge` — the badge on the table's wheel it came from — stopping
	 * dead at the wedge's own angle, and gone the moment it hits, so the badge under it takes over;
	 * `onLand` is the hit. With no wedge to land on it backs off to nothing where it is, and nothing
	 * is hit. Resolves once it is gone.
	 */
	export const uncover = async (wedge: Box | null, onLand?: () => void): Promise<void> => {
		if (!shown) return;
		const end = wedge ?? { ...box, size: box.size * 0.01 };
		// Slammed back in: faster and faster until it hits, and the turn does not wind down for it —
		// it runs on at full rate and stops dead on the wedge's own angle at the moment of impact.
		slamSpin(near(end.angle ?? 0), SLAM_MS);
		leg(
			covered,
			{ dx: end.x - box.x, dy: end.y - box.y, k: end.size / box.size },
			(u) => Math.pow(u, 2.2),
			(u) => Math.pow(u, 2.6),
			SLAM_MS,
		);
		playSound('whoosh');
		await waitForTimeout(SLAM_MS);
		// The caller hands over to the badge under it, and shakes it and the wheel (`onLand`).
		hide();
		if (wedge) {
			playSound('boom', 1.3, 0.5);
			onLand?.();
		}
	};

	/**
	 * Turn on at the steady rate, give or take, for `duration`, ending exactly on `angle` (mod a
	 * whole turn) — no easing, so it stops dead there.
	 */
	const slamSpin = (angle: number, duration: number) => {
		if (!spinEl) return;
		const now = parseFloat(getComputedStyle(spinEl).rotate) || 0;
		const turns = Math.max(1, Math.round((now + SPIN_RATE * duration - angle) / 360));
		const end = Math.max(angle + 360 * turns, angle + 360 * Math.ceil((now + 1 - angle) / 360));
		const old = spinEl.getAnimations();
		spinEl.animate([{ rotate: `${now}deg` }, { rotate: `${end}deg` }], {
			duration,
			fill: 'forwards',
		});
		old.forEach((a) => a.cancel());
	};

	const hide = () => {
		iconEl?.getAnimations().forEach((a) => a.cancel());
		spinEl?.getAnimations().forEach((a) => a.cancel());
		shown = false;
	};
</script>

{#if shown}
	<div class="reveal" aria-hidden="true">
		<div
			class="icon"
			bind:this={iconEl}
			style="left:{box.x - box.size / 2}px; top:{box.y - box.size / ASPECT / 2}px; width:{box.size}px; height:{box.size / ASPECT}px"
		>
			<div class="spin" bind:this={spinEl}>
				<img src={ICON} alt="" draggable="false" />
			</div>
		</div>
	</div>
{/if}

<style>
	/* Over everything in the frame, the balance and the wager included: the icon is the screen. */
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
	.spin {
		width: 100%;
		height: 100%;
		will-change: rotate;
	}
	img {
		display: block;
		width: 100%;
		height: 100%;
		/* The room wheel's hub's own shadow (Wheel.svelte, `.center`): it is the same icon, so on the
		   hub the two are one picture. */
		filter: drop-shadow(0 0.3vw 0.6vw rgba(0, 0, 0, 0.6));
	}
</style>
