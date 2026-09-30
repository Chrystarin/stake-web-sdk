<script lang="ts">
	/**
	 * The way into Pirate Plinko: the cannonball on the wedge the wheel landed on hops off the disc,
	 * bounces into the middle of the wheel, lands on the hub with a squash (`play`), and bounces
	 * again — up, over, and down (`fall`). The camera goes down with it: once the ball has dropped
	 * a little past the hub, the table slides up and away and the bonus screen comes up from below,
	 * the view following the ball down into the room, which lies under the table. The camera passes
	 * the ball as it slows onto the room, so the ball ends up just under the cannon's mouth as
	 * everything comes to rest, and the room loads it up the barrel from there (RoomPiratePlinko's
	 * `loadBall`), so it is one ball all the way from the wedge to the shot.
	 *
	 * And back out, the same way up: once the room has shown what it paid, the ball hops back up out
	 * of the pocket it took and into the middle of the screen, grown, with a squash (`rise`); bounces
	 * again, up, with the camera going up after it — the room slides down and away and the table
	 * comes back down from above — and drops onto the hub (`climb`); and from the hub it hops over
	 * its wedge, shrinking, and is slammed back down into it (`home`).
	 *
	 * Laid out in the game frame's own pixels (the caller converts client rects, see `centreIn` in
	 * Game.svelte), and every beat timed by the clock rather than by animation events, so a tab in
	 * the background cannot leave the round waiting on a frame that never comes.
	 */
	import { tick } from 'svelte';
	import { waitForTimeout } from 'utils-shared/wait';

	import { ROOM_ICON } from '../game/constants';
	import { playSound } from '../game/sound';
	import { staticUrl } from '../lib/staticUrl';

	/** A centre and a size, in frame pixels; `angle` is how far a wedge's badge is turned. */
	type Box = { x: number; y: number; size: number; angle?: number };
	type Frame = { w: number; h: number };

	const BALL = staticUrl(ROOM_ICON.piratePlinko.src);

	/** The beats, in ms. */
	/** The hop up off its wedge — as long as the chest's (RoomReveal's `POP_MS`). */
	const POP_MS = 320;
	/** From the top of that hop down onto the hub. */
	const HOP_MS = 520;
	/** Squashed flat on the hub for a moment. */
	const SQUASH_MS = 130;
	/** The second bounce: from the hub to the top of it. */
	const RISE_MS = 300;
	/** How high the second bounce goes above the hub, as a share of the frame's height. */
	const OUT_APEX = 0.15;
	/**
	 * How far past the hub the ball falls on its own before the camera takes it, as a share of the
	 * frame's height.
	 */
	const FALL_ALONE = 0.08;
	/** The camera's move, and the ball's from where the camera sets off to the cannon. */
	const CAMERA_MS = 1000;
	/** Samples a second along the camera's move: plenty for linear pieces to read as a curve. */
	const SAMPLES_PER_S = 60;
	/** One turn of the ball's roll. */
	const ROLL_MS = 700;

	/** The way out. From the top of its hop out of the pocket to the middle of the screen. */
	const OUT_HOP_MS = 560;
	/** How big it is drawn in the middle of the screen, as a share of the frame's shorter side. */
	const MIDDLE_SHARE = 0.3;
	/** The bounce up off the middle and down onto the hub, the camera going up after it. */
	const CLIMB_MS = 1500;
	/** How far into that bounce the camera sets off, as a share of it. */
	const CLIMB_CAMERA_FROM = 0.22;
	/** The top of that bounce, on the screen, as a share of the frame's height from its top. */
	const CLIMB_APEX = 0.12;
	/** Up off the hub and over its wedge, shrinking. */
	const HOME_OVER_MS = 460;
	/** Down into the wedge. */
	const HOME_SLAM_MS = 200;

	/** The camera's move: how far down it is (px) at even steps over `ms`. */
	type Pan = (camera: number[], ms: number) => void;

	type Pose = { dx: number; dy: number; k: number };

	let shown = $state(false);
	let box = $state<Box>({ x: 0, y: 0, size: 0 });
	/** Where the ball was last left on the way out, off `box`: what the next beat starts from. */
	let rest: Pose = { dx: 0, dy: 0, k: 1 };
	let iconEl: HTMLDivElement | undefined = $state();
	let spinEl: HTMLDivElement | undefined = $state();

	/**
	 * A thrown ball, sampled: out of `from` and into `to` (offsets from the hub, px) over an arc
	 * whose top is `apex` px above the higher end. Time runs linearly through the samples, so the
	 * ball slows over the top and speeds up falling, the way a ball does.
	 *
	 * The height is a parabola y = top + c (t - tTop)^2 through both ends: with A and B the drops
	 * from the top to the start and to the end, tTop = sqrt A / (sqrt A + sqrt B) and
	 * c = (sqrt A + sqrt B)^2.
	 */
	const arc = (
		from: { dx: number; dy: number; k: number },
		to: { dx: number; dy: number; k: number },
		apex: number,
		steps = 32,
	): Keyframe[] => {
		const top = Math.min(from.dy, to.dy) - Math.max(1, apex);
		const ra = Math.sqrt(from.dy - top);
		const rb = Math.sqrt(to.dy - top);
		const tTop = ra / (ra + rb);
		const c = (ra + rb) ** 2;
		const frames: Keyframe[] = [];
		for (let i = 0; i <= steps; i++) {
			const t = i / steps;
			const dy = top + c * (t - tTop) ** 2;
			const dx = from.dx + (to.dx - from.dx) * t;
			const k = from.k + (to.k - from.k) * t;
			frames.push({ transform: `translate(${dx}px, ${dy}px) scale(${k})` });
		}
		return frames;
	};

	/** Swaps the ball's move for `frames`: the new one goes on before the old comes off. */
	const move = (frames: Keyframe[], options: KeyframeAnimationOptions) => {
		const old = iconEl?.getAnimations() ?? [];
		iconEl?.animate(frames, { fill: 'both', ...options });
		old.forEach((a) => a.cancel());
	};

	const pose = (p: Pose) => ({ transform: `translate(${p.dx}px, ${p.dy}px) scale(${p.k})` });

	/** Rolling, a steady turn on an element of its own, apart from the moving. */
	const roll = () => {
		spinEl?.getAnimations().forEach((a) => a.cancel());
		spinEl?.animate([{ rotate: '0deg' }, { rotate: '360deg' }], {
			duration: ROLL_MS,
			iterations: Infinity,
		});
	};

	/** How far round the roll has the ball, in degrees. */
	const rolled = () => {
		const rolling = spinEl?.getAnimations()[0];
		return (((Number(rolling?.currentTime) || 0) % ROLL_MS) / ROLL_MS) * 360;
	};

	/**
	 * Landed at `p`: squashed flat, and straight back up, left in the stretch it comes up with —
	 * the bounce off whatever it landed on is the next beat's.
	 */
	const squash = async (p: Pose) => {
		playSound('peg', 0.7);
		playSound('boom', 1.4, 0.35);
		const lift = `translate(${p.dx}px, ${p.dy}px)`;
		move(
			[
				pose(p),
				{
					transform: `${lift} translateY(${box.size * p.k * 0.08}px) scale(${p.k * 1.18}, ${p.k * 0.8})`,
					offset: 0.45,
				},
				{ transform: `${lift} scale(${p.k * 0.94}, ${p.k * 1.08})` },
			],
			{ duration: SQUASH_MS, easing: 'ease-out' },
		);
		await waitForTimeout(SQUASH_MS);
	};

	/**
	 * From the ball on its wedge (`from`) to the hub (`to`, where it lands at `to.size`). Resolves
	 * with it squashed on the hub, stretching back up for `fall`.
	 */
	export const play = async (from: Box, to: Box): Promise<void> => {
		box = to;
		shown = true;
		await tick();

		// Rolling the whole way.
		roll();

		// Hopped up out of its wedge, growing a little — the same hop the chest makes.
		const k = from.size / to.size;
		const wedge = { dx: from.x - to.x, dy: from.y - to.y, k };
		const popped = { dx: wedge.dx, dy: wedge.dy - from.size * 1.4, k: k * 1.5 };
		playSound('pop', 1.1);
		move([pose(wedge), pose(popped)], {
			duration: POP_MS,
			easing: 'cubic-bezier(0.2, 0.9, 0.4, 1)',
		});
		await waitForTimeout(POP_MS);

		// Over and down onto the hub: a short rise from the top of the hop, then a fall.
		const hub = { dx: 0, dy: 0, k: 1 };
		move(arc(popped, hub, to.size * 0.35), { duration: HOP_MS });
		playSound('whoosh', 0.9);
		await waitForTimeout(HOP_MS);

		// Landed: squashed flat on the hub, and straight back up.
		await squash({ dx: 0, dy: 0, k: 1 });

		// Holding the stretch it came up out of the squash with: the bounce itself is `fall`, run
		// as the room's entrance, since the camera goes down with it.
	};

	/**
	 * The second bounce, off the hub and down into the room, with the camera going down after it.
	 * `cannon` is where the room's cannon takes the ball — in the frame's own pixels, as it will be
	 * once the room is at rest — and the size it is drawn there. `pan` is handed the camera's whole
	 * move as it starts: how far down it is (px, from 0 on the table to the frame's height on the
	 * room) at even steps over `ms`, to put on the table and the bonus screen. Resolves with the ball
	 * at `cannon` and the camera on the room, both at rest; the ball is taken off then, for the room
	 * to carry on with, upright as the room draws it.
	 */
	export const fall = async (frame: Frame, cannon: Box, pan: Pan): Promise<void> => {
		if (!shown) return;
		const to = box;
		const h = frame.h;
		// The bounce: straight up to the apex and down again, free, until it is FALL_ALONE past the
		// hub — with whatever gravity gets it up there in RISE_MS.
		const rise = RISE_MS / 1000;
		const g = (2 * h * OUT_APEX) / rise ** 2;
		const alone = h * FALL_ALONE;
		const aloneS = rise + Math.sqrt(rise * rise + (2 * alone) / g);
		const v = g * (aloneS - rise);
		// Then the camera sets off from rest, easing in and out onto the room, while the ball, from
		// the speed it has, slows to a stop at the cannon: a cubic in the room's own space from that
		// speed to none. On the screen, which is the one less the other, the ball keeps falling for
		// a moment as the camera gathers speed, then the camera overtakes it and it rises into the
		// cannon as everything comes to rest. The cubic only ever goes forward — the ball never
		// climbs in the room's own space — while it starts off no faster than three times its
		// average speed, which is what caps the move's length.
		const drop = h + cannon.y - (to.y + alone);
		const ms = Math.min(CAMERA_MS, (1000 * 2.9 * drop) / v);
		const carry = (v * ms) / 1000;
		const smooth = (t: number) => t * t * (3 - 2 * t);

		// Sampled in two runs, each with its own time on it: the fall on its own, then the camera.
		const total = aloneS * 1000 + ms;
		const balls: Keyframe[] = [];
		const cams: number[] = [];
		const end = { dx: cannon.x - to.x, dy: cannon.y - to.y, k: cannon.size / to.size };
		const at = (time: number, dx: number, dy: number, k: number) => ({
			offset: time / total,
			transform: `translate(${dx}px, ${dy}px) scale(${k})`,
		});
		for (let s = 0; s < aloneS; s += 1 / SAMPLES_PER_S)
			balls.push(at(s * 1000, 0, g * s * (s / 2 - rise), 0.94));
		const steps = Math.max(2, Math.round((ms / 1000) * SAMPLES_PER_S));
		for (let i = 0; i <= steps; i++) {
			const t = i / steps;
			const e = smooth(t);
			cams.push(h * e);
			const dy = alone + (end.dy - alone) * e + carry * t * (1 - t) ** 2;
			balls.push(at(aloneS * 1000 + t * ms, end.dx * e, dy, 0.94 + (end.k - 0.94) * e));
		}
		cams[cams.length - 1] = h;

		const old = iconEl?.getAnimations() ?? [];
		iconEl?.animate(balls, { duration: total, fill: 'both' });
		old.forEach((a) => a.cancel());
		// The roll runs down with it and stops upright, which is how the room's ball starts.
		const rolling = spinEl?.getAnimations()[0];
		const from = (((Number(rolling?.currentTime) || 0) % ROLL_MS) / ROLL_MS) * 360;
		rolling?.cancel();
		const turns = Math.max(1, Math.round(total / ROLL_MS / 1.6));
		spinEl?.animate([{ rotate: `${from}deg` }, { rotate: `${360 * (turns + 1)}deg` }], {
			duration: total,
			easing: 'cubic-bezier(0.25, 0.6, 0.4, 1)',
			fill: 'both',
		});
		playSound('whoosh');
		await waitForTimeout(aloneS * 1000);
		pan(cams, ms);
		await waitForTimeout(ms);
		hide();
	};

	/**
	 * The way out, first: from the ball in the pocket it took (`from`, the room's own ball, which
	 * the caller takes off the board as this one goes up) — hopped up out of it, growing, and over
	 * into the middle of the frame, where it lands grown to MIDDLE_SHARE with a squash. Resolves
	 * with it there, stretching back up for `climb`.
	 */
	export const rise = async (from: Box, frame: Frame): Promise<void> => {
		const size = Math.min(frame.w, frame.h) * MIDDLE_SHARE;
		box = { x: frame.w / 2, y: frame.h / 2, size };
		shown = true;
		await tick();
		roll();

		// The hop the way in started with, out of the pocket instead of the wedge.
		const k = from.size / size;
		const slot = { dx: from.x - box.x, dy: from.y - box.y, k };
		const popped = { dx: slot.dx, dy: slot.dy - from.size * 1.6, k: k * 1.6 };
		playSound('pop', 1.1);
		move([pose(slot), pose(popped)], { duration: POP_MS, easing: 'cubic-bezier(0.2, 0.9, 0.4, 1)' });
		await waitForTimeout(POP_MS);

		// Over and into the middle, growing all the way.
		rest = { dx: 0, dy: 0, k: 1 };
		move(arc(popped, rest, size * 0.35), { duration: OUT_HOP_MS });
		playSound('whoosh', 0.9);
		await waitForTimeout(OUT_HOP_MS);
		await squash(rest);
	};

	/**
	 * The bounce up off the middle, with the camera going up after it, and down onto the hub (`hub`,
	 * in the frame's pixels as the table stands at rest, and the size the ball lands there at). The
	 * ball flies one parabola on the screen, up near the top and down onto the hub; the camera sets
	 * off as it rises and has come to rest on the table by the time it lands, so it is the table that
	 * comes down to meet it. `pan` is handed the camera's move as `fall` hands it, how far down it is
	 * at even steps over `ms` — from the frame's height on the room back to 0 on the table. Resolves
	 * with the ball squashed on the hub, stretching back up for `home`.
	 */
	export const climb = async (frame: Frame, hub: Box, pan: Pan): Promise<void> => {
		if (!shown) return;
		const h = frame.h;
		const end = { dx: hub.x - box.x, dy: hub.y - box.y, k: hub.size / box.size };
		// The top of the bounce, set on the screen rather than above either end.
		const top = h * CLIMB_APEX - box.y;
		const steps = Math.max(2, Math.round((CLIMB_MS / 1000) * SAMPLES_PER_S));
		move(arc({ ...rest, k: rest.k * 0.94 }, end, Math.min(rest.dy, end.dy) - top, steps), {
			duration: CLIMB_MS,
		});
		playSound('whoosh');

		const lead = CLIMB_MS * CLIMB_CAMERA_FROM;
		const ms = CLIMB_MS - lead;
		const smooth = (t: number) => t * t * (3 - 2 * t);
		const camSteps = Math.max(2, Math.round((ms / 1000) * SAMPLES_PER_S));
		const cams = Array.from({ length: camSteps + 1 }, (_, i) => h * (1 - smooth(i / camSteps)));
		cams[cams.length - 1] = 0;
		await waitForTimeout(lead);
		pan(cams, ms);
		await waitForTimeout(ms);

		rest = end;
		await squash(rest);
	};

	/**
	 * Home: up off the hub and over its wedge (`to`, the badge with its turn), shrinking to it, and
	 * slammed down into it, the roll brought round to stop dead on the badge's own angle. `onLand` is
	 * the impact: the ball is gone in that frame, and the caller puts the wedge's badge back and
	 * gives the wheel its knock. With no wedge to find it only goes.
	 */
	export const home = async (to: Box | null, onLand?: () => void): Promise<void> => {
		if (!shown) return;
		if (!to) {
			hide();
			onLand?.();
			return;
		}
		const wedge = { dx: to.x - box.x, dy: to.y - box.y, k: to.size / box.size };
		const over = { dx: wedge.dx, dy: wedge.dy - to.size * 1.4, k: wedge.k * 1.6 };

		// The roll runs on and comes to rest on the badge's angle at the moment it hits, a whole turn
		// or more on from wherever it is now, so it never turns back.
		const from = rolled();
		const angle = (((to.angle ?? 0) % 360) + 360) % 360;
		const stop = angle + 360 * Math.ceil((from + 360 - angle) / 360);
		spinEl?.getAnimations().forEach((a) => a.cancel());
		spinEl?.animate([{ rotate: `${from}deg` }, { rotate: `${stop}deg` }], {
			duration: HOME_OVER_MS + HOME_SLAM_MS,
			easing: 'cubic-bezier(0.3, 0.5, 0.6, 1)',
			fill: 'both',
		});

		playSound('whoosh', 1.1);
		move(arc(rest, over, box.size * rest.k * 0.3), { duration: HOME_OVER_MS });
		await waitForTimeout(HOME_OVER_MS);

		move([pose(over), pose(wedge)], {
			duration: HOME_SLAM_MS,
			easing: 'cubic-bezier(0.6, 0, 0.9, 0.5)',
		});
		await waitForTimeout(HOME_SLAM_MS);
		hide();
		playSound('boom', 1.3, 0.5);
		onLand?.();
	};

	/** Takes the ball off the screen wherever it is. */
	export const hide = () => {
		iconEl?.getAnimations().forEach((a) => a.cancel());
		spinEl?.getAnimations().forEach((a) => a.cancel());
		rest = { dx: 0, dy: 0, k: 1 };
		shown = false;
	};
</script>

{#if shown}
	<div class="reveal" aria-hidden="true">
		<div
			class="icon"
			bind:this={iconEl}
			style="left:{box.x - box.size / 2}px; top:{box.y - box.size / 2}px; width:{box.size}px; height:{box.size}px"
		>
			<div class="spin" bind:this={spinEl}>
				<img src={BALL} alt="" draggable="false" />
			</div>
		</div>
	</div>
{/if}

<style>
	/* Over the table, the balance and the wager included — and over the bonus screen as it slides
	   down after the ball. */
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
		filter: drop-shadow(0 0.3vw 0.6vw rgba(0, 0, 0, 0.6))
			drop-shadow(0 0 0.8vw rgba(245, 180, 49, 0.55));
	}
</style>
