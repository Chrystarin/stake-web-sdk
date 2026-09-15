<script lang="ts">
	/**
	 * The board itself: pegs, pockets, and one ball.
	 *
	 * Driven imperatively rather than by props, because a round is a sequence and not a state:
	 * `arm()` hands the ball to the player and resolves when they let go of it, `drop()` plays the
	 * fall to a pocket that was decided elsewhere. Both are awaited by whatever is orchestrating
	 * the round (see JackpotPlinko.svelte).
	 *
	 * The ball is animated contact to contact rather than simulated. Each segment is a real
	 * projectile arc — kicked up off the peg it struck, falling onto the next — so the motion reads
	 * as physics even though the pegs it will strike were all chosen before it was released.
	 */
	import { onMount } from 'svelte';

	import {
		arcClears,
		arcDepth,
		arcRise,
		BOUNCE_CHOICES,
		inBlast,
		layoutBoard,
		pegColumnAt,
		pegKey,
		pegsFor,
		pegsInRow,
		placeBombs,
		planDropWithBombs,
		snapStartOffset,
		startOffsets,
		type BoardFrame,
		type BoardPeg,
		type BoardShape,
		type BombSite,
	} from './board';
	import { ballPalette } from './colour';
	import { pocketHeat, pocketOffset, type PocketLadder } from './pockets';
	import { glowHeight, regionStyle, SLOT_CARDS, SLOT_GLOWS, slotTier } from './slots';

	type Props = {
		shape: BoardShape;
		ladder: PocketLadder;
		/** The ball is painted in this — the colour that opened the round. */
		accent?: string;
		/** Written before the value on a pocket label, e.g. `x` for `x200`. */
		prefix?: string;
		/**
		 * How a pocket's value is written, when `prefix` is not enough. A host whose awards run into
		 * the thousands needs to shorten them — the label has one pocket's width to fit in, and a
		 * card is only ever about five characters wide.
		 */
		format?: (value: number) => string;
		/**
		 * A picture to fall instead of the painted ball.
		 *
		 * `cx`, `cy` and `d` say which part of the image IS the ball — its centre and diameter, as
		 * fractions of the image's width — so a drawing with something sticking out of it (a fuse, a
		 * tail) still strikes the pegs on its round part and not on its bounding box. The painted
		 * ball stays underneath as the glow: the halo is drawn in `accent`, and with art it is lit
		 * the whole way down rather than only while the ball is waiting to be picked up.
		 *
		 * `scale` draws the picture bigger than the ball it stands for, without moving the ball: a
		 * board sized for its pockets can leave a ball too small to recognise a drawing in, and
		 * overlapping the pegs slightly is what a real object of that size would do anyway. The
		 * contacts, and the fall, are unchanged.
		 */
		art?: { src: string; cx: number; cy: number; d: number; scale?: number };
		/**
		 * How opaque the playfield is, 0-1. Below 1 the screen behind reads through it — which is
		 * only worth doing over a background worth seeing.
		 */
		fieldOpacity?: number;
		/** Fired as the ball is let go, on every peg contact, as a bomb goes off, and as it lands. */
		sounds?: { peg?: () => void; drop?: () => void; land?: () => void; blast?: () => void };
		/**
		 * Bombs among the pegs: `count` of them, placed afresh each time the ball is armed.
		 *
		 * The ball striking one sets it off — the pegs around it are blown away and the ball is
		 * thrown several rows down and a couple of pitches across in one flight (see `board.ts`).
		 * The pocket is not at stake: the throw is chosen from the ones that leave the walk able to
		 * reach the pocket it was already headed for.
		 *
		 * `src` is drawn in the peg's place; `cx`, `cy` and `d` say where the round body is in it, as
		 * fractions of its width, so the bomb stands on the peg by its body and not by its fuse. The
		 * body is drawn `scale` times the ball's size (default 1), capped at half a pitch so bombs
		 * never touch across a row. `blast` is the explosion, a square picture drawn centred on the
		 * bomb and animated by the board.
		 */
		bombs?: {
			count: number;
			src: string;
			cx: number;
			cy: number;
			d: number;
			scale?: number;
			blast: string;
		};
		/** Let go for the player if they never do, so a round can never hang. 0 disables. */
		autoDropAfterMs?: number;
		/**
		 * How the ball is launched.
		 *
		 * `rail` hands it to the player on a slider to drag and let go of, which is what a board with
		 * nothing above it wants. `aimed` takes its orders from outside instead: the host points
		 * something of its own at the board — a cannon, a chute — and drives `aim()` and `fire()`.
		 * The board then draws no rail, and keeps the ball out of sight until it is fired, because
		 * until then the ball is in whatever the host is pointing.
		 */
		launcher?: 'rail' | 'aimed';
		/**
		 * A cabinet painted behind the board: where the pegs may stand and where the pockets go,
		 * as fractions of the host. Given one, the board stops drawing a field of its own — the
		 * picture IS the field — and stops choosing its own proportions.
		 */
		frame?: BoardFrame;
	};

	const props: Props = $props();

	/**
	 * Time the ball spends on one ARC UNIT — the time a projectile takes to rise or fall one row gap
	 * under this board's gravity. A segment is as many units long as its arc is tall, so the clock
	 * follows the shape of the fall instead of ticking evenly: a glancing hop is quick, a rebound
	 * that goes back up over the row above hangs. That variation is most of what makes the drop read
	 * as a ball rather than as a marker being stepped down a grid.
	 */
	const ARC_MS = 95;
	/**
	 * The first fall, off the rail. No bounce — it has not hit anything yet — and slow, because it is
	 * the one moment the player is watching their own choice leave their hand.
	 */
	const ENTRY_ARC_SCALE = 2.4;
	/**
	 * The same leg, fired. A shot leaves the muzzle under its own power instead of being let go of,
	 * so it crosses the empty gap above the board quickly and the slow, watchable part of the fall
	 * starts where the pegs do. Only this first segment is affected: everything from the first peg
	 * down keeps the timing it had, because that is the part with something to look at.
	 */
	const FIRED_ENTRY_ARC_SCALE = 1;
	/** The last, into the pocket: a deeper drop, and the one being waited on, so it takes its time. */
	const POCKET_ARC_SCALE = 1.5;
	/**
	 * A throw off a bomb. Quicker than a hop of the same height — the ball is being driven rather
	 * than falling — but not by much: a flight that crosses three pitches in the time a hop crosses
	 * half of one reads as a cut, not a blast.
	 */
	const BLAST_ARC_SCALE = 0.8;
	/**
	 * How long the ball sits on the bomb before it is thrown. The fuse, in effect: the strike, the
	 * flash, and only THEN the ball leaving — all three at once and the eye reads none of them.
	 */
	const BLAST_HOLD_MS = 90;
	/** How long the explosion is on screen, and how long a blown peg takes to fly off. */
	const BLAST_MS = 720;
	const PEG_GONE_MS = 480;
	/**
	 * How high the ball comes off a peg, in row gaps. Most strikes are glancing; roughly one in five
	 * is a real rebound that carries it back up past the row above before it comes down. The tail is
	 * the point — a fall where every bounce is the same height is a fall nobody watches twice.
	 */
	const BOUNCE_MIN = 0.18;
	const BOUNCE_SPREAD = 0.72;
	const BIG_BOUNCE_ODDS = 0.3;
	const BOUNCE_BIG = 1.8;
	/** How long the ball stays squashed after a contact, and a struck peg stays lit. */
	const CONTACT_MS = 130;
	/**
	 * Spin. A peg adds to the ball's turn in the direction it deflected it, and the ball keeps most
	 * of the turn it already had — so a zig-zag rocks, and a run of deflections the same way winds
	 * up into a tumble. Rates are degrees per millisecond; `MAX` is a little under two turns a row,
	 * past which a picture stops reading as an object and starts reading as a blur.
	 */
	const SPIN_RETAIN = 0.82;
	const SPIN_KICK = 0.3;
	const SPIN_MAX = 1.1;
	/** How long the ball takes to right itself once it is in the pocket. */
	const SPIN_SETTLE_MS = 280;
	const PEG_LIT_MS = 320;
	/** Ball glide when the board is resized under it, or when it is first put on the rail. */
	const SNAP_MS = 140;

	let hostEl = $state<HTMLDivElement>();
	let box = $state({ width: 0, height: 0 });

	const layout = $derived(layoutBoard(props.shape, box.width, box.height, props.frame));
	const pegs = $derived(pegsFor(props.shape, layout));

	/**
	 * Where `art` sits inside the ball's own box, in host pixels, so the round part of the picture
	 * lands exactly on the ball's centre and is exactly the ball's size.
	 */
	const artBox = $derived.by(() => {
		const art = props.art;
		if (!art || art.d <= 0) return null;
		const size = ((layout.ballRadius * 2) / art.d) * (art.scale ?? 1);
		return {
			size,
			left: layout.ballRadius - art.cx * size,
			top: layout.ballRadius - art.cy * size,
		};
	});

	/**
	 * Where the ball sits on the rail, in pitches from centre. CONTINUOUS: the player is left
	 * wherever they let go, rather than being tidied onto the nearest peg.
	 */
	let railOffset = $state(0.5);
	/**
	 * The peg it will strike in the top row — the nearest one to wherever it was let go.
	 *
	 * The walk needs a peg to start from, so this is what the plan is built on; the ball's own
	 * position is not moved to match it. Between the two is the first fall, which carries the ball
	 * from where it was released onto the peg below — at most half a pitch, which is exactly what
	 * a ball dropped between two pegs does anyway.
	 */
	const startStep = $derived(snapStartOffset(props.shape, railOffset));
	let phase = $state<'idle' | 'armed' | 'released' | 'dropping' | 'landed'>('idle');
	let dragging = $state(false);
	/** Ball centre in host pixels. Follows the drag while armed, the plan once dropped. */
	let ballX = $state(0);
	let ballY = $state(0);
	/** 1 at a peg contact, decaying to 0 — what deforms the ball on the hit. */
	let squash = $state(0);
	/** How far the ball has turned, in degrees. Only art can show it — see `.pb-ball-art`. */
	let spin = $state(0);
	/** True while the landed ball is turning back upright in its pocket. */
	let settling = $state(false);
	let landedPocket = $state<number | null>(null);
	/** Pegs currently flashing, by index into `pegs`. */
	let litPegs = $state(new Set<number>());

	// --- Bombs ------------------------------------------------------------------------------
	/** This round's bombs, in board units so a resize carries them with the pegs. */
	let bombs = $state<BombSite[]>([]);
	/** Pegs blown away, by `pegKey`, with the direction each flew off in (a unit vector). */
	let destroyed = $state(new Map<string, { dx: number; dy: number }>());
	/** Explosions on screen. Each is removed once its animation is over. */
	let blasts = $state<{ id: number; row: number; offset: number }[]>([]);
	let blastSeq = 0;
	const bombAt = $derived(new Map(bombs.map((bomb) => [pegKey(bomb.row, bomb.offset), bomb])));
	/** A peg's offset from centre in pitches — the unit the bombs and the blast set are kept in. */
	const pegOffsetOf = (peg: BoardPeg) => peg.col - (pegsInRow(props.shape, peg.row) - 1) / 2;
	/**
	 * Where the bomb picture sits about the peg it stands on, in host pixels — the same idea as
	 * `artBox`: the body is put on the peg, and the fuse goes wherever the drawing has it.
	 */
	const bombBox = $derived.by(() => {
		const art = props.bombs;
		if (!art || art.d <= 0) return null;
		const body = Math.min(layout.ballRadius * 2 * (art.scale ?? 1), layout.pitch * 0.5);
		const size = body / art.d;
		return { size, left: -art.cx * size, top: -art.cy * size };
	});
	/**
	 * The explosion's box. Wide enough to cover the blast set on either kind of board: a pitch
	 * either side of the bomb across, two rows either side of it down — whichever of those is the
	 * larger, since a squat board's rows are a fraction of its pitch and a tall board's are most of
	 * one. Drawn as a circle regardless; the set it stands for is a diamond, but a flash is round.
	 */
	const blastSize = $derived(2 * Math.max(layout.pitch * 1.15, layout.rowGap * 2.4));

	/**
	 * Set a bomb off: it and the pegs around it are marked gone, each with the direction away from
	 * the bomb so it can fly off that way, and the explosion is put on screen over the top.
	 */
	const explode = (bomb: BombSite) => {
		const bombX = layout.centreX + bomb.offset * layout.pitch;
		const bombY = layout.topY + bomb.row * layout.rowGap;
		const next = new Map(destroyed);
		for (const peg of pegs) {
			const offset = pegOffsetOf(peg);
			if (!inBlast(bomb, peg.row, offset)) continue;
			const dx = peg.x - bombX;
			const dy = peg.y - bombY;
			const length = Math.hypot(dx, dy) || 1;
			next.set(pegKey(peg.row, offset), { dx: dx / length, dy: dy / length });
		}
		destroyed = next;
		const id = ++blastSeq;
		blasts = [...blasts, { id, row: bomb.row, offset: bomb.offset }];
		const timer = setTimeout(() => {
			blasts = blasts.filter((blast) => blast.id !== id);
			pegTimers.delete(timer);
		}, BLAST_MS);
		pegTimers.add(timer);
		props.sounds?.blast?.();
	};

	const pocketX = (index: number) =>
		layout.centreX + pocketOffset(props.ladder, index) * layout.pitch;

	/** The track runs to the outermost start position, not to the wall past it. */
	const railLimit = () => (props.shape.startSteps - 0.5) * layout.pitch;

	const aimed = $derived(props.launcher === 'aimed');
	/**
	 * Where an aimed shot starts, in host pixels — the muzzle of whatever the host is pointing.
	 * Normally ABOVE the board, so its y is negative, which is why it is given in pixels rather
	 * than in the board's own rows: up there the board has no row to name.
	 */
	let launchPoint = $state<{ x: number; y: number } | null>(null);
	/** The furthest the ball can enter from centre, in pitches. Both launchers answer to it. */
	const startLimit = $derived(props.shape.startSteps - 0.5);

	/** Put the ball where the rail says it is. Also what keeps it there through a resize. */
	const restBall = () => {
		ballX = layout.centreX + railOffset * layout.pitch;
		ballY = layout.railY;
	};

	// Reading `layout` and `railOffset` is what subscribes this to a resize. Only while the ball is
	// waiting and NOT in hand — a drag drives the ball straight from the pointer.
	$effect(() => {
		void layout;
		if (phase === 'armed' && !dragging) restBall();
	});

	onMount(() => {
		const el = hostEl;
		if (!el) return;
		const measure = () => (box = { width: el.clientWidth, height: el.clientHeight });
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(el);
		return () => {
			observer.disconnect();
			cancelAnimation();
		};
	});

	// --- Holding the ball -------------------------------------------------------------------

	let releaseRound: ((step: number) => void) | null = null;
	let autoDropTimer: ReturnType<typeof setTimeout> | undefined;

	const pointerX = (event: PointerEvent) => {
		const rect = hostEl?.getBoundingClientRect();
		return rect ? event.clientX - rect.left : 0;
	};

	/**
	 * Follow the pointer even once it leaves the rail — a drag that has to stay inside a 40px strip
	 * is a drag that keeps getting dropped. Capture is best-effort: it throws on a pointer the
	 * browser no longer considers active, and the drag works without it either way.
	 */
	const capture = (event: PointerEvent, hold: boolean) => {
		const el = event.currentTarget as HTMLElement | null;
		try {
			if (hold) el?.setPointerCapture(event.pointerId);
			else el?.releasePointerCapture(event.pointerId);
		} catch {
			/* not capturable — the handlers stand on their own */
		}
	};

	/**
	 * (Re)start the unattended-drop clock. Deliberately kept running through a drag rather than
	 * cancelled by it: a pointerup that never arrives — the pointer left the window, the browser
	 * dropped the capture — would otherwise leave the ball held for good, and with it an open RGS
	 * round. Every interaction pushes it back, so it only ever fires on a player who has stopped.
	 */
	const armAutoDrop = () => {
		clearTimeout(autoDropTimer);
		const delay = props.autoDropAfterMs ?? 20000;
		if (delay > 0) autoDropTimer = setTimeout(release, delay);
	};

	const onRailDown = (event: PointerEvent) => {
		if (phase !== 'armed') return;
		dragging = true;
		armAutoDrop();
		capture(event, true);
		onRailMove(event);
	};

	const onRailMove = (event: PointerEvent) => {
		if (!dragging) return;
		const limit = railLimit();
		// Free movement inside the drop zone, hard walls at its ends — the ball is on a rail, and a
		// pointer that runs past the end parks it there rather than dragging it off the board.
		ballX = Math.max(layout.centreX - limit, Math.min(layout.centreX + limit, pointerX(event)));
		ballY = layout.railY;
		railOffset = (ballX - layout.centreX) / layout.pitch;
		armAutoDrop();
	};

	const onRailUp = (event: PointerEvent) => {
		if (!dragging) return;
		dragging = false;
		capture(event, false);
		release();
	};

	/**
	 * Let the ball go from exactly where it is sitting.
	 *
	 * Nothing is tidied on the way: the ball is not walked onto the nearest peg first, because that
	 * takes the player's aim off them at the last moment and makes the whole drop zone feel like a
	 * row of notches. It falls from where they let go, and the peg it strikes on the way down is
	 * whichever one is under it (see `startStep`).
	 */
	const release = () => {
		if (phase !== 'armed') return;
		clearTimeout(autoDropTimer);
		dragging = false;
		phase = 'released';
		props.sounds?.drop?.();
		const resolve = releaseRound;
		releaseRound = null;
		resolve?.(startStep);
	};

	/**
	 * Hand the ball to the player. Resolves with the peg they let go over.
	 *
	 * A round that is never released would leave an RGS bet open, so an unattended drop lets go on
	 * its own after `autoDropAfterMs` — from wherever the ball was left, which is still the
	 * player's choice.
	 */
	export const arm = (): Promise<number> => {
		cancelAnimation();
		landedPocket = null;
		litPegs = new Set();
		squash = 0;
		spin = 0;
		settling = false;
		// On the rail the middle of the track sits between the two innermost start pegs, so the ball
		// opens on the one just right of centre rather than on a position that does not exist. An
		// aimed launcher starts level instead, pointing at the middle of the board.
		railOffset = aimed ? 0 : 0.5;
		launchPoint = null;
		// A fresh field: last round's holes are filled in and the bombs go somewhere new.
		bombs = props.bombs?.count ? placeBombs(props.shape, props.bombs.count) : [];
		destroyed = new Map();
		blasts = [];
		phase = 'armed';
		restBall();
		return new Promise<number>((resolve) => {
			releaseRound = resolve;
			armAutoDrop();
		});
	};

	/**
	 * Point the shot, for a host driving an `aimed` launcher. `fraction` is where the ball will
	 * enter: -1 at the far left of the drop zone, 0 dead centre, 1 at the far right. It is CLAMPED
	 * here, so a host that hands over a wilder number still gets a shot that lands on the board —
	 * which is the whole reason the range is normalised rather than in pixels the host has to know.
	 */
	export const aim = (fraction: number) => {
		if (phase !== 'armed') return;
		const clamped = Math.max(-1, Math.min(1, Number.isFinite(fraction) ? fraction : 0));
		railOffset = clamped * startLimit;
		restBall();
		armAutoDrop();
	};

	/**
	 * Where the shot comes FROM, in host pixels, for a host with something to fire it out of.
	 * Left unset, the ball simply appears on the drop-zone line, which is where a rail would have
	 * been holding it; set, the ball leaves that point and flies into the board.
	 */
	export const launchFrom = (point: { x: number; y: number } | null) => {
		launchPoint = point;
	};

	/** Fire, for an `aimed` launcher. The same thing as letting go of the rail. */
	export const fire = () => release();

	// --- The fall ---------------------------------------------------------------------------

	let cancelFrame: (() => void) | null = null;
	const pegTimers = new Set<ReturnType<typeof setTimeout>>();

	/**
	 * Ask for the next frame, from rAF or from a timer — whichever answers first.
	 *
	 * A backgrounded tab stops serving rAF altogether, and the ball is the only thing that can
	 * finish the round: a fall that freezes mid-board leaves the RGS bet open and the game waiting
	 * on a promise that will never settle. The timer is what makes that impossible. Every position
	 * is computed from the clock rather than counted in frames, so a throttled tab replays the same
	 * fall in fewer, larger steps and still lands in the same pocket.
	 */
	const scheduleFrame = (run: (now: number) => void): (() => void) => {
		let spent = false;
		const fire = () => {
			if (spent) return;
			spent = true;
			cancelAnimationFrame(frame);
			clearTimeout(timer);
			run(performance.now());
		};
		const frame = requestAnimationFrame(fire);
		const timer = setTimeout(fire, 40);
		return () => {
			spent = true;
			cancelAnimationFrame(frame);
			clearTimeout(timer);
		};
	};

	const cancelAnimation = () => {
		cancelFrame?.();
		cancelFrame = null;
		clearTimeout(autoDropTimer);
		for (const timer of pegTimers) clearTimeout(timer);
		pegTimers.clear();
	};

	const lightPeg = (row: number, col: number) => {
		const index = pegs.findIndex((peg) => peg.row === row && peg.col === col);
		if (index < 0) return;
		litPegs = new Set(litPegs).add(index);
		const timer = setTimeout(() => {
			const next = new Set(litPegs);
			next.delete(index);
			litPegs = next;
			pegTimers.delete(timer);
		}, PEG_LIT_MS);
		pegTimers.add(timer);
	};

	/**
	 * Play the ball down to `pocketIndex`.
	 *
	 * The path is planned in BOARD coordinates — offsets in peg pitches, depth in row gaps — and
	 * converted to pixels every frame, so a viewport that changes mid-drop carries the ball with
	 * the board instead of leaving it behind.
	 */
	export const drop = (pocketIndex: number): Promise<void> => {
		cancelAnimation();
		phase = 'dropping';
		settling = false;

		const targetOffset = pocketOffset(props.ladder, pocketIndex);
		/**
		 * The board in pixels, which is what turns "does this hop clear the pegs" from a question
		 * about pitches into one that can actually be answered — the pegs are 12px across and the
		 * ball is as wide as the gap between rows, and neither of those is knowable in board units.
		 */
		const geometry = {
			pitch: layout.pitch,
			rowGap: layout.rowGap,
			ballRadius: layout.ballRadius,
			pegRadius: layout.pegRadius,
		};
		/**
		 * The tallest height this hop can be flown at without going through a peg, or null. `absent`
		 * is the pegs that are no longer there to go through — blown away earlier in this same fall.
		 */
		const flyableBounce = (
			from: { row: number; offset: number },
			to: { row: number; offset: number },
			ceiling = Infinity,
			absent?: (row: number, offset: number) => boolean,
		) =>
			BOUNCE_CHOICES.find(
				(bounce) => bounce <= ceiling && arcClears(props.shape, geometry, from, to, bounce, absent),
			) ?? null;
		// A step is only offered to the walk if there is SOME height it can be flown at cleanly. With
		// the ball going no further than the next peg along, that is nearly always true — what this
		// still catches is a bounce tall enough to carry it up into the row above and through a peg
		// standing there. A throw off a bomb is a different matter: it crosses pitches, and the
		// same test is most of what decides which throws are on offer.
		const contacts = planDropWithBombs(
			props.shape,
			startStep,
			targetOffset,
			bombs,
			Math.random,
			(from, to, absent) => flyableBounce(from, to, Infinity, absent) !== null,
		);
		const pocketDepth =
			(layout.pocketTop + layout.pocketHeight * 0.5 - layout.topY) / layout.rowGap;
		const railDepth = (layout.railY - layout.topY) / layout.rowGap;

		// One contact per peg struck — one per row, except where a bomb threw the ball over some —
		// then the pocket. `depth` is in row gaps below the top row. `bomb` marks a contact that
		// sets one off: the segment AFTER it is the throw.
		const points = contacts.map((contact) => {
			const onField = contact.row < props.shape.rows;
			return {
				offset: contact.offset,
				depth: onField ? contact.row : pocketDepth,
				peg: onField
					? { row: contact.row, col: pegColumnAt(props.shape, contact.row, contact.offset) }
					: null,
				bomb: contact.bomb ? { row: contact.row, offset: contact.offset } : null,
			};
		});
		/**
		 * The pegs that are gone by the time segment `index` is flown: everything blown away by the
		 * bombs struck before it. Standing pegs are obstacles; these are holes.
		 */
		const absentBefore = (index: number) => {
			const blown = points.slice(0, index).flatMap((point) => (point.bomb ? [point.bomb] : []));
			return blown.length
				? (row: number, offset: number) => blown.some((bomb) => inBlast(bomb, row, offset))
				: undefined;
		};
		// The fall starts where the ball ACTUALLY is, not on the peg it is about to strike — the
		// first segment is what carries it from one to the other. Fired, that is the muzzle it came
		// out of, off the top of the board; otherwise it is the drop-zone line.
		// A fired ball leaves the barrel at speed; a dropped one starts from rest. It changes the
		// shape of the first leg, so the answer is taken here rather than read off `launchPoint`
		// again mid-fall.
		const fired = launchPoint !== null;
		const from = launchPoint
			? {
					offset: (launchPoint.x - layout.centreX) / layout.pitch,
					depth: (launchPoint.y - layout.topY) / layout.rowGap,
				}
			: { offset: railOffset, depth: railDepth };
		/**
		 * How high the ball comes off each peg, in row gaps. Rolled ONCE, here, rather than per frame:
		 * a tab that is only served three frames has to replay the same fall as one served thirty.
		 * Bounces grow a little towards the bottom, which is both true — the ball is moving fastest
		 * there — and the right place for them, since the last few are the ones being waited on.
		 */
		const bounces = points.map((point, index) => {
			if (index === 0) return 0;
			const before = points[index - 1];
			const height =
				Math.random() < BIG_BOUNCE_ODDS
					? BOUNCE_BIG * (0.7 + Math.random() * 0.6)
					: BOUNCE_MIN + Math.random() * BOUNCE_SPREAD;
			const wanted = height * (0.85 + (index / points.length) * 0.4);
			// And then the tallest arc no higher than that which actually clears the pegs. The last
			// hop is into the pocket, below the field, where there is nothing left to clear.
			if (index === points.length - 1 || !before.peg || !point.peg) return wanted;
			const hop = {
				from: { row: before.peg.row, offset: before.offset },
				to: { row: point.peg.row, offset: point.offset },
			};
			const absent = absentBefore(index);
			// Thrown off a bomb: as high as the field allows, which is what a blast looks like — and
			// never flat, since the planner only offered the throw because some clean arc exists.
			if (before.bomb)
				return flyableBounce(hop.from, hop.to, Infinity, absent) ?? BOUNCE_CHOICES[3];
			// Falling back to a FLAT hop would be the one way left to phase: a ball thrown wide and
			// not allowed to arc goes straight through whatever stands between. Where nothing under
			// the wanted height is clean, take the clean arc that is taller instead — the planner
			// only offered this step because one exists.
			return (
				flyableBounce(hop.from, hop.to, wanted, absent) ??
				flyableBounce(hop.from, hop.to, Infinity, absent) ??
				0
			);
		});

		/**
		 * A hop that rises `up` and then falls `up + drop` takes time in proportion to the square
		 * roots of the two heights — which is just what gravity does, and what makes a tall rebound
		 * hang instead of merely travelling further.
		 */
		const arcUnits = (up: number, drop: number) =>
			Math.sqrt(Math.max(0, up)) + Math.sqrt(Math.max(0, up + drop));

		const durations = points.map((point, index) => {
			const before = index === 0 ? from : points[index - 1];
			const drop = point.depth - before.depth;
			if (index === 0)
				return (
					ARC_MS *
					(fired ? FIRED_ENTRY_ARC_SCALE : ENTRY_ARC_SCALE) *
					Math.sqrt(Math.max(0.2, drop))
				);
			const scale =
				index === points.length - 1
					? POCKET_ARC_SCALE
					: points[index - 1].bomb
						? BLAST_ARC_SCALE
						: 1;
			return ARC_MS * scale * arcUnits(bounces[index], drop);
		});
		/** The fuse: how long the ball waits on a bomb before the segment's clock starts. */
		const holds = points.map((_, index) =>
			index > 0 && points[index - 1].bomb ? BLAST_HOLD_MS : 0,
		);

		/**
		 * The share of a segment spent going up, so the two halves of the arc meet at the apex. Zero
		 * where there is no bounce, which collapses the whole thing back to a plain accelerating
		 * fall — that is the first segment, off the rail.
		 */
		const riseShare = points.map((point, index) => {
			const before = index === 0 ? from : points[index - 1];
			return arcRise(bounces[index], point.depth - before.depth);
		});

		/**
		 * The turn is planned segment by segment, the same way the path is: one rate and one
		 * starting angle each, so a throttled tab serving three frames instead of thirty still
		 * turns the ball by exactly the same amount. `dir` is the way the peg at the top of the
		 * segment sent it, which is the way it leaves that peg spinning.
		 */
		const spinRates: number[] = [];
		const spinAngles: number[] = [];
		let rate = 0;
		let angle = 0;
		for (let index = 0; index < points.length; index++) {
			const before = index === 0 ? from : points[index - 1];
			const dir = Math.sign(points[index].offset - before.offset);
			// A blast sends it tumbling flat out; a peg only nudges the turn it already has.
			rate =
				index > 0 && points[index - 1].bomb
					? dir * SPIN_MAX
					: Math.max(-SPIN_MAX, Math.min(SPIN_MAX, rate * SPIN_RETAIN + dir * SPIN_KICK));
			spinRates.push(rate);
			spinAngles.push(angle);
			angle += rate * durations[index];
		}

		return new Promise<void>((resolve) => {
			let segment = 0;
			let segmentStart = 0;
			let lastContact = -Infinity;

			const step = (now: number) => {
				if (!segmentStart) segmentStart = now;
				const start = segment === 0 ? from : points[segment - 1];
				const end = points[segment];
				const span = durations[segment];
				const t = Math.min(1, Math.max(0, (now - segmentStart - holds[segment]) / span));

				/**
				 * A real hop, in two parabolas that meet at the apex: up off the peg, decelerating to
				 * a stop, then down onto the next one, accelerating. Both are exact at their ends, so
				 * the ball leaves one contact and arrives at the next however coarsely it is sampled.
				 *
				 * Across, it moves at a constant rate — which is what a projectile does, and why a
				 * tall rebound drifts slowly at the top and quickly at the two ends.
				 */
				const bounce = bounces[segment];
				const rise = riseShare[segment];
				const drop = end.depth - start.depth;
				// The shot out of a barrel is the exception: constant speed, so with x already linear
				// the ball travels a STRAIGHT line along the barrel. Everything after it is falling,
				// and falls on the arc above.
				const depth =
					fired && segment === 0
						? start.depth + drop * t
						: arcDepth(start.depth, drop, bounce, rise, t);

				ballX = layout.centreX + (start.offset + (end.offset - start.offset) * t) * layout.pitch;
				ballY = layout.topY + depth * layout.rowGap;
				squash = Math.max(0, 1 - (now - lastContact) / CONTACT_MS);
				// Off `t` rather than the clock, so the angle at the end of a segment is exactly the
				// angle the next one starts from however few frames were served in between.
				spin = spinAngles[segment] + spinRates[segment] * span * t;

				if (t >= 1) {
					lastContact = now;
					if (end.bomb) {
						explode(end.bomb);
					} else if (end.peg) {
						lightPeg(end.peg.row, end.peg.col);
						props.sounds?.peg?.();
					}
					segment += 1;
					if (segment >= points.length) {
						cancelFrame = null;
						squash = 1;
						phase = 'landed';
						landedPocket = pocketIndex;
						// A bomb lying on its side in the pocket reads as broken rather than as landed,
						// so the last of the turn is spent standing it back up the short way.
						spin = Math.round(spin / 360) * 360;
						settling = true;
						props.sounds?.land?.();
						// Let the squash relax rather than snapping flat the instant it lands.
						setTimeout(() => (squash = 0), CONTACT_MS * 2);
						resolve();
						return;
					}
					segmentStart = now;
				}
				cancelFrame = scheduleFrame(step);
			};

			cancelFrame = scheduleFrame(step);
		});
	};

	/** Take the ball off the board and put every pocket back to rest. */
	export const reset = () => {
		cancelAnimation();
		releaseRound = null;
		phase = 'idle';
		landedPocket = null;
		litPegs = new Set();
		squash = 0;
		spin = 0;
		settling = false;
		railOffset = aimed ? 0 : 0.5;
		launchPoint = null;
		bombs = [];
		destroyed = new Map();
		blasts = [];
	};

	/**
	 * How brightly the ladder is lit, which is a different answer at each of the three moments a
	 * round has: offered, in flight, decided.
	 *
	 * Held back while the ball still is — the board is waiting, and nothing on the ladder has
	 * happened yet. Full the instant the shot leaves, because from there every pocket is live and
	 * the whole row is what the ball is being watched against. Then all but the one that took it,
	 * so the result is the only thing lit: the board has finished offering and is now reporting.
	 */
	const pocketWaiting = $derived(phase === 'idle' || phase === 'armed');
	const pocketDimmed = (index: number) => landedPocket !== null && landedPocket !== index;

	/** Glides only when the board moves under it; a drag and a release both leave it exactly. */
	const snapping = $derived(phase === 'armed' && !dragging);
	/** Waiting to be picked up: the ball pulses until a hand is actually on it. Only on the rail —
	 *  an aimed ball is loaded, not offered, and there is nothing on the board to reach for. */
	const beckoning = $derived(!aimed && phase === 'armed' && !dragging);
	const ticks = $derived(startOffsets(props.shape));
	const ball = $derived(ballPalette(props.accent ?? '#ffe14d'));
