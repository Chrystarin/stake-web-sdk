# One-Eyed Willy's Plinko (frontend)

Svelte 5 + PixiJS client for **One-Eyed Willy's Plinko** (`one_eyed_willys_plinko`). Outcomes come from RGS/math books in [`stake-math-sdk`](../../../stake-math-sdk/games/crimson_plinko); the client only renders book events.

Monorepo setup and architecture: [stake-web-sdk README](../../README.md).

## Prerequisites

- **Node** `>=22.16.0`, **pnpm** `10.5.0` (see root `package.json`)
- From repo root: `pnpm install`
- Optional for Storybook/local books: generated math books in `stake-math-sdk/games/crimson_plinko/library/books/`

## Ports

| Mode       | Port |
| ---------- | ---- |
| Dev server | 3003 |
| Storybook  | 6005 |

## Commands (from repo root)

Use `--filter=plinko` so Turbo runs this app and builds workspace deps (e.g. `pixi-svelte`).

```bash
# Development (http://localhost:3003)
pnpm run dev --filter=plinko

# Production build → apps/plinko/build/
pnpm run build --filter=plinko

# Serve the production build locally
pnpm run preview --filter=plinko

# Storybook (syncs math books first via prestorybook)
pnpm run storybook --filter=plinko

# Lint / format
pnpm run lint --filter=plinko
pnpm run format --filter=plinko
```

## Commands (from `apps/plinko`)

```bash
pnpm run dev
pnpm run build
pnpm run preview
pnpm run storybook
pnpm run lint
pnpm run format
pnpm run sync-math-books
```

## Production build output

After `pnpm run build --filter=plinko`:

- **Upload folder:** `apps/plinko/build/` (static site from `@sveltejs/adapter-static`)
- Entry: `build/index.html` plus `build/_app/`, `build/img/`, `build/i18n/`, etc.
- `paths.relative` is enabled in `svelte.config.js` so assets work on Stake Engine CDN subpaths.

`build/` and `.svelte-kit/` are gitignored; regenerate before each Engine upload.

### Stake Engine upload

1. Run a fresh build (above).
2. In [Stake Engine](https://engine.stake.com/), open the game **Files** page and import the entire `build/` folder.
3. Publish **Front End**, then test via **Developer → Start game session → Launch in New Tab**.
4. Copy the session query string into local dev URL to test against RGS.

## Math books & Storybook fixtures

Storybook and local dev can play math books without RGS when fixtures exist.

**Generate books (math repo):**

```bash
cd ../../../stake-math-sdk
pip install -e .
python games/crimson_plinko/run.py
```

**Sync into this app** (writes `src/stories/data/base_books.ts` and `base_events.ts`):

```bash
# from apps/plinko
pnpm run sync-math-books
# optional limit
node scripts/import-math-books.mjs --limit 20
```

**One-shot check + sync + instructions:**

```bash
# from stake-web-sdk root
node apps/plinko/scripts/run-local-storybook.mjs
```

Storybook runs `import-math-books.mjs` automatically via the `prestorybook` script.

Useful Storybook entries:

- `MODE_BASE` / book / random — play a synced math book
- `COMPONENTS` / PlinkoBoard, Game, etc.

## Local dev without RGS

With synced `base_books.ts`, dev can drive rounds from fixture books (see `src/game/devLocalBet.ts`). Without books, sync math first or use Storybook.

## Maintenance scripts

| Script | Purpose |
| ------ | ------- |
| `scripts/import-math-books.mjs` | Copy sample books from `stake-math-sdk` into Storybook data |
| `scripts/run-local-storybook.mjs` | Verify math books exist, sync, print Storybook URL |
| `scripts/port-plinko-engine.mjs` | Regenerate `src/plinko-engine/PlinkoEngine.ts` from legacy source |
| `scripts/port-meter-engines.mjs` | Port meter UI from legacy Angular (`crimson-plinko`) |

## Rebuild shared packages

If you change `packages/pixi-svelte` or other workspace libraries:

```bash
pnpm run build --filter=pixi-svelte
```

Turbo usually builds `^build` dependencies automatically when you build or dev plinko.

## Game config

- Provider / game IDs: `src/game/config.ts` (`one_eyed_willy` / `one_eyed_willys_plinko`)
- Book handlers: `src/game/bookEventHandlerMap.ts`
- Pixi board: `src/plinko-engine/PlinkoEngine.ts`, `src/components/PlinkoBoard.svelte`

## Related repos

| Repo | Role |
| ---- | ---- |
| `stake-math-sdk/games/crimson_plinko` | Authoritative math & book generation |
| `ThirdPartyClients/Crash/crimson-plinko` | Legacy Angular reference (port scripts only) |
