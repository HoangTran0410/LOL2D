import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const ROOT = join(__dirname, '../../');

const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

/** Resolve a `@/`-aliased or relative specifier to a file under src/. */
const resolveSpecifier = (from: string, specifier: string): string | null => {
  const base = specifier.startsWith('@/')
    ? join(ROOT, 'src', specifier.slice(2))
    : specifier.startsWith('.')
      ? resolve(dirname(from), specifier)
      : null;
  if (!base) return null;
  for (const candidate of [base, `${base}.ts`, join(base, 'index.ts')]) {
    if (existsSync(candidate) && candidate.endsWith('.ts')) return candidate;
  }
  return null;
};

/** Every module reachable from `entry` by a *value* import. */
const valueClosure = (entry: string): Set<string> => {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length) {
    const file = queue.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    const source = stripComments(readFileSync(file, 'utf8'));
    const pattern = /^\s*(?:import|export)\s+(type\s+)?[\s\S]*?\bfrom\s+'([^']+)'/gm;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(source)) !== null) {
      if (match[1]) continue; // `import type` is erased; it cannot pull code in.
      const target = resolveSpecifier(file, match[2]);
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
    // and into the pack — `bundledPack.ts` (an exception in
    // `corePacksBoundary.test.ts`) now reaches it by a relative
    // `../../packs/riot/maps/summonersRift` specifier, which this walk's
    // `resolveSpecifier` follows the same as any other relative import.
    expect(paths).toContain('packs/riot/maps/summonersRift.ts');
    const offenders = paths.filter(isGeometryModule);
    expect(offenders).toEqual([]);
  });
});
