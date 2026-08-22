import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { packIsInstalled } from '../../support/installedPacks';

/**
 * No geometry may be computed at module-eval time.
 *
 * `lanes.ts` and `LaneObjectives.ts` used to build their derived tables once,
 * at module load, on the grounds that the game shipped exactly one map —
 * `RED_LANE_WAYPOINTS` reversed `LANE_WAYPOINTS` once; `GEOMETRY` was an IIFE
 * building per-lane arc-length tables. Both were correct then. Neither
 * survives a map chosen per match: a module-scope computation runs once for
 * the whole process, before any pack has installed a map, and the second test
 * in a file to pick a different one gets the first map's geometry forever.
 *
 * A scan rather than a lint rule, for the same reason the other seams in this
 * repo are scans (`packBoundary.test.ts`, `mana-spend-seam.test.ts`,
 * `dash-onupdate-seam.test.ts`): milliseconds, and it closes the whole class
 * of mistake rather than the one instance that got caught.
 *
 * Comments are stripped before matching — both files *document* the rule
 * being enforced here, at length, and a scan that flags its own explanation
 * is a scan someone deletes.
 */
const ROOT = join(__dirname, '../../..');

/**
 * `packs/riot/maps/summonersRiftGeometry.ts` and
 * `packs/reference/provingGroundsGeometry.ts` — a content pack's own map
 * geometry — landed after this scan's original three-file list and were
 * never added to it, even though both assemble a `MapGeometry` (`lanes`
 * included) at their own module scope, exactly the shape this scan exists
 * to police. Neither happens to trip either regex today (their top-level
 * `const`s call a plain function, not a `.map()`/`.reverse()`/IIFE derived
 * table), but "does not currently violate the rule" and "is covered by the
 * rule" are different claims — a future edit introducing the historical
 * bug pattern here would ship unseen without this.
 *
 * `summonersRiftGeometry.ts` moved from `src/content/maps/` into
 * `packs/riot/maps/` by batch 4 task 6, which split its `DEFAULT_LANE_WAYPOINTS`
 * off `src/game/lanes.ts` and relocated it there too — the scan still
 * covers the same module, just at its new path.
 */
/**
 * Core's own three, plus one geometry module per installed pack.
 *
 * `packs/riot/maps/summonersRiftGeometry.ts` used to be an unconditional
 * entry, which made this whole scan `ENOENT` the moment that pack was moved
 * out of the tree — content-pack-extraction batch 5 task 8's drill. The rule
 * a pack's geometry module is held to has not changed; what is conditional is
 * only whether this checkout has that pack to hold. The reference pack's is
 * unconditional because that pack never leaves.
 */
const FILES = [
  'src/game/lanes.ts',
  'src/game/ai/LaneObjectives.ts',
  'src/game/Game.ts',
  ...(packIsInstalled('riot') ? ['packs/riot/maps/summonersRiftGeometry.ts'] : []),
  'packs/reference/provingGroundsGeometry.ts',
];

const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

/**
 * A top-level (module-scope) computed assignment: an IIFE (`= (() => {` or
 * `= (function`), or a `.map(`/`.reverse()` call anywhere inside a `const`
 * statement. Both start matching only at column 0 (module scope — a same-
 * shaped expression inside a function body is indented and never anchors
 * there), and the computed-call form is bounded to a single statement by
 * refusing to cross a `;`, so it cannot walk past its own declaration into
 * unrelated code further down the file.
 */
const TOP_LEVEL_IIFE = /^(?:export\s+)?const\s+\w+[^=\n]*=\s*\((?:\(\)\s*=>|function)/m;
const TOP_LEVEL_COMPUTED = /^(?:export\s+)?const\s+\w+[^;]*?\.(?:map|reverse)\(\)/m;

function offendersIn(relativePath: string): string[] {
  const source = stripComments(readFileSync(join(ROOT, relativePath), 'utf8'));
  const found: string[] = [];
  if (TOP_LEVEL_IIFE.test(source)) found.push(`${relativePath}: top-level IIFE`);
  if (TOP_LEVEL_COMPUTED.test(source)) {
    found.push(`${relativePath}: top-level .map()/.reverse() assigned to a const`);
  }
  return found;
}

describe('no geometry is computed at module-eval time', () => {
  it('finds files to scan, or this proves nothing', () => {
    // Guards the guard: an empty file list would leave every assertion below
    // vacuously green forever.
    expect(FILES.length).toBeGreaterThan(0);
  });

  it('lanes.ts and LaneObjectives.ts build their tables lazily, not at module load', () => {
    const offenders = FILES.flatMap(offendersIn);
    expect(offenders).toEqual([]);
  });

  it('the scan can see a violation it is meant to catch', () => {
    // Unindented on purpose — a top-level statement starts at column 0 in the
    // real source files, and an indented copy would test the wrong thing.
    const iife = [
      '// Built once at module load.',
      'const GEOMETRY = (() => {',
      '  return {};',
      '})();',
    ].join('\n');
    const reversed = [
      '// Reversed once at module load rather than per wave.',
      'const RED_LANE_WAYPOINTS = {',
      '  top: [...LANE_WAYPOINTS.top].reverse(),',
      '};',
    ].join('\n');
    const source1 = stripComments(iife);
    const source2 = stripComments(reversed);
    expect(TOP_LEVEL_IIFE.test(source1)).toBe(true);
    expect(TOP_LEVEL_COMPUTED.test(source2)).toBe(true);
  });
});
