import { stateBet } from 'state-shared';

import { playBet } from './utils';
import type { Bet, BookEvent, BookEventRoom } from './typesBookEvent';
import { stateGame } from './stateGame.svelte';
import {
	BUY_MODES,
	CHEST_VALUES,
	PLINKO_SLOTS,
	TOP_SLOT_MULTS,
	VOYAGE_DEPTHS,
	WHEEL_LAYOUT,
	isBuyMode,
	modeCost,
} from './constants';
import books from '../stories/data/base_books';

type RawBook = { events?: Bet['state']; state?: Bet['state']; payoutMultiplier?: number };
type BooksByMode = Record<string, RawBook[]>;

/**
 * `?force=` shorthand -> the room's book event. Lowercase on purpose: `readForce` lowercases what
 * the URL carries, so these are dev words typed by hand rather than the spots' own keys.
 */
const ROOM_EVENT: Record<string, string> = {
	plinko: 'piratePlinkoRoom',
	wheel: 'bonusWheelRoom',
	chest: 'chestRoom',
	voyage: 'oceanVoyageRoom',
};

/**
 * Play a math book locally when no RGS session is configured (dev / preview).
 *
 * The book MUST come from the mode the board committed to: each ticket has its own book set,
 * and a book from another ticket would pay the wrong spots.
 *
 * `?force=<kind>` (or `?bonus=<room>`) narrows the pick; see docs/dev-debug.md.
 */
export async function playDevLocalBook(): Promise<void> {
	const byMode = books as unknown as BooksByMode;
	const mode = stateBet.activeBetModeKey;
	const modeBooks = byMode[mode];

	if (!modeBooks?.length) {
		console.warn(
			`[crazy-time] No local books for mode "${mode}". Run the math ` +
				`(stake-math-sdk games/crazy_time), then: pnpm --filter crazy-time sync-math-books`,
		);
		stateGame.rolling = false;
		return;
	}

	const raw = pickBook(modeBooks, readForce(), readMult());
	const bet = { state: raw.events ?? raw.state ?? [] } as Bet;

	// The player is charged amount x cost: one chip per covered spot, or the buy's price.
	const stake = modeCost(mode) * stateBet.betAmount;
	stateBet.balanceAmount = Math.max(0, stateBet.balanceAmount - stake);
	stateBet.winBookEventAmount = 0;

	await playBet(bet);

	// Book amounts are payout x100 in units of `amount` (the chip), so the cash win scales by
	// betAmount, NOT by the total stake, which cost already accounts for.
	const winCash = (stateBet.winBookEventAmount / 100) * stateBet.betAmount;
	stateBet.balanceAmount = stateBet.balanceAmount + winCash;
	stateGame.rolling = false;
}

type Force = { kind: string; value: number | null } | null;

const readForce = (): Force => {
	if (typeof window === 'undefined') return null;
	const params = new URLSearchParams(window.location.search);
	const raw = params.get('force') ?? params.get('bonus');
	if (!raw) return null;
	const [kind, value] = raw.toLowerCase().split(':');
	return { kind, value: value !== undefined && value !== '' ? Number(value) : null };
};

/**
 * The room a `?force=` names, or null. `bonus` counts, since it means “any room”.
 *
 * Only the dev auto-start reads this: getting to a room by hand means placing a bet and spinning
 * every single time, which is a lot of clicking to look at one screen. A live session never gets
 * here — the parameters do nothing with an `rgs_url`, and the caller checks that too.
 */
export const forcedRoomKind = (): string | null => {
	const force = readForce();
	if (!force) return null;
	return force.kind === 'bonus' || ROOM_EVENT[force.kind] ? force.kind : null;
};

/** `?buy=` shorthand -> the buy mode. The mode keys themselves (`buy_pp`, …) work too. */
const BUY_WORD: Record<string, string> = {
	any: 'buy_any',
	bonus: 'buy_any',
	plinko: 'buy_pp',
	wheel: 'buy_bw',
	chest: 'buy_tc',
	voyage: 'buy_ov',
};

/**
 * The buy mode a `?buy=` names, or null. Like a forced room, only the dev auto-start reads it:
 * on load it buys that bonus at the current chip, skipping the Yes/No prompt.
 */
export const forcedBuyMode = (): string | null => {
	if (typeof window === 'undefined') return null;
	const raw = new URLSearchParams(window.location.search).get('buy')?.toLowerCase();
	if (!raw) return null;
	const mode = isBuyMode(raw) ? raw : BUY_WORD[raw];
	if (!mode) {
		console.warn(
			`[crazy-time] ?buy=${raw}: not a buy; use ${Object.keys(BUY_WORD).join(', ')} or ${Object.keys(BUY_MODES).join(', ')}`,
		);
		return null;
	}
	return mode;
};

