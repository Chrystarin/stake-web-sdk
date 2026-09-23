<script lang="ts">
	/**
	 * Pirate Plinko room: Colour Dice's jackpot plinko board (`src/plinko`), played inside the bonus
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
	import type { BookEventPiratePlinko } from '../../game/typesBookEvent';
	import { playSound } from '../../game/sound';
	import { staticPath } from '../../lib/staticUrl';
	import { finePointer } from '../../lib/pointer.svelte';
	import RoomHint from './RoomHint.svelte';

	type Props = {
		room: BookEventPiratePlinko;
		/** False when the player was not in this bonus: the ball lets itself go. */
		interactive?: boolean;
		/** Tall viewport: the cabinet swaps to its upright drawing and the room re-scales with it. */
		portrait?: boolean;
	};
	let {
		room,
		interactive = true,
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
	 * aim at all and the shot goes off when it lifts. `finePointer` asks of pointer CAPABILITY
	 * rather than of screen width, because that is the thing that actually differs: a narrow desktop
	 * window still has a cursor, and a large tablet still has none.
	 *
	 * Broken into lines HERE rather than left to wrap — see `RoomHint`, which draws them and drains
	 * `AIM_MS` across them.
	 */
	const HINT_FINE = ['Move to aim', 'Click to fire'];
	const HINT_COARSE = ['Hold to aim', 'Release to fire'];
	const hintLines = $derived(finePointer() ? HINT_FINE : HINT_COARSE);

	/**
	 * A coin falls instead of a ball. It is drawn as a disc filling its own file — centred, and
	 * 496 of 512 across — so unlike the bomb it needs no correction: the picture IS the ball.
	 */
	const COIN = {
		src: staticPath('img/pirate-plinko/coin.png'),
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
	 * Four of the pegs are bombs. The coin striking one sets it off: the pegs around it are blown
	 * away and the coin is thrown clear across the field — a detour, never a different pocket, since
	 * the board picks the throw from the ones that still reach the pocket the book settled on.
	 *
	 * The bomb is drawn by its BODY, which is not the middle of its file: the fuse takes the top
	 * third, so the round part sits low — centred at 0.664 down and 0.617 wide, read off the art.
	 * Drawn well over the coin's size — a black ball on dark timber has to be BIG to be seen at all,
	 * and the board caps it at half a pitch, which on this squat board is where this lands. The
	 * explosion is a plain square burst, centred on the bomb by the board.
	 */
	const BOMBS = {
		count: 4,
		src: staticPath('img/pirate-plinko/bomb.png'),
		cx: 0.5,
		cy: 0.664,
		d: 0.617,
		scale: 2,
		blast: staticPath('img/pirate-plinko/explosion.png'),
	};
	/** How long the cabinet rattles after a blast. */
	const QUAKE_MS = 380;
	let quaking = $state(false);
	let quakeTimer: ReturnType<typeof setTimeout> | undefined;
	/**
	 * The whole cabinet jolts, art and all — a blast that shook the pegs but not the timber they
	 * stand in would read as the pegs shaking, not the board. Off and on in a fresh frame for the
	 * same reason the recoil is: two bombs a second apart both have to be felt.
	 */
	const quake = () => {
		quaking = false;
		requestAnimationFrame(() => (quaking = true));
		clearTimeout(quakeTimer);
		quakeTimer = setTimeout(() => (quaking = false), QUAKE_MS + 40);
	};

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
		src: staticPath('img/pirate-plinko/board_v2.png'),
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
	 * The panel is far taller than it is wide here, so the field takes the timber wall to wall and
	 * the fall still comes out steep — a tall board is a tall fall, and pinching it narrower to
	 * flatten the angle would only waste the timber.
	 */
	const BOARD_PORTRAIT = {
		src: staticPath('img/pirate-plinko/board_v2_portrait.png'),
		ratio: 1024 / 1536,
		frame: {
			// Read off the upright drawing the same way the landscape one was: the timber panel runs
			// from 0.14 to 0.855 across and from 0.076 to 0.845 down, and the box is set to its two
			// side walls exactly, so the half-pitch of spare the layout keeps is the only margin
			// between the outermost pegs and the rope. Down the panel the field is inset — a row's
			// worth of plank above the first row of pegs, and a shade under the last — so the pegs
			// read as standing IN the panel rather than pressed against its edges, and the last row
			// hands straight over to the cards instead of leaving a strip of bare wood between them.
			field: { left: 0.14, right: 0.855, top: 0.108, bottom: 0.802 },
			// Standing on the panel's bottom edge and reaching over the top of the ornamented rail,
			// which is what makes a card deep enough to read at this width — thirteen of them across
			// a narrow opening is the tightest the ladder ever gets. The outermost pair does clip
			// the treasure heaped into the two bottom corners; that is the price of a legible card,
			// and going shallower to avoid it is what left the row unreadable before.
			pockets: { top: 0.812, bottom: 0.868 },
		} satisfies BoardFrame,
	};
	const BOARD = $derived(portrait ? BOARD_PORTRAIT : BOARD_LANDSCAPE);
	const FRAME = $derived(BOARD.frame);
	const boardRatio = $derived(BOARD.ratio);

	/**
	 * How many page pixels one of the room's own pixels is worth.
	 *
	 * The game is drawn inside a CSS `zoom`, which the two ways of measuring an element do not agree
	 * about: `getBoundingClientRect` answers in the page's pixels, `clientWidth` and `offsetHeight`
	 * in the room's. On a screen wide enough to be drawn at full size they are the same number and
	 * nothing here matters; on a short one they differ by a fifth. Anything that subtracts one kind
	 * from the other has to bring them into one space first, and the room's is the one the board is
	 * laid out in.
	 */
	const zoomOf = (el: HTMLElement): number => {
		const own = el.clientWidth;
		return own > 0 ? el.getBoundingClientRect().width / own : 1;
	};

	/**
	 * The cabinet is fitted to whatever the column has left, keeping its ratio exactly — measured
	 * rather than left to CSS, because `aspect-ratio` against two max constraints gives up on one
	 * of them and quietly stretches, and the fractions the pegs and pockets are placed by only
	 * hold while the box matches the picture.
	 */
	let wrapEl: HTMLElement | undefined = $state();
	let bayEl: HTMLElement | undefined = $state();
	let wrap = $state({ w: 0, h: 0 });
	/**
	 * How far the muzzle stands above the floor the cabinet is built up from, in pixels.
	 *
	 * This is what caps the board in portrait, where it is allowed to grow past the top of its own
	 * column: the cabinet rises from a fixed floor, the first row of pegs rises with it, and what
	 * runs out first is the air the shot needs — not the room the picture has. Measured off the
	 * pivot marker rather than the cannon's own box, which is rotated and so measures wider and
	 * taller than the barrel really is.
	 */
	let muzzleDrop = $state(0);
	/**
	 * The air kept between the muzzle and the top row of pegs, as a share of the column's width.
	 *
	 * A share rather than a length, because everything either side of it is a share: the gun, the
	 * cabinet and the gap between them all come off the same column, so a fixed figure would be
	 * generous on a phone and invisible on a tablet.
	 */
	const MUZZLE_AIR = 0.035;
	/**
	 * Portrait lets the cabinet overflow the top of its column, behind the hanging sign.
	 *
	 * Landscape fits it into the column and stops, because there the board is bound by width long
	 * before it is bound by height. A tall screen is the opposite: the column has width to spare
	 * and the cabinet is starved of height, so held inside it the board comes out well short of the
	 * room's own width and leaves a band of empty screen down each side. Letting it grow upwards
	 * spends the only space there is — the stretch behind the plaque, which is already where the
	 * cannon stands — and the shot's own air is what says when to stop.
	 */
	const fit = $derived.by(() => {
		if (!portrait) {
			const w = Math.max(0, Math.min(wrap.w, wrap.h * boardRatio));
			return { w, h: w / boardRatio };
		}
		// The cabinet's top rail is the part that rises past the muzzle; the field below it is what
		// has to stay clear, so the cap is read at the field rather than at the picture's edge.
		const clear = muzzleDrop - wrap.w * MUZZLE_AIR;
		const cap = muzzleDrop > 0 ? clear / (1 - FRAME.field.top) : wrap.h;
		const h = Math.max(0, Math.min(wrap.w / boardRatio, cap));
		return { w: h * boardRatio, h };
	});
	$effect(() => {
		const el = wrapEl;
		const bay = bayEl;
		if (!el) return;
		const measure = () => {
			wrap = { w: el.clientWidth, h: el.clientHeight };
			const pivot = pivotEl?.getBoundingClientRect();
			// Both ends of this come off the same layout pass, so the pair survives the screen
			// sliding in underneath them — what is wanted is the distance, not either end's place.
			// Taken in page pixels and brought back into the room's own, because the barrel it is
			// then measured against is an element's height rather than a rect.
			muzzleDrop = pivot
				? (el.getBoundingClientRect().bottom - pivot.top) / zoomOf(el) -
					MUZZLE_FROM_PIVOT * cannonHeight()
				: 0;
		};
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
	const CANNON = staticPath('img/pirate-plinko/cannon.png');
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
		// The pivot's offset from the board's corner is measured in page pixels and the barrel in the
		// room's, so the first is converted before the second is added to it — see `zoomOf`.
		const zoom = zoomOf(boardEl);
		board?.launchFrom({
			x: (px - host.left) / zoom + barrel * Math.sin(rad),
			y: (py - host.top) / zoom + barrel * Math.cos(rad),
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
		<div
			class="board"
			class:quaking
			bind:this={boardEl}
			style="width:{fit.w}px; height:{fit.h}px; --quake-ms:{QUAKE_MS}ms"
		>
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
				bombs={BOMBS}
				frame={FRAME}
				format={label}
				launcher="aimed"
				autoDropAfterMs={interactive ? AIM_MS : TEASE_MS}
				sounds={{
					// The board tells us the moment the ball leaves, which is the moment the gun should
					// jump — and it covers the unattended shot too, which is fired from inside the board
					// and never passes through a pointer handler at all.
					drop: () => {
						playSound('cannon');
						recoil();
					},
					peg: () => playSound('peg', 0.9 + Math.random() * 0.2),
					blast: () => {
						playSound('boom', 0.95 + Math.random() * 0.1);
						quake();
					},
					land: () => playSound('merge'),
				}}
			/>

			<!-- The instruction, over the middle of the board and above everything the board draws.
			     It doubles as the shot clock — the drain across the words IS `AIM_MS` running out.
			     Portrait gets its own size because the cabinet nearly triples in width there. -->
			{#if interactive}
				<RoomHint
					lines={hintLines}
					shown={armed}
					durationMs={AIM_MS}
					overlay
					size="2.6vw"
					portraitSize="7.4vw"
				/>
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
		--cannon-h: 10.6vw;
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
		/* Over the cabinet, not under it. In portrait the board rises past the top of the column and
		   the muzzle ends up standing over its top rail, so DOM order — which would paint the timber
		   across the barrel — is not what should decide this. */
		z-index: 2;
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
	/* The jolt. Small — a third of a percent of the board's own width — and over in a few frames:
	   the explosion is the thing to look at, and the shake only has to be FELT under it. */
	.board.quaking {
		animation: board-quake var(--quake-ms) ease-out;
	}
	@keyframes board-quake {
		0% {
			translate: 0 0;
		}
		15% {
			translate: 0.5% -0.35%;
		}
		35% {
			translate: -0.45% 0.3%;
		}
		55% {
			translate: 0.3% 0.2%;
		}
		75% {
			translate: -0.15% -0.1%;
		}
		100% {
			translate: 0 0;
		}
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
	/* ---- Portrait ----------------------------------------------------------------------
	   A tall screen gets the upright cabinet: nearly the full width, and everything that is
	   authored in vw scaled up to match, because a portrait vw is about a third of a landscape
	   one. The board's own geometry needs no rules here — it follows the frame it is given. */
	:global(.game.portrait) .plinko {
		width: 92vw;
		/* Trimmed from 37.5vw, and the air under it with it. The gun and the cabinet are bidding for
		   the same stretch of screen: every pixel the barrel gives up here is one the board takes,
		   multiplied by its own ratio into two thirds of a pixel of width — and on a tall screen the
		   board is what the round is played on. What is left still reads as a cannon because the
		   part that was surrendered is mostly the part that stands BEHIND the plaque. */
		--cannon-h: 33vw;
		--cannon-gap: 2.5vw;
	}
</style>