</script>

<div class="pb-host" bind:this={hostEl} style="--pb-field-alpha:{props.fieldOpacity ?? 1}">
	{#if layout.pitch > 0}
		<!-- The field the pegs stand in. Purely a backdrop — it gives the board an edge to end at,
		     so the pockets read as the bottom of something rather than as a floating row. Skipped
		     under a frame, where the host has painted something better behind it. -->
		{#if !props.frame}
			<div
				class="pb-field"
				style="left:{layout.left}px; top:{layout.top}px; width:{layout.width}px; height:{layout.height}px; border-radius:{layout.pitch *
					0.5}px;"
			></div>
		{/if}

		<!-- The slider the ball is held on: a thin pill spanning the drop zone, with the ball riding
		     it as the knob. The element itself is a taller, invisible hit area, so the ball can be
		     grabbed by aiming near the track rather than exactly at it. An aimed board has no rail:
		     the thing being pointed lives outside, and this space is the gap under it. -->
		{#if !aimed}
			<div
				class="pb-rail"
				class:live={phase === 'armed'}
				style="left:{layout.centreX - railLimit() - layout.ballRadius}px; top:{layout.railY -
					layout.rowGap * 1.2}px; width:{railLimit() * 2 +
					layout.ballRadius * 2}px; height:{layout.rowGap * 2.4}px;"
				onpointerdown={onRailDown}
				onpointermove={onRailMove}
				onpointerup={onRailUp}
				onpointercancel={onRailUp}
				aria-hidden="true"
			>
				<div
					class="pb-track"
					style="height:{layout.ballRadius * 0.42}px; border-radius:{layout.ballRadius}px;"
				>
					{#each ticks as tick (tick)}
						<div
							class="pb-tick"
							class:on={tick === startStep && phase !== 'idle'}
							style="left:{railLimit() +
								layout.ballRadius +
								tick * layout.pitch}px; width:{layout.ballRadius *
								0.26}px; height:{layout.ballRadius * 0.26}px;"
						></div>
					{/each}
				</div>
			</div>
		{/if}

		<!-- The glow columns go in FIRST, so they rise behind the pegs rather than over them. All
		     eleven pulse together and in phase, which is exactly how the source skeleton animates
		     them (see slots.ts). -->
		{#each props.ladder.values as _, index (index)}
			{@const width = layout.pitch * 0.94}
			{@const height = glowHeight(width)}
			<div
				class="pb-pocket-glow"
				class:won={landedPocket === index}
				class:waiting={pocketWaiting}
				class:dimmed={pocketDimmed(index)}
				style="left:{pocketX(index)}px; top:{layout.pocketTop +
					layout.pocketHeight -
					height}px; width:{width}px; height:{height}px;"
			>
				<i style={regionStyle(SLOT_GLOWS[slotTier(pocketHeat(props.ladder, index))], width, height)}
				></i>
			</div>
		{/each}

		<!-- A peg is a stud, or a bomb standing where the stud would be. Either can be blown away:
		     a stud flies off along the line from the bomb to it, a bomb simply goes — the explosion
		     drawn over it is what the eye is on. -->
		{#each pegs as peg, index (`${peg.row}:${peg.col}`)}
			{@const key = pegKey(peg.row, pegOffsetOf(peg))}
			{@const gone = destroyed.get(key)}
			{#if bombBox && bombAt.has(key)}
				<i
					class="pb-bomb"
					class:gone={Boolean(gone)}
					style="left:{peg.x + bombBox.left}px; top:{peg.y +
						bombBox.top}px; width:{bombBox.size}px; height:{bombBox.size}px; background-image:url('{props
						.bombs?.src}'); transform-origin:{props.bombs ? props.bombs.cx * 100 : 50}% {props.bombs
						? props.bombs.cy * 100
						: 50}%;"
				></i>
			{:else}
				<div
					class="pb-peg"
					class:hit={litPegs.has(index)}
					class:gone={Boolean(gone)}
					style="left:{peg.x}px; top:{peg.y}px; --peg:{layout.pegRadius * 2}px; --dx:{gone?.dx ??
						0}; --dy:{gone?.dy ?? 0}; --fling:{layout.pitch * 1.1}px; --gone-ms:{PEG_GONE_MS}ms;"
				></div>
			{/if}
		{/each}

		{#each props.ladder.values as value, index (index)}
			{@const width = layout.pitch * 0.94}
			<div
				class="pb-pocket"
				class:won={landedPocket === index}
				class:waiting={pocketWaiting}
				class:dimmed={pocketDimmed(index)}
				style="left:{pocketX(
					index,
				)}px; top:{layout.pocketTop}px; width:{width}px; height:{layout.pocketHeight}px; font-size:{layout.pitch *
					0.3}px;"
			>
				<i
					style={regionStyle(
						SLOT_CARDS[slotTier(pocketHeat(props.ladder, index))],
						width,
						layout.pocketHeight,
					)}
				></i>
				<span>{props.format ? props.format(value) : `${props.prefix ?? ''}${value}`}</span>
			</div>
		{/each}

		<!-- Explosions: over the pegs, UNDER the ball. The ball sits in the middle of the burst for
		     the moment it is held there and then flies out of it — which is only a flight anyone
		     sees if the burst is behind it rather than over it. -->
		{#each blasts as blast (blast.id)}
			<i
				class="pb-blast"
				style="left:{layout.centreX + blast.offset * layout.pitch}px; top:{layout.topY +
					blast.row *
						layout.rowGap}px; width:{blastSize}px; height:{blastSize}px; background-image:url('{props
					.bombs?.blast}'); --blast-ms:{BLAST_MS}ms;"
			></i>
		{/each}

		<!-- An aimed ball is inside whatever the host is pointing until it is fired, so the board
		     shows nothing until then. On the rail it is on the board the whole time. -->
		{#if phase !== 'idle' && !(aimed && phase === 'armed')}
			<div
				class="pb-ball"
				class:snapping
				class:beckoning
				class:held={dragging}
				class:has-art={Boolean(props.art)}
				style="--x:{ballX}px; --y:{ballY}px; width:{layout.ballRadius *
					2}px; height:{layout.ballRadius *
					2}px; --squash:{squash}; --snap-ms:{SNAP_MS}ms; --sheen:{ball.sheen}; --face:{ball.face}; --shade:{ball.shade}; --edge:{ball.edge};"
			>
				{#if props.art && artBox}
					<i
						class="pb-ball-art"
						class:settling
						style="background-image:url('{props.art
							.src}'); width:{artBox.size}px; height:{artBox.size}px; left:{artBox.left}px; top:{artBox.top}px; transform-origin:{props
							.art.cx * 100}% {props.art.cy *
							100}%; rotate:{spin}deg; --settle-ms:{SPIN_SETTLE_MS}ms;"
					></i>
				{/if}
			</div>
		{/if}
	{/if}
