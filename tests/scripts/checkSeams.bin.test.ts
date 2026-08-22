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
 *
 * The first two regressions below used to point at `packs/riot/spells` for a
 * target guaranteed to have *some* violation — true when this file was
 * written, false since content-pack-extraction batch 5 task 6 gave the pack
 * its own `seam-debt.mjs` (`packs/riot/seam-debt.mjs`) and wired
 * `packs/riot`'s own `check-seams` script to run clean by default. A
 * regression test asserting on a real pack's *debt count* is exactly the
 * kind of fixture this repo's own notes warn about — it silently stops
 * proving what it says the moment someone pays down the debt, and worse, it
 * would make root `npm run verify` depend on the content pack's own
 * cleanliness (proven the hard way while writing task 6: a first draft of
 * the last test below did exactly that, spawning the bin against the real
 * `packs/riot/spells`, and `npm run verify` went red the moment a violation
 * was planted there for Step 2's own proof — the precise "seam has not
 * moved, it has been copied" failure task 6 exists to rule out). Both now
 * plant a real violation into a synthetic `mkdtemp` tree instead, same as
 * "still finds a clean target clean" below, and prove the same two
 * regressions against a fixture that cannot drift.
 */
describe('moba2d-check-seams bin', () => {
  it('exists as an executable npm-managed symlink', () => {
    expect(existsSync(bin)).toBe(true);
  });

  let violationRoot: string | undefined;
  let cleanRoot: string | undefined;

  afterEach(async () => {
    if (violationRoot) await rm(violationRoot, { recursive: true, force: true });
    violationRoot = undefined;
    if (cleanRoot) await rm(cleanRoot, { recursive: true, force: true });
    cleanRoot = undefined;
  });

  it('reports real violations when invoked through its bin symlink, not silently exiting 0', async () => {
    violationRoot = await mkdtemp(join(tmpdir(), 'lol2d-check-seams-violation-'));
    await mkdir(join(violationRoot, 'target'));
    await writeFile(join(violationRoot, 'target', 'Bad.ts'), `owner.stats.mana.baseValue -= 10;\n`);

    const result = spawnSync(bin, ['./target'], { cwd: violationRoot, encoding: 'utf8' });

    expect(result.status).toBe(1);
    expect(result.stdout + result.stderr).toMatch(/violation\(s\)/);
  });

  it("resolves a relative target against the invoking directory, not against this script's own", async () => {
    // The review's exact repro shape: `cd <some dir> && node <elsewhere>/
    // check-seams.mjs ./target`, invoking the script by a path outside the
    // target's own directory. Before the fix this resolved `./target`
    // against the script's own directory and threw ENOENT.
    violationRoot = await mkdtemp(join(tmpdir(), 'lol2d-check-seams-cwd-'));
    await mkdir(join(violationRoot, 'target'));
    await writeFile(join(violationRoot, 'target', 'Bad.ts'), `owner.stats.mana.baseValue -= 10;\n`);

    const result = spawnSync('node', [scriptPath, './target'], {
      cwd: violationRoot,
      encoding: 'utf8',
    });

    expect(result.stderr).not.toMatch(/ENOENT/);
    expect(result.status).toBe(1);
    expect(result.stdout + result.stderr).toMatch(
      /violation\(s\) across \d+ file\(s\) scanned in \.\/target/
    );
  });

  it('still finds a clean target clean, from a non-root directory', async () => {
    cleanRoot = await mkdtemp(join(tmpdir(), 'lol2d-check-seams-clean-'));
    await mkdir(join(cleanRoot, 'target'));
    await writeFile(join(cleanRoot, 'target', 'Nothing.ts'), 'export const nothing = 1;\n');

    const result = spawnSync(bin, ['./target'], { cwd: cleanRoot, encoding: 'utf8' });

    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/clean/);
  });

  it('discovers a sibling seam-debt.mjs and suppresses the debt it declares (the mechanism packs/riot/seam-debt.mjs uses for real)', async () => {
    // Deliberately synthetic, not `packs/riot/spells` — a regression test
    // asserting on a real pack's current debt count is exactly the fixture
    // this repo's own notes warn about (see this file's header): it stops
    // proving anything the moment someone pays the real debt down, and
    // worse, it would make root `npm run verify` depend on the *content*
    // pack's cleanliness — the "seam has not moved, it has been copied"
    // failure content-pack-extraction batch 5 task 6 exists to rule out.
    // This proves the mechanism (`loadPackSeamDebt` in `check-seams.mjs`)
    // in isolation instead: a sibling `seam-debt.mjs`, one directory above
    // the scanned root, discovered and honoured through the real bin.
    violationRoot = await mkdtemp(join(tmpdir(), 'lol2d-check-seams-debt-'));
    await mkdir(join(violationRoot, 'target'));
    await writeFile(join(violationRoot, 'target', 'Bad.ts'), `owner.stats.mana.baseValue -= 10;\n`);
    await writeFile(
      join(violationRoot, 'seam-debt.mjs'),
      `export const seamDebt = { skip: new Set(['Bad.ts']) };\n`
    );

    const result = spawnSync(bin, ['./target'], { cwd: violationRoot, encoding: 'utf8' });

    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/clean/);
  });
});
