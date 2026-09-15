/**
 * Plinko board geometry and drop planning. Pure maths — no DOM, no framework, no game imports —
 * so the shape of a board and the path of a ball can both be reasoned about (and tested) on
 * their own.
 *
 * THE ONE RULE THIS FILE EXISTS TO KEEP: the ball hits exactly one peg per row and leaves it half
 * a peg-pitch to one side — the peg NEXT to the one it struck, never one further off. Every
 * position it ever occupies is therefore a real peg, and the path is a genuine Galton walk rather
 * than a curve drawn to a destination. The result is still fixed before the ball is released — the
 * walk is planned backwards from the pocket the RGS settled on (see `planDrop`) — but nothing in
 * the animation has to cheat to land it there.
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
 * The shape of one hop, shared by the renderer that draws it and the test that checks it clears the
 * pegs. Both MUST read the same curve: a clearance test run against a different parabola from the
 * one on screen guarantees nothing at all.
 *
 * Two parabolas meeting at the apex — up off the peg decelerating, then down onto the next one
 * accelerating — with `rise` the share of the segment spent climbing. A hop with no bounce collapses
 * to a plain accelerating fall.
 */
export const arcRise = (bounce: number, drop: number): number => {
	if (bounce <= 0) return 0;
	const up = Math.sqrt(bounce);
	return Math.min(0.9, up / (up + Math.sqrt(Math.max(0.001, bounce + drop))));
};

export const arcDepth = (
	fromDepth: number,
	drop: number,
	bounce: number,
	rise: number,
	t: number,
): number => {
	if (bounce <= 0) return fromDepth + drop * t * t;
	return t < rise
		? fromDepth - bounce * (1 - (1 - t / rise) ** 2)
		: fromDepth - bounce + (bounce + drop) * ((t - rise) / (1 - rise)) ** 2;
};

/** What a board looks like in pixels, for the one piece of maths here that needs to know. */
export type ArcGeometry = {
	pitch: number;
	rowGap: number;
	ballRadius: number;
	pegRadius: number;
};

/**
 * How much of the ball may lie over a peg before it stops reading as a graze and starts reading as
 * the ball passing through it.
 *
 * It cannot be zero. On this board the ball is as wide as the gap between rows — a diameter of one
 * row gap, measured — so a ball anywhere between two rows is already overlapping the pegs on both
 * of them, and demanding daylight would reject every path there is. What can be demanded is that
 * the ball's CENTRE stays out of the peg and most of the way clear of it, which is the difference
 * between clipping the shoulder of one and swallowing it whole.
 */
const CLEARANCE = 0.55;
/** How finely an arc is sampled when testing it. Enough to catch a peg at the ball's own width. */
const ARC_SAMPLES = 28;

/**
 * Whether the ball can fly from one peg to another at this height without passing through a THIRD.
 *
 * The two pegs the hop belongs to are exempt — it leaves one and lands on the other, and those are
 * contacts rather than collisions. Everything else within reach of the arc counts.
 */
export const arcClears = (
	shape: BoardShape,
	geometry: ArcGeometry,
	from: { row: number; offset: number },
	to: { row: number; offset: number },
	bounce: number,
	/**
	 * Pegs that are no longer standing — blown away by a bomb (see `inBlast`). A hole in the field
	 * is a hole the ball may fly through, so they do not count.
	 */
	absent?: (row: number, offset: number) => boolean,
): boolean => {
	const drop = to.row - from.row;
	const rise = arcRise(bounce, drop);
	const reach = geometry.pegRadius + geometry.ballRadius * CLEARANCE;
	for (let sample = 1; sample < ARC_SAMPLES; sample++) {
		const t = sample / ARC_SAMPLES;
		const offset = from.offset + (to.offset - from.offset) * t;
		const depth = arcDepth(from.row, drop, bounce, rise, t);
		for (let row = Math.floor(depth) - 2; row <= Math.ceil(depth) + 1; row++) {
			if (row < 0 || row >= shape.rows) continue;
			// Where the pegs of this row stand: half-pitches on the wide rows, whole ones between.
			const wide = pegsInRow(shape, row) % 2 === 0;
			const nearest = wide ? Math.round(offset - 0.5) + 0.5 : Math.round(offset);
			for (let step = -1; step <= 1; step++) {
				const pegOffset = nearest + step;
				if (row === from.row && Math.abs(pegOffset - from.offset) < 1e-9) continue;
				if (row === to.row && Math.abs(pegOffset - to.offset) < 1e-9) continue;
				if (absent?.(row, pegOffset)) continue;
				const dx = (offset - pegOffset) * geometry.pitch;
				const dy = (depth - row) * geometry.rowGap;
				if (dx * dx + dy * dy < reach * reach) return false;
			}
		}
	}
	return true;
};

