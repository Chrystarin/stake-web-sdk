/**
 * Plinko board geometry and drop planning. Pure maths — no DOM, no framework, no game imports —
 * so the shape of a board and the path of a ball can both be reasoned about (and tested) on
 * their own.
 *
 * THE ONE RULE THIS FILE EXISTS TO KEEP: the ball hits exactly one peg per row and leaves it half
 * a peg-pitch to one side. Every position it ever occupies is therefore a real peg, and the path
 * is a genuine Galton walk rather than a curve drawn to a destination. The result is still fixed
 * before the ball is released — the walk is planned backwards from the pocket the RGS settled on
 * (see `planDrop`) — but nothing in the animation has to cheat to land it there.
 */

export type BoardShape = {
	/** Pockets along the bottom. Odd, so one sits dead centre. */
	pockets: number;
	/** Peg rows the ball falls through. Odd — see `shapeForPockets`. */
	rows: number;
	/** Start positions each side of centre. See `startOffsets`. */
	startSteps: number;
};

/**
 * Work out a board that can deliver ANY pocket from ANY starting point.
 *
 * The field is a BOX, not a pyramid: every row runs the full width of the board, alternating
 * `pockets + 1` and `pockets` pegs so the half-pitch zig-zag always lands on one. The top row and
 * the bottom row are BOTH the wide one — same pattern at both ends — which is what an odd row
 * count gives you.
 *
 * That squaring-off is also what buys the drop zone. A pyramid ties the row count to the pocket
 * count (the bottom row has to frame the pockets, and each row above it is one peg narrower), so
 * there is no slack to start off-centre with. A box has as many rows as it likes, so the drop
 * zone can span the whole width: there is a start position above every gap in the top row.
 *
 * Rows follow from that. The longest trip is corner to opposite corner — `maxStep + startSteps`
 * pitches — and the walk covers half a pitch per row, so it needs `2 x` that many, plus a spare
 * pair so even that path gets one bounce back the other way rather than running straight down one
 * wall.
 */
export const shapeForPockets = (pockets: number): BoardShape => {
	// Pockets either side of the middle one — also the furthest a ball ever has to travel.
	const maxStep = (pockets - 1) / 2;
	const startSteps = maxStep;
	// Always odd, which is exactly the parity the box needs to be wide at top and bottom.
	const rows = 2 * (maxStep + startSteps) + 1;
	return { pockets, rows, startSteps };
};

/** Pegs in row `row`. Alternating, so the ball always has one to strike. */
export const pegsInRow = (shape: BoardShape, row: number): number =>
	row % 2 === 0 ? shape.pockets + 1 : shape.pockets;

/**
 * Where the ball may be started, as offsets from centre in peg pitches.
 *
 * The top row is the WIDE one, so its pegs sit on half-pitches — and the ball starts ON a peg, so
 * the start positions are half-pitches too. That is also the parity the walk needs: an odd number
 * of half-pitch steps lands a half-offset start exactly on a whole-offset pocket centre.
 */
export const startOffsets = (shape: BoardShape): number[] =>
	Array.from({ length: shape.startSteps * 2 }, (_, index) => index - shape.startSteps + 0.5);

/** Nearest legal start position to an arbitrary offset. */
export const snapStartOffset = (shape: BoardShape, offset: number): number => {
	const limit = shape.startSteps - 0.5;
	return Math.max(-limit, Math.min(limit, Math.round(offset - 0.5) + 0.5));
};

/** Centre → outermost peg of a row, in pitches. Also the parity the ball must arrive on. */
export const rowHalfSpan = (shape: BoardShape, row: number): number =>
	(pegsInRow(shape, row) - 1) / 2;

/** How far off centre the ball may be once row `row` has deflected it. */
const spanAfterRow = (shape: BoardShape, row: number): number =>
	row + 1 < shape.rows ? rowHalfSpan(shape, row + 1) : (shape.pockets - 1) / 2;

/**
 * Plan the walk from a starting peg to the pocket the round has already been settled on.
 *
 * Each row is a coin flip that is only allowed to come up a way that (a) keeps the ball on the
 * board and (b) leaves enough rows to still reach the target. Inside those two bounds the choice
 * is genuinely random, which is what stops every drop to a given pocket from tracing the same
 * line — and because feasibility is checked BEFORE the step is taken rather than corrected after,
 * the walk never has to slide sideways to make up ground it lost.
 *
 * Returns the ball's offset from centre (in pitches) at every peg contact, plus its offset in the
 * pocket: `rows + 1` values, the last of which is exactly `targetOffset`.
 */
export const planDrop = (
	shape: BoardShape,
	startOffset: number,
	targetOffset: number,
	random: () => number = Math.random,
): number[] => {
	const offsets = [startOffset];
	let current = startOffset;

	for (let row = 0; row < shape.rows; row++) {
		const rowsLeft = shape.rows - row - 1;
		const limit = spanAfterRow(shape, row);
		// Try both ways, in a random order, and take the first that is still legal.
		const steps = random() < 0.5 ? [-0.5, 0.5] : [0.5, -0.5];
		let chosen: number | undefined;
		for (const step of steps) {
			const next = current + step;
			if (Math.abs(next) > limit + 1e-9) continue;
			if (Math.abs(targetOffset - next) > rowsLeft * 0.5 + 1e-9) continue;
			chosen = step;
			break;
		}
		// Unreachable for a shape from `shapeForPockets` — every start can reach every pocket with
		// rows to spare. A hand-tuned shape that cannot is still better served by a ball that heads
		// for the right pocket than by one that stops mid-board.
		current += chosen ?? (targetOffset > current ? 0.5 : -0.5);
		offsets.push(current);
	}

	return offsets;
};

