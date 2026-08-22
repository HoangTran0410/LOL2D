import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { srcSourceFilePaths } from '../support/srcTree';

/**
 * Task 6 of the content-pack extraction: core must contain no Summoner's
 * Rift coordinate at all, once the map — `lanes.ts`'s `DEFAULT_LANE_WAYPOINTS`
 * and `mapPresets.ts`'s `NEUTRAL_SLOTS` — has moved into `packs/riot/maps/`.
 *
 * The needles below are every `{ x, y }` pair that used to live in those two
 * files (fountains, all three lanes' waypoints, all eleven jungle slots) —
 * lifted verbatim before the move, not recomputed from anything under `src/`
 * after it, or a scan that reads its own answer back would prove nothing.
 * `tests/content/coordinateBoundaryFixture.test.ts`-style self-check is
 * folded into the first `it` below: the needle list itself must be non-empty,
 * or an empty list would make every other assertion vacuously pass.
 *
 * Written to fail first: run against the pre-move tree, it names
 * `src/game/lanes.ts` (30 pairs — three lanes' worth of waypoints, fountains
 * included) and `src/game/mapPresets.ts` (11 pairs — every jungle slot) as
 * the two offenders. Recorded in `task-6-report.md`.
 */

/** Every fountain, turret-row-following lane waypoint, and jungle slot Summoner's Rift ships. */
const SR_COORDINATE_PAIRS: readonly [number, number][] = [
  // Fountains (shared by all three lanes as waypoint 0/last).
  [400, 6075],
  [6100, 375],
  // TOP
  [376, 4680],
  [696, 4456],
  [456, 3448],
  [744, 1288],
  [1592, 664],
  [3608, 456],
  [4328, 584],
  [4792, 728],
  // MID
  [1144, 5672],
  [1416, 5208],
  [1784, 4760],
  [2120, 4152],
  [2760, 3672],
  [4200, 2232],
  [4472, 2088],
  [5976, 856],
  // BOT
  [1512, 5608],
  [3096, 5928],
  [5080, 5656],
  [5816, 4712],
  [5944, 2424],
  [5736, 1832],
  [6088, 1576],
  // Jungle slots (mapPresets.ts's NEUTRAL_SLOTS)
  [2147, 1876], // baron
  [1631, 2958], // blue
  [4794, 3419], // blue
  [3368, 4698], // red
  [3085, 1672], // red
  [1685, 3562], // wolves
  [4728, 2835], // wolves
  [914, 2784], // gromp
  [5540, 3599], // gromp
  [2954, 4110], // raptors
  [3498, 2258], // raptors
];

const SRC = join(__dirname, '../../src');

const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

function sourceFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...sourceFilesUnder(full));
    else if (name.endsWith('.ts') || name.endsWith('.vue')) out.push(full);
  }
  return out;
}

/**
 * A pair reads as SR's own coordinate when both numbers appear in an
 * `x`/`y`-shaped literal together — `{ x: 400, y: 6075 }`,
 * `{x:400,y:6075}`, or a destructured `x: 400,\n  y: 6075` across a
 * reasonable span all match, which is every shape this codebase's own map
 * literals are written in (`lanes.ts`, `mapPresets.ts`,
 * `provingGroundsGeometry.ts`). A bare "400" and "6075" appearing anywhere
 * in a file unrelated to each other would not — that is deliberately not
 * what this scan flags, or two-digit and three-digit unrelated constants a
 * few lines apart would false-positive.
 *
 * Also matches the two-element tuple shape — `[400, 6075]` — which is not
 * a shape any pre-move `src/` file used, but is the shape
 * `SR_COORDINATE_PAIRS` right above declares its own needles in. A scan
 * that cannot see its own needle table's literal shape is not proof against
 * a future file (a compact re-encoding, a serialized fixture) that writes a
 * coordinate the same way.
 */
function containsPair(source: string, x: number, y: number): boolean {
  const objectPattern = new RegExp(`x:\\s*${x}\\s*,\\s*y:\\s*${y}\\b`);
  const tuplePattern = new RegExp(`\\[\\s*${x}\\s*,\\s*${y}\\s*\\]`);
  return objectPattern.test(source) || tuplePattern.test(source);
}

describe("core contains no Summoner's Rift coordinate", () => {
  it('has a real, non-empty needle list, or this scan proves nothing', () => {
    expect(SR_COORDINATE_PAIRS.length).toBeGreaterThan(0);
  });

  it('finds source files under src/ to scan, or this scan proves nothing', () => {
    // Derived, not `> 20` — see `tests/support/srcTree.ts`.
    const viaVite = srcSourceFilePaths();

    expect(viaVite.length).toBeGreaterThan(0);
    expect(sourceFilesUnder(SRC).length).toBe(viaVite.length);
  });

  it('no file under src/ contains any of Summoner\u2019s Rift\u2019s fountain, lane or jungle coordinates', () => {
    const files = sourceFilesUnder(SRC);
    const offenders: string[] = [];

    for (const file of files) {
      const source = stripComments(readFileSync(file, 'utf8'));
      for (const [x, y] of SR_COORDINATE_PAIRS) {
        if (containsPair(source, x, y)) {
          offenders.push(`${file.slice(SRC.length + 1)}: (${x}, ${y})`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
