<script lang="ts">
	/**
	 * Plinko room: Colour Dice's jackpot plinko board (`src/plinko`), played inside the bonus
	 * screen this game already has.
	 *
	 * The board is the whole room — no title, no HUD, no slide of its own — because `BonusRound`
	 * supplies all of that. What comes over is the part that matters: a real Galton fall onto a
	 * ladder of pockets, with the player choosing where to let the ball go.
	 *
	 * The award is still the book's. `room.board` is the paytable with the Top Slot already in it,
	 * and the math writes it as a palindrome — cheapest in the middle, dearest at both edges — so
	 * it rebuilds as exactly the ladder the module wants. The pocket the ball is sent to is chosen
	 * from `room.total` and the side the player dropped from, which is the mirror twin of the
	 * book's own `slot` at worst: same value, shorter path. `room.dropZone` goes unused, because
	 * choosing where to drop from is now the player's job.
	 */
	import { PlinkoBoard, buildPocketLadder, pocketForAward, shapeForPockets } from '../../plinko';
	import type { PlinkoBoardApi } from '../../plinko';
	import type { BookEventPlinkoBonus } from '../../game/typesBookEvent';
	import { playSound } from '../../game/sound';
	import { staticPath } from '../../lib/staticUrl';

	type Props = {
		room: BookEventPlinkoBonus;
		/** False when the player was not in this bonus: the ball lets itself go. */
		interactive?: boolean;
	};
	let { room, interactive = true }: Props = $props();

	/** How long the ball waits for a player who is there, and for one who is only watching. */
	const HELD_MS = 12000;
	const TEASE_MS = 700;

	/**
	 * A lit bomb falls instead of a ball. `cx`/`cy`/`d` are the sphere inside `bomb.png`, measured
	 * off the file (centre 206.5, 304.5 of 512; 414 across), so the bomb strikes the pegs on its
	 * body while the fuse and its sparks hang off the top-right without pushing it around.
	 */
	const BOMB = {
		src: staticPath('img/plinko/bomb.png'),
		cx: 0.403,
		cy: 0.595,
		d: 0.809,
		// The board is sized by its 13 pockets, which leaves a ball too small to read a drawing in.
		scale: 1.9,
	};
	/**
	 * The glow behind it. The bomb is nearly black on a dark field over a dark video, so the light
	 * is what makes it findable — an ember, in the colour of the fuse rather than of the room.
	 */
	const GLOW = '#ff8a1f';
	/** Solid enough to read as a board, open enough to know the video is still back there. */
	const FIELD_OPACITY = 0.72;

	/**
	 * The cannon the ball is fired from, standing over the board with a gap under it.
	 *
	 * The drawing already faces the right way: the rounded cascabel knob is at the top and the
	 * open, banded mouth at the bottom, so the muzzle points at the board with no flipping at all.
	 * It swings about the two orange trunnions on its flanks, which is where a gun is hung.
	 */
	const CANNON = staticPath('img/plinko/cannon.png');
	/**
	 * How far the cannon may swing either side of straight down. Full deflection is the edge of the
	 * drop zone, so the barrel reaching its stop and the shot reaching the board's limit are the
	 * same moment — which is what stops a player aiming at something they cannot have.
	 */
	const MAX_AIM_DEG = 38;
	/**
	 * How far the muzzle sits from the trunnions, as a share of the cannon's height: the mouth is
	 * at the very bottom of the drawing, the trunnions a little under a third of the way down. It
	 * is what puts the ball at the end of the barrel rather than at the middle of the picture.
	 */
	const MUZZLE_FROM_PIVOT = 0.99 - 0.29;
	/** How far the gun jumps back up its own barrel when it fires, as a share of its height. */
	const RECOIL = 0.13;
	/** Long enough to see the kick and the return; the ball is clear of the muzzle well before. */
	const RECOIL_MS = 420;

	/**
	 * A pocket card is about five characters wide, and the Top Slot can put a x15 in front of a
	 * 400 — so the thousands are written the way the rest of the game writes them, as `k`.
	 */
	const label = (value: number): string =>
		value >= 1000 ? `x${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)}k` : `x${value}`;

	const ladder = $derived(buildPocketLadder(room.board));
	const shape = $derived(shapeForPockets(ladder.count));

	let board = $state<PlinkoBoardApi>();
	let armed = $state(false);

	/** Where the barrel points, in degrees from straight down. Negative is left. */
	let aimDeg = $state(0);
	let pivotEl: HTMLElement | undefined = $state();
	let cannonEl: HTMLElement | undefined = $state();
	let boardEl: HTMLElement | undefined = $state();
	/** The kick, in real pixels, back along whatever line the barrel was on when it fired. */
	let kick = $state({ x: 0, y: 0 });
	let firing = $state(false);
	let recoilTimer: ReturnType<typeof setTimeout> | undefined;

	/**
	 * Point the cannon at the pointer and tell the board where the shot will land.
	 *
	 * The barrel tracks the pointer exactly while it is inside the cone and stops at the edge of it
	 * — so aiming past the board's limit does not silently do nothing, it visibly runs out of
	 * travel. The same clamped angle is what sets the entry point, at full deflection = far edge,
	 * so the two can never disagree about where the ball is going.
	 */
	const aimAt = (clientX: number, clientY: number) => {
		if (!armed || !interactive || !pivotEl) return;
		const pivot = pivotEl.getBoundingClientRect();
		const px = pivot.left;
		const py = pivot.top;
		// Only ever downward: a pointer level with or above the breech would otherwise flip the aim.
		const down = Math.max(1, clientY - py);
		const raw = (Math.atan2(clientX - px, down) * 180) / Math.PI;
		aimDeg = Math.max(-MAX_AIM_DEG, Math.min(MAX_AIM_DEG, raw));
		board?.aim(aimDeg / MAX_AIM_DEG);

		// And where the ball will come out: the end of the barrel, swung to wherever it now points.
		// Handed over in the board's own pixels, which above the board means a negative y — the
		// board has no row up here to name the height by.
		if (!boardEl) return;
		const barrel = MUZZLE_FROM_PIVOT * cannonHeight();
		const rad = (aimDeg * Math.PI) / 180;
		const host = boardEl.getBoundingClientRect();
		board?.launchFrom({
			x: px + barrel * Math.sin(rad) - host.left,
			y: py + barrel * Math.cos(rad) - host.top,
		});
	};

	/**
	 * The cannon's drawn height in real pixels. `offsetHeight` rather than a measured rect, because
	 * the element is rotated and a rect would give the box that CONTAINS it, which is longer than
	 * the barrel at every angle but zero.
	 */
	const cannonHeight = (): number => cannonEl?.offsetHeight ?? 0;

	const onPointerMove = (event: PointerEvent) => aimAt(event.clientX, event.clientY);
	const onPointerUp = (event: PointerEvent) => {
		if (!armed || !interactive) return;
		aimAt(event.clientX, event.clientY);
		board?.fire();
	};

	/**
	 * The gun jumps back up its own barrel and settles again — straight back along the line it
	 * fired on, so a shot to the left kicks the cannon up and to the right. The kick is measured
	 * here, at the moment of firing, because the aim is free to change the instant it is over.
	 */
	const recoil = () => {
		const rad = (aimDeg * Math.PI) / 180;
		const back = RECOIL * cannonHeight();
		kick = { x: -back * Math.sin(rad), y: -back * Math.cos(rad) };
		firing = false;
		// Off and on again in a fresh frame, so the animation restarts rather than being ignored
		// as already-running — a round can only fire once, but the tease fires too.
		requestAnimationFrame(() => (firing = true));
		clearTimeout(recoilTimer);
		recoilTimer = setTimeout(() => (firing = false), RECOIL_MS + 60);
	};

	/**
	 * The listeners go on the window, not on the room.
	 *
	 * The room is a column down the middle of a screen that is far wider, and a gun that stops
	 * turning the moment the pointer leaves that column is a gun that feels broken. On the window,
	 * anywhere on the bonus screen aims, and anywhere fires. They are only bound while there is a
	 * shot to take, so nothing is listening through the fall or the win line.
	 */
	$effect(() => {
		if (!armed || !interactive) return;
		window.addEventListener('pointermove', onPointerMove);
		window.addEventListener('pointerdown', onPointerMove);
		window.addEventListener('pointerup', onPointerUp);
		return () => {
			window.removeEventListener('pointermove', onPointerMove);
			window.removeEventListener('pointerdown', onPointerMove);
			window.removeEventListener('pointerup', onPointerUp);
		};
	});

	export const play = async (): Promise<number> => {
		const active = board;
		if (!active) return room.total;
		aimDeg = 0;
		armed = true;
		const startStep = await active.arm();
		armed = false;
		await active.drop(pocketForAward(ladder, room.total, startStep));
		return room.total;
	};
