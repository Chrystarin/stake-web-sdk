/**
 * Copy sample books from stake-math-sdk (One-Eyed Willy's Plinko / games/crimson_plinko) into Storybook fixtures.
 *
 * Usage (from apps/plinko):
 *   node scripts/import-math-books.mjs
 *   node scripts/import-math-books.mjs --limit 20
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const appRoot = join(__dirname, '..');
const limitArg = process.argv.find((a) => a.startsWith('--limit'));
const limit = limitArg
	? Number(limitArg.includes('=') ? limitArg.split('=')[1] : process.argv[process.argv.indexOf(limitArg) + 1])
	: 12;
if (!Number.isFinite(limit) || limit < 1) {
	console.error('Invalid --limit');
	process.exit(1);
}

const booksDir = join(appRoot, '../../../stake-math-sdk/games/crimson_plinko/library/books');
// One published book file per balls-per-drop tier (mode). Older single-mode `books_base`
// is a pre-split fallback only.
const TIER_MODES = ['baseone', 'baseten', 'basetwenty', 'basefifty'];

function loadMode(mode) {
	for (const ext of ['.json', '.jsonl']) {
		const p = join(booksDir, `books_${mode}${ext}`);
		if (!existsSync(p)) continue;
		const raw = readFileSync(p, 'utf8').trim();
		if (!raw) return [];
		return ext === '.jsonl'
			? raw.split('\n').filter(Boolean).map((line) => JSON.parse(line))
			: JSON.parse(raw);
	}
	return [];
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

/**
 * Cover every UI balls-per-drop tier and demonstrate features: one feature book per tier
 * (where available) + one base book per tier, then fill remaining slots in order.
 */
function sampleBooks(source, maxCount) {
	const picked = [];
	const take = (predicate) => {
		const match = source.find((book) => !picked.includes(book) && predicate(book));
		if (match) picked.push(match);
	};

	for (const tier of BALL_TIERS) {
		take((book) => ballsPerDropForBook(book) === tier && isFeatureBook(book));
	}
	for (const tier of BALL_TIERS) {
		take((book) => ballsPerDropForBook(book) === tier && !isFeatureBook(book));
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
