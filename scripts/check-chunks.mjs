/**
 * Asserts the chunk graph in `dist/` actually has the shape `vite.config.ts`
 * intends. Runs after `build`, in `verify`.
 *
 * ## Why a build-level check, when two source scans already exist
 *
 * `menuBootPath.test.ts` and `pregameBootPath.test.ts` read `src/` and ban the
 * imports that would collapse the split. They are necessary and they are not
 * sufficient, because twice now the split has collapsed with the source
 * perfectly clean:
 *
 *  - `DomUtils` is imported by both the menu and the match. Left unassigned,
 *    Rollup put the shared module in `game`, so `MenuScene`'s chunk imported
 *    one helper out of a megabyte.
 *  - Vite's own `__vitePreload` runtime is not in `src/` at all. Once
 *    `spellModules.ts` arrived with 238 dynamic imports, it was assigned to
 *    `game` — and the menu imported *that*, dragging the match back in.
 *
 * Neither is visible from any file a human wrote. Both are obvious here.
 *
 *   node scripts/check-chunks.mjs
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const assets = join(root, 'dist', 'assets');

/** Static `import ... from "./x.js"` only — a dynamic import is the point of the split. */
function staticDeps(file) {
  const source = readFileSync(join(assets, file), 'utf8');
  return [...new Set([...source.matchAll(/from"\.\/([A-Za-z0-9_.-]+\.js)"/g)].map(m => m[1]))];
}

function chunk(prefix) {
  // The trailing token is Vite's content hash, whose base64url alphabet
  // includes `-` and `_` — so match anything up to `.js`, not `[^-]+`, or a
  // hash that happens to contain a hyphen (e.g. `MenuScene-7Yhb0-MG.js`) reads
  // as zero chunks and fails a perfectly good split at random.
  const found = readdirSync(assets).filter(name => new RegExp(`^${prefix}-[^.]+\\.js$`).test(name));
  if (found.length !== 1) {
    throw new Error(`expected exactly one ${prefix}-*.js chunk, found ${found.length}`);
  }
  return found[0];
}

/** Each rule is "this chunk must not *statically* reach that family". */
const RULES = [
  {
    chunk: 'MenuScene',
    forbidden: /^game-/,
    why: 'the menu would fetch and parse the whole match before drawing a logo',
  },
  {
    chunk: 'SetupScene',
    forbidden: /^game-/,
    why: 'the pregame screen renders a roster from generated data and needs no spell classes',
  },
  {
    chunk: 'game',
    forbidden: /^spell-/,
    why: 'spell chunks are fetched per champion by `spellRegistry`; a static edge loads all of them',
  },
];

const failures = [];

for (const rule of RULES) {
  const file = chunk(rule.chunk);
  const offenders = staticDeps(file).filter(dep => rule.forbidden.test(dep));
  if (offenders.length) {
    failures.push(`${file} statically imports ${offenders.join(', ')} — ${rule.why}`);
  }
}

// The spell split only means anything while it is actually many chunks: a
// `manualChunks` rule that stops matching returns one big one and nothing else
// would notice.
const spellChunks = readdirSync(assets).filter(name => /^spell-.+\.js$/.test(name));
if (spellChunks.length < 40) {
  failures.push(
    `only ${spellChunks.length} spell-*.js chunks — the per-champion split is not applying`
  );
}

if (failures.length) {
  console.error('Chunk graph regressed:\n' + failures.map(line => `  - ${line}`).join('\n'));
  process.exitCode = 1;
} else {
  console.log(
    `chunks ok: menu and pregame stay off the match chunk, ${spellChunks.length} per-champion spell chunks`
  );
}