// --- Layout ---------------------------------------------------------------------------------
// Everything below turns a shape plus a host box into pixels. The board is laid out to fit
// whichever of width or height runs out first, then centred in what is left, so it fills a
// landscape jackpot screen and a portrait one without either being tuned for.

/** Rail → first peg row, in row gaps: the airspace the ball is held in before it is let go. */
const DROP_ZONE_ROWS = 3.2;
/** Last peg row → top of the pockets. */
const POCKET_GAP_ROWS = 1.15;
/** Deep enough that the pocket art sits close to the proportions it was drawn at. */
const POCKET_ROWS = 2.2;
/**
 * Row gap as a fraction of peg pitch — the band the board is allowed to stretch through to fill
 * its container.
 *
 * This ratio IS the angle the ball falls at: it moves half a pitch sideways per row, so a gap of
 * 0.5 pitches is a 45-degree zig-zag. Squatter rows read as the ball travelling more across than
 * down, taller ones as it barely wandering — so the board fills whichever way its box wants, and
 * the clamp only steps in past the point where the fall stops looking like one.
 */
const ROW_GAP_MIN = 0.3;
const ROW_GAP_MAX = 0.7;

export type BoardLayout = {
	pitch: number;
	rowGap: number;
	pegRadius: number;
	ballRadius: number;
	/** x of the board's centre line, in host pixels. */
	centreX: number;
	/** y the ball waits at before it is dropped. */
	railY: number;
	/** y of the first peg row. */
	topY: number;
	pocketTop: number;
	pocketHeight: number;
	width: number;
	height: number;
	left: number;
	top: number;
};

export const layoutBoard = (shape: BoardShape, hostWidth: number, hostHeight: number): BoardLayout => {
	// One spare pitch across, so the outermost pockets have a wall to sit against.
	const columns = shape.pockets + 1;
	const verticalRows = DROP_ZONE_ROWS + (shape.rows - 1) + POCKET_GAP_ROWS + POCKET_ROWS;

	// Fill the box in BOTH directions: the pitch comes off the width and the row gap off the
	// height, and only when that would push the fall outside the ratio band does one of them take
	// over and set the other. So a board given a square container fills it exactly, and one given
	// a very wide or very tall container fills the tighter axis and centres in the other.
	const pitchByWidth = hostWidth / columns;
	const rowGapByHeight = hostHeight / verticalRows;
	const ratio = pitchByWidth > 0 ? rowGapByHeight / pitchByWidth : ROW_GAP_MAX;
	const pitch = Math.max(
		0,
		ratio < ROW_GAP_MIN ? rowGapByHeight / ROW_GAP_MIN : pitchByWidth,
	);
	const rowGap = Math.max(
		0,
		ratio > ROW_GAP_MAX ? pitch * ROW_GAP_MAX : rowGapByHeight,
	);
	const width = columns * pitch;
	const height = verticalRows * rowGap;
	const left = (hostWidth - width) / 2;
	const top = (hostHeight - height) / 2;

	return {
		pitch,
		rowGap,
		// Sized against the tighter of the two spacings, so a squat board keeps its pegs apart
		// vertically and a tall one keeps them apart across.
		pegRadius: Math.min(pitch * 0.082, rowGap * 0.26),
		ballRadius: Math.min(pitch * 0.3, rowGap * 0.5),
		centreX: left + width / 2,
		// Centred in the drop zone, so the ball has clear air both above and below it.
		railY: top + rowGap * (DROP_ZONE_ROWS / 2),
		topY: top + DROP_ZONE_ROWS * rowGap,
		pocketTop: top + (DROP_ZONE_ROWS + shape.rows - 1 + POCKET_GAP_ROWS) * rowGap,
		pocketHeight: POCKET_ROWS * rowGap,
		width,
		height,
		left,
		top,
	};
};

export type BoardPeg = { row: number; col: number; x: number; y: number };

export const pegsFor = (shape: BoardShape, layout: BoardLayout): BoardPeg[] => {
	const pegs: BoardPeg[] = [];
	for (let row = 0; row < shape.rows; row++) {
		const count = pegsInRow(shape, row);
		for (let col = 0; col < count; col++) {
			pegs.push({
				row,
				col,
				x: layout.centreX + (col - (count - 1) / 2) * layout.pitch,
				y: layout.topY + row * layout.rowGap,
			});
		}
	}
	return pegs;
};

/** Which peg in `row` sits at `offset` — the one the ball is about to strike. */
export const pegColumnAt = (shape: BoardShape, row: number, offset: number): number =>
	Math.round(offset + (pegsInRow(shape, row) - 1) / 2);
