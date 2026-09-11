<script lang="ts">
	/**
	 * What a bonus room says to the player, and how long they have to act on it — one block of
	 * writing shared by all four rooms.
	 *
	 * It began as Pirate Plinko's, where the instruction IS the shot clock: the words are laid down in
	 * gold and uncovered in white at the speed of the countdown, so the player reads how long is
	 * left off the thing they are already looking at rather than off a number beside it. Every room
	 * now speaks the same way, because a bonus that changes voice from screen to screen reads as
	 * four games rather than as four rooms of one.
	 *
	 * A room with nothing to wait for — the voyage dives itself, a chest opens itself for a player
	 * who was not in the bonus — leaves `durationMs` off and gets the same writing with no drain,
	 * which is simply the finished state: white all through.
	 */
	import type { Snippet } from 'svelte';

	type Props = {
		/**
		 * The instruction, ALREADY broken into lines rather than left to wrap. Each line drains on a
		 * clock of its own, and a line the layout invented has no clock to give it.
		 */
		lines?: string[];
		/** Faded in while true. Coming off it fades out and leaves the drain where it stood. */
		shown?: boolean;
		/**
		 * The whole clock, shared out equally between the lines. Omitted — or null — means there is
		 * no clock: the words simply stand there, finished.
		 */
		durationMs?: number | null;
		/** Lay it across the parent instead of taking a place in its flow (Pirate Plinko covers its board). */
		overlay?: boolean;
		/**
		 * Type size, as any CSS length. The rooms are not the same size on the screen, so the writing
		 * on them is not either; the treatment is what is shared. `portraitSize` is only wanted by a
		 * room that GROWS on a tall screen — one that does not keeps its landscape size, which is
		 * already a share of the same viewport width.
		 */
		size?: string;
		portraitSize?: string;
		/** Anything richer than lines of plain text — an outcome with a multiplier picked out of it. */
		children?: Snippet;
	};
	let {
		lines = [],
		shown = true,
		durationMs = null,
		overlay = false,
		size = '2.6vw',
		portraitSize,
		children,
	}: Props = $props();

	/** Each line gets an equal share of the clock, and starts where the line above it finished. */
	const drainMs = $derived(durationMs === null ? 0 : durationMs / Math.max(1, lines.length));
	const draining = $derived(shown && drainMs > 0);
</script>

<!-- Three nested boxes, and each is doing a job. The outer one places the writing and fades it. The
     middle one is text-sized, which is what keeps the shadow's buffer off the whole room and gives
     the breath something to scale about. The lines are separate because the drain is measured
     against the height of the box it is painted on: one box around both lines would spend a share
     of the clock crossing the air between them, and over a busy room it would cross the letters in
     a single frame. -->
<div
	class="hint"
	class:overlay
	class:shown
	style="--hint-size:{size}; --hint-portrait-size:{portraitSize ?? size}"
