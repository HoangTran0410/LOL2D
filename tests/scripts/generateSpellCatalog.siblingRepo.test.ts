import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const bin = resolve(repoRoot, 'node_modules/.bin/moba2d-generate-spell-catalog');

let simRoot: string | undefined;

afterEach(async () => {
  if (simRoot) await rm(simRoot, { recursive: true, force: true });
  simRoot = undefined;
});

/**
 * Fix round 1 finding (HIGH 1): `PACK_SPELL_TREES.riot`'s paths used to be
 * hardcoded relative to *this script's own* directory — core's root, which
 * coincides with where the pack lives inside this monorepo, so every call
 * and every existing test passed for the wrong reason. The review's own
 * repro against `check-seams.mjs`'s identical shape (`cd packs/riot && node
 * ../../scripts/check-seams.mjs ./spells` → ENOENT) is what exposed it.
 *
 * This builds the one simulation that actually exercises the failure mode:
 * a copy of the pack's `spells/`, `vfx/` and `generated/assetManifest.ts` in
 * a directory that is not a descendant of this repository at all, with
 * `@moba2d/core` resolved through a `node_modules` symlink the way a real
 * `npm install` of a devDependency would create one — the fair simulation
 * of a sibling repository the review asked for. If the generator still
 * reached for `packs/riot/` under its own directory (the old bug), every
 * read here would 404/ENOENT against a path that does not exist in this
 * tree at all, since nothing here is nested under `packs/riot/`.
 */
describe('generate-spell-catalog against a pack outside this repository', () => {
  it('produces the checked-in output from a directory that is not this repo, via the installed bin, with --root supplied by the caller', async () => {
    simRoot = await mkdtemp(join(tmpdir(), 'lol2d-sibling-sim-'));
    await mkdir(join(simRoot, 'generated'));
    await mkdir(join(simRoot, 'node_modules', '@moba2d'), { recursive: true });
    await mkdir(join(simRoot, 'node_modules', '.bin'), { recursive: true });

    await cp(join(repoRoot, 'packs/riot/spells'), join(simRoot, 'spells'), { recursive: true });
    await cp(join(repoRoot, 'packs/riot/vfx'), join(simRoot, 'vfx'), { recursive: true });
    await cp(
      join(repoRoot, 'packs/riot/generated/assetManifest.ts'),
      join(simRoot, 'generated/assetManifest.ts')
    );
    // Stands in for `npm install`ing `@moba2d/core` as a devDependency in
    // a real sibling repository — both symlinks are exactly what npm
    // itself would create.
    await symlink(repoRoot, join(simRoot, 'node_modules/@moba2d/core'));
    await symlink(
      '../@moba2d/core/scripts/generate-spell-catalog.mjs',
      join(simRoot, 'node_modules/.bin/moba2d-generate-spell-catalog')
    );

    const result = spawnSync(
      join(simRoot, 'node_modules/.bin/moba2d-generate-spell-catalog'),
      ['--tree=riot', '--root=.'],
      { cwd: simRoot, encoding: 'utf8' }
    );

    expect(result.status, result.stderr || result.error?.message).toBe(0);

    const [expectedCatalog, expectedModules, actualCatalog, actualModules] = await Promise.all([
      readFile(join(repoRoot, 'packs/riot/generated/spellCatalog.ts'), 'utf8'),
      readFile(join(repoRoot, 'packs/riot/generated/spellModules.ts'), 'utf8'),
      readFile(join(simRoot, 'generated/spellCatalog.ts'), 'utf8'),
      readFile(join(simRoot, 'generated/spellModules.ts'), 'utf8'),
    ]);

    expect(actualCatalog).toBe(expectedCatalog);
    expect(actualModules).toBe(expectedModules);
  }, 30000);

  it('refuses a named tree without --root, rather than silently falling back to its own directory', () => {
    const result = spawnSync(bin, ['--check', '--tree=riot'], { cwd: repoRoot, encoding: 'utf8' });

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/--root=<path>/);
  });
});