</script>

<div class="plinko">
	<div class="cannon-bay">
		<!-- Two elements, because a recoil and a swing are two different transforms and CSS applies
		     its own in a fixed order: the mount takes the kick, the barrel takes the aim. -->
		<div
			class="cannon-mount"
			class:firing
			style="--kick-x:{kick.x}px; --kick-y:{kick.y}px; --recoil-ms:{RECOIL_MS}ms"
		>
			<img
				bind:this={cannonEl}
				class="cannon"
				class:loaded={armed && interactive}
				src={CANNON}
				alt=""
				draggable="false"
				style="--aim:{aimDeg}deg"
			/>
		</div>
		<!-- The point the barrel turns about, as an element of its own. The cannon's own box is
		     rotated, and a rotated box measures as the rectangle that CONTAINS it — which grows and
		     shifts with every degree — so reading the pivot off it would make the aim chase itself.
		     This marker never turns. -->
		<span class="cannon-pivot" bind:this={pivotEl}></span>
	</div>

	<div class="board" bind:this={boardEl}>
		<PlinkoBoard
			bind:this={board}
			{shape}
			{ladder}
			accent={GLOW}
			art={BOMB}
			fieldOpacity={FIELD_OPACITY}
			format={label}
			launcher="aimed"
			autoDropAfterMs={interactive ? HELD_MS : TEASE_MS}
			sounds={{
				// The board tells us the moment the ball leaves, which is the moment the gun should
				// jump — and it covers the unattended shot too, which is fired from inside the board
				// and never passes through a pointer handler at all.
				drop: () => {
					playSound('whoosh');
					recoil();
				},
				peg: () => playSound('peg', 0.9 + Math.random() * 0.2),
				land: () => playSound('merge'),
			}}
		/>
	</div>
	<div class="hint" class:shown={armed && interactive}>Aim the cannon and click to fire.</div>