/**
 * The heights a hop may be flown at, tallest first, in row gaps.
 *
 * A fixed set rather than a free number, because the same list is walked twice — once to ask whether
 * a deflection is flyable at all, and again to pick the height it is actually flown at. Two
 * different sets would let the planner approve a step the renderer then cannot fly cleanly.
 */
export const BOUNCE_CHOICES = [2.6, 2.1, 1.7, 1.35, 1.05, 0.8, 0.6, 0.45, 0.32, 0.22, 0.14, 0];

/**
 * Plan the walk from a starting peg to the pocket the round has already been settled on.
 *
 * Each row is a coin flip that is only allowed to come up a way that (a) keeps the ball on the
 * board, (b) leaves enough rows to still reach the target, and (c) can actually be FLOWN without
 * the ball passing through a peg on the way — see `canFly`. Inside those bounds the choice
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
	/**
	 * Whether the ball can actually FLY a step without going through a peg on the way. Given one,
	 * a deflection has to be both legal and flyable to be taken, and the fall stops phasing.
	 *
	 * Optional because the geometry is the host's: this module knows how many pegs there are and
	 * where they stand in pitches, but not how big they are in pixels. Left out, the planner is the
	 * pure walk it always was.
	 */
	canFly?: (from: { row: number; offset: number }, to: { row: number; offset: number }) => boolean,
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
			if (canFly && !canFly({ row, offset: current }, { row: row + 1, offset: next })) continue;
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

/**
 * A picture the board has to sit inside: where in the host box the pegs may stand, and where
 * the pockets belong. Fractions of the host, 0 to 1.
 *
 * Without one the board sizes itself and centres in whatever it is given, which is what a board
 * drawn by the module wants. With one, a cabinet has been painted behind it and the geometry is
 * no longer the board's to choose: the pegs go in the frame's opening and the pockets go on the
 * ledge under it, wherever the artist put them.
 */
export type BoardFrame = {
	/** The opening the pegs stand in. */
	field: { left: number; right: number; top: number; bottom: number };
	/** The band the pockets sit on, usually just below the opening. */
	pockets: { top: number; bottom: number };
};

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