/**
 * `?mult=<x>`: what the bonus should pay, in chips (the multiplier on the win line). The picked
 * book's room is rewritten to land there — see `payExactly`.
 */
const readMult = (): number | null => {
	if (typeof window === 'undefined') return null;
	const raw = new URLSearchParams(window.location.search).get('mult');
	if (raw === null || raw === '') return null;
	const mult = Number(raw);
	if (!Number.isFinite(mult) || mult <= 0) {
		console.warn(`[crazy-time] ?mult=${raw}: not a positive number; ignored`);
		return null;
	}
	return mult;
};

const eventsOf = (book: RawBook): BookEvent[] => (book.events ?? book.state ?? []) as BookEvent[];

const roomOf = (book: RawBook) =>
	eventsOf(book).find((e): e is Extract<BookEvent, { multiplier: number; total: number }> =>
		e.type.endsWith('Room'),
	);

const matches = (book: RawBook, kind: string): boolean => {
	const events = eventsOf(book);
	const payout = book.payoutMultiplier ?? 0;
	switch (kind) {
		case 'bonus':
			return events.some((e) => e.type.endsWith('Room'));
		case 'number':
			return !events.some((e) => e.type.endsWith('Room'));
		case 'topslot':
			return events.some((e) => e.type === 'wheelSpin' && e.topSlotApplied);
		case 'win':
			return payout > 0;
		case 'loss':
			return payout === 0;
		default:
			return ROOM_EVENT[kind] ? events.some((e) => e.type === ROOM_EVENT[kind]) : false;
	}
};

const pickBook = (modeBooks: RawBook[], force: Force, mult: number | null = null): RawBook => {
	const book = pickByForce(modeBooks, force, mult);
	return mult === null ? book : payExactly(book, mult);
};

const random = <T>(pool: T[]): T => pool[Math.floor(Math.random() * pool.length)];

const pickByForce = (modeBooks: RawBook[], force: Force, mult: number | null): RawBook => {
	if (mult !== null) modeBooks = booksForMult(modeBooks, mult);
	if (!force) return random(modeBooks);

	if (force.kind === 'maxwin') {
		return modeBooks.reduce((best, book) =>
			(book.payoutMultiplier ?? 0) > (best.payoutMultiplier ?? 0) ? book : best,
		);
	}

	let pool = modeBooks.filter((book) => matches(book, force.kind));
	if (!pool.length) {
		console.warn(
			`[crazy-time] ?force=${force.kind}: no sampled book of that kind for this ticket; playing a random one`,
		);
		return random(modeBooks);
	}
	if (force.value !== null && ROOM_EVENT[force.kind]) {
		const exact = pool.filter((book) => roomOf(book)?.multiplier === force.value);
		if (exact.length) pool = exact;
		else
			console.warn(
				`[crazy-time] ?force=${force.kind}:${force.value}: no sampled book with that value; playing any ${force.kind}`,
			);
	}
	return random(pool);
};

// --- `?mult=` -------------------------------------------------------------------------------

/** Every value each room can land on before the Top Slot. */
const ROOM_BASES: Record<string, readonly number[]> = {
	piratePlinkoRoom: PLINKO_SLOTS,
	bonusWheelRoom: WHEEL_LAYOUT,
	chestRoom: CHEST_VALUES,
	oceanVoyageRoom: VOYAGE_DEPTHS,
};

type Split = { base: number; topSlot: number };

/** How `type` pays exactly `win`: room value x Top Slot, no Top Slot if it can, else the biggest room value. */
const splitWin = (type: string, win: number): Split | null => {
	const bases = [...new Set(ROOM_BASES[type] ?? [])].sort((a, b) => b - a);
	if (bases.includes(win)) return { base: win, topSlot: 1 };
	for (const base of bases)
		for (const topSlot of TOP_SLOT_MULTS) if (base * topSlot === win) return { base, topSlot };
	return null;
};

/** The payout `type` can reach that is nearest `win` (by ratio), for a `?mult=` it cannot pay. */
const nearestSplit = (type: string, win: number): Split => {
	let best: Split = { base: ROOM_BASES[type][0], topSlot: 1 };
	for (const base of new Set(ROOM_BASES[type]))
		for (const topSlot of [1, ...TOP_SLOT_MULTS]) {
			const off = Math.abs(Math.log((base * topSlot) / win));
			if (off < Math.abs(Math.log((best.base * best.topSlot) / win))) best = { base, topSlot };
		}
	return best;
};

/**
 * The books worth rewriting for `?mult=`: ones with a room, and of those the ones whose room can
 * pay the figure exactly (so Random Bonus lands in a room that can). The number-only books are
 * dropped because there is no bonus to steer.
 */
