import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * `package.json`'s `exports` is the whole answer to "what may a content pack
 * import from core" — not a convention documented in a doc comment
 * somewhere, a field a reviewer can see move in a diff. Widening it (adding
 * a fifth subpath, or pointing one at a different file) is a decision this
 * test forces to be deliberate: touch the list, touch this test.
 *
 * The measured surface (`docs/superpowers/surveys/2026-08-22-...`) is three
 * modules, all `import type`, plus `src/seams/` for the seam-checker CLI,
 * which is tooling rather than content API. That is exactly these four
 * subpaths and no more.
 */

const repoRoot = join(__dirname, '..', '..');
const packageJsonPath = join(repoRoot, 'package.json');

function readPackageJson(): Record<string, unknown> {
  return JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
}

describe('package.json public surface', () => {
  it('declares exports as exactly the four content-pack-facing subpaths', () => {
    const pkg = readPackageJson();
    const exportsMap = pkg.exports as Record<string, string> | undefined;

    expect(exportsMap).toBeDefined();
    expect(Object.keys(exportsMap!).sort()).toEqual(
      ['./content/ContentApi', './content/ContentPack', './content/types', './seams'].sort()
    );
  });

  it('points every exports target at a file that exists on disk', () => {
    const pkg = readPackageJson();
    const exportsMap = pkg.exports as Record<string, string> | undefined;

    expect(exportsMap).toBeDefined();
    for (const [specifier, target] of Object.entries(exportsMap!)) {
      const absoluteTarget = join(repoRoot, target);
      expect(existsSync(absoluteTarget), `${specifier} -> ${target} does not exist on disk`).toBe(
        true
      );
    }
  });

  it('is named @moba2d/core', () => {
    const pkg = readPackageJson();
    expect(pkg.name).toBe('@moba2d/core');
  });

  it('declares exactly two bins: moba2d-check-seams and moba2d-generate-spell-catalog', () => {
    const pkg = readPackageJson();
    const bin = pkg.bin as Record<string, string> | undefined;

    expect(bin).toBeDefined();
    expect(bin).toEqual({
      'moba2d-check-seams': './scripts/check-seams.mjs',
      'moba2d-generate-spell-catalog': './scripts/generate-spell-catalog.mjs',
    });
    for (const target of Object.values(bin!)) {
      expect(existsSync(join(repoRoot, target)), `${target} does not exist on disk`).toBe(true);
    }
  });
});
