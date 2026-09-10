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
	import type { BoardFrame, PlinkoBoardApi } from '../../plinko';
	import type { BookEventPlinkoBonus } from '../../game/typesBookEvent';
	import { playSound } from '../../game/sound';
	import { staticPath } from '../../lib/staticUrl';

	type Props = {
		room: BookEventPlinkoBonus;
		/** False when the player was not in this bonus: the ball lets itself go. */
		interactive?: boolean;
		/** True when the player was on this room, so the win is theirs rather than a tease. */
		covered?: boolean;
		/** The multiplier the round paid, once it has. Null until then. */
		result?: number | null;
		/** That multiplier in money, already formatted and signed by the screen. */
		cash?: string;
		/** Tall viewport: the cabinet swaps to its upright drawing and the room re-scales with it. */
		portrait?: boolean;
	};
	let {
		room,
		interactive = true,
		covered = true,
		result = null,
		cash = '',
		portrait = false,
	}: Props = $props();

	/**
	 * How long the ball waits for a player who is there, and for one who is only watching.
	 *
	 * `AIM_MS` is drawn as well as counted — it is the length of the drain across the hint — so it
	 * has to be a clock the player can trust: one that starts when the shot is offered and runs
	 * straight through to the shot being taken.
	 */
	const AIM_MS = 15000;
	const TEASE_MS = 700;

	/**
	 * What to tell the player, which is not the same instruction on the two kinds of device.
	 *
	 * The handlers are one set — `pointermove` aims and `pointerup` fires — but they are lived very
	 * differently: a mouse hovers and the shot goes off on a click, a finger has to be held down to
	 * aim at all and the shot goes off when it lifts. Asked of pointer CAPABILITY rather than of
	 * screen width, because that is the thing that actually differs: a narrow desktop window still
	 * has a cursor, and a large tablet still has none.
	 */
	/**
	 * Broken into lines HERE rather than left to wrap, because each line drains on a clock of its
	 * own and a line the layout invented has no clock to give it.
	 */
	const HINT_FINE = ['Move to aim', 'Click to fire'];
	const HINT_COARSE = ['Hold to aim', 'Release to fire'];
	let finePointer = $state(true);
	$effect(() => {
		const query = window.matchMedia('(hover: hover) and (pointer: fine)');
		const sync = () => (finePointer = query.matches);
		sync();
		query.addEventListener('change', sync);
		return () => query.removeEventListener('change', sync);
	});
	const hintLines = $derived(finePointer ? HINT_FINE : HINT_COARSE);
	/** Each line gets an equal share of the clock, and starts where the line above it finished. */
	const drainMs = $derived(AIM_MS / hintLines.length);

	/**
	 * A coin falls instead of a ball. It is drawn as a disc filling its own file — centred, and
	 * 496 of 512 across — so unlike the bomb it needs no correction: the picture IS the ball.
	 */
	const COIN = {
		src: staticPath('img/plinko/coin.png'),
		cx: 0.5,
		cy: 0.5,
		d: 496 / 512,
		// Framed, the board is squat: thirteen pockets across a short opening make the row gap small,
		// and with it the ball. Drawn over size so the coin still reads as a coin, but only just: at
		// this scale it covers about four tenths of a peg pitch, near enough the ball it stands for
		// that it falls THROUGH the field rather than over the top of it. Everything either side of
		// this number is measured in host pixels off the board's real box, so the coin tracks the
		// viewport on its own; this is only how much bigger than its own ball it is drawn.
		scale: 1.35,
	};
	/**
	 * The glow behind it. Over dark timber a coin can go quiet, so the light is what keeps it
	 * findable all the way down — gold, taken off the coin itself.
	 */
	const GLOW = '#f5b431';

	/**
	 * The cabinet the board is played in: a roped timber sign, and where its picture says the pegs
	 * and the pockets go. Read off the art as fractions of its own box.
	 *
	 * The board element is given the art's aspect ratio, so these fractions stay true at any size
	 * and the frame is never stretched.
	 *
	 * There are two drawings rather than one turned on its side. The sign is not symmetric under a
	 * quarter turn — the wood grain runs across it, the gem crest sits at the middle of the BOTTOM
	 * rail, and the treasure spills into the two bottom corners — so a rotated landscape board reads
	 * as a picture that fell over. Each orientation gets the art that was drawn for it.
	 */
	const BOARD_LANDSCAPE = {
		src: staticPath('img/plinko/board_v2.png'),
		ratio: 1519 / 1036,
		/**
		 * Placed off a reference drawn over the art, not derived: the pegs fill the timber panel wall
		 * to wall, starting a plank below its top edge and running a row past the bottom of the
		 * marked box, and the ladder sits under them as a deep row that reaches down over the top of
		 * the ornamented rail and out across the treasure heaped into both bottom corners.
		 *
		 * `field` is NOT the peg extent: the layout keeps a spare half-pitch of wall at each side, so
		 * the box is a pitch wider than the outermost pegs. These numbers are what puts those pegs on
		 * the marked edges — read the peg span, not this box, when matching the art.
		 *
		 * Pulled in from the marked edges, and started a little higher, to steepen the fall. The two
		 * are the same knob: the pitch comes off the width and the row gap off the height, so a
		 * narrower, deeper box raises the ratio between them — which IS the angle the ball falls at.
		 * At the reference's full width that ratio was 0.24, flat enough to read as a skitter; these
		 * numbers put it at 0.27, most of the way to the old cabinet's 0.31, and hand the coin back
		 * the best part of the four tenths of a pitch it is drawn to fill. Widen the sides to flatten
		 * it again; raising `top` buys back some of the angle that costs.
		 */
		frame: {
			field: { left: 0.105, right: 0.895, top: 0.145, bottom: 0.748 },
			// Drawn taller than the card art's own proportion, which is what the reference asks for:
			// a deep ladder standing on the rail rather than a strip of labels resting above it. The
			// bottom stays pinned over the rail's top edge; the top has since come down to hand the
			// two extra peg rows their space, which lands the card near the proportion it was drawn
			// at rather than the taller one it was marked at.
			pockets: { top: 0.762, bottom: 0.822 },
		} satisfies BoardFrame,
	};
	/**
	 * The same sign stood upright, which is a drawing of its own rather than this one turned.
	 *
	 * The panel is far taller than it is wide here, so the pegs are inset LESS across than in
	 * landscape and the field still comes out steep — a tall board is a tall fall, and pinching it
	 * narrower to flatten the angle would only waste the timber.
	 */
	const BOARD_PORTRAIT = {
		src: staticPath('img/plinko/board_v2_portrait.png'),
		ratio: 1024 / 1536,
		frame: {
			field: { left: 0.185, right: 0.815, top: 0.075, bottom: 0.735 },
			// Low enough that the cards read as sitting on the panel's bottom edge, and still above
			// the treasure heaped into both corners.
			pockets: { top: 0.77, bottom: 0.8 },
		} satisfies BoardFrame,
	};
	const BOARD = $derived(portrait ? BOARD_PORTRAIT : BOARD_LANDSCAPE);
	const FRAME = $derived(BOARD.frame);
	const boardRatio = $derived(BOARD.ratio);

	/**
	 * The cabinet is fitted to whatever the column has left, keeping its ratio exactly — measured
	 * rather than left to CSS, because `aspect-ratio` against two max constraints gives up on one
	 * of them and quietly stretches, and the fractions the pegs and pockets are placed by only
	 * hold while the box matches the picture.
	 */
	let wrapEl: HTMLElement | undefined = $state();
	let bayEl: HTMLElement | undefined = $state();
	let wrap = $state({ w: 0, h: 0 });
	const fit = $derived.by(() => {
		const w = Math.max(0, Math.min(wrap.w, wrap.h * boardRatio));
		return { w, h: w / boardRatio };
	});
	$effect(() => {
		const el = wrapEl;
		const bay = bayEl;
		if (!el) return;
		const measure = () => (wrap = { w: el.clientWidth, h: el.clientHeight });
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(el);
		if (bay) observer.observe(bay);
		return () => observer.disconnect();
	});

	/**
	 * The cannon the ball is fired from, standing over the board with a gap under it.
	 *
	 * The drawing already faces the right way: the rounded cascabel knob is at the top and the
	 * open, banded mouth at the bottom, so the muzzle points at the board with no flipping at all.
	 * It swings about the two orange trunnions on its flanks, which is where a gun is hung.
	 */
	const CANNON = staticPath('img/plinko/cannon.png');
	/**
	 * How far the cannon may swing either side of straight down.
	 *
	 * Worked out from the geometry rather than picked: it is the angle from the breech to the far
	 * edge of the drop zone, so the barrel points at exactly the place the ball will enter and runs
	 * out of travel at exactly the moment the shot runs out of board. A fixed figure cannot do that
	 * once the cabinet can be wide OR tall — the same 38 degrees that undershot a landscape board
	 * would overshoot a portrait one.
	 */
	const aimLimitDeg = (pivotY: number, host: DOMRect): number => {
		const halfSpan = ((FRAME.field.right - FRAME.field.left) / 2) * host.width;
		const entryY = host.top + FRAME.field.top * host.height;
		return (Math.atan2(halfSpan, Math.max(1, entryY - pivotY)) * 180) / Math.PI;
	};
	/**
	 * How far the muzzle sits from the trunnions, as a share of the cannon's height: the mouth is at
	 * the very bottom of the drawing (0.97), the wheels it hangs between centred at 0.4. It is what
	 * puts the ball at the end of the barrel rather than at the middle of the picture. Both are read
	 * off the file, so they have to be read again whenever the art is replaced.
	 */
	const MUZZLE_FROM_PIVOT = 0.97 - 0.4;
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
	/**
	 * Peg rows past the ladder's own count, to fill the space taken back off the pocket cards.
	 *
	 * TWO, not one: the walk moves half a pitch per row and starts on a half-offset, so only an ODD
	 * row count lands the ball on a pocket centre rather than between two. The pair is free — it
	 * costs the fall a row's worth of time and nothing else, since the pocket is settled before the
	 * ball is released and `planDrop` only ever gains slack from having more rows to reach it in.
	 *
	 * Not per-orientation, though only the landscape frame was drawn for it: the plan is built from
	 * this shape when the ball is released, and a row count that changed under a viewport turning
	 * mid-fall would leave that plan describing a board that no longer exists.
	 */
	const EXTRA_PEG_ROWS = 2;
	const shape = $derived.by(() => {
		const base = shapeForPockets(ladder.count);
		return { ...base, rows: base.rows + EXTRA_PEG_ROWS };
	});

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
		if (!boardEl) return;
		const host = boardEl.getBoundingClientRect();
		const limit = aimLimitDeg(py, host);
		const raw = (Math.atan2(clientX - px, down) * 180) / Math.PI;
		aimDeg = Math.max(-limit, Math.min(limit, raw));
		board?.aim(aimDeg / limit);

		// And where the ball will come out: the end of the barrel, swung to wherever it now points.
		// Handed over in the board's own pixels, which above the board means a negative y — the
		// board has no row up here to name the height by.
		const barrel = MUZZLE_FROM_PIVOT * cannonHeight();
		const rad = (aimDeg * Math.PI) / 180;
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
		/**
		 * The clock the hint is drawing, and the one that actually takes the shot.
		 *
		 * The board keeps an unattended-drop timer of its own, but that one is pushed back by every
		 * aim — deliberately, so it only ever lets go of a player who has stopped. A bar drawn off
		 * THAT would refill every time the pointer moved and never finish on a desktop, so the
		 * visible clock is owned here and never reset. It is set before `arm()` is called, so on a
		 * player who never moves at all it is the one that fires; the board's is left in place
		 * behind it, where it can only ever go off later and finds the round already released.
		 */
		const deadline = interactive ? setTimeout(() => active.fire(), AIM_MS) : undefined;
		const startStep = await active.arm();
		clearTimeout(deadline);
		armed = false;
		await active.drop(pocketForAward(ladder, room.total, startStep));
		return room.total;
	};