>
	<span class="hint-body">
		{#if children}
			<!-- One flex item around the lot of it. The body is a flex COLUMN, so a room's own markup
			     dropped straight in would be broken up item by item — the multiplier at the end of a
			     sentence would be handed a row of its own. Inside a block it lays out as writing, and
			     the room can break its own lines with a `<br>`. -->
			<span class="hint-rich">{@render children()}</span>
		{:else}
			{#each lines as line, index (line)}
				<!-- Three copies of the same words, stacked in one grid cell and painted in DOM order:
				     the brown edge, then the gold, then the white that drains over it.

				     The EDGE is the copy left readable, and it is the only one that can be: the gold is
				     taken away on a line with no clock, and the white is clipped to nothing for most of
				     one that has. The other two are the same line over again, so a reader is spared
				     them. -->
				<span class="hint-line" style="--drain-ms:{drainMs}ms; --drain-delay:{index * drainMs}ms">
					<span class="hint-edge">{line}</span>
					<span class="hint-ink" class:idle={!draining} aria-hidden="true">{line}</span>
					<span class="hint-fill" class:draining aria-hidden="true">{line}</span>
				</span>
			{/each}
		{/if}
	</span>
</div>

<style>
	/* This layer only places the writing and fades it; the drain lives on `.hint-line`. */
	.hint {
		display: flex;
		align-items: center;
		justify-content: center;
		/* Nothing here is ever the thing being pressed: the chests, the wheel and Pirate Plinko's board all
		   take the pointer straight through it. */
		pointer-events: none;
		opacity: 0;
		transition: opacity 250ms ease;
	}
	/* Laid across the room rather than stacked above it. Over the pegs, the pockets and the ball,
	   all of which Pirate Plinko's board draws below 10 — and under the win line, which comes up only once
	   this is long gone. */
	.hint.overlay {
		position: absolute;
		inset: 0;
		z-index: 40;
	}
	.hint.shown {
		opacity: 1;
	}
	/* The block of writing: text-sized, which is what the shadow and the breath both want.

	   The shadow is three passes, and a filter rather than a `text-shadow` so it takes the shape of
	   what was actually painted THROUGH the glyphs — a text-shadow would be cast by the letters,
	   which are transparent here, and the drain would have no shadow at all below the seam. The
	   first pass is unblurred and offset, which is what reads as a shadow rather than as a glow; the
	   other two are the soft cast and the ambient darkening that lift the letters off whatever they
	   happen to be lying on.

	   In `em`, so one rule serves a room of any size: these are the numbers Pirate Plinko was carrying in
	   vw, which had to be written out a second time for portrait to come out the same weight.

	   It sits here rather than on each line so the filter runs once over the whole block, and so the
	   lines breathe together instead of scaling about their own centres and drifting apart. */
	.hint-body {
		display: inline-flex;
		flex-direction: column;
		align-items: center;
		max-width: 88%;
		font-family: 'PotatoSans', 'Alexandria', sans-serif;
		font-size: var(--hint-size);
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
		color: #ffffff;
		filter: drop-shadow(0 0.06em 0 rgba(12, 7, 2, 0.95))
			drop-shadow(0 0.115em 0.135em rgba(0, 0, 0, 0.85)) drop-shadow(0 0 0.35em rgba(0, 0, 0, 0.6));
	}
	/* Small on purpose. This sits over a room the player is watching, so it has to catch the eye
	   without becoming the thing being watched. */
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
	/* An outcome line takes the same brown edge, but straight on the writing: there is no gradient
	   here, only flat colour, so `paint-order` can put the stroke behind the fill and no second copy
	   is needed. The same 0.12em, which comes out at the same visible weight — either way the fill
	   buries the inner half of it. */
	.hint-rich {
		display: block;
		-webkit-text-stroke: 0.12em #3a1c07;
		paint-order: stroke fill;
	}
	/* A number a room wants picked out of a sentence — the multiplier a chest gave up, the floor a
	   climb stopped on. `:global`, because that markup is the room's own. */
	.hint-body :global(b) {
		font-weight: inherit;
		color: #ffe14d;
	}
	/* One line, and its share of the clock.

	   The drain is TWO copies of the line, gold underneath and white on top, with the white one
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
	   back to when the class comes off at the moment the room is released: the last thing seen
	   through the fade is where the drain ended rather than a flash of it refilling. It is also
	   what a room with no clock gets from the first frame, which is the whole of how the undrained
	   case works. */
	.hint-line {
		/* The three copies live in ONE grid cell, which stacks them glyph on glyph and paints them in
		   the order they are written — the edge under the gold under the white. A grid rather than the
		   absolute positioning this used to do, because a positioned box paints ABOVE its in-flow
		   siblings whatever the DOM says, and the edge has to sit underneath. */
		display: inline-grid;
		/* A line is a line. Let one wrap and its box is suddenly two lines tall, which the drain is
		   measured against — the clip below would walk the first line's glyphs and then a stretch of
		   air. Rooms break their own lines; this makes sure the layout cannot break them again. */
		white-space: nowrap;
	}
	.hint-line > * {
		grid-area: 1 / 1;
	}
	/*
	 * The outline: a copy of the line with no fill at all, carrying a solid dark brown stroke — the
	 * same brown the room signs are cut with, so the writing belongs to the same set of letters.
	 *
	 * A stroke straddles the glyph's outline, half of it inside and half out, and the two copies over
	 * this one bury the inside half. What is left is a clean edge of about half the width below,
	 * around whichever of them is showing — so the gold and the white are both edged by this one
	 * copy, and neither has to carry a stroke of its own. The gold in particular could not: paint it
	 * through `background-clip: text` and a stroke on the same box is filled by the gradient rather
	 * than drawn over it.
	 *
	 * In `em`, so it holds its weight against type cut anywhere from the voyage's caption to Pirate Plinko's
	 * portrait board.
	 */
	.hint-edge {
		color: transparent;
		-webkit-text-stroke: 0.12em #3a1c07;
		paint-order: stroke fill;
	}
	/*
	 * What is still to run: gold at the top through yellow to a burnt orange at the foot, the same
	 * metal the signs and the multipliers are cut in, rather than the blue this started life with.
	 *
	 * The foot is deliberately dark. The drain is read off the STEP between white and what is under
	 * it, and gold sits far closer to white than the blue did — a ramp that stopped at a bright
	 * orange left the seam soft at landscape sizes, where the writing is only a couple of vw tall.
	 * Most of the fall happens in the bottom third, which is where the seam spends the last of every
	 * line's clock.
	 *
	 * It is a gradient down the GLYPHS, which needs the paint clipped to the text — a plain `color`
	 * has only one value to give. The flat gold is what a browser without the clip is left holding,
	 * and it is a fallback rather than a compromise: `color: transparent` outside the `@supports`
	 * would hand that browser an invisible line instead of a slightly plainer one.
	 *
	 * Painting through the glyphs is also what keeps the block's drop-shadow honest — see
	 * `.hint-body`, where the shadow is a filter for exactly that reason. A gradient is still paint;
	 * the shadow takes the shape of the letters it came through.
	 */
	.hint-ink {
		color: #f7c948;
	}
	@supports (background-clip: text) or (-webkit-background-clip: text) {
		.hint-ink {
			background: linear-gradient(180deg, #ffeaa6 0%, #ffd24d 36%, #ef9418 70%, #b85c0b 100%);
			-webkit-background-clip: text;
			background-clip: text;
			color: transparent;
		}
	}
	/* No clock: nothing is coming to uncover the gold, so there is no gold. The white copy over it
	   is doing all of the reading. */
	.hint-ink.idle {
		visibility: hidden;
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
	 * rasteriser rounding the other way at another size cannot leave a sliver of gold behind.
	 *
	 * They are shares of the line box rather than of a size, so they hold at whatever size a room
	 * asks for. Re-measure both if the font, the `line-height` above, or the case of the words ever
	 * changes.
	 */
	.hint-line {
		--ink-top: 4.8%;
		--ink-bottom: 81.5%;
	}
	/* The drain's own copy. It shares the cell with the other two, so it wraps and centres exactly as
	   they do and the clip below is measured against the same box.

	   The white is DISHED rather than flat: grey down the sides of every stroke, white through the
	   middle, so the uncovered words read as cut into the sign rather than laid on it — the solidity
	   the gold below the seam already gets from its ramp.

	   It is a stroke and not a shadow because a `text-shadow` cannot do it. A shadow is the whole
	   glyph over again, offset and blurred, so it covers the MIDDLE of a stroke as surely as the
	   edge — anything strong enough to read as depth turns the letter grey and leaves a white sliver
	   at one edge, which is the wrong way round. A stroke straddles the outline instead, and with the
	   default paint order it is drawn over the fill: the inner half is the grey rim, and the middle
	   is never touched.

	   The outer half is spent on `.hint-edge`'s brown, which carries 0.06em outside the outline —
	   about twice this stroke's reach — so nothing of it lands on the room. Widening it much past
	   here starts to grey that brown from the inside.

	   In `em`, like the rest of this file, so a rim of the same weight lands on the voyage's caption
	   and on Pirate Plinko's landscape line alike. */
	.hint-fill {
		color: #ffffff;
		-webkit-text-stroke: 0.055em rgba(122, 122, 132, 0.42);
		clip-path: inset(0 0 calc(100% - var(--ink-bottom)) 0);
	}
	.hint-fill.draining {
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

	/* A tall screen only matters to a room that grows on one. Those pass a second size; the rest
	   land back on their landscape one, which is already a share of the same viewport width. */
	:global(.game.portrait) .hint-body {
		font-size: var(--hint-portrait-size);
	}
</style>
