import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * `package.json`'s `exports` is the whole answer to "what may a content pack
 * import from core" — not a convention documented in a doc comment
 * somewhere, a field a reviewer can see move in a diff. Widening it (adding
 * a subpath, or pointing one at a different file) is a decision this test
 * forces to be deliberate: touch the list, touch this test.
 *
 * The original measured surface (`docs/superpowers/surveys/2026-08-22-...`)
 * was three content modules, all `import type`, plus `src/seams/` for the
 * seam-checker CLI, which is tooling rather than content API. Content-pack-
 * extraction batch 5 task 6 fix round 2 widened it by three, all the same
 * shape as `./seams` — build tooling a pack's own standalone `tsc` program
 * needs, not content API: `./tsconfig.base.json` (the shared compiler
 * options, and `@/*`, core's own internal alias — resolved relative to
 * *this* file's location regardless of who extends it, which is what lets a
 * pack's `tsconfig.json` reach it by package name instead of a `../../`
 * path into this checkout) and `./types/global.d.ts` /
 * `./types/poly-decomp.d.ts` (the ambient declarations — p5 in global mode,
 * the physics library's missing types — a pack's own strict typecheck needs
 * to see real types through `ContentApi`'s own internals, which are core's
 * unbundled source and import via `@/*` like the rest of this codebase).
 * `packs/riot/tsconfig.json`'s own header has the full account. Seven
 * subpaths and no more.
 */

const repoRoot = join(__dirname, '..', '..');
const packageJsonPath = join(repoRoot, 'package.json');

function readPackageJson(): Record<string, unknown> {
  return JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
}

describe('package.json public surface', () => {
  it('declares exports as exactly the seven content-pack-facing subpaths', () => {
    const pkg = readPackageJson();
    const exportsMap = pkg.exports as Record<string, string> | undefined;

    expect(exportsMap).toBeDefined();
    expect(Object.keys(exportsMap!).sort()).toEqual(
      [
        './content/ContentApi',
        './content/ContentPack',
        './content/types',
        './seams',
        './tsconfig.base.json',
        './types/global.d.ts',
        './types/poly-decomp.d.ts',
      ].sort()
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