</script>

<div class="plinko">
	<div class="cannon-bay" bind:this={bayEl}>
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

	<div class="board-wrap" bind:this={wrapEl}>
		<div class="board" bind:this={boardEl} style="width:{fit.w}px; height:{fit.h}px">
			<!-- The cabinet itself, drawn at the box it was fitted to. Nothing is turned: a tall screen
			     is handed the upright drawing instead. -->
			<img
				class="board-art"
				src={BOARD.src}
				alt=""
				draggable="false"
				style="width:{fit.w}px; height:{fit.h}px"
			/>
			<PlinkoBoard
				bind:this={board}
				{shape}
				{ladder}
				accent={GLOW}
				art={COIN}
				frame={FRAME}
				format={label}
				launcher="aimed"
				autoDropAfterMs={interactive ? AIM_MS : TEASE_MS}
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

			<!-- The instruction, over the middle of the board and above everything the board draws.
			     It doubles as the shot clock: see `.hint-line` for how the drain is done.
			
			     Three nested boxes, and each is doing a job. The outer one centres and fades. The
			     middle one is text-sized, which is what keeps the shadow's buffer off the whole
			     board and gives the breath something to scale about. The lines are separate because
			     the drain is measured against the height of the box it is painted on: one box around
			     both lines would spend a third of the clock crossing the air between them, and
			     against the board it would cross the letters in a single frame. -->
			{#if interactive}
				<div class="hint" class:shown={armed}>
					<span class="hint-body">
						{#each hintLines as line, index (line)}
							<span
								class="hint-line"
								style="--drain-ms:{drainMs}ms; --drain-delay:{index * drainMs}ms"
							>
								<span class="hint-ink">{line}</span>
								<!-- The same words again, in white, laid exactly over the blue and clipped back to
								     nothing. Uncovering it is the drain. Hidden from a reader, which would
								     otherwise be given the line twice. -->
								<span class="hint-fill" aria-hidden="true">{line}</span>
							</span>
						{/each}
					</span>
				</div>
			{/if}

			<!-- What it paid, over the middle of the board. It comes up only once the ball is in a
		     pocket, so it never covers the fall it is reporting on. -->
			{#if result !== null}
				<div class="win">
					<div class="win-mult">x{result}</div>
					{#if covered}
						<div class="win-cash">WIN {cash}</div>
					{:else}
						<div class="win-cash muted">would have paid {cash} per chip</div>
					{/if}
				</div>
			{/if}
		</div>
	</div>
</div>

<style>
	.plinko {
		position: relative;
		display: flex;
		flex-direction: column;
		align-items: center;
		/* Room for the screen's title above the cannon, and for the cannon above the board. The
		   cabinet takes whatever is left after those and keeps its own ratio, so the whole room
		   grows and shrinks with the viewport rather than being pinned to one size. */
		width: 56vw;
		height: 100%;
		/* Stretched, not merely tall: the room has to START at the plaque, or the cannon hung off
		   its top edge has nothing to be hidden behind. */
		align-self: stretch;
		/* The cannon takes the top and the cabinet the bottom; whatever is left over opens up
		   between them rather than being shared out. */
		justify-content: space-between;
		cursor: crosshair;
		/* The cannon's height, where along it the barrel turns, and the air under the muzzle. Set
		   here once because three rules and one measured marker all have to agree on them. */
		/* Trimmed to give the board its height back: the bay is mostly air, and with the win line off
		   the footer the board is the only thing left that wants the room. */
		--cannon-h: 8.5vw;
		--cannon-pivot: 0.4;
		--cannon-gap: 1.2vw;
		/* How much of the barrel goes up behind the title plaque. The bay only reserves what is left,
		   so whatever is hidden costs the board nothing. */
		--cannon-tuck: 0.55;
	}
	/* The cannon's own row, above the board. Its height is the gap: the bay is short, the cannon is
	   taller than the bay and hangs out of the bottom of it, so what sits between the muzzle and the
	   field is air rather than layout. `overflow: visible` is what lets it. */
	/* The cannon's own row: its height plus the air under it, so the muzzle never reaches the field.
	   Swung over to its stop the muzzle RISES rather than drops — a fixed-length barrel turning about
	   its breech — so the gap only ever opens up. */
	.cannon-bay {
		position: relative;
		/* Fixed, like the hint: with the board sized off its own width, anything left flexible in
		   this column gets squeezed instead — which is what was quietly shrinking the cannon. */
		flex: none;
		width: 100%;
		height: calc(var(--cannon-h) * (1 - var(--cannon-tuck)) + var(--cannon-gap));
		overflow: visible;
		pointer-events: none;
	}
	.cannon-pivot {
		position: absolute;
		left: 50%;
		/* Follows the mount up, or the barrel would swing about a point it no longer turns on. */
		top: calc(var(--cannon-h) * (var(--cannon-pivot) - var(--cannon-tuck)));
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
		/* Lifted by the tucked share, so the top of the barrel runs up behind the plaque. */
		top: calc(-1 * var(--cannon-tuck) * var(--cannon-h));
		left: 0;
		right: 0;
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
	/* The cabinet. Its height is whatever the column has left and its width follows from the art's
	   own ratio (set inline, off the file's real size), so the frame is never stretched and the
	   fractions the pegs and pockets are placed by stay true at every size. Fully opaque: this is a
	   board, not a window. */
	/* The space the cabinet is fitted into: everything the column has left once the cannon and
	   the hint have taken theirs. The cabinet is sized in script, to the pixel — see `fit`. */
	.board-wrap {
		flex: 1;
		min-height: 0;
		width: 100%;
		display: flex;
		align-items: flex-end;
		justify-content: center;
	}
	.board {
		position: relative;
		flex: none;
	}
	/* Under everything the board draws, and never in the way of a pointer aiming through it. */
	.board-art {
		position: absolute;
		left: 50%;
		top: 50%;
		translate: -50% -50%;
		pointer-events: none;
		user-select: none;
	}
	/* What the round paid, over the middle of the board. Above the pegs and the pockets, and
	   with a soft ground of its own so it reads over timber rather than fighting the grain. */
	.win {
		position: absolute;
		inset: 0;
		z-index: 50;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.3vw;
		font-family: 'Alexandria', sans-serif;
		pointer-events: none;
		animation: win-in 320ms cubic-bezier(0.2, 0.9, 0.3, 1) both;
	}
	@keyframes win-in {
		from {
			opacity: 0;
			scale: 0.86;
		}
		to {
			opacity: 1;
			scale: 1;
		}
	}
	.win-mult {
		font-size: 4.6vw;
		font-weight: 700;
		line-height: 1;
		color: #ffe14d;
		text-shadow:
			0 0.2vw 0.5vw rgba(0, 0, 0, 0.9),
			0 0 1.6vw rgba(0, 0, 0, 0.85);
	}
	.win-cash {
		font-size: 1.5vw;
		font-weight: 600;
		color: #fff;
		text-shadow:
			0 0.15vw 0.4vw rgba(0, 0, 0, 0.9),
			0 0 1.2vw rgba(0, 0, 0, 0.85);
	}
	.win-cash.muted {
		color: #cbb9a4;
		font-weight: 400;
	}
	/* The instruction, laid across the middle of the board — and the shot clock as well. This
	   layer only centres it and fades it; the drain lives on `.hint-line`. */
	.hint {
		position: absolute;
		inset: 0;
		/* Over the pegs, the pockets and the ball, all of which the board draws below 10. Under the
		   win line, which comes up only once this is long gone. */
		z-index: 40;
		display: flex;
		align-items: center;
		justify-content: center;
		/* The pointer aims through this: the handlers are on the window, but the board is what the
		   crosshair is over and a box across the middle of it would take the cursor off. */
		pointer-events: none;
		opacity: 0;
		transition: opacity 250ms ease;
	}
	.hint.shown {
		opacity: 1;
	}
	/* The block of writing: text-sized, which is what the shadow and the breath both want.
	
	   The shadow is three passes, and a filter rather than a `text-shadow` so it takes the shape of
	   what was actually painted THROUGH the glyphs — a text-shadow would be cast by the letters,
	   which are transparent here, and the drain would have no shadow at all below the seam. The
	   first pass is unblurred and offset, which is what reads as a shadow rather than as a glow; the
	   other two are the soft cast and the ambient darkening that lift the letters off the grain.
	
	   It sits here rather than on each line so the filter runs once over the whole block, and so the
	   two lines breathe together instead of scaling about their own centres and drifting apart. */
	.hint-body {
		display: inline-flex;
		flex-direction: column;
		align-items: center;
		max-width: 88%;
		font-family: 'PotatoSans', 'Alexandria', sans-serif;
		font-size: 2.6vw;
		/* Tight, and tighter than it reads on paper. Two things want it that way: the drain hands
		   over from one line to the next, and the further apart they sit the more that handover looks
		   like a jump rather than a continuation — the eye loses the fill between them. And these are
		   caps with no descenders, which carry close leading far better than mixed case would.
		
		   There is a floor. Below about 0.9 the half-leading goes negative enough to push the caps
		   out of the top of the line box, and `.hint-fill` is clipped to that box — the tops of the
		   letters would never be uncovered. Anything changed here has to be re-measured against the
		   ink percentages on `.hint-line`. */
		line-height: 0.95;
		text-align: center;
		filter: drop-shadow(0 0.16vw 0 rgba(12, 7, 2, 0.95))
			drop-shadow(0 0.3vw 0.35vw rgba(0, 0, 0, 0.85)) drop-shadow(0 0 0.9vw rgba(0, 0, 0, 0.6));
	}
	/* Small on purpose. This sits over a field of pegs the player is aiming at, so it has to catch
	   the eye without becoming the thing being watched. */
	.hint.shown .hint-body {
		animation: hint-breathe 1.5s ease-in-out infinite;
	}
	@keyframes hint-breathe {
		0%,
		100% {
			scale: 1;
		}
		50% {
			scale: 1.06;
		}
	}
	/* One line, and its share of the clock.
	
	   The drain is TWO copies of the line, blue underneath and white on top, with the white one
	   clipped away and given back a little at a time. The edge between them stays hard — it is the
	   boundary of a clip, not a blend — and it moves smoothly, which is the pair of things a
	   gradient slid behind the glyphs could not do at once. A background position is snapped to
	   whole device pixels when it is painted, and at a line's height over fifteen seconds the seam
	   crawls about a pixel and a half a second: slow enough that the snapping IS the motion, one
	   visible jump per second. A clip is geometry rather than an image origin, so it lands on
	   fractional pixels and the edge glides.
	
	   `both` rather than `forwards`, because a line whose turn has not come yet has to HOLD the
	   opening frame — without it the second line would sit finished until its delay elapsed. The
	   unanimated state is still the finished one, fully uncovered, which is what every line falls
	   back to when the class comes off at the moment of firing: the last thing seen through the fade
	   is where the drain ended rather than a flash of it refilling. */
	.hint-line {
		position: relative;
		display: block;
		color: #35b6ff;
	}
	/*
	 * Where the GLYPHS are inside the line box, top and bottom, as shares of it.
	 *
	 * The clip is walked between these two rather than from 0 to 100%, and that is the difference
	 * between a fill that moves and one that stalls. A line box is taller than the writing in it,
	 * and travelling the full box spends the difference revealing nothing — the empty tail of one
	 * line running straight into the empty head of the next, which is a pause in the middle of the
	 * drain right where the eye is following it.
	 *
	 * Measured by drawing the words to a canvas at eight times size and scanning for the first and
	 * last row with any ink in it. NOT off `actualBoundingBox*`, which Chrome rounds to whole pixels
	 * — a whole pixel is two percent of this box, and it reported the descent of a line of caps as a
	 * flat zero. The scan says 5.13% and 80.46%; these are those, opened by a fifth of a pixel so a
	 * rasteriser rounding the other way at another size cannot leave a sliver of blue behind.
	 *
	 * Re-measure both if the font, the `line-height` above, or the case of the words ever changes.
	 */
	.hint-line {
		--ink-top: 4.8%;
		--ink-bottom: 81.5%;
	}
	/* Pinned to the line's own box, so the copy wraps and centres exactly as the original did and
	   the two sit glyph on glyph. */
	.hint-fill {
		position: absolute;
		inset: 0;
		color: #ffffff;
		clip-path: inset(0 0 calc(100% - var(--ink-bottom)) 0);
	}
	.hint.shown .hint-fill {
		animation: hint-drain var(--drain-ms) var(--drain-delay) linear both;
	}
	/* Across the writing and no further. See `.hint-line` for both halves of why. */
	@keyframes hint-drain {
		from {
			clip-path: inset(0 0 calc(100% - var(--ink-top)) 0);
		}
		to {
			clip-path: inset(0 0 calc(100% - var(--ink-bottom)) 0);
		}
	}

	/* ---- Portrait ----------------------------------------------------------------------
	   A tall screen gets the upright cabinet: nearly the full width, and everything that is
	   authored in vw scaled up to match, because a portrait vw is about a third of a landscape
	   one. The board's own geometry needs no rules here — it follows the frame it is given. */
	:global(.game.portrait) .plinko {
		width: 92vw;
		--cannon-h: 30vw;
		--cannon-gap: 3vw;
	}
	:global(.game.portrait) .hint-body {
		font-size: 7.4vw;
		filter: drop-shadow(0 0.45vw 0 rgba(12, 7, 2, 0.95))
			drop-shadow(0 0.85vw 1vw rgba(0, 0, 0, 0.85)) drop-shadow(0 0 2.5vw rgba(0, 0, 0, 0.6));
	}
	:global(.game.portrait) .win-mult {
		font-size: 11vw;
	}
	:global(.game.portrait) .win-cash {
		font-size: 3.6vw;
	}
</style>