</div>

<style>
	.pb-host {
		position: absolute;
		inset: 0;
		/* The rail is dragged, so the browser must not claim the gesture as a scroll first. */
		touch-action: none;
		/* Contains the pocket glows' additive blending to the board. Without it they would reach
		   through to the screen behind and light up the backdrop as well as the field. */
		isolation: isolate;
	}

	/* The cabinet the pegs stand in. The field runs the full width at every row, so this is a plain
	   box rather than a frame around a taper — walls down both sides, and the pockets sitting in
	   the floor of it. */
	.pb-field {
		position: absolute;
		box-sizing: border-box;
		/* Opaque by default, so the screen behind does not read through the playfield — `fieldOpacity`
		   is what opens it up for a host with a background worth showing. The sheen on top stays
		   translucent either way: it is a highlight ON the box, not a window through it. */
		background:
			radial-gradient(ellipse at 50% 0%, rgba(255, 240, 200, 0.09) 0%, rgba(0, 0, 0, 0) 62%),
			linear-gradient(
				180deg,
				rgba(26, 18, 9, var(--pb-field-alpha, 1)) 0%,
				rgba(12, 8, 3, var(--pb-field-alpha, 1)) 100%
			);
		border: 0.12em solid rgba(255, 225, 77, 0.22);
		box-shadow:
			inset 0 0 1.6em rgba(0, 0, 0, 0.6),
			inset 0 0 0 0.06em rgba(255, 255, 255, 0.06),
			0 0.6em 2em rgba(0, 0, 0, 0.6);
	}

	/* --- The slider ----------------------------------------------------------------------- */
	/* The element is only the hit area — deliberately much taller than the track it draws, so the
	   ball can be caught by grabbing near it. */
	.pb-rail {
		position: absolute;
		display: flex;
		align-items: center;
		pointer-events: none;
		opacity: 0;
		transition: opacity 220ms ease;
	}
	/* Only takes the pointer while there is a ball to move — a slider that swallowed taps through
	   the fall would leave the player poking at a board that cannot answer. */
	.pb-rail.live {
		pointer-events: auto;
		opacity: 1;
		cursor: grab;
	}
	/* The track: a thin light-grey pill, running the width of the drop zone. Pale rather than sunk
	   into the board, so it reads as a control laid on top of the field and the ball riding it is
	   obvious against it. */
	.pb-track {
		position: relative;
		width: 100%;
		/* Half-transparent, so the track sits under the ball without competing with it — the notches
		   ride the same fade, since they belong to the track rather than to the board. */
		opacity: 0.5;
		background: linear-gradient(180deg, #e8eaee 0%, #b9bec7 100%);
		box-shadow:
			inset 0 0.08em 0.2em rgba(255, 255, 255, 0.85),
			inset 0 -0.06em 0.2em rgba(0, 0, 0, 0.28),
			0 0.12em 0.4em rgba(0, 0, 0, 0.5);
	}
	/* The landing positions, as notches down the middle of the track. Faint, because they are a
	   guide to where the ball will settle rather than something to read. */
	.pb-tick {
		position: absolute;
		top: 50%;
		border-radius: 50%;
		transform: translate(-50%, -50%);
		background: rgba(60, 66, 78, 0.4);
		transition:
			transform 160ms ease,
			background 160ms ease;
	}
	.pb-tick.on {
		background: rgba(40, 45, 55, 0.85);
		transform: translate(-50%, -50%) scale(1.7);
	}

	/* --- Pegs ----------------------------------------------------------------------------- */
	/* Above the pocket glows, so a glow column rises BEHIND the pegs it passes and leaves them
	   crisp — the glows are additive, and would otherwise wash out the bottom rows. */
	/* A stud standing off the timber, not a dot printed on it.
	
	   Everything is measured in `--peg`, the peg's own diameter, because a peg is about six pixels
	   across on a laptop and half as much again on a phone — a shadow fixed in pixels is a different
	   shadow at every size, and at this scale a pixel either way is the whole effect. */
	.pb-peg {
		position: absolute;
		z-index: 2;
		width: var(--peg);
		height: var(--peg);
		transform: translate(-50%, -50%);
		border-radius: 50%;
		/* Two layers: the ball, and the bloom around the glint that stops the specular reading as a
		   disc stuck on the front of it.
		
		   The value RANGE is what does the work. At six pixels there is no room for detail, so the
		   only thing that says "sphere" is how far the surface travels from lit to unlit. Most of that
		   travel is spent on the LIT side on purpose: the peg has to stay a bright dot on dark
		   timber, so the shadow is a rim turning the edge under rather than a wash over the whole
		   ball. Kept as literal stops rather than a
		   brightness filter: the strike animation already drives `filter` and would wipe anything
		   built with one the moment it ran.
		
		   `farthest-side` is load-bearing. Left at the default `farthest-corner` the ramp is sized to
		   a corner of the square box, and the peg is a CIRCLE — everything past about 78% of that
		   radius falls outside the disc and is clipped away by the border-radius, taking the dark end
		   of the ramp with it and leaving a flat pale button. Sizing to the farthest SIDE lands the
		   last stop on the rim, where it can be seen. */
		background:
			radial-gradient(circle at 33% 24%, rgba(255, 255, 255, 0.55) 0%, rgba(255, 255, 255, 0) 30%),
			radial-gradient(
				circle farthest-side at 33% 25%,
				#ffffff 0%,
				#f1f4f8 14%,
				#cbd2dc 34%,
				#9aa3b1 56%,
				#68717f 76%,
				#3d4653 92%,
				#2a323e 100%
			);
		/* Read from the inside out: the top lifted where the light lands, the bottom sunk where it
		   does not, then the contact where the peg meets the timber and the shadow it throws below
		   that. The two cast shadows are separate on purpose — one tight and dark to sit the peg
		   down, one wide and offset to give it height. Without both it reads as a blur, not a
		   shadow. */
		box-shadow:
			inset 0 calc(var(--peg) * 0.1) calc(var(--peg) * 0.1) rgba(255, 255, 255, 0.45),
			inset calc(var(--peg) * -0.07) calc(var(--peg) * -0.12) calc(var(--peg) * 0.16)
				rgba(0, 0, 0, 0.5),
			0 calc(var(--peg) * 0.09) calc(var(--peg) * 0.07) rgba(0, 0, 0, 0.8),
			0 calc(var(--peg) * 0.3) calc(var(--peg) * 0.32) rgba(0, 0, 0, 0.65);
	}
	/* The glint, kept small and high and off to the same side the gradient is lit from. A specular
	   is a fraction of the surface or it stops reading as a shine and starts reading as a hole —
	   the bloom that sells it is the first background layer above, not this. */
	.pb-peg::before {
		content: '';
		position: absolute;
		left: 25%;
		top: 12%;
		width: 34%;
		height: 26%;
		border-radius: 50%;
		background: linear-gradient(
			180deg,
			#ffffff 0%,
			rgba(255, 255, 255, 0.35) 60%,
			rgba(255, 255, 255, 0) 100%
		);
		pointer-events: none;
	}
	/* Struck. The ring is on a pseudo-element so the flash can outgrow the peg without disturbing
	   anything around it. */
	.pb-peg.hit {
		animation: peg-hit 260ms ease-out;
	}
	.pb-peg::after {
		content: '';
		position: absolute;
		inset: -35%;
		border-radius: 50%;
		border: 2px solid rgba(255, 225, 77, 0.9);
		opacity: 0;
		transform: scale(0.6);
	}
	.pb-peg.hit::after {
		animation: peg-ring 320ms ease-out;
	}
	@keyframes peg-hit {
		0% {
			filter: brightness(2.4);
			transform: translate(-50%, -50%) scale(1.35);
		}
		100% {
			filter: brightness(1);
			transform: translate(-50%, -50%) scale(1);
		}
	}
	@keyframes peg-ring {
		0% {
			opacity: 0.9;
			transform: scale(0.6);
		}
		100% {
			opacity: 0;
			transform: scale(1.5);
		}
	}
	/* Blown away. Lit white for a frame, then flung along the line from the bomb to it and gone —
	   `--dx`/`--dy` are that direction as a unit vector, `--fling` how far it goes. It stays gone
	   (`forwards`): the hole is part of the board for the rest of the fall. Declared after `.hit`
	   so it wins over the strike flash on the one peg that was struck the moment before the bomb
	   next to it went off. */
	.pb-peg.gone {
		animation: peg-gone var(--gone-ms) cubic-bezier(0.2, 0.7, 0.3, 1) forwards;
	}
	@keyframes peg-gone {
		0% {
			opacity: 1;
			filter: brightness(3);
			transform: translate(-50%, -50%) scale(1.4);
		}
		100% {
			opacity: 0;
			filter: brightness(1);
			transform: translate(
					calc(-50% + var(--dx) * var(--fling)),
					calc(-50% + var(--dy) * var(--fling))
				)
				scale(0.1);
		}
	}

	/* --- Bombs ---------------------------------------------------------------------------- */
	/* A bomb standing in for a peg. Positioned by its body (see `bombBox`), on the pegs' own layer,
	   and with the fuse alight: a bomb that does not look about to go off is just a dark peg. */
	.pb-bomb {
		position: absolute;
		z-index: 2;
		background-repeat: no-repeat;
		background-position: center;
		background-size: contain;
		/* A black ball over dark timber: the drop shadow sits it down, the warm glow is what finds
		   it. The glow breathes with the fuse — the two are one thing, a bomb about to go off. */
		filter: drop-shadow(0 0.1em 0.25em rgba(0, 0, 0, 0.7))
			drop-shadow(0 0 0.3em rgba(255, 140, 40, 0.55));
		/* Two idles on one element: the glow breathing, and the rattle. The rattle turns about the
		   body (`transform-origin` is set inline to the round part of the picture), so the fuse
		   whips and the body stays on its peg — a bomb shaking on its own base rather than a
		   picture wobbling about its corner. The durations are unrelated on purpose, so the two
		   never fall into step and the shake reads as nervous rather than metronomic. */
		animation:
			bomb-glow 1s ease-in-out infinite alternate,
			bomb-rattle 1.3s linear infinite;
		pointer-events: none;
	}
	/* A burst of jitter, then a rest: the first half is a run of small irregular kicks about the
	   body, the second half is still. Percent translates are of the bomb's own box, so the
	   jitter is under a pixel at any size the board draws it. */
	@keyframes bomb-rattle {
		0%,
		52%,
		100% {
			transform: rotate(0deg) translate(0, 0);
		}
		6% {
			transform: rotate(-4deg) translate(-1.5%, 0.5%);
		}
		12% {
			transform: rotate(3.5deg) translate(1.5%, -0.5%);
		}
		18% {
			transform: rotate(-2.5deg) translate(-1%, 0);
		}
		24% {
			transform: rotate(4deg) translate(1%, 0.5%);
		}
		30% {
			transform: rotate(-3deg) translate(-1.5%, -0.5%);
		}
		36% {
			transform: rotate(2deg) translate(0.5%, 0);
		}
		42% {
			transform: rotate(-1.5deg) translate(-0.5%, 0.5%);
		}
		48% {
			transform: rotate(0.8deg) translate(0, 0);
		}
	}
	@keyframes bomb-glow {
		from {
			filter: drop-shadow(0 0.1em 0.25em rgba(0, 0, 0, 0.7))
				drop-shadow(0 0 0.2em rgba(255, 140, 40, 0.35));
		}
		to {
			filter: drop-shadow(0 0.1em 0.25em rgba(0, 0, 0, 0.7))
				drop-shadow(0 0 0.45em rgba(255, 160, 50, 0.8));
		}
	}
	/* The spark, at the tip of the fuse — read off the file, so it moves if the art does. */
	.pb-bomb::after {
		content: '';
		position: absolute;
		left: 57%;
		top: 4%;
		width: 16%;
		height: 16%;
		margin: -8% 0 0 -8%;
		border-radius: 50%;
		background: radial-gradient(
			circle,
			#fff7c0 0%,
			#ffb31a 32%,
			rgba(255, 90, 0, 0.55) 55%,
			rgba(255, 90, 0, 0) 72%
		);
		animation: fuse-spark 0.5s ease-in-out infinite alternate;
	}
	@keyframes fuse-spark {
		from {
			opacity: 0.75;
			transform: scale(0.75);
		}
		to {
			opacity: 1;
			transform: scale(1.4);
		}
	}
	/* Gone the instant it goes off. No flight for the bomb itself: the explosion is drawn exactly
	   where it stood, and IS what happened to it. */
	.pb-bomb.gone {
		visibility: hidden;
	}
	/* The explosion. On the pegs' layer and before the ball in the DOM, so the ball is drawn over
	   it: it bursts out from the bomb, holds for the fuse, and is already thinning as the ball is
	   thrown out of it. The pseudo-element is a white flash that is over in the first third. */
	.pb-blast {
		position: absolute;
		z-index: 2;
		background-repeat: no-repeat;
		background-position: center;
		background-size: contain;
		pointer-events: none;
		filter: drop-shadow(0 0 0.4em rgba(255, 150, 40, 0.85));
		animation: blast-burst var(--blast-ms) cubic-bezier(0.2, 0.8, 0.3, 1) forwards;
	}
	.pb-blast::before {
		content: '';
		position: absolute;
		inset: -20%;
		border-radius: 50%;
		background: radial-gradient(
			circle,
			rgba(255, 245, 200, 0.95) 0%,
			rgba(255, 160, 40, 0.6) 38%,
			rgba(255, 90, 0, 0) 68%
		);
		animation: blast-flash calc(var(--blast-ms) * 0.4) ease-out forwards;
	}
	@keyframes blast-burst {
		0% {
			opacity: 0.9;
			transform: translate(-50%, -50%) scale(0.2) rotate(-25deg);
		}
		16% {
			opacity: 1;
			transform: translate(-50%, -50%) scale(1) rotate(0deg);
		}
		40% {
			opacity: 0.95;
			transform: translate(-50%, -50%) scale(1.08) rotate(8deg);
		}
		100% {
			opacity: 0;
			transform: translate(-50%, -50%) scale(1.3) rotate(20deg);
		}
	}
	@keyframes blast-flash {
		0% {
			opacity: 1;
			transform: scale(0.5);
		}
		100% {
			opacity: 0;
			transform: scale(1.5);
		}
	}

	/* --- Pockets --------------------------------------------------------------------------- */
	/* Card and glow are both regions of the source atlas, cropped by the inline style and turned
	   upright here — every region in it is packed on its side (see slots.ts). The tier the region
	   comes from is picked by how far out the pocket sits, so the board inherits the source's own
	   cool-centre / hot-edges ramp instead of being recoloured. */
	.pb-pocket i,
	.pb-pocket-glow i {
		position: absolute;
		left: 50%;
		top: 50%;
		transform: translate(-50%, -50%) rotate(90deg);
		background-repeat: no-repeat;
		pointer-events: none;
	}

	/* Above the ball, so a landing drops BEHIND the pocket and the card closes over it — the ball
	   goes into the slot rather than resting on the front of it. */
	.pb-pocket {
		position: absolute;
		transform: translateX(-50%);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 3;
		font-family: 'Alexandria', sans-serif;
		font-weight: 700;
		white-space: nowrap;
		color: #fff;
		text-shadow:
			0 0.06em 0.12em rgba(0, 0, 0, 0.85),
			0 0 0.3em rgba(0, 0, 0, 0.6);
	}
	.pb-pocket span {
		position: relative;
		z-index: 1;
	}
	/* The pocket that took the ball. Kicks down the way a real one would, then holds lit — the
	   round is over but what it paid has to stay readable. */
	.pb-pocket.won {
		/* Squashed onto its own base rather than about its middle, so the card is driven into the
		   floor of the board instead of shrinking in place. */
		transform-origin: 50% 100%;
		animation: pocket-take 460ms ease-out;
	}
	.pb-pocket.won i {
		filter: brightness(1.5) saturate(1.15);
	}
	/* The ladder held back, at the two moments it is not the thing being watched. Both fade rather
	   than switch, so the row comes up as the shot leaves and settles again as it lands. */
	.pb-pocket.waiting,
	.pb-pocket-glow.waiting,
	.pb-pocket.dimmed,
	.pb-pocket-glow.dimmed {
		transition:
			opacity 320ms ease,
			filter 320ms ease;
	}
	/* Before the shot: down, but only enough to read as not-yet-live. The ladder is still what the
	   player is choosing between, so it is held back rather than put out — the numbers have to stay
	   legible while they are being aimed at. */
	/* Held back by turning the light down on the card, not by fading it out. The card stays solid —
	   a faded one lets the timber read through the ladder, which makes the row look like it is
	   dissolving rather than waiting. Done as a `brightness` filter rather than as a dark panel laid
	   over the top, because the filter follows the card art's own alpha: the cards have rounded,
	   cut-away corners, and a rectangle of black would sit in those corners against the wood.
	
	   Down, but only enough to read as not-yet-live. The ladder is still what the player is choosing
	   between, so the numbers have to stay legible while they are being aimed at. */
	.pb-pocket.waiting {
		filter: brightness(0.5) saturate(0.8);
	}
	/* The columns are the one thing here that still FADES rather than darkens: they are light rather
	   than an object, and a light turned black is just a black shape. Their own pulse animates
	   opacity, so it has to be stopped before an opacity of ours can be seen at all — an animation
	   outranks a plain declaration. */
	.pb-pocket-glow.waiting {
		animation: none;
		opacity: 0.18;
		filter: grayscale(0.35) brightness(0.85);
	}
	/* Every pocket the ball did NOT take, once it has landed. Taken further down than the waiting
	   state and most of the colour with it, because now there IS something to look at and the rest
	   of the ladder has to stop competing with it. The board has finished offering and is now
	   reporting. Still solid, for the same reason as above. */
	.pb-pocket.dimmed {
		filter: brightness(0.32) saturate(0.45);
	}
	.pb-pocket-glow.dimmed {
		animation: none;
		opacity: 0.12;
		filter: grayscale(0.6) brightness(0.7);
	}
	/* Struck from above: the pocket is driven DOWN into the floor, springs back past its resting
	   height, and settles. It starts and ends at rest, so the movement is the ball landing on it
	   rather than the pocket arriving from somewhere. */
	@keyframes pocket-take {
		0% {
			transform: translateX(-50%) translateY(0) scaleY(1);
		}
		30% {
			transform: translateX(-50%) translateY(20%) scaleY(0.76);
		}
		62% {
			transform: translateX(-50%) translateY(-7%) scaleY(1.07);
		}
		84% {
			transform: translateX(-50%) translateY(2%) scaleY(0.98);
		}
		100% {
			transform: translateX(-50%) translateY(0) scaleY(1);
		}
	}

	/* The glow column rising out of each pocket. Additive, because the source art is premultiplied
	   and a glow over a dark board wants to add light rather than paint over it.

	   The pulse IS the skeleton's animation, keyframe for keyframe: full alpha, down to 0x4a/255 at
	   one second, back up at two. Every pocket runs it in phase, as authored. */
	.pb-pocket-glow {
		position: absolute;
		transform: translateX(-50%);
		z-index: 1;
		pointer-events: none;
		mix-blend-mode: plus-lighter;
		animation: pocket-glow 2s ease-in-out infinite;
	}
	@keyframes pocket-glow {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.29;
		}
	}
	/* The winning pocket stops pulsing and holds at full — it has stopped inviting and started
	   reporting. */
	.pb-pocket-glow.won {
		animation: none;
		opacity: 1;
		filter: brightness(1.4);
	}

	/* --- Ball ------------------------------------------------------------------------------ */
	/* Painted in the colour that opened the round (see colour.ts), so the ball on the board is the
	   colour that took the triple. `--squash` is 1 at a contact and decays to 0, which is what
	   deforms it on the hit and lets it recover on the way down instead of falling as a rigid disc. */
	/* Above the pegs it strikes — both sit on 2, and this comes later in the DOM — but below the
	   pockets, so the fall reads over the field and the landing reads inside the slot. */
	/* Moved by TRANSFORM, not by `left`/`top`.
	
	   The fall recomputes the ball's position every frame, and box offsets are layout: each frame
	   was re-laying-out the host and repainting whatever the ball and its halo happened to be over,
	   which on this board is a field of several hundred pegs. A transform is composited instead —
	   the layer is moved, nothing under it is touched. `will-change` is what gets it that layer up
	   front rather than on the first frame it moves, which is the frame the drop starts on. */
	.pb-ball {
		position: absolute;
		left: 0;
		top: 0;
		border-radius: 50%;
		z-index: 2;
		will-change: transform;
		pointer-events: none;
		background: radial-gradient(
			circle at 33% 28%,
			var(--sheen) 0%,
			var(--face) 38%,
			var(--shade) 72%,
			var(--edge) 100%
		);
		box-shadow:
			0 0.15em 0.4em rgba(0, 0, 0, 0.55),
			inset -0.1em -0.12em 0.25em rgba(0, 0, 0, 0.35);
		transform: translate3d(var(--x, 0px), var(--y, 0px), 0) translate(-50%, -50%)
			scale(calc(1 + var(--squash, 0) * 0.16), calc(1 - var(--squash, 0) * 0.16));
	}
	/* Slides onto the peg it was released over — at most half a pitch, so it reads as the ball
	   settling into the gap rather than being repositioned. */
	.pb-ball.snapping {
		transition: transform var(--snap-ms) cubic-bezier(0.22, 0.61, 0.36, 1);
	}
	/* A halo in the ball's own colour, breathing while the ball is waiting to be picked up — the
	   only thing on the screen asking to be touched, so it says so. It sits on a pseudo-element so
	   the pulse scales independently of the squash the ball takes on a peg. */
	.pb-ball::after {
		content: '';
		position: absolute;
		inset: -55%;
		border-radius: 50%;
		background: radial-gradient(
			circle,
			var(--face) 0%,
			color-mix(in srgb, var(--face) 45%, transparent) 42%,
			transparent 70%
		);
		opacity: 0;
		pointer-events: none;
	}
	.pb-ball.beckoning::after {
		animation: ball-beckon 1.5s ease-in-out infinite;
	}
	@keyframes ball-beckon {
		0%,
		100% {
			opacity: 0.28;
			transform: scale(0.86);
		}
		50% {
			opacity: 0.8;
			transform: scale(1.16);
		}
	}
	/* In hand: the halo stops and the ball just brightens, so the pulse reads as "pick me up"
	   rather than as decoration that carries on regardless. */
	.pb-ball.held {
		filter: brightness(1.15);
	}
	.pb-ball.held::after {
		animation: none;
		opacity: 0;
	}
	/* --- Art in place of the ball ----------------------------------------------------------- */
	/* The painted ball steps aside and becomes the light behind the picture: no fill, no rim, but
	   the halo stays lit for the whole fall so a dark drawing still reads against a dark field. It
	   is on the pseudo-element, so it pulses and glows without being squashed by the contacts. */
	.pb-ball.has-art {
		background: none;
		box-shadow: none;
	}
	.pb-ball.has-art::after {
		inset: -62%;
		opacity: 0.7;
	}
	.pb-ball.has-art.held::after {
		opacity: 0.95;
	}
	/* Above the halo — both are children of a stacking context the ball's own transform opens.
	   The turn is on the picture and not on the ball beneath it: a featureless gradient sphere has
	   nothing to show a rotation with, and spinning it would only send its highlight round the
	   outside, which is the one thing on a lit ball that should stay put. `transform-origin` is set
	   inline to the round part of the image, so a bomb turns about its body and not about the
	   middle of a box its fuse pushed off-centre. */
	.pb-ball-art {
		position: absolute;
		z-index: 1;
		background-repeat: no-repeat;
		background-position: center;
		background-size: contain;
		filter: drop-shadow(0 0.12em 0.3em rgba(0, 0, 0, 0.75));
		pointer-events: none;
	}
	/* Only in the pocket: through the fall the angle is set every frame and must not be smoothed,
	   or the picture would lag the ball it is drawn on. */
	.pb-ball-art.settling {
		transition: rotate var(--settle-ms) cubic-bezier(0.2, 0.9, 0.3, 1);
	}
</style>