</div>

<style>
	.plinko {
		position: relative;
		display: flex;
		flex-direction: column;
		align-items: center;
		width: 46vw;
		height: 100%;
		cursor: crosshair;
		/* The cannon's height, where along it the barrel turns, and the air under the muzzle. Set
		   here once because three rules and one measured marker all have to agree on them. */
		--cannon-h: 9vw;
		--cannon-pivot: 0.29;
		--cannon-gap: 2.4vw;
	}
	/* The cannon's own row, above the board. Its height is the gap: the bay is short, the cannon is
	   taller than the bay and hangs out of the bottom of it, so what sits between the muzzle and the
	   field is air rather than layout. `overflow: visible` is what lets it. */
	/* The cannon's own row: its height plus the air under it, so the muzzle never reaches the field.
	   Swung over to its stop the muzzle RISES rather than drops — a fixed-length barrel turning about
	   its breech — so the gap only ever opens up. */
	.cannon-bay {
		position: relative;
		width: 100%;
		height: calc(var(--cannon-h) + var(--cannon-gap));
		overflow: visible;
		pointer-events: none;
	}
	.cannon-pivot {
		position: absolute;
		left: 50%;
		top: calc(var(--cannon-h) * var(--cannon-pivot));
		width: 0;
		height: 0;
	}
	/* No flipping: the drawing already has its mouth at the bottom, so it faces the board as it is.
	   It hangs from the trunnions, which is why the origin is up near the top rather than at the
	   middle — the muzzle is the end that should travel. The sweep is NEGATED because a clockwise
	   turn takes a downward-pointing barrel to the LEFT, and aiming right has to send it right. */
	/* The mount is the full width of the bay with the barrel centred in it, so the kick has the
	   `translate` property to itself — a centring offset living there would be overwritten by the
	   recoil the moment it ran. */
	.cannon-mount {
		position: absolute;
		inset: 0 0 auto 0;
		display: flex;
		justify-content: center;
	}
	.cannon-mount.firing {
		animation: cannon-recoil var(--recoil-ms) cubic-bezier(0.22, 1, 0.36, 1);
	}
	/* Snapped back, then eased home: the kick is over in a fifth of the time the return takes. */
	@keyframes cannon-recoil {
		0% {
			translate: 0 0;
		}
		16% {
			translate: var(--kick-x) var(--kick-y);
		}
		100% {
			translate: 0 0;
		}
	}
	.cannon {
		height: var(--cannon-h);
		width: auto;
		aspect-ratio: 320 / 448;
		transform-origin: 50% calc(var(--cannon-pivot) * 100%);
		rotate: calc(-1 * var(--aim));
		transition: rotate 90ms linear;
		filter: drop-shadow(0 0.25vw 0.5vw rgba(0, 0, 0, 0.65));
		will-change: rotate;
	}
	/* Lit while it is loaded and waiting, so the one thing the player can act on says so. */
	.cannon.loaded {
		filter: drop-shadow(0 0.25vw 0.5vw rgba(0, 0, 0, 0.65))
			drop-shadow(0 0 0.7vw rgba(255, 138, 31, 0.75));
	}
	/* The board fills whatever it is given, in both directions — see `layoutBoard`. The hint keeps
	   its line below it whether or not it is showing, so the board does not resize when it does. */
	.board {
		position: relative;
		flex: 1;
		width: 100%;
		min-height: 0;
	}
	.hint {
		height: 1.6vw;
		display: flex;
		align-items: center;
		font-family: 'Alexandria', sans-serif;
		font-size: 0.8vw;
		color: #d6c6b4;
		text-align: center;
		opacity: 0;
		transition: opacity 250ms ease;
	}
	.hint.shown {
		opacity: 1;
	}
</style>