export const layoutBoard = (
	shape: BoardShape,
	hostWidth: number,
	hostHeight: number,
	frame?: BoardFrame,
): BoardLayout => {
	// One spare pitch across, so the outermost pockets have a wall to sit against.
	const columns = shape.pockets + 1;
	if (frame) return layoutInFrame(shape, hostWidth, hostHeight, columns, frame);
	const verticalRows = DROP_ZONE_ROWS + (shape.rows - 1) + POCKET_GAP_ROWS + POCKET_ROWS;

	// Fill the box in BOTH directions: the pitch comes off the width and the row gap off the
	// height, and only when that would push the fall outside the ratio band does one of them take
	// over and set the other. So a board given a square container fills it exactly, and one given
	// a very wide or very tall container fills the tighter axis and centres in the other.
	const pitchByWidth = hostWidth / columns;
	const rowGapByHeight = hostHeight / verticalRows;
	const ratio = pitchByWidth > 0 ? rowGapByHeight / pitchByWidth : ROW_GAP_MAX;
	const pitch = Math.max(0, ratio < ROW_GAP_MIN ? rowGapByHeight / ROW_GAP_MIN : pitchByWidth);
	const rowGap = Math.max(0, ratio > ROW_GAP_MAX ? pitch * ROW_GAP_MAX : rowGapByHeight);
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

/**
 * The same board, but told where to go.
 *
 * Nothing is centred and nothing is clamped: the opening sets the pitch and the row gap, and
 * the ledge sets the pockets. The fall comes out at whatever angle the picture implies, which
 * is the artist's business rather than the module's — a frame is a decision already made.
 *
 * The drop zone shrinks to a single row, because with a frame the ball comes from something
 * OUTSIDE the board and the airspace a rail needed is just wasted opening.
 */
const FRAMED_DROP_ZONE_ROWS = 1;

const layoutInFrame = (
	shape: BoardShape,
	hostWidth: number,
	hostHeight: number,
	columns: number,
	frame: BoardFrame,
): BoardLayout => {
	const left = frame.field.left * hostWidth;
	const width = (frame.field.right - frame.field.left) * hostWidth;
	const top = frame.field.top * hostHeight;
	const height = (frame.field.bottom - frame.field.top) * hostHeight;
	const pitch = Math.max(0, width / columns);
	const rowGap = Math.max(0, height / (FRAMED_DROP_ZONE_ROWS + shape.rows - 1));
	return {
		pitch,
		rowGap,
		pegRadius: Math.min(pitch * 0.082, rowGap * 0.26),
		ballRadius: Math.min(pitch * 0.3, rowGap * 0.5),
		centreX: left + width / 2,
		railY: top + rowGap * (FRAMED_DROP_ZONE_ROWS / 2),
		topY: top + FRAMED_DROP_ZONE_ROWS * rowGap,
		pocketTop: frame.pockets.top * hostHeight,
		pocketHeight: (frame.pockets.bottom - frame.pockets.top) * hostHeight,
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

// --- Bombs ----------------------------------------------------------------------------------
// A few of the pegs are bombs. The ball striking one sets it off: the pegs around it are blown
// away and the ball is thrown — several rows down and a couple of pitches across in one flight,
// instead of the half-pitch hop every other peg gives it. The pocket it ends in is STILL the one
// the round was settled on: the throw is chosen from the ones that leave the walk able to reach
// it, exactly the way an ordinary step is, so a blast is a detour on the way to a fixed result
// rather than a change to it.

export type BombSite = { row: number; offset: number };

/** A peg's identity, for sets and maps. Offsets are exact halves, so the string is exact too. */
export const pegKey = (row: number, offset: number): string => `${row}:${offset}`;

/**
 * Rows a bomb may stand on.
 *
 * Not the first few: a shot straight into a bomb has had no fall to watch yet, and the explosion
 * would be the first thing to happen. Not the last few either — a throw goes two to four rows
 * down and has to land on a peg, so a bomb keeps at least three rows under it, and with them the
 * guarantee that SOME throw is always feasible (see `planDropWithBombs`).
 */
const BOMB_ROW_MIN = 3;
const BOMB_ROWS_KEPT_BELOW = 4;

/**
 * Whether the peg at `row`/`offset` is inside `bomb`'s blast.
 *
 * Measured in board units rather than pixels, so the same pegs go on every screen: the bomb's own
 * row either side of it, the four diagonal neighbours, and the pegs straight above and below two
 * rows off — a diamond of nine, the bomb included. The walk after a throw only ever moves DOWN
 * from where the ball landed, which is at least two rows under the bomb, so it can never step back
 * into this set — which is what lets the planner treat a blown peg as simply gone.
 */
export const inBlast = (bomb: BombSite, row: number, offset: number): boolean => {
	const dRow = row - bomb.row;
	const dOffset = offset - bomb.offset;
	return Math.abs(dRow) <= 2 && dOffset * dOffset + (dRow / 2) * (dRow / 2) <= 1.05;
};

/**
 * Put `count` bombs on the board at random, none within reach of another's blast.
 *
 * The separation keeps every blast to itself: no bomb is ever destroyed by a neighbour going off,
 * and no two blast sets overlap, so a peg is blown away exactly once and the planner never has to
 * reason about a chain. Best-effort on a board too small to hold them all that far apart — a
 * jackpot board never is.
 */
export const placeBombs = (
	shape: BoardShape,
	count: number,
	random: () => number = Math.random,
): BombSite[] => {
	const bombs: BombSite[] = [];
	const rowMax = shape.rows - BOMB_ROWS_KEPT_BELOW;
	if (rowMax < BOMB_ROW_MIN) return bombs;
	for (let tries = 0; bombs.length < count && tries < 400; tries++) {
		const row = BOMB_ROW_MIN + Math.floor(random() * (rowMax - BOMB_ROW_MIN + 1));
		const span = rowHalfSpan(shape, row);
		// Not the outermost peg of a row: a bomb against the wall can only throw one way.
		const inner = span - 1;
		if (inner < 0) continue;
		const offset = -inner + Math.floor(random() * (inner * 2 + 1));
		const crowded = bombs.some(
			(other) => Math.abs(other.row - row) <= 4 && Math.abs(other.offset - offset) <= 2,
		);
		if (crowded) continue;
		bombs.push({ row, offset });
	}
	return bombs;
};

/**
 * The throws a blast can give the ball, as rows down and pitches across (either side).
 *
 * Parity is built in: an even number of rows keeps the ball on the same kind of row, so it moves a
 * whole number of pitches; an odd number swaps it, so it moves a half. The far throws are the ones
 * wanted — a blast that moves the ball one pitch is a blast nobody saw — and the near ones are the
 * fallback for a bomb close to a wall, or close to the pocket the ball has to get to. Both tiers
 * land outside the blast set, so the ball is never thrown onto a peg that was just blown away.
 */
const FAR_THROWS: readonly (readonly [rows: number, across: number])[] = [
	[2, 2],
	[2, 3],
	[3, 2.5],
	[3, 3.5],
	[4, 3],
];
const NEAR_THROWS: readonly (readonly [rows: number, across: number])[] = [
	[2, 1],
	[3, 1.5],
	[4, 2],
];

/**
 * How strongly the walk leans towards a bomb it can still reach, 0.5 being no lean at all.
 *
 * A Galton walk that ignored the bombs would strike one in about two rounds in seven (measured:
 * 29% over 4,000 plans on the 13-pocket board), which makes them furniture. Leaning the coin
 * flip towards the nearest bomb the ball can still walk to — only ever between steps that are
 * BOTH legal, so the pocket is never at stake — lifts that to about three rounds in four without
 * making it the certain one, and a ball drifting one way rather than the other is not something a
 * walk that was random to begin with can be seen doing.
 */
export const BOMB_PULL = 0.65;

/** One peg the ball strikes on the way down. `bomb` marks a strike that sets a bomb off. */
export type Contact = { row: number; offset: number; bomb?: boolean };

const shuffled = <T>(items: readonly T[], random: () => number): T[] => {
	const out = [...items];
	for (let i = out.length - 1; i > 0; i--) {
		const j = Math.floor(random() * (i + 1));
		[out[i], out[j]] = [out[j], out[i]];
	}
	return out;
};

/**
 * `planDrop`, on a board with bombs in it.
 *
 * The walk is the same walk, and every ordinary step is chosen under the same three conditions.
 * Two things are added. When the ball's step lands it ON a bomb, the next thing it does is not a
 * step but a THROW: two to four rows down and one to three-and-a-half pitches across, taken from
 * `FAR_THROWS` (then `NEAR_THROWS`) in a random order, the first that keeps the ball on the board,
 * within reach of the pocket, off any peg already blown away, and — given `flyable` — clear of
 * every peg still standing. And between steps the coin is weighted towards the nearest bomb the
 * ball can still get to (`BOMB_PULL`), so bombs actually get hit.
 *
 * The result is a list of CONTACTS rather than one offset per row, because a throw skips rows.
 * The last entry is the pocket, at `row === shape.rows`, and its offset is exactly `targetOffset`.
 *
 * A bomb the ball lands on with no feasible throw at all — which the placement rules make
 * impossible on a board from `shapeForPockets`, but a hand-tuned board might allow — still goes
 * off; the ball just takes an ordinary step off it. Better an explosion that barely moves the ball
 * than a ball that stops.
 */
export const planDropWithBombs = (
	shape: BoardShape,
	startOffset: number,
	targetOffset: number,
	bombs: readonly BombSite[],
	random: () => number = Math.random,
	/**
	 * Whether a flight from one contact to the next can be flown without going through a standing
	 * peg — `absent` says which pegs are no longer standing. See `planDrop`'s `canFly`.
	 */
	flyable?: (
		from: { row: number; offset: number },
		to: { row: number; offset: number },
		absent: (row: number, offset: number) => boolean,
	) => boolean,
	pull: number = BOMB_PULL,
): Contact[] => {
	const contacts: Contact[] = [{ row: 0, offset: startOffset }];
	const live = new Map(bombs.map((bomb) => [pegKey(bomb.row, bomb.offset), bomb]));
	const exploded: BombSite[] = [];
	const gone = (row: number, offset: number) => exploded.some((bomb) => inBlast(bomb, row, offset));
	const stepsLeftFrom = (row: number) => shape.rows - row;

	let row = 0;
	let current = startOffset;
	while (row < shape.rows) {
		const bomb = live.get(pegKey(row, current));
		if (bomb) {
			live.delete(pegKey(row, current));
			exploded.push(bomb);
			contacts[contacts.length - 1].bomb = true;
			let landing: { row: number; offset: number } | undefined;
			for (const tier of [FAR_THROWS, NEAR_THROWS]) {
				const throws = shuffled(
					tier.flatMap(([rows, across]) => [
						[rows, across],
						[rows, -across],
					]),
					random,
				);
				for (const [rows, across] of throws) {
					const to = { row: row + rows, offset: current + across };
					if (to.row > shape.rows - 1) continue;
					if (Math.abs(to.offset) > rowHalfSpan(shape, to.row) + 1e-9) continue;
					if (Math.abs(targetOffset - to.offset) > stepsLeftFrom(to.row) * 0.5 + 1e-9) continue;
					if (gone(to.row, to.offset)) continue;
					if (flyable && !flyable({ row, offset: current }, to, gone)) continue;
					landing = to;
					break;
				}
				if (landing) break;
			}
			if (landing) {
				row = landing.row;
				current = landing.offset;
				contacts.push({ row, offset: current });
				continue;
			}
		}

		const limit = spanAfterRow(shape, row);
		const rowsLeft = shape.rows - row - 1;
		let steps = random() < 0.5 ? [-0.5, 0.5] : [0.5, -0.5];
		// The lean: the nearest bomb the ball could still walk to, and the step that goes its way.
		// Tried FIRST rather than taken — the same legality checks below still decide.
		const lure = [...live.values()]
			.filter(
				(candidate) =>
					candidate.row > row &&
					Math.abs(candidate.offset - current) <= (candidate.row - row) * 0.5 + 1e-9,
			)
			.sort((a, b) => a.row - b.row)[0];
		if (lure && random() < pull) {
			const towards = lure.offset === current ? steps[0] : Math.sign(lure.offset - current) * 0.5;
			steps = [towards, -towards];
		}
		let chosen: number | undefined;
		for (const step of steps) {
			const next = current + step;
			if (Math.abs(next) > limit + 1e-9) continue;
			if (Math.abs(targetOffset - next) > rowsLeft * 0.5 + 1e-9) continue;
			if (row + 1 < shape.rows && gone(row + 1, next)) continue;
			if (flyable && !flyable({ row, offset: current }, { row: row + 1, offset: next }, gone))
				continue;
			chosen = step;
			break;
		}
		current += chosen ?? (targetOffset > current ? 0.5 : -0.5);
		row += 1;
		contacts.push({ row, offset: current });
	}

	return contacts;
};
