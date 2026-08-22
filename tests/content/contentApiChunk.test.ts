import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { scanImports } from '@/seams/importScan';
import { packIsInstalled } from '../support/installedPacks';

const ROOT = join(__dirname, '../../');

/**
 * Resolve a `@/`-aliased, relative, or `@moba2d/content-*` specifier to a file
 * on disk.
 *
 * The third form is batch 5 task 8's and it is not optional decoration: that
 * task moved core's reach into the riot pack behind
 * `src/generated/installedPacks.ts`, which names the pack by *package* name
 * (`@moba2d/content-riot/pack`) so the specifier keeps resolving once the pack
 * is a repository of its own. A walk that only followed `@/` and `./` would
 * simply have stopped at the barrel — and stopping is silent: the geometry
 * guard below would have gone on passing while covering nothing of the pack at
 * all. `realpathSync` is what turns the resolved `node_modules/@moba2d/...`
 * path back into this monorepo's own `packs/riot/...`, so the assertions below
 * read the same either way.
 */
const resolveSpecifier = (from: string, specifier: string): string | null => {
  const base = specifier.startsWith('@/')
    ? join(ROOT, 'src', specifier.slice(2))
    : specifier.startsWith('.')
      ? resolve(dirname(from), specifier)
      : specifier.startsWith('@moba2d/content-')
        ? join(ROOT, 'node_modules', specifier)
        : null;
  if (!base) return null;
  for (const candidate of [base, `${base}.ts`, join(base, 'index.ts')]) {
    if (existsSync(candidate) && candidate.endsWith('.ts')) return realpathSync(candidate);
  }
  return null;
};

/**
 * Every module reachable from `entry` by a *value* import.
 *
 * Fix round 3 replaced this walk's own inline regex — the exact original,
 * single-quote-only `import`/`export ... from` matcher two earlier rounds
 * had already found and fixed two holes in over in
 * `corePacksBoundary.test.ts` — with `src/seams/importScan.ts`'s
 * `scanImports`. Deliberately still narrower than that module's full
 * surface: this walk only ever followed static `from`-clause *value*
 * imports (never `import type`, never a side-effect import, never a
 * dynamic `import()`), and keeps exactly that scope rather than silently
 * widening what it follows the moment a shared parser makes the other
 * kinds easy to reach for.
 */
const valueClosure = (entry: string): Set<string> => {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length) {
    const file = queue.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    const source = readFileSync(file, 'utf8');
    for (const { specifier, kind } of scanImports(source)) {
      if (kind !== 'value') continue;
      const target = resolveSpecifier(file, specifier);
      if (target) queue.push(target);
    }
  }
  return seen;
};

describe('the data half of the pack contract', () => {
  const closure = valueClosure(join(ROOT, 'src/content/catalog.ts'));

  it('walked a real graph', () => {
    expect(closure.size).toBeGreaterThan(3);
  });

  it('does not reach ContentApi, and so does not reach the engine', () => {
    const offenders = [...closure].filter(
      file => file.endsWith('src/content/ContentApi.ts') || file.includes('/src/game/gameObject/')
    );
    expect(offenders.map(f => f.slice(ROOT.length))).toEqual([]);
  });

  /**
   * The structural version of "a map lists without pulling its geometry in".
   * `summonersRift.ts` itself belongs in this closure — it is the eager
   * summary `bundledPack.ts` lists — but its geometry sits behind a dynamic
   * `import('./summonersRiftGeometry')`, which this walk's regex only
   * matches on static `import ... from` / `export ... from`, so a module that
   * genuinely reaches the geometry statically shows up here. That is what
   * stops a later task quietly importing the polygons back into the listing
   * path.
   *
   * The offender test is `f.endsWith('Geometry.ts')`, not
   * `f.includes('/content/maps/')`: `catalog.ts`'s closure already crosses
   * out of `src/` into `packs/reference/` (`install.ts`'s static import of
   * `packs/reference/pack.ts`, which this walk's `resolveSpecifier` follows
   * same as any relative import), so `provingGroundsGeometry.ts` living
   * under `packs/reference/` rather than `src/content/maps/` would have
   * passed the old, path-anchored filter even if pulled in statically.
   * `isGeometryModule` below is exercised directly, against a synthetic
   * `packs/`-rooted path, so that claim does not rest on nothing in the
   * repo happening to import it that way today.
   */
  const isGeometryModule = (f: string): boolean => f.endsWith('Geometry.ts');

  it('the offender test itself catches a geometry module under packs/, not just src/content/maps/', () => {
    expect(isGeometryModule('src/content/maps/summonersRiftGeometry.ts')).toBe(true);
    expect(isGeometryModule('packs/reference/provingGroundsGeometry.ts')).toBe(true);
    expect(isGeometryModule('packs/some-other-pack/ArenaGeometry.ts')).toBe(true);
    expect(isGeometryModule('src/content/maps/summonersRift.ts')).toBe(false);
  });

  it('reaches a map summary but never its geometry module', () => {
    const paths = [...closure].map(f => f.slice(ROOT.length));
    // Batch 4 task 6 moved Summoner's Rift's map out of `src/content/maps/`
    // and into the pack; batch 5 task 8 moved core's reach into that pack
    // behind `src/generated/installedPacks.ts`'s `@moba2d/content-riot/pack`
    // — which `resolveSpecifier` above follows and realpaths back to this
    // path. Only asserted when that pack is actually installed: with it moved
    // out of the tree there is no Summoner's Rift summary to reach, and the
    // real claim of this test is the `offenders` line below, which holds for
    // whatever maps a checkout does have.
    if (packIsInstalled('riot')) expect(paths).toContain('packs/riot/maps/summonersRift.ts');
    expect(paths).toContain('packs/reference/map.ts');
    const offenders = paths.filter(isGeometryModule);
    expect(offenders).toEqual([]);
  });
});
