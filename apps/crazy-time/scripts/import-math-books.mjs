/**
 * Copy a sample of Crazy Time math books into the app for offline dev / preview play.
 *
 * There is one book set per published mode (one per spot combination, 252 of them), so the
 * output is keyed by mode: the
 * dev harness has to play a book from the SAME mode the board committed to.
 *
 * The published books are zstd-compressed, so we shell out to the math-sdk Python venv
 * (which has `zstandard`) to decompress + sample, then write a plain TS module.
 *
 * Usage (from apps/crazy-time):
 *   node scripts/import-math-books.mjs [--limit 14]      # per mode (252 modes x 14 = ~3.5k books)
 */
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(__dirname, '..');
const repoRoot = resolve(appDir, '..', '..');
const mathRoot = resolve(repoRoot, '..', 'stake-math-sdk');

const limitArg = process.argv.indexOf('--limit');
const limit = limitArg > -1 ? Number(process.argv[limitArg + 1]) : 14;

const publishDir = join(mathRoot, 'games', 'crazy_time', 'library', 'publish_files');
if (!existsSync(publishDir)) {
	console.error(
		`[Crazy Time] Missing published math books: ${publishDir}\n` +
			`Run from stake-math-sdk: PYTHONPATH=. env/Scripts/python.exe games/crazy_time/run.py`,
	);
	process.exit(1);
}

const modeFiles = readdirSync(publishDir)
	.filter((name) => /^books_.+\.jsonl\.zst$/.test(name))
	.map((name) => ({ mode: name.slice('books_'.length, -'.jsonl.zst'.length), file: join(publishDir, name) }))
	.sort((a, b) => a.mode.localeCompare(b.mode));

if (!modeFiles.length) {
	console.error(`[Crazy Time] No per-mode book files found in ${publishDir}`);
	process.exit(1);
}

const pythonCandidates = [
	join(mathRoot, 'env', 'Scripts', 'python.exe'),
	join(mathRoot, 'env', 'bin', 'python'),
	'python',
	'python3',
];
const python = pythonCandidates.find(
	(candidate) => candidate === 'python' || candidate === 'python3' || existsSync(candidate),
);

const outDir = join(appDir, 'src', 'stories', 'data');
mkdirSync(outDir, { recursive: true });
const outFile = join(outDir, 'base_books.ts');

// Sample a varied set per mode: every room, a Top Slot hit, the max win, then a weighted spread
// of ordinary rounds, so offline play exercises everything the client has to draw. Books are
// enumerated (not sampled) in the math, so a plain stride would over-represent rare outcomes;
// the spread here is drawn in proportion to the lookup-table weights instead.
// The mode list goes through a temp file: 252 paths inline would blow Windows' 32 KB command line.
const specFile = join(tmpdir(), 'crazy-time-book-spec.json');
writeFileSync(specFile, JSON.stringify(modeFiles.map(({ mode, file }) => [mode, file])));
const pyScript = `
import json, zstandard, sys, os, random, bisect
limit = ${Number.isFinite(limit) ? limit : 14}
spec = json.load(open(${JSON.stringify(specFile)}))
d = zstandard.ZstdDecompressor()
random.seed(7)
out = {}
for mode, path in spec:
    with open(path, "rb") as f:
        data = d.stream_reader(f).read().decode("utf-8")
    books = [json.loads(l) for l in data.splitlines() if l.strip()]
    lut = os.path.join(os.path.dirname(path), f"lookUpTable_{mode}_0.csv")
    weights = {}
    with open(lut) as f:
        for line in f:
            i, w, p = line.strip().split(",")
            weights[int(i)] = int(w)
    def kinds(b):
        ks = set()
        for e in b["events"]:
            t = e.get("type", "")
            if t.endswith("Bonus"): ks.add(t)
            if t == "wheelSpin" and e.get("topSlotApplied"): ks.add("topslot")
        return ks
    picked, seen = [], set()
    def take(b):
        if b["id"] not in seen:
            seen.add(b["id"]); picked.append(b)
    # one of each kind, preferring books that were covered (so the room actually pays)
    for want in ("piratePlinkoRoom", "bonusWheelRoom", "chestRoom", "oceanVoyageRoom", "topslot"):
        cands = [b for b in books if want in kinds(b)]
        cands.sort(key=lambda b: -b["payoutMultiplier"])
        covered = [b for b in cands if b["payoutMultiplier"] > 0]
        pool = covered or cands
        if pool:
            take(random.choice(pool[: max(1, len(pool) // 4)]))
    top = max(books, key=lambda b: b["payoutMultiplier"])
    take(top)
    # weighted spread of the rest
    ids = [b["id"] for b in books]
    cum, total = [], 0
    for i in ids:
        total += weights.get(i, 1); cum.append(total)
    by_id = {b["id"]: b for b in books}
    tries = 0
    while len(picked) < limit and tries < limit * 50:
        tries += 1
        r = random.randrange(total)
        take(by_id[ids[bisect.bisect_right(cum, r)]])
    out[mode] = picked[:limit]
sys.stdout.write(json.dumps(out))
`;

const result = spawnSync(python, ['-c', pyScript], { maxBuffer: 512 * 1024 * 1024 });
if (result.status !== 0) {
	console.error('[Crazy Time] Failed to read books via Python.', result.stderr?.toString());
	process.exit(1);
}

const booksByMode = JSON.parse(result.stdout.toString());
writeFileSync(
	outFile,
	`// AUTO-GENERATED by scripts/import-math-books.mjs: do not edit.\n` +
		`// Offline sample books, keyed by bet mode (ticket).\n` +
		`export default ${JSON.stringify(booksByMode)} as const;\n`,
);

const total = Object.values(booksByMode).reduce((sum, list) => sum + list.length, 0);
const eventTypes = [
	...new Set(
		Object.values(booksByMode)
			.flat()
			.flatMap((book) => (book.events ?? []).map((event) => event.type)),
	),
];
console.log(
	`[Crazy Time] Wrote ${total} books across ${Object.keys(booksByMode).length} modes ` +
		`to src/stories/data/base_books.ts`,
);
console.log(`[Crazy Time] Event types: ${eventTypes.join(', ')}`);
