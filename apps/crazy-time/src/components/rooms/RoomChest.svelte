<script lang="ts">
	/**
	 * Treasure Chest room: twelve chests, and the last one standing is the one the player wins.
	 *
	 * The player opens chests one at a time. Every chest they open is a decoy, showing what they are
	 * NOT taking home; the one they never touch is the prize, and once the other eleven are open it
	 * crosses to the middle of the board and opens on its own.
	 *
	 * The prize is AUTHORED. The book's awarded value goes to whichever chest is left, and the decoys
	 * are dealt out in the order the chests are opened — the k-th chest opened shows the book's k-th
	 * decoy — so no order of opening changes what the round pays, the same as a shuffled live board.
	 * The rules page must say so. A player who does not finish inside the clock has the rest opened
	 * for them, in board order, and the book's own `opened` chest is the one left shut if it still is.
	 *
	 * The reveal keeps its old shape from there: the eleven clear off the board, and only then does
	 * the last chest cross to the middle, take the dragon's fire, and give up its number.
	 */
	import { PICK_SECONDS } from '../../game/constants';
	import type { BookEventChest } from '../../game/typesBookEvent';
	import { playSound } from '../../game/sound';
	import { staticPath } from '../../lib/staticUrl';
	import { waitForTimeout } from 'utils-shared/wait';
	import RoomHint from './RoomHint.svelte';
	import ChestDragon from './ChestDragon.svelte';

	type Props = { room: BookEventChest; interactive: boolean };
	let { room, interactive }: Props = $props();

	/**
	 * The pick clock, as one span rather than as a count of ticks.
	 *
	 * It used to be a `setInterval` printing the seconds beside the instruction. The instruction now
	 * IS the clock — `RoomHint` drains the words over exactly this long — so nothing needs the
	 * number, and a single timeout cannot drift away from the drain the way a run of ticks could.
	 */
	const PICK_MS = PICK_SECONDS * 1000;

	/**
	 * The chest, shut and open — one drawing each.
	 *
	 * They are NOT the same picture with the lid moved: the open one is a wider canvas, because the
	 * treasure spills past the sides of the box. Drawn naively — both laid across the column — the
	 * chest itself would jump SMALLER at the very moment it opens. So the pair is registered here
	 * instead, put back at the same scale and stood on the same floor:
	 *
	 *   shut  1427x1102, its base plate 1137px across, bottom edge 43px above the canvas foot
	 *   open  1536x1024, its base plate 1129px across, bottom edge 23px above the canvas foot
	 *
	 * The base plates already agree to within a percent, so one scale serves both: the open canvas
	 * is 1536/1427 = 1.0764 times as wide as the shut one, and it has to sit (43 - 23)/1427 = 0.014
	 * of a column higher for the two floors to land on each other. Both numbers are in the art rules
	 * below; re-measure them if either drawing is ever re-exported.
	 *
	 * The measurements are the SOURCE pngs beside the shipped files. What ships is that same pair at
	 * 0.7 — 999x771 and 1075x717 — which is a little over what the largest thing on the largest
	 * screen can ask for (a column is 8vw, and the last chest grows to three of them), and both
	 * numbers above are ratios, so scaling the pair together leaves them exactly where they were.
	 */
	const CHEST_SHUT = staticPath('img/treasure_chest/chest_close.webp');
	const CHEST_OPEN = staticPath('img/treasure_chest/chest_open.webp');

	/**
	 * What to tell the player. It is the rule of the room rather than an instruction — there is
	 * nothing to say about HOW to open a chest that the twelve rattling boxes are not already
	 * saying. Broken into lines here because each line drains on a clock of its own.
	 */
	const HINT = ['Last chest', 'standing wins'];

	/**
	 * The instruction, cut as a share of one chest column — the same knob the whole grid is drawn
	 * off (see `--cell`), so it grows with the chests on a tall screen instead of needing a portrait
	 * rule of its own.
	 */
	const HINT_SIZE = 'calc(var(--cell) * 0.355)';

	/** Four across, three down. The transforms below are the only other place that shape matters. */
	const COLS = 4;

	/**
	 * The reveal, one beat at a time.
	 *
	 *   picking   chests are being opened one at a time; the open ones show what they held, the shut
	 *             ones rattle. It ends with eleven open and one shut, the winner
	 *   clearing  the eleven are fading off the board
	 *   centred   the last chest has crossed to the middle and grown, still shut; the small dragon
	 *             lands on it and breathes fire over it, and the lid waits for the flames to die back
	 *   opened    it is open, with its multiplier on its front; the dragon stays on the lid, idling
	 */
	type Phase = 'picking' | 'clearing' | 'centred' | 'opened';
	let phase = $state<Phase>('picking');

	/** Between chests opened FOR the player — out of time, or not in the bonus at all. */
	const AUTO_MS = 260;
	/** Eleven open and one shut, rattling on its own: a beat before the board clears round it. */
	const LAST_HOLD_MS = 900;
	/** The eleven fade off. */
	const CLEAR_MS = 380;
	/** The last chest crosses the board and grows. Matches the transform's own transition. */
	const CENTRE_MS = 640;
	/** It is open, with the number over it, before the screen moves on to the win line. */
	const OPEN_HOLD_MS = 1200;
	/**
	 * How far into the chest's cue (`treasure`, game/sound.ts) the lid comes off: the hit the
	 * recording builds to. Everything from the ignition to here is the chest shuddering.
	 */
	const LID_AT_CUE_MS = 4000;
	/** One rattle of a shut chest, a few swings dying away — see `rattle` below. */
	const SHAKE_MS = 560;
	/** The board stays still this long, give or take, between one set of rattling chests and the next. */
	const SHAKE_PAUSE_MIN_MS = 1000;
	const SHAKE_PAUSE_MAX_MS = 2000;
	/** How many chests go in a set: three as a rule, two or four now and then so it does not tick. */
	const SHAKE_SET_SIZES = [2, 3, 3, 3, 4];
	/**
	 * The chests of a set do not start together — each waits this much longer than the one before
	 * it, give or take, so a set reads as one box stirring and setting the next off rather than the
	 * three jolting in step.
	 */
	const SHAKE_STAGGER_MIN_MS = 120;
	const SHAKE_STAGGER_MAX_MS = 320;
	/** The first set comes sooner, so the board does not open on two dead seconds. */
	const SHAKE_FIRST_MS = 500;

	/** The chests opened so far, in the order they were opened. */
	let openedOrder = $state<number[]>([]);
	const openedSet = $derived(new Set(openedOrder));
	/** The last chest standing, once there is one. */
	let winner = $state<number | null>(null);
	let resolveOpen: ((index: number) => void) | null = null;

	/**
	 * The shut chests rattling right now. While the pick is on, about three shut chests are picked to
	 * rattle together, then the board rests for a second or two before another set goes — never the
	 * whole board at once. A set tries not to repeat a chest from the set before it, so the rattle
	 * wanders round the grid. Each entry carries the chest's own start offset within the set.
	 */
	let rattling = $state<{ index: number; delayMs: number }[]>([]);
	const rattleDelay = (index: number) => rattling.find((r) => r.index === index)?.delayMs;
	$effect(() => {
		if (phase !== 'picking') return;
		let timer: ReturnType<typeof setTimeout>;
		const next = (delay: number) => (timer = setTimeout(rattle, delay));
		const rattle = () => {
			const shut = room.chests.map((_, index) => index).filter((index) => !openedSet.has(index));
			const fresh = shut.filter((index) => rattleDelay(index) === undefined);
			const pool = [...(fresh.length > 0 ? fresh : shut)];
			const size = Math.min(
				pool.length,
				SHAKE_SET_SIZES[Math.floor(Math.random() * SHAKE_SET_SIZES.length)],
			);
			const set: { index: number; delayMs: number }[] = [];
			let delayMs = 0;
			while (set.length < size) {
				const index = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
				set.push({ index, delayMs });
				delayMs += Math.round(
					SHAKE_STAGGER_MIN_MS + Math.random() * (SHAKE_STAGGER_MAX_MS - SHAKE_STAGGER_MIN_MS),
				);
			}
			rattling = set;
			// The set is over when its LAST chest has finished, not its first.
			const lastStart = set[set.length - 1]?.delayMs ?? 0;
			timer = setTimeout(() => {
				rattling = [];
				next(SHAKE_PAUSE_MIN_MS + Math.random() * (SHAKE_PAUSE_MAX_MS - SHAKE_PAUSE_MIN_MS));
			}, lastStart + SHAKE_MS);
		};
		next(SHAKE_FIRST_MS);
		return () => {
			clearTimeout(timer);
			rattling = [];
		};
	});

	/** The chests, so the dragon can find the last one on the screen. */
	let chestEls = $state<HTMLButtonElement[]>([]);
	let dragon = $state<ReturnType<typeof ChestDragon>>();
	/** True while the dragon's fire is on the last chest. */
	let burning = $state(false);

	/**
	 * Values as shown. The book's decoys, in book order, are dealt to the chests in the order they
	 * are OPENED, and the awarded value goes to whichever chest is left — so the numbers on the board
	 * are a function of the opening order alone, and every order pays the same.
	 */
	const award = $derived(room.chests[room.opened]);
	const decoys = $derived(room.chests.filter((_, index) => index !== room.opened));
	const valueOf = (index: number): number => {
		const turn = openedOrder.indexOf(index);
		return turn === -1 ? award : decoys[turn];
	};

	/** A pop per chest, climbing a little with each one so the run of eleven reads as a run. */
	const openChest = (index: number) => {
		openedOrder = [...openedOrder, index];
		playSound('pop', 0.9 + openedOrder.length * 0.03, 0.4);
	};

	const choose = (index: number) => {
		if (phase !== 'picking' || winner !== null || !resolveOpen || openedSet.has(index)) return;
		resolveOpen(index);
	};

	export const play = async (): Promise<number> => {
		const count = room.chests.length;
		if (interactive) {
			// One clock for the whole run, and it is the hint's drain. When it runs out the wait is
			// released with no chest, and the loop below hands the rest over to the auto-opener.
			let timedOut = false;
			const deadline = setTimeout(() => {
				timedOut = true;
				resolveOpen?.(-1);
			}, PICK_MS);
			while (openedOrder.length < count - 1 && !timedOut) {
				const index = await new Promise<number>((resolve) => (resolveOpen = resolve));
				resolveOpen = null;
				if (index < 0) break;
				playSound('click');
				openChest(index);
			}
			clearTimeout(deadline);
			resolveOpen = null;
		} else {
			await waitForTimeout(900);
		}

		// Whatever is still shut is opened for the player, one at a time in board order, keeping
		// back the book's own chest if it is still shut and otherwise the last one along.
		const shut = room.chests.map((_, index) => index).filter((index) => !openedSet.has(index));
		const keep = shut.includes(room.opened) ? room.opened : shut[shut.length - 1];
		for (const index of shut) {
			if (index === keep) continue;
			openChest(index);
			await waitForTimeout(AUTO_MS);
		}
		winner = keep;
		await waitForTimeout(LAST_HOLD_MS);

		phase = 'clearing';
		playSound('whoosh');
		await waitForTimeout(CLEAR_MS);

		phase = 'centred';
		dragon?.appear();
		await waitForTimeout(CENTRE_MS);

		/*
		 * The fire and the chest's own cue start together, on the ignition: the dragon breathes, the
		 * chest shudders in the heat, and the lid stays on until the cue reaches the hit it is cut to
		 * — half a second after the roar has finished, with the flames already gone and the chest
		 * still shaking. The wait is measured from the cue rather than counted in beats, so the two
		 * cannot drift.
		 *
		 * The dragon is allowed not to be there (it has its own load timeout), and the beat plays out
		 * the same way when it is not: the cue and the shudder start where the fire would have.
		 */
		let cueAt = 0;
		const startCue = () => {
			burning = true;
			playSound('treasure');
			cueAt = performance.now();
		};
		await dragon?.breathe({ onIgnite: startCue });
		if (!cueAt) startCue();
		await waitForTimeout(Math.max(0, LID_AT_CUE_MS - (performance.now() - cueAt)));
		burning = false;

		// The dragon stays on the open chest, idling: the number is written on the chest's front, below
		// where it stands.
		phase = 'opened';
		playSound('doorOpen');
		await waitForTimeout(240);
		playSound('merge');
		await waitForTimeout(OPEN_HOLD_MS);
		return room.total;
	};
