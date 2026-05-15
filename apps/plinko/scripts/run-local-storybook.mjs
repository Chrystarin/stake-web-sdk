/**
 * Verify math books exist, sync to Storybook fixtures, print next steps.
 * Run from repo root: node apps/plinko/scripts/run-local-storybook.mjs
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const appRoot = join(__dirname, '..');
const mathBooks = join(
	appRoot,
	'../../../stake-math-sdk/games/crimson_plinko/library/books/books_base.json',
);
const mathBooksAlt = join(
	appRoot,
	'../../../stake-math-sdk/games/crimson_plinko/library/books/books_base.jsonl',
);

if (!existsSync(mathBooks) && !existsSync(mathBooksAlt)) {
	console.error(`
Math books not found. Generate them first:

  cd ../../../stake-math-sdk
  pip install -e .
  python games/crimson_plinko/run.py

Then re-run this script or: pnpm run storybook --filter=plinko
`);
	process.exit(1);
}

const sync = spawnSync('node', ['scripts/import-math-books.mjs', '--limit', '20'], {
	cwd: appRoot,
	stdio: 'inherit',
});
if (sync.status !== 0) process.exit(sync.status ?? 1);

console.log(`
Storybook fixtures synced.

Start Storybook (from stake-web-sdk root):

  pnpm run storybook --filter=plinko

Open http://localhost:6005 and try:
  - MODE_BASE / book / random  (click Action — plays math book)
  - COMPONENTS / <PlinkoBoard> / board
  - COMPONENTS / <Game> / plinkoDrop (demo)
`);
