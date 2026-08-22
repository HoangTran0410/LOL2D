import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, lstatSync } from 'node:fs';
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

/** Exactly the file list `npm publish` would ship — npm's own `files` resolution, not ours. */
function publishedPaths(): string[] {
  const stdout = execFileSync('npm', ['pack', '--dry-run', '--json'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  const [{ files }] = JSON.parse(stdout) as [{ files: { path: string }[] }];
  return files.map(entry => entry.path);
}

/**
 * A sibling repository whose `@moba2d/core` is **the published package and
 * nothing more**.
 *
 * ## What the previous version of this file proved, and why that was worse
 * ## than proving nothing
 *
 * It built the same directory and then wrote
 * `symlink(repoRoot, join(simRoot, 'node_modules/@moba2d/core'))` — a link
 * back into this monorepo. Node resolves a symlinked package by its
 * *realpath*, so every bare specifier core's own code reached for was
 * answered out of this repository's `node_modules/`, core's
 * `devDependencies` included. The test therefore certified a property
 * ("`catalog:check` runs outside this monorepo") that was false at the time
 * it was written: with core installed from a real `npm pack` tarball, the
 * whole-branch review measured
 *
 *     failed to load config from …/node_modules/@moba2d/core/vite.config.ts
 *     Cannot find package '@vitejs/plugin-vue' imported from …vite.config.ts…
 *
 * then, once that was supplied by hand, `vite-plugin-pwa`. Both are core
 * *devDependencies*: `scripts/generate-spell-catalog.mjs` used to boot its
 * Vite server against core's own `vite.config.ts`, and nothing that config
 * imports travels in the tarball. The pack could not regenerate or verify
 * its own spell catalogue outside this monorepo — the one gate of its five
 * that could not — and the symlink is precisely what hid it.
 *
 * ## What this version does instead
 *
 * `node_modules/@moba2d/core` is a **real directory** holding exactly the
 * paths `npm pack --dry-run --json` reports, copied out of this repo. No
 * link back, so realpath resolution cannot escape into this repository's
 * dependency tree, and a file core ships an import of but not the file
 * itself fails here the way it would fail for a real consumer.
 *
 * Beside core sit exactly the packages a real `npm install` of this pack
 * would put there: core's own `dependencies`, and the `devDependencies`
 * `packs/riot/package.json` declares for itself (`vite` among them). What
 * the pack does not declare — and what a real install therefore does not
 * have — is `@vitejs/plugin-vue` or `vite-plugin-pwa`, and the first test
 * below asserts they stay unresolvable from inside the fixture, because
 * those two are the breaking point it exists to sit on.
 */
describe('generate-spell-catalog against a pack outside this repository', () => {
  async function buildSibling(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'lol2d-sibling-sim-'));
    const coreDir = join(root, 'node_modules/@moba2d/core');

    await mkdir(join(root, 'generated'), { recursive: true });
    await mkdir(join(root, 'node_modules', '.bin'), { recursive: true });
    await mkdir(coreDir, { recursive: true });

    // The pack's own tree — the three things this generator reads.
    await cp(join(repoRoot, 'packs/riot/spells'), join(root, 'spells'), { recursive: true });
    await cp(join(repoRoot, 'packs/riot/vfx'), join(root, 'vfx'), { recursive: true });
    await cp(
      join(repoRoot, 'packs/riot/generated/assetManifest.ts'),
      join(root, 'generated/assetManifest.ts')
    );

    // Core, as published: npm's own answer to "what ships", materialised as
    // real files rather than a link back to where they came from.
    for (const path of publishedPaths()) {
      await mkdir(dirname(join(coreDir, path)), { recursive: true });
      await cp(join(repoRoot, path), join(coreDir, path));
    }

    // What a real `npm install` of this pack would put beside core, and
    // nothing else: core's own `dependencies` (npm installs a dependency's
    // dependencies) plus `vite`, which `packs/riot/package.json` declares
    // in its **own** `devDependencies`. Read out of the manifests rather
    // than listed here, so adding a runtime dependency to core does not
    // quietly turn this fixture into a different fixture.
    //
    // Core's `devDependencies` are deliberately absent — that is the whole
    // point, and the guard above pins it. A link rather than a copy: npm
    // resolves a package by realpath too, so a linked package's own
    // dependencies resolve exactly as an installed one's would.
    const coreManifest = JSON.parse(
      await readFile(join(repoRoot, 'package.json'), 'utf8')
    ) as Record<string, Record<string, string>>;
    const packManifest = JSON.parse(
      await readFile(join(repoRoot, 'packs/riot/package.json'), 'utf8')
    ) as Record<string, Record<string, string>>;
    const installed = new Set([
      ...Object.keys(coreManifest.dependencies ?? {}),
      ...Object.keys(packManifest.devDependencies ?? {}).filter(name => name !== '@moba2d/core'),
    ]);
    for (const name of installed) {
      const source = join(repoRoot, 'node_modules', name);
      if (!existsSync(source)) continue; // a type-only devDependency npm may have pruned
      await mkdir(dirname(join(root, 'node_modules', name)), { recursive: true });
      await symlink(source, join(root, 'node_modules', name));
    }
    await symlink(
      '../@moba2d/core/scripts/generate-spell-catalog.mjs',
      join(root, 'node_modules/.bin/moba2d-generate-spell-catalog')
    );

    return root;
  }

  it("installs core as real published files, with none of core's devDependencies reachable", async () => {
    simRoot = await buildSibling();
    const coreDir = join(simRoot, 'node_modules/@moba2d/core');

    // If this ever becomes a link again, every assertion below stops
    // meaning what it says — see this file's own header.
    expect(lstatSync(coreDir).isSymbolicLink()).toBe(false);

    for (const devDependency of ['@vitejs/plugin-vue', 'vite-plugin-pwa']) {
      const probe = spawnSync(
        process.execPath,
        ['-e', `require.resolve(${JSON.stringify(devDependency)})`],
        { cwd: coreDir, encoding: 'utf8' }
      );
      expect(probe.status, `${devDependency} resolved from inside the fixture`).not.toBe(0);
    }
  }, 60000);

  it('produces the checked-in output from a directory that is not this repo, via the installed bin, with --root supplied by the caller', async () => {
    simRoot = await buildSibling();

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
  }, 120000);

  it('refuses a named tree without --root, rather than silently falling back to its own directory', () => {
    const result = spawnSync(bin, ['--check', '--tree=riot'], { cwd: repoRoot, encoding: 'utf8' });

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/--root=<path>/);
  });
});