const booksForMult = (modeBooks: RawBook[], mult: number): RawBook[] => {
	const withRoom = modeBooks.filter((book) => roomOf(book));
	if (!withRoom.length) {
		console.warn(`[crazy-time] ?mult=${mult}: this ticket has no sampled bonus round; ignored`);
		return modeBooks;
	}
	const exact = withRoom.filter((book) => splitWin(roomOf(book)!.type, mult));
	return exact.length ? exact : withRoom;
};

/**
 * A copy of `book` whose room pays `win` chips: the room lands on the value, the Top Slot on the
 * room is set (or cleared) to make up the rest, and the paytable the room draws, the win line and
 * the round total all follow. Dev only — the RGS book is never touched. A figure the room cannot
 * pay is rounded to the nearest one it can, with a warning.
 */
const payExactly = (source: RawBook, win: number): RawBook => {
	const book = structuredClone(source);
	const events = eventsOf(book);
	const room = roomOf(book) as BookEventRoom | undefined;
	if (!room) return book;

	let split = splitWin(room.type, win);
	if (!split) {
		split = nearestSplit(room.type, win);
		console.warn(
			`[crazy-time] ?mult=${win}: ${room.type} cannot pay that; playing ${split.base * split.topSlot}` +
				(split.topSlot > 1 ? ` (${split.base} x Top Slot ${split.topSlot})` : ''),
		);
	}
	const { base, topSlot } = split;
	const total = base * topSlot;
	const scale = (values: readonly number[]) => values.map((value) => value * topSlot);
	const indexOf = (values: readonly number[]) =>
		random(values.flatMap((value, index) => (value === base ? [index] : [])));

	// The paytable a room draws carries the Top Slot already.
	switch (room.type) {
		case 'piratePlinkoRoom':
			room.board = scale(PLINKO_SLOTS);
			room.slot = indexOf(PLINKO_SLOTS);
			break;
		case 'bonusWheelRoom':
			room.wedges = scale(WHEEL_LAYOUT);
			room.wedge = indexOf(WHEEL_LAYOUT);
			break;
		case 'chestRoom':
			// Decoys keep their room values, rescaled from the book's old Top Slot to the new one.
			room.chests = room.chests.map((value) => (value / room.topSlotMultiplier) * topSlot);
			room.chests[room.opened] = total;
			break;
		case 'oceanVoyageRoom': {
			room.depths = scale(VOYAGE_DEPTHS);
			room.dived = VOYAGE_DEPTHS.indexOf(base as (typeof VOYAGE_DEPTHS)[number]) + 1;
			const tiles = room.tilesPerDepth;
			room.path = Array.from({ length: room.dived }, (_, depth) => room.path[depth] ?? depth % tiles);
			// A clean surfacing only at the bottom; otherwise the kraken ends it one depth lower.
			room.krakenTile = room.dived === VOYAGE_DEPTHS.length ? null : random([...Array(tiles).keys()]);
			break;
		}
	}
	room.multiplier = base;
	room.topSlotMultiplier = topSlot;
	room.total = total;

	const wheel = events.find((e) => e.type === 'wheelSpin');
	const spot = wheel?.spot;
	if (wheel) {
		wheel.topSlotApplied = topSlot > 1;
		wheel.multiplier = topSlot;
	}
	const reels = events.find((e) => e.type === 'topSlot');
	if (reels && topSlot > 1) {
		reels.spot = spot ?? reels.spot;
		reels.multiplier = topSlot;
	} else if (reels && reels.spot === spot) {
		reels.spot = null;
		reels.multiplier = null;
	}

	let paid = 0;
	for (const event of events) {
		if (event.type !== 'winInfo') continue;
		if (event.spot === spot) {
			event.baseValue = base;
			event.topSlotMultiplier = topSlot;
			event.totalWin = event.covered ? Math.round(total * 100) : 0;
		}
		paid += event.totalWin;
	}
	for (const event of events)
		if (event.type === 'setTotalWin' || event.type === 'finalWin') event.amount = paid;
	book.payoutMultiplier = paid;
	return book;
};

/**
 * Offline stand-in for `/bet/replay` (`?replay=true&mode=<ticket>` with no `rgs_url`): the sampled
 * book whose id is `event`, else one `?force=` picks, else any. Null when the mode has no books.
 */
export const devReplayBook = (
	mode: string,
	event: string,
): { state: BookEvent[]; payoutMultiplier: number; mode: string } | null => {
	const modeBooks = (books as unknown as BooksByMode)[mode];
	if (!modeBooks?.length) return null;
	const byId = (modeBooks as (RawBook & { id?: number })[]).find(
		(book) => event !== '' && String(book.id) === event,
	);
	const raw = byId ?? pickBook(modeBooks, readForce(), readMult());
	// Sampled books carry the lookup table's figure (x100); the RGS sends the multiplier itself.
	return { state: eventsOf(raw), payoutMultiplier: (raw.payoutMultiplier ?? 0) / 100, mode };
};
