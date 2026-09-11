<script lang="ts">
	/**
	 * Treasure Chest room: twelve chests, the player opens one.
	 *
	 * The prize is AUTHORED: whichever chest the player taps reveals the book's awarded value, and
	 * the remaining eleven reveal the book's decoys. Every chest is equally likely to be tapped, so
	 * the pick has no effect on the expected value — the same as a shuffled live board. The rules
	 * page must say so. If the player does not pick in time, the book's own `opened` index is used.
	 *
	 * The reveal is deliberately back to front: the ELEVEN the player did not choose open first, in
	 * rings spreading out from the one they did, and only once those have shown what they were worth
	 * and cleared off does the chosen chest cross to the middle of the board and open on its own.
	 * The player learns what they turned down before they learn what they took, which is the whole
	 * of the moment — a board that opened the pick first would be asking nobody to look at the rest.
	 */
	import { PICK_SECONDS } from '../../game/constants';
	import type { BookEventChest } from '../../game/typesBookEvent';
	import { playSound } from '../../game/sound';
	import { staticPath } from '../../lib/staticUrl';
	import { finePointer } from '../../lib/pointer.svelte';
	import { waitForTimeout } from 'utils-shared/wait';
	import RoomHint from './RoomHint.svelte';

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
	 * screen can ask for (a column is 8vw, and the chosen chest grows to three of them), and both
	 * numbers above are ratios, so scaling the pair together leaves them exactly where they were.
	 */
	const CHEST_SHUT = staticPath('img/treasure_chest/chest_close.webp');
	const CHEST_OPEN = staticPath('img/treasure_chest/chest_open.webp');

	/**
	 * What to tell the player, which is not the same instruction on the two kinds of device — the
	 * same split Pirate Plinko makes, asked of pointer capability rather than of screen width. Broken into
	 * lines here because each line drains on a clock of its own.
	 */
	const HINT_FINE = ['Click a chest', 'to open it'];
	const HINT_COARSE = ['Tap a chest', 'to open it'];
	const hintLines = $derived(finePointer() ? HINT_FINE : HINT_COARSE);

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
	 *   idle      nothing chosen yet; twelve shut chests
	 *   decoys    the eleven the player passed over are open, showing what they held
	 *   clearing  those eleven are fading off the board
	 *   centred   the chosen chest has crossed to the middle and grown, still shut
	 *   opened    it is open, with its multiplier over it
	 */
	type Phase = 'idle' | 'decoys' | 'clearing' | 'centred' | 'opened';
	let phase = $state<Phase>('idle');

	/** Between rings of decoys, and so the length of the sweep out from the chosen chest. */
	const WAVE_MS = 90;
	/** The decoys open, and are left up long enough to actually be read. */
	const DECOY_MS = 1600;
	/** They fade off. */
	const CLEAR_MS = 380;
	/** The chosen chest crosses the board and grows. Matches the transform's own transition. */
	const CENTRE_MS = 640;
	/** It is open, with the number over it, before the screen moves on to the win line. */
	const OPEN_HOLD_MS = 1200;

	let picked = $state<number | null>(null);
	let resolvePick: ((index: number) => void) | null = null;

	/** Values as shown: the awarded value moves to the chest the player opened. */
	const shown = $derived.by(() => {
		const values = [...room.chests];
		if (picked !== null && picked !== room.opened) {
			[values[picked], values[room.opened]] = [values[room.opened], values[picked]];
		}
		return values;
	});

	/** How many chests away, counted ALONG the grid rather than across it — one ring per step. */
	const ringOf = (from: number, to: number): number =>
		Math.abs((from % COLS) - (to % COLS)) +
		Math.abs(Math.floor(from / COLS) - Math.floor(to / COLS));

	/** A decoy's place in the sweep: the ring it stands in, counted out from the chosen chest. */
	const openDelay = (index: number): number =>
		picked === null || picked === index ? 0 : Math.max(0, ringOf(picked, index) - 1) * WAVE_MS;

	/**
	 * A pop per RING rather than per chest. Eleven of them inside half a second is a rattle; five,
	 * one to a ring and rising, is the sweep the eye is already following.
	 */
	const rippleOut = (from: number) => {
		const rings = new Set(room.chests.map((_, index) => ringOf(from, index)));
		for (const ring of rings) {
			if (ring === 0) continue;
			setTimeout(() => playSound('pop', 0.94 + ring * 0.05, 0.4), (ring - 1) * WAVE_MS);
		}
	};

	const choose = (index: number) => {
		if (picked !== null || !resolvePick) return;
		resolvePick(index);
	};

	export const play = async (): Promise<number> => {
		let index: number;
		if (interactive) {
			index = await new Promise<number>((resolve) => {
				const deadline = setTimeout(() => resolve(room.opened), PICK_MS);
				// The clock is called off by the pick that beat it, so nothing is left ticking behind a
				// player who chose in the second second.
				resolvePick = (chosen) => {
					clearTimeout(deadline);
					resolve(chosen);
				};
			});
		} else {
			await waitForTimeout(900);
			index = room.opened;
		}
		resolvePick = null;
		picked = index;
		playSound('click');

		phase = 'decoys';
		rippleOut(index);
		await waitForTimeout(DECOY_MS);

		phase = 'clearing';
		playSound('whoosh');
		await waitForTimeout(CLEAR_MS);

		phase = 'centred';
		await waitForTimeout(CENTRE_MS);

		phase = 'opened';
		playSound('doorOpen');
		await waitForTimeout(240);
		playSound('merge');
		await waitForTimeout(OPEN_HOLD_MS);
		return room.total;
	};
