#!/usr/bin/env node
/**
 * Measures whether an edit under `src/game/` re-hashes spell chunks it has
 * no business touching.
 *
 * ## The bug this catches
 *
 * Before batch 4, every `spell-*.js` chunk carried `from "./game-<hash>.js"`
 * — a static import of the core game chunk *by its hashed filename*. Vite
 * hashes a chunk's filename from its own bytes, so any change under
 * `src/game/` re-hashes `game-*.js`, and every chunk that statically imports
 * it by name has to be re-emitted (a new hash, even if that chunk's own
 * source did not change) just to update the string literal pointing at the
 * new filename. A returning player's browser then re-downloads dozens of
 * files it already had, and `workbox-precaching` installs changed entries
 * strictly sequentially (`GoogleChrome/workbox#2528`), which is why a normal
 * deploy took 19 seconds before the update prompt became actionable.
 *
 * The content-pack migration's prediction: a pack spell now imports
 * `@/content/types` only as a *type* — erased at compile time — and takes
 * everything else through its factory's `api` argument. No runtime import
 * of core means no static edge for Rollup to hash-link, means a `src/game/`
 * edit should leave every `spell-*.js` filename exactly as it was.
 *
 * This script is how that prediction gets checked against the actual built
 * output rather than trusted from the source graph: build, make one real
 * edit under `src/game/`, build again, and diff the emitted filenames.
 * Reading the *built* chunk's own import list is also how `check-chunks.mjs`
 * catches the sibling failure mode — a `manualChunks` path rule can defeat a
 * dynamic import silently, so a clean source graph is not proof of a clean
 * chunk graph.
 *
 * Deliberately outside `npm run verify`: it builds twice, and `verify` is
 * already the long pole. Run on demand:
 *
 *   npm run e2e:chunk-cascade
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const assetsDir = join(root, 'dist', 'assets');

/**
 * The file mutated to stand in for "a real change under `src/game/`".
 * `Game.ts` lands in the `game` manualChunks bucket (the catch-all
 * `id.includes('/src/game/')` rule in `vite.config.ts`, ahead of nothing
 * more specific for this file), which is exactly the chunk `spell-*.js`
 * files used to statically import by hash.
 */
const PROBE_FILE = join(root, 'src', 'game', 'Game.ts');
const PROBE_MARKER = '__CHUNK_CASCADE_PROBE__';
const PROBE_ANCHOR = 'export default class Game {';
// A top-level, side-effecting statement — not a comment, and not a bare
// `export const` a tree-shaker could drop as unreferenced. `console.log`
// with a non-literal argument can never be proven dead by esbuild/Rollup's
// minifier, so this is guaranteed to change the emitted chunk's bytes
// without changing anything the game actually does before it is reverted.
const PROBE_STATEMENT = `console.log('${PROBE_MARKER}', Math.random());\n\n`;

/** Every emitted `.js` chunk in `dist/assets`, sorted for a stable diff. */
export function listJsAssets(dir) {
  return readdirSync(dir)
    .filter(name => name.endsWith('.js'))
    .sort();
}

/** The per-champion (and shared) spell chunks — the ones under test. */
export function spellChunks(files) {
  return files.filter(name => /^spell-.+\.js$/.test(name));
}

/**
 * Set difference by filename. Vite's filenames carry a content hash, so a
 * chunk whose bytes moved shows up as one name leaving `before` and a
 * different name (same logical chunk) entering `after` — a like-for-like
 * rename, not a genuine add+remove. `removed.length === added.length` is
 * the normal case; anything else means the split itself changed shape.
 */
export function changedFilenames(before, after) {
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  return {
    removed: before.filter(name => !afterSet.has(name)),
    added: after.filter(name => !beforeSet.has(name)),
  };
}

/** The numbers the report cares about, computed from two `dist/assets` snapshots. */
export function summarize(before, after) {
  const beforeSpell = spellChunks(before);
  const afterSpell = spellChunks(after);
  const allDiff = changedFilenames(before, after);
  const spellDiff = changedFilenames(beforeSpell, afterSpell);
  return {
    totalChunks: before.length,
    totalChanged: allDiff.removed.length,
    changedNames: allDiff.removed,
    spellChunks: beforeSpell.length,
    spellChanged: spellDiff.removed.length,
    changedSpellNames: spellDiff.removed,
  };
}

function build(label) {
  console.log(`\n--- build (${label}) ---`);
  execFileSync('npm', ['run', 'build'], { cwd: root, stdio: 'inherit' });
}

async function main() {
  const original = readFileSync(PROBE_FILE, 'utf8');
  if (original.includes(PROBE_MARKER)) {
    console.error(
      `${PROBE_FILE} already contains the probe marker — a previous run did not clean up. ` +
        'Restore it with `git checkout -- src/game/Game.ts` and re-run.'
    );
    process.exitCode = 1;
    return;
  }
  if (!original.includes(PROBE_ANCHOR)) {
    console.error(`${PROBE_FILE} no longer contains "${PROBE_ANCHOR}" — update PROBE_ANCHOR.`);
    process.exitCode = 1;
    return;
  }

  try {
    build('baseline');
    const before = listJsAssets(assetsDir);

    writeFileSync(PROBE_FILE, original.replace(PROBE_ANCHOR, PROBE_STATEMENT + PROBE_ANCHOR));
    console.log(`\nMutated ${PROBE_FILE} (inserted a real, reverted-after console.log).`);

    build('after a src/game/ edit');
    const after = listJsAssets(assetsDir);

    const result = summarize(before, after);

    console.log('\n--- chunk cascade report ---');
    console.log(`total .js chunks before edit: ${result.totalChunks}`);
    console.log(`total .js chunks that changed filename: ${result.totalChanged}`);
    if (result.changedNames.length) {
      for (const name of result.changedNames) console.log(`  - ${name}`);
    }
    console.log(`spell-*.js chunks before edit: ${result.spellChunks}`);
    console.log(`spell-*.js chunks that changed filename: ${result.spellChanged}`);

    if (result.spellChanged > 0) {
      console.error(
        '\nFAIL: a src/game/ edit re-hashed spell chunks it should have no static edge to:'
      );
      for (const name of result.changedSpellNames) console.error(`  - ${name}`);
      console.error(
        '\nThat is a surviving static import from a pack spell into core. Read the emitted ' +
          "chunk's own import list (grep 'from\"./' in the old spell-*.js file) to find it — " +
          'do not reason from the source graph alone.'
      );
      process.exitCode = 1;
    } else {
      console.log(
        '\nPASS: every spell-*.js filename survived a src/game/ edit — the chunk-hash cascade is dead.'
      );
    }
  } finally {
    writeFileSync(PROBE_FILE, original);
    console.log(`\nRestored ${PROBE_FILE}.`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
