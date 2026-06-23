/**
 * Copy sample books from stake-math-sdk (One-Eyed Willy's Plinko / games/crimson_plinko) into Storybook fixtures.
 *
 * Usage (from apps/plinko):
 *   node scripts/import-math-books.mjs
 *   node scripts/import-math-books.mjs --limit 20
 */
import { existsSync, writeFileSync, mkdirSync, openSync, readSync, closeSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Published libraries can be 100s of MB / GBs (100k+ books) — too large for readFileSync (Node's max
// string length). We only need a small sample, so read just the first chunk of the file and pull out
// complete book objects from it.
const MAX_BOOKS_PER_MODE = 30000;
const HEAD_BYTES = 80 * 1024 * 1024; // 80 MB — well under the string limit, holds tens of thousands of books

/** Read up to `HEAD_BYTES` from a file as UTF-8 (handles arbitrarily large files). */
function readHead(path) {
	const fd = openSync(path, 'r');
	try {
		const buf = Buffer.alloc(HEAD_BYTES);
		const n = readSync(fd, buf, 0, HEAD_BYTES, 0);
		return buf.subarray(0, n).toString('utf8');
	} finally {
		closeSync(fd);
	}
}

/** Extract complete top-level `{...}` book objects from a (possibly truncated) JSON array / JSONL
 * string via brace-counting (string-aware), up to `maxBooks`. Works for both `.json` and `.jsonl`. */
function extractBooks(str, maxBooks) {
	const books = [];
	let depth = 0;
	let inStr = false;
	let esc = false;
	let start = -1;
	for (let i = 0; i < str.length; i++) {
		const c = str[i];
		if (inStr) {
			if (esc) esc = false;
			else if (c === '\\') esc = true;
			else if (c === '"') inStr = false;
			continue;
		}
		if (c === '"') inStr = true;
		else if (c === '{') {
			if (depth === 0) start = i;
			depth += 1;
		} else if (c === '}') {
			depth -= 1;
			if (depth === 0 && start >= 0) {
				try {
					books.push(JSON.parse(str.slice(start, i + 1)));
				} catch {
					/* truncated / malformed trailing object */
				}
				start = -1;
				if (books.length >= maxBooks) break;
			}
		}
	}
	return books;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const appRoot = join(__dirname, '..');
const limitArg = process.argv.find((a) => a.startsWith('--limit'));
const limit = limitArg
	? Number(limitArg.includes('=') ? limitArg.split('=')[1] : process.argv[process.argv.indexOf(limitArg) + 1])
	: 24;
if (!Number.isFinite(limit) || limit < 1) {
	console.error('Invalid --limit');
	process.exit(1);
}

const booksDir = join(appRoot, '../../../stake-math-sdk/games/crimson_plinko/library/books');
// One published book file per balls-per-drop tier (mode). Older single-mode `books_base`
// is a pre-split fallback only.
const TIER_MODES = ['onedrop', 'tendrop', 'twentydrop', 'fiftydrop'];

function loadMode(mode) {
	// Prefer the freshest books file by mtime among the formats that exist (.json array / .jsonl lines).
	const candidates = [`books_${mode}.json`, `books_${mode}.jsonl`]
		.map((name) => join(booksDir, name))
		.filter(existsSync);
	if (candidates.length === 0) return [];
	candidates.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
	return extractBooks(readHead(candidates[0]), MAX_BOOKS_PER_MODE);
}

let allBooks = TIER_MODES.flatMap(loadMode);
if (allBooks.length === 0) {
	allBooks = loadMode('base'); // legacy single-mode fallback
}

if (allBooks.length === 0) {
	console.warn(
		`[sync-math-books] No math books for One-Eyed Willy's Plinko at ${booksDir}. Run stake-math-sdk: python games/crimson_plinko/run.py`,
	);
	process.exit(0);
}

const outDir = join(appRoot, 'src/stories/data');
mkdirSync(outDir, { recursive: true });

const BALL_TIERS = [1, 10, 20, 50];
const FEATURE_EVENT_TYPES = new Set(['freeSpinTrigger', 'bonusRoulette', 'bonusRound']);

function ballsPerDropForBook(book) {
	const drop = (book.events ?? []).find((event) => event.type === 'plinkoDrop');
	return drop?.ballsPerDrop ?? drop?.outcomes?.length ?? 0;
}

function isFeatureBook(book) {
	return (book.events ?? []).some((event) => FEATURE_EVENT_TYPES.has(event.type));
}
// A free spin landing on BONUS also emits `bonusRoulette` (the chain). For a clean "bonus" sample we
// want METER-triggered bonus books (bonus meter fills → roulette), NOT free-spin→BONUS chains.
const isChainBonus = (book) =>
	(book.events ?? []).some(
		(e) => e.type === 'freeSpinTrigger' && String(e.segment ?? '').toUpperCase() === 'BONUS',
	);
const hasBonus = (book) =>
	(book.events ?? []).some((e) => e.type === 'bonusRoulette') && !isChainBonus(book);
const hasFreeSpin = (book) => (book.events ?? []).some((e) => e.type === 'freeSpinTrigger');

/**
 * DEV/test fixtures only (does NOT affect published RTP — that comes from the LUT). To make features
 * easy to test in dev-local play, cover BOTH feature types per tier and weight the sample heavily
 * toward features: per tier take 2 bonus + 2 free-spin (none on 1-ball) + 1 base book, then fill.
 */
function sampleBooks(source, maxCount) {
	const picked = [];
	const take = (predicate, n = 1) => {
		let added = 0;
		for (const book of source) {
			if (added >= n) break;
			if (!picked.includes(book) && predicate(book)) {
				picked.push(book);
				added += 1;
			}
		}
	};

	for (const tier of BALL_TIERS) {
		take((book) => ballsPerDropForBook(book) === tier && hasBonus(book), 2);
		take((book) => ballsPerDropForBook(book) === tier && hasFreeSpin(book), 2);
		take((book) => ballsPerDropForBook(book) === tier && !isFeatureBook(book), 1);
	}
	for (const book of source) {
		if (picked.length >= maxCount) break;
		if (!picked.includes(book)) picked.push(book);
	}

	return picked.slice(0, maxCount);
}

const books = sampleBooks(allBooks, limit);

writeFileSync(join(outDir, 'base_books.ts'), `export default ${JSON.stringify(books, null, '\t')} as const;\n`);

const eventTypes = [...new Set(books.flatMap((book) => (book.events ?? []).map((ev) => ev.type)))];
const tierCounts = Object.fromEntries(
	BALL_TIERS.map((tier) => [tier, books.filter((book) => ballsPerDropForBook(book) === tier).length]),
);
console.log(`Wrote ${books.length} books to src/stories/data/base_books.ts`);
console.log(`Balls-per-drop tiers in sample: ${JSON.stringify(tierCounts)}`);
console.log(`Event types: ${eventTypes.join(', ')}`);
