import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const bin = resolve(repoRoot, 'node_modules/.bin/moba2d-check-seams');
const scriptPath = resolve(repoRoot, 'scripts/check-seams.mjs');
const packSpells = resolve(repoRoot, 'packs/riot');

/**
 * Fix round 1, MEDIUM 3: `check-seams.mjs` carried both bugs found and fixed
 * on `generate-spell-catalog.mjs` in the same round, unfixed here until now.
 *
 * 1. The self-invoke guard (`process.argv[1] === scriptPath`, a bare
 *    `resolve()`) never matches when this file is reached through the
 *    `node_modules/.bin/moba2d-check-seams` symlink — Node resolves
 *    `import.meta.url` to the symlink's real target but leaves
 *    `process.argv[1]` as the symlink path, so the CLI block silently never
 *    ran: no output, exit 0, regardless of how many violations the target
 *    actually has.
 * 2. `resolve(repoRoot, targetRoot)` resolved a CLI-supplied relative path
 *    against *this script's own* directory rather than the invoking
 *    shell's. The review's own repro is the second test below.
 */
describe('moba2d-check-seams bin', () => {
  it('exists as an executable npm-managed symlink', () => {
    expect(existsSync(bin)).toBe(true);
  });

  it('reports real violations when invoked through its bin symlink, not silently exiting 0', () => {
    const result = spawnSync(bin, ['./spells'], { cwd: packSpells, encoding: 'utf8' });

    expect(result.status).toBe(1);
    expect(result.stdout + result.stderr).toMatch(/violation\(s\)/);
  });

  it("resolves a relative target against the invoking directory, not against this script's own", () => {
    // The review's exact repro: `cd packs/riot && node ../../scripts/
    // check-seams.mjs ./spells`. Before the fix this threw ENOENT looking
    // for `<repoRoot>/spells`, which does not exist.
    const result = spawnSync('node', [scriptPath, './spells'], {
      cwd: packSpells,
      encoding: 'utf8',
    });

    expect(result.stderr).not.toMatch(/ENOENT/);
    expect(result.status).toBe(1);
    expect(result.stdout + result.stderr).toMatch(
      /violation\(s\) across \d+ file\(s\) scanned in \.\/spells/
    );
  });

  let cleanRoot: string | undefined;

  afterEach(async () => {
    if (cleanRoot) await rm(cleanRoot, { recursive: true, force: true });
    cleanRoot = undefined;
  });

  it('still finds a clean target clean, from a non-root directory', async () => {
    cleanRoot = await mkdtemp(join(tmpdir(), 'lol2d-check-seams-clean-'));
    await mkdir(join(cleanRoot, 'target'));
    await writeFile(join(cleanRoot, 'target', 'Nothing.ts'), 'export const nothing = 1;\n');

    const result = spawnSync(bin, ['./target'], { cwd: cleanRoot, encoding: 'utf8' });

    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/clean/);
  });
});
