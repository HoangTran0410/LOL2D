#!/usr/bin/env node
/**
 * The CLI form of `@moba2d/core/seams` (`src/seams/index.ts`), and the
 * working implementation of spec §8.1's pack-side command
 * `moba2d-check-seams ./src` — a pack's own build step, checking a pack's
 * own tree, failing a pack's own build.
 *
 * `package.json`'s `bin` now points here, but that alone does not put it on
 * anyone's `PATH`: Task 4 of the content-pack extraction is what adds the
 * workspace link that makes `moba2d-check-seams` resolve as a bare command,
 * and Task 6 is where a pack actually invokes it. Until a workspace links
 * it, a pack (or this repo's own `packs/riot/`) runs it as
 * `node <path-to-core>/scripts/check-seams.mjs <root>`.
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
    const absoluteTarget = resolve(repoRoot, targetRoot);
    const violations = checkSeams(absoluteTarget).map(violation => ({
      ...violation,
      // Report relative to the target root, which is what a violation's
      // `file` already is — kept here only for the summary's own path math.
      root: relative(repoRoot, absoluteTarget) || '.',
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

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
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
