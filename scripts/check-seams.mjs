#!/usr/bin/env node
/**
 * The CLI form of `@moba2d/core/seams` (`src/seams/index.ts`), and the
 * working implementation of spec §8.1's pack-side command
 * `moba2d-check-seams ./src` — a pack's own build step, checking a pack's
 * own tree, failing a pack's own build.
 *
 * `package.json`'s `bin` field points here and the workspace link that
 * makes `moba2d-check-seams` resolve as a bare command already exists — but
 * two real bugs, both found in content-pack-extraction batch 5 task 5's fix
 * round 1, meant that bare command did nothing:
 *
 * 1. **The self-invoke guard.** `process.argv[1] === scriptPath` compared
 *    the raw argv path against `import.meta.url`'s resolved real path.
 *    Invoked through the `node_modules/.bin/moba2d-check-seams` symlink,
 *    Node resolves `import.meta.url` to the symlink's real target but
 *    leaves `process.argv[1]` as the symlink path itself — the two never
 *    compared equal, so this whole block silently never ran: no output, no
 *    error, exit 0, on a target with real violations. `realpathSync` below
 *    is the fix; `scripts/generate-spell-catalog.mjs` has the identical
 *    pattern and the same fix, found first there.
 *
 * 2. **The target root.** `resolve(repoRoot, targetRoot)` resolved a
 *    CLI-supplied relative path against *this script's own* directory —
 *    core's root — rather than against wherever the invoking shell actually
 *    stood. Inside this monorepo, `cd packs/riot && node ../../scripts/
 *    check-seams.mjs ./spells` and `node scripts/check-seams.mjs
 *    packs/riot/spells` happen to name the same directory relative to
 *    `repoRoot`, so this passed every test that invoked it from the repo
 *    root — but the first form is exactly how a pack (or a sibling
 *    repository) actually calls it, and it threw ENOENT. A bare `resolve()`
 *    resolves against `process.cwd()`, which is the only meaning "the
 *    current directory" can have when this script is a devDependency
 *    installed somewhere else entirely.
 *
 * `src/seams/index.ts` is plain TypeScript with no p5/browser dependency —
 * just `node:fs` — but it lives under `src/`, which is not run directly by
 * Node. This loads it the same way `scripts/generate-spell-catalog.mjs`
 * loads spell barrels: Vite's SSR module graph, so `@/` aliases resolve and
 * the loaded module is real compiled TypeScript, not a hand-rolled reimplementation.
 *
 *   node scripts/check-seams.mjs ./packs/riot/spells
 *
 * Exits 1 and prints one line per violation if any seam finds one; exits 0
 * and prints a summary otherwise.
 */
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { realpathSync } from 'node:fs';
import { createServer } from 'vite';

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(scriptPath), '..');

export async function runCheckSeams(targetRoot) {
  const server = await createServer({
    root: repoRoot,
    configFile: resolve(repoRoot, 'vite.config.ts'),
    logLevel: 'error',
    server: { middlewareMode: true, hmr: false },
    appType: 'custom',
  });

  try {
    const { checkSeams, scannedSeamFiles } = await server.ssrLoadModule('/src/seams/index.ts');
    // Resolved against the invoking shell's own directory, not this
    // script's — `resolve()` with a single argument is `process.cwd()`.
    // This is the fix for fix round 1's HIGH 1-shaped bug: the old
    // `resolve(repoRoot, targetRoot)` answered "where is `targetRoot`
    // relative to core's own checkout", which is not what a CLI argument
    // means once this script is installed somewhere other than where it is
    // invoked from.
    const absoluteTarget = resolve(targetRoot);
    const violations = checkSeams(absoluteTarget).map(violation => ({
      ...violation,
      // Report relative to the target root, which is what a violation's
      // `file` already is — kept here only for the summary's own path math.
      root: relative(process.cwd(), absoluteTarget) || '.',
    }));
    // Every seam walks the same tree `checkSeams` just did; this is that
    // same walk, done once more, so the summary can say how much ground it
    // covered. Without it, an empty `violations` array reads as "clean" for
    // both a genuinely clean root and a root that does not exist (or whose
    // every file matched `skip`) — indistinguishable to whoever is reading
    // the CLI's own default output.
    const scannedCount = scannedSeamFiles(absoluteTarget).length;
    return { violations, scannedCount };
  } finally {
    await server.close();
  }
}

// `realpathSync`, not a bare `resolve()` — see this file's own header for
// why: reached through the `node_modules/.bin/` symlink, `process.argv[1]`
// stays the symlink path while `scriptPath` is already resolved to the
// real file, and a plain string comparison never matches.
function invokedDirectly() {
  const invoked = process.argv[1];
  if (!invoked) return false;
  try {
    return realpathSync(resolve(invoked)) === scriptPath;
  } catch {
    return resolve(invoked) === scriptPath;
  }
}

if (invokedDirectly()) {
  const targetRoot = process.argv[2];
  if (!targetRoot) {
    console.error('usage: node scripts/check-seams.mjs <root>');
    process.exit(2);
  }

  runCheckSeams(targetRoot)
    .then(({ violations, scannedCount }) => {
      if (violations.length === 0) {
        console.log(`check-seams: scanned ${scannedCount} file(s), clean (${targetRoot})`);
        return;
      }
      for (const v of violations) {
        console.error(`${v.seamId} :: ${v.root}/${v.file} :: ${v.message}`);
      }
      console.error(
        `check-seams: ${violations.length} violation(s) across ${scannedCount} file(s) scanned in ${targetRoot}`
      );
      process.exitCode = 1;
    })
    .catch(error => {
      console.error(error);
      process.exitCode = 1;
    });
}
