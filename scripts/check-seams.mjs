/**
 * The CLI form of `@lol2d/core/seams` (`src/seams/index.ts`).
 *
 * Spec §8.1's pack-side command is `lol2d-check-seams ./src` — a pack's own
 * build step, checking a pack's own tree, failing a pack's own build. This
 * script is that command's working implementation. What it is *not*: an
 * installed `bin`, or a reason for `packs/riot/` to have a `package.json` —
 * both are ruled out for this task, and are batch 5's call once it decides
 * how packs are published. Until then, a pack (or this repo's own `packs/
 * riot/`) runs it as `node <path-to-core>/scripts/check-seams.mjs <root>`.
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
    const { checkSeams } = await server.ssrLoadModule('/src/seams/index.ts');
    const absoluteTarget = resolve(repoRoot, targetRoot);
    return checkSeams(absoluteTarget).map(violation => ({
      ...violation,
      // Report relative to the target root, which is what a violation's
      // `file` already is — kept here only for the summary's own path math.
      root: relative(repoRoot, absoluteTarget) || '.',
    }));
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
    .then(violations => {
      if (violations.length === 0) {
        console.log(`check-seams: clean (${targetRoot})`);
        return;
      }
      for (const v of violations) {
        console.error(`${v.seamId} :: ${v.root}/${v.file} :: ${v.message}`);
      }
      console.error(`check-seams: ${violations.length} violation(s) in ${targetRoot}`);
      process.exitCode = 1;
    })
    .catch(error => {
      console.error(error);
      process.exitCode = 1;
    });
}
