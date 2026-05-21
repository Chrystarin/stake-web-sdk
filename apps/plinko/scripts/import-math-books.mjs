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
const books = (
	booksPath.endsWith('.jsonl')
		? raw.split('\n').filter(Boolean).map((line) => JSON.parse(line))
		: JSON.parse(raw)
).slice(0, limit);

const eventsByType = {};
for (const book of books) {
	for (const ev of book.events ?? []) {
		if (!eventsByType[ev.type]) eventsByType[ev.type] = { ...ev, index: 0 };
	}
}

writeFileSync(join(outDir, 'base_books.ts'), `export default ${JSON.stringify(books, null, '\t')} as const;\n`);
writeFileSync(
	join(outDir, 'base_events.ts'),
	`export default ${JSON.stringify(eventsByType, null, '\t')} as const;\n`,
);

console.log(`Wrote ${books.length} books to src/stories/data/base_books.ts`);
console.log(`Event types: ${Object.keys(eventsByType).join(', ')}`);