</script>

<div class="chests" style="--shake-ms:{SHAKE_MS}ms">
	<!-- The rule of the room and the pick clock, in the game's one voice — see `RoomHint`. It stands
	     over the grid rather than across it, because here the thing being read and the thing being
	     tapped are the same twelve boxes. A player who was not in the bonus is only being shown the
	     chests opening, so their line has no clock to drain.

	     It is left MOUNTED once the last chest is known, faded rather than removed: it sits above the
	     grid in the same column, and taking it out would jump the whole board up by a line at the
	     exact moment that chest is measuring its way to the middle. There is nothing left for it to
	     say, either — from here the chest carries its own number, cut in the letters every other
	     multiplier in the game is cut in, and the footer says what that paid. -->
	<RoomHint
		lines={interactive ? HINT : ['Opening the chests']}
		durationMs={interactive ? PICK_MS : null}
		shown={winner === null}
		size={HINT_SIZE}
	/>
	<div class="grid">
		{#each room.chests as _, i (i)}
			{@const mine = winner === i}
			{@const open = mine ? phase === 'opened' : openedSet.has(i)}
			{@const gone = !mine && phase !== 'picking'}
			<button
				class="chest"
				class:open
				class:mine
				class:gone
				class:shaking={!open && phase === 'picking' && rattleDelay(i) !== undefined}
				class:centred={mine && (phase === 'centred' || phase === 'opened')}
				class:burning={mine && burning}
				bind:this={chestEls[i]}
				style="--dx:{1.5 - (i % COLS)}; --dy:{1 - Math.floor(i / COLS)}; --shake-delay:{rattleDelay(i) ?? 0}ms"
				disabled={open || winner !== null || phase !== 'picking' || !interactive}
				onclick={() => choose(i)}
			>
				<!-- Both drawings are in the DOM from the first frame, the open one merely transparent.
				     It is the only way it is ready when it is wanted: a chest that fetched its open art
				     at the moment it opened would show a hole for as long as the download took, and the
				     download is on the far side of a CDN. -->
				<img class="art shut" src={CHEST_SHUT} alt="" />
				<img class="art spilling" src={CHEST_OPEN} alt="" />
				<div class="value">
					<div class="mult-badge">
						<span class="mult-stroke" aria-hidden="true">{valueOf(i)}x</span>
						<span class="mult-fill">{valueOf(i)}x</span>
					</div>
				</div>
			</button>
		{/each}
	</div>
	<ChestDragon bind:this={dragon} target={winner === null ? undefined : chestEls[winner]} />
</div>

<style>
	/*
	 * Every measurement in this room is a share of ONE chest column, and that column is the only
	 * number that changes between a wide screen and a tall one. It was a dozen separate vw values
	 * before, which meant a portrait pass would have been a dozen more of them, each free to drift
	 * out of proportion with the rest; now there is a single knob and the drawing follows it.
	 */
	.chests {
		/* The dragon's layer is laid over this box. */
		position: relative;
		--cell: 8vw;
		--gap: calc(var(--cell) * 0.097);
		/* The shut drawing, laid across the full column: 1102/1427 of its own width. */
		--art-h: calc(var(--cell) * 0.7723);
		/* Headroom over the lid. The multiplier used to go here; it is on the chest's front now, on a
		   shadow of its own (see `.value`), and this is where the dragon stands on the last chest. */
		--head: calc(var(--cell) * 0.27);
		--chest-h: calc(var(--art-h) + var(--head));
		/* How far the last chest grows once it reaches the middle — and the dragon with it, since it
		   is sized off the chest's own box on the screen. The grid is 4.29 columns across and a
		   little over 3.2 chests down; 3 stood clear of both, and this deliberately overhangs the
		   board it came from. The eleven are gone by then and the hint has faded, so there is
		   nothing under it to hide except the air — except the win line, which comes up under its
		   foot. At this size the foot would still run a little under that line on a 16:9 screen, so
		   the chest is also lifted (`--lift`) by the shortfall; the dragon on its lid still stands
		   clear of the sign above. */
		--zoom: 4.2;
		--lift: calc(var(--cell) * 0.2);
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: calc(var(--cell) * 0.129);
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(4, var(--cell));
		gap: var(--gap);
	}
	.chest {
		position: relative;
		width: var(--cell);
		height: var(--chest-h);
		border: none;
		background: none;
		padding: 0;
		cursor: pointer;
		transform-origin: center center;
		transition:
			transform 640ms cubic-bezier(0.22, 1, 0.36, 1),
			opacity 380ms ease;
	}
	.chest:disabled {
		cursor: default;
	}
	/*
	 * The glow behind a chest under the pointer: a pool of warm light the chest sits in, so the one
	 * about to be opened is lit before it is touched. It is a pseudo-element under the drawings —
	 * first in the box, so it paints beneath them — and a gradient rather than a shadow filter,
	 * which the compositor fades for nothing. Wider than the box on every side, so the light spills
	 * past the chest rather than stopping at its edges.
	 */
	.chest::before {
		content: '';
		position: absolute;
		inset: -18% -28%;
		border-radius: 50%;
		background: radial-gradient(
			ellipse closest-side,
			rgba(255, 240, 170, 0.95) 0%,
			rgba(255, 210, 90, 0.7) 40%,
			rgba(255, 170, 40, 0.3) 70%,
			rgba(255, 160, 30, 0) 100%
		);
		opacity: 0;
		transition: opacity 180ms ease;
		pointer-events: none;
	}
	.chest:not(:disabled):hover::before {
		opacity: 1;
	}
	/*
	 * The two drawings, standing on the same floor — see `CHEST_OPEN` above for where the two
	 * numbers come from. The lift is a share of the COLUMN rather than a percentage, because a
	 * percentage on `bottom` is read against the box's HEIGHT, which carries the headroom for the
	 * number and so is not the unit the drawings were measured in.
	 */
	.art {
		position: absolute;
		bottom: 0;
		left: 50%;
		width: 100%;
		height: auto;
		transform: translateX(-50%);
		/* Decoration. The number above it is what a chest actually says. */
		pointer-events: none;
		transition:
			opacity 220ms ease,
			transform 240ms ease;
	}
	.art.spilling {
		width: 107.64%;
		bottom: calc(var(--cell) * 0.014);
		opacity: 0;
		transform: translateX(-50%) scale(0.95);
		transition:
			opacity 200ms ease,
			transform 420ms cubic-bezier(0.3, 1.5, 0.5, 1);
	}
	.chest.open .art.spilling {
		opacity: 1;
		transform: translateX(-50%) scale(1);
	}
	.chest.open .art.shut {
		opacity: 0;
	}
	/* The lid's old lift on hover, moved onto the whole drawing: there is no lid to raise on its own
	   any more. */
	.chest:not(:disabled):hover .art.shut {
		transform: translateX(-50%) translateY(-5%);
	}
	/*
	 * The multiplier, cut in the letters every other multiplier in the game is cut in —
	 * `.mult-badge` is the table's own, and it is global on purpose so a number reads the same
	 * wherever in the game it happens to be standing.
	 *
	 * It is written on the chest's front, over the drawing, where a gold number would otherwise be
	 * lost in the gold coins of the open art — so it is laid on a pool of shadow with a warm glow
	 * round its edge (`::before`), which makes it read on any chest at any size.
	 */
	.value {
		position: absolute;
		left: 0;
		right: 0;
		bottom: calc(var(--art-h) * 0.16);
		height: calc(var(--art-h) * 0.5);
		display: grid;
		place-items: center;
		font-size: calc(var(--cell) * 0.24);
		pointer-events: none;
		opacity: 0;
		transform: translateY(calc(var(--cell) * 0.09)) scale(0.85);
		transition:
			opacity 240ms ease,
			transform 420ms cubic-bezier(0.3, 1.5, 0.5, 1);
	}
	/* Gradients rather than a blur filter: a filter is rasterised afresh at every size the last
	   chest passes through on its way to three times its own, and a gradient is painted by the
	   compositor for nothing. The transform on `.value` keeps the negative z-index inside it, under
	   the number. */
	.value::before {
		content: '';
		position: absolute;
		inset: -22% -8%;
		z-index: -1;
		border-radius: 50%;
		background:
			radial-gradient(
				ellipse closest-side,
				rgba(8, 4, 0, 0.85) 0%,
				rgba(8, 4, 0, 0.75) 42%,
				rgba(8, 4, 0, 0.35) 62%,
				rgba(8, 4, 0, 0) 74%
			),
			radial-gradient(
				ellipse closest-side,
				rgba(255, 214, 90, 0.85) 50%,
				rgba(255, 180, 50, 0.45) 72%,
				rgba(255, 160, 30, 0.12) 88%,
				rgba(255, 160, 30, 0) 100%
			);
	}
	.chest.open .value {
		opacity: 1;
		transform: translateY(0) scale(1);
	}
	/* The eleven leaving. They go TOGETHER: each was read as it opened, and there is nothing left
	   on any of them to walk the eye over. */
	.chest.gone {
		opacity: 0;
		transform: scale(0.86);
		pointer-events: none;
	}
	/*
	 * The last chest crossing to the middle of the board.
	 *
	 * The grid is regular, so the trip is arithmetic rather than a measurement: a column plus a gap
	 * for every column it stands out from the middle, a chest plus a gap for every row. `--dx` and
	 * `--dy` are those two counts, written on the element — 1.5 minus the column, 1 minus the row —
	 * and they are the only place the shape of the grid is stated twice (see `COLS`).
	 *
	 * The scale comes after the translate so the chest grows about where it ARRIVES rather than
	 * dragging its own new size across the board with it. `--lift` is taken off the trip in the
	 * board's own units, so it is the same distance on the screen whatever the zoom.
	 */
	.chest.centred {
		z-index: 5;
		transform: translate(
				calc((var(--cell) + var(--gap)) * var(--dx)),
				calc((var(--chest-h) + var(--gap)) * var(--dy) - var(--lift, 0px))
			)
			scale(var(--zoom));
	}

	/*
	 * A shut chest rattles now and then while the pick is on — something is in it, and it wants out.
	 * It is a small nudge, a few swings dying away, played once each time the chest is picked for a
	 * set (`rattling` in the script says which chests and when). The class comes off between sets,
	 * so a chest picked again starts its rattle from the top. Under a degree: three chests go per
	 * set, and at the original 1.1° a set read as the board jolting rather than a few boxes stirring;
	 * half that was too easy to miss, so it sits between.
	 *
	 * On the drawing's `rotate` and `translate` rather than its `transform`: the transform is where
	 * the drawing is centred in its column and where the hover lift goes, and the individual
	 * properties compose with it rather than replacing it. It stops with the pick, and the last chest
	 * gets the dragon's scorch (below) in its place.
	 */
	.chest.shaking .art.shut {
		/* `--shake-delay` is the chest's own offset within its set (script), so no two start together. */
		animation: rattle var(--shake-ms) ease-in-out var(--shake-delay, 0ms);
	}
	@keyframes rattle {
		0%,
		100% {
			rotate: 0deg;
			translate: 0 0;
		}
		18% {
			rotate: -0.8deg;
			translate: -0.36% 0;
		}
		38% {
			rotate: 0.72deg;
			translate: 0.32% 0.14%;
		}
		58% {
			rotate: -0.44deg;
			translate: -0.18% 0;
		}
		78% {
			rotate: 0.22deg;
			translate: 0.08% 0.06%;
		}
	}

	/* Under the dragon's fire the shut chest shudders in the heat. A transform on the drawing only, so
	   the compositor moves it and nothing is re-rasterised at three times its size. */
	.chest.burning .art.shut {
		animation: scorch 110ms ease-in-out infinite alternate;
	}
	@keyframes scorch {
		from {
			transform: translateX(-50%) translateX(-1.2%) rotate(-0.6deg);
		}
		to {
			transform: translateX(-50%) translateX(1.2%) rotate(0.6deg);
		}
	}

	/* ---- Portrait ----------------------------------------------------------------------
	   The one number, given a taller screen: four chests across nearly the whole width, which is
	   where the room was always meant to be — it was drawn for a wide screen and left at a quarter
	   of a phone.

	   The zoom is pulled in with it, by the same share as before the pair grew by half. A phone's
	   board is the same three-and-a-bit chests tall as a desktop's, but there is far less air around
	   it, and the sign above and the win line below are closer. */
	:global(.game.portrait) .chests {
		--cell: 19vw;
		--zoom: 4.2;
		/* A phone's board has the win line well below the chest already; no lift is wanted. */
		--lift: 0px;
	}
</style>
