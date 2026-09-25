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
	 * Laid out in the game frame's own pixels (the caller converts client rects, see `centreIn` in
	 * Game.svelte), and every beat timed by the clock rather than by animation events, so a tab in
	 * the background cannot leave the round waiting on a frame that never comes.
	 */
	import { tick } from 'svelte';
	import { waitForTimeout } from 'utils-shared/wait';

	import { ROOM_ICON } from '../game/constants';
	import { playSound } from '../game/sound';
	import { staticUrl } from '../lib/staticUrl';

	type Box = { x: number; y: number; size: number };
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

	/** The camera's move: how far down it is (px) at even steps over `ms`. */
	type Pan = (camera: number[], ms: number) => void;

	let shown = $state(false);
	let box = $state<Box>({ x: 0, y: 0, size: 0 });
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

	/**
	 * From the ball on its wedge (`from`) to the hub (`to`, where it lands at `to.size`). Resolves
	 * with it squashed on the hub, stretching back up for `fall`.
	 */
	export const play = async (from: Box, to: Box): Promise<void> => {
		box = to;
		shown = true;
		await tick();

		// Rolling the whole way: a steady turn on an element of its own, apart from the moving.
		spinEl?.animate([{ rotate: '0deg' }, { rotate: '360deg' }], {
			duration: ROLL_MS,
			iterations: Infinity,
		});

		// Hopped up out of its wedge, growing a little — the same hop the chest makes.
		const k = from.size / to.size;
		const wedge = { dx: from.x - to.x, dy: from.y - to.y, k };
		const popped = { dx: wedge.dx, dy: wedge.dy - from.size * 1.4, k: k * 1.5 };
		playSound('pop', 1.1);
		iconEl?.animate(
			[
				{ transform: `translate(${wedge.dx}px, ${wedge.dy}px) scale(${wedge.k})` },
				{ transform: `translate(${popped.dx}px, ${popped.dy}px) scale(${popped.k})` },
			],
			{ duration: POP_MS, easing: 'cubic-bezier(0.2, 0.9, 0.4, 1)', fill: 'both' },
		);
		await waitForTimeout(POP_MS);

		// Over and down onto the hub: a short rise from the top of the hop, then a fall.
		const hub = { dx: 0, dy: 0, k: 1 };
		const hop = arc(popped, hub, to.size * 0.35);
		let old = iconEl?.getAnimations() ?? [];
		iconEl?.animate(hop, { duration: HOP_MS, fill: 'both' });
		old.forEach((a) => a.cancel());
		playSound('whoosh', 0.9);
		await waitForTimeout(HOP_MS);

		// Landed: squashed flat on the hub, and straight back up.
		playSound('peg', 0.7);
		playSound('boom', 1.4, 0.35);
		old = iconEl?.getAnimations() ?? [];
		iconEl?.animate(
			[
				{ transform: 'translate(0, 0) scale(1)' },
				{ transform: `translate(0, ${to.size * 0.08}px) scale(1.18, 0.8)`, offset: 0.45 },
				{ transform: 'translate(0, 0) scale(0.94, 1.08)' },
			],
			{ duration: SQUASH_MS, easing: 'ease-out', fill: 'both' },
		);
		old.forEach((a) => a.cancel());
		await waitForTimeout(SQUASH_MS);

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

	/** Takes the ball off the screen wherever it is. */
	export const hide = () => {
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
