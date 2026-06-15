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
const candidates = [join(booksDir, 'books_base.jsonl'), join(booksDir, 'books_base.json')];
const booksPath = candidates.find((p) => existsSync(p));

if (!booksPath) {
	console.warn(
		`[sync-math-books] No math books for One-Eyed Willy's Plinko at ${booksDir}. Run stake-math-sdk: python games/crimson_plinko/run.py`,
	);
	process.exit(0);
}

const outDir = join(appRoot, 'src/stories/data');
mkdirSync(outDir, { recursive: true });

const raw = readFileSync(booksPath, 'utf8').trim();
const allBooks = booksPath.endsWith('.jsonl')
	? raw.split('\n').filter(Boolean).map((line) => JSON.parse(line))
	: JSON.parse(raw);

const BALL_TIERS = [1, 10, 20, 50];

function ballsPerDropForBook(book) {
	const drop = (book.events ?? []).find((event) => event.type === 'plinkoDrop');
	return drop?.ballsPerDrop ?? drop?.outcomes?.length ?? 0;
}

/** Prefer at least one book per UI balls-per-drop tier, then fill remaining slots in order. */
function sampleBooks(source, maxCount) {
	const picked = [];
	const seenTiers = new Set();

	for (const tier of BALL_TIERS) {
		const match = source.find(
			(book) => !picked.includes(book) && ballsPerDropForBook(book) === tier,
		);
		if (match) {
			picked.push(match);
			seenTiers.add(tier);
		}
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