</script>

<div class="chests">
	<!-- The instruction and the pick clock, in the game's one voice — see `RoomHint`. It stands over
	     the grid rather than across it, because here the thing being read and the thing being tapped
	     are the same twelve boxes. A player who was not in the bonus is only being shown a chest
	     opening, so their line has no clock to drain.

	     It is left MOUNTED once the pick is in, faded rather than removed: it sits above the grid in
	     the same column, and taking it out would jump the whole board up by a line at the exact
	     moment the chosen chest is measuring its way to the middle. There is nothing left for it to
	     say, either — from here the chest carries its own number, cut in the letters every other
	     multiplier in the game is cut in, and the footer says what that paid. -->
	<RoomHint
		lines={interactive ? hintLines : ['Opening a chest']}
		durationMs={interactive ? PICK_MS : null}
		shown={picked === null}
		size={HINT_SIZE}
	/>
	<div class="grid">
		{#each shown as value, i (i)}
			{@const mine = picked === i}
			{@const open = mine ? phase === 'opened' : phase !== 'idle'}
			{@const gone = !mine && phase !== 'idle' && phase !== 'decoys'}
			<button
				class="chest"
				class:open
				class:mine
				class:gone
				class:centred={mine && (phase === 'centred' || phase === 'opened')}
				style="--dx:{1.5 - (i % COLS)}; --dy:{1 - Math.floor(i / COLS)}; --in:{openDelay(i)}ms"
				disabled={picked !== null || !interactive}
				onclick={() => choose(i)}
			>
				<div class="halo"></div>
				<!-- Both drawings are in the DOM from the first frame, the open one merely transparent.
				     It is the only way it is ready when it is wanted: a chest that fetched its open art
				     at the moment it opened would show a hole for as long as the download took, and the
				     download is on the far side of a CDN. -->
				<img class="art shut" src={CHEST_SHUT} alt="" />
				<img class="art spilling" src={CHEST_OPEN} alt="" />
				<div class="value">
					<div class="mult-badge">
						<span class="mult-stroke" aria-hidden="true">{value}x</span>
						<span class="mult-fill">{value}x</span>
					</div>
				</div>
			</button>
		{/each}
	</div>
</div>

<style>
	/*
	 * Every measurement in this room is a share of ONE chest column, and that column is the only
	 * number that changes between a wide screen and a tall one. It was a dozen separate vw values
	 * before, which meant a portrait pass would have been a dozen more of them, each free to drift
	 * out of proportion with the rest; now there is a single knob and the drawing follows it.
	 */
	.chests {
		--cell: 8vw;
		--gap: calc(var(--cell) * 0.097);
		/* The shut drawing, laid across the full column: 1102/1427 of its own width. */
		--art-h: calc(var(--cell) * 0.7723);
		/* Headroom over the lid, which is where the multiplier goes. It is deliberately NOT laid over
		   the chest: the open drawing is a heap of gold coins, and a gold number on gold coins is a
		   number nobody can read. */
		--head: calc(var(--cell) * 0.27);
		--chest-h: calc(var(--art-h) + var(--head));
		/* How far the chosen chest grows once it reaches the middle. The grid is 4.29 columns across
		   and a little over 3.2 chests down, so this is about as large as it can be and still stand
		   clear of both. */
		--zoom: 3;
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
			opacity 220ms ease var(--in, 0ms),
			transform 240ms ease;
	}
	.art.spilling {
		width: 107.64%;
		bottom: calc(var(--cell) * 0.014);
		opacity: 0;
		transform: translateX(-50%) scale(0.95);
		transition:
			opacity 200ms ease var(--in, 0ms),
			transform 420ms cubic-bezier(0.3, 1.5, 0.5, 1) var(--in, 0ms);
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
	 * The chosen chest is lit from the moment it is chosen, which is what tells the player their tap
	 * landed while the other eleven are still opening — and it stays lit through the crossing and
	 * the opening, so the eye never has to find it again.
	 *
	 * A pool of light BEHIND the chest rather than a `drop-shadow` around it. The shadow was the
	 * obvious way to write it and the wrong one: it is a filter over the drawing, so it has to be
	 * rasterised afresh at every size the chest passes through on its way to three times its own —
	 * one blur of a megapixel image per frame, for the whole of the trip. A gradient is painted by
	 * the compositor and scales for nothing.
	 */
	.halo {
		position: absolute;
		inset: -14% -10% -8%;
		border-radius: 50%;
		background: radial-gradient(
			ellipse at 50% 62%,
			rgba(255, 226, 96, 0.52) 0%,
			rgba(255, 195, 58, 0.3) 30%,
			rgba(255, 168, 32, 0.12) 50%,
			rgba(255, 150, 20, 0.03) 64%,
			rgba(255, 150, 20, 0) 76%
		);
		opacity: 0;
		pointer-events: none;
		transition: opacity 300ms ease;
	}
	.chest.mine .halo {
		opacity: 1;
	}
	/*
	 * The multiplier, cut in the letters every other multiplier in the game is cut in —
	 * `.mult-badge` is the table's own, and it is global on purpose so a number reads the same
	 * wherever in the game it happens to be standing.
	 */
	.value {
		position: absolute;
		left: 0;
		right: 0;
		top: 0;
		height: var(--head);
		display: grid;
		place-items: center;
		font-size: calc(var(--cell) * 0.22);
		opacity: 0;
		transform: translateY(calc(var(--cell) * 0.09)) scale(0.85);
		transition:
			opacity 240ms ease var(--in, 0ms),
			transform 420ms cubic-bezier(0.3, 1.5, 0.5, 1) var(--in, 0ms);
	}
	.chest.open .value {
		opacity: 1;
		transform: translateY(0) scale(1);
	}
	/* The eleven leaving. They go TOGETHER rather than in the rings they arrived in: the sweep was
	   there to walk the eye over them, and it has nothing left to walk it over. */
	.chest.gone {
		opacity: 0;
		transform: scale(0.86);
		pointer-events: none;
	}
	/*
	 * The chosen chest crossing to the middle of the board.
	 *
	 * The grid is regular, so the trip is arithmetic rather than a measurement: a column plus a gap
	 * for every column it stands out from the middle, a chest plus a gap for every row. `--dx` and
	 * `--dy` are those two counts, written on the element — 1.5 minus the column, 1 minus the row —
	 * and they are the only place the shape of the grid is stated twice (see `COLS`).
	 *
	 * The scale comes after the translate so the chest grows about where it ARRIVES rather than
	 * dragging its own new size across the board with it.
	 */
	.chest.centred {
		z-index: 5;
		transform: translate(
				calc((var(--cell) + var(--gap)) * var(--dx)),
				calc((var(--chest-h) + var(--gap)) * var(--dy))
			)
			scale(var(--zoom));
	}

	/* ---- Portrait ----------------------------------------------------------------------
	   The one number, given a taller screen: four chests across nearly the whole width, which is
	   where the room was always meant to be — it was drawn for a wide screen and left at a quarter
	   of a phone.

	   The zoom is pulled in with it. A phone's board is the same three-and-a-bit chests tall as a
	   desktop's, but there is far less air around it, and a chest grown to 2.6 columns there would
	   be pressing on the sign above and the win line below. */
	:global(.game.portrait) .chests {
		--cell: 19vw;
		--zoom: 2.8;
	}
</style>
