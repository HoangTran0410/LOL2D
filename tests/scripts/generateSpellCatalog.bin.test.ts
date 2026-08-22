import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const bin = resolve(root, 'node_modules/.bin/moba2d-generate-spell-catalog');

/**
 * `scripts/generate-spell-catalog.mjs`'s self-invoke guard used to compare
 * `process.argv[1]` against `import.meta.url` with a bare `resolve()`. That
 * comparison silently fails when the file is reached through the
 * npm-managed `node_modules/.bin/` symlink `package.json`'s `bin` field
 * creates: Node resolves `import.meta.url` (this file's `scriptPath`) to
 * the symlink's real target, but leaves `process.argv[1]` as the symlink
 * path itself, so the two never compare equal — the CLI block silently
 * never runs, and the process exits 0 having done nothing. Confirmed by
 * hand against `scripts/check-seams.mjs`'s own bin (`moba2d-check-seams`),
 * which still uses the bare comparison and reproduces exactly this: no
 * output, exit 0, on a real target.
 *
 * A plain function import (`tests/scripts/generateSpellCatalog.tree.test.ts`)
 * cannot see this class of bug — it never goes through the bin symlink at
 * all. Only running the actual installed bin as a subprocess can, so that
 * is what this file does.
 */
describe('moba2d-generate-spell-catalog bin', () => {
  it('exists as an executable npm-managed symlink', () => {
    expect(existsSync(bin)).toBe(true);
  });

  /**
   * `--tree=does-not-exist` is the fast, discriminating case: that branch
   * reports and sets `process.exitCode = 1` before ever booting the Vite
   * server `generateSpellCatalog` needs, so this proves the CLI block
   * actually executed without paying for a real catalogue build. The
   * silent-no-op bug exits 0 on every input, including this one — it can't
   * fake a report it never reads the arguments to produce.
   */
  it('reports an unknown tree when invoked through its bin symlink, proving the CLI block ran', () => {
    const result = spawnSync(bin, ['--check', '--tree=does-not-exist'], {
      cwd: root,
      encoding: 'utf8',
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/unknown spell tree/i);
  });
});
