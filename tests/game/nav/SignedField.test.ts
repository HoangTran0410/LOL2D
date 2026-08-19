/**
 * A body overlapping a wall anywhere on the shipped map comes out of it.
 *
 * `tests/game/map/WallPushOut.test.ts` proves the mechanism on a wall built to
 * be awkward — two convex boxes stacked across a slab's depth, which is the
 * shape that used to weld a champion in place. This file asks the same question
 * of the real thing: every one of the 329 hand-drawn wall pieces, every seam
 * between them, every corner, every sliver.
 *
 * ## Why the assertion is behavioural
 *
 * The obvious test — compare `NavGrid.signedDistanceAt` against a distance
 * computed from the raw polygons — cannot be made sound cheaply, and finding
 * that out is worth more than the test would have been.
 *
 * `wallClearance` in ./geometry takes the smallest signed distance over each
 * polygon separately. Outside a wall that is exact: the nearest piece is the
 * nearest surface. Near a seam it is not, and not only *inside* the wall.
 * Measured on the shipped map at (6226, 4809), where two of the largest wall
 * pieces meet: every piece reports that point as 0.12px outside itself, and it
 * is 78px deep in solid wall. A shell of points around every internal seam
 * reads as open ground to any per-polygon measurement — which is the whole
 * reason the field exists, and so cannot also be the standard it is held to.
 *
 * What the polygons *do* answer soundly is "is this circle clear of all of
 * them", because clear-of-the-union is clear-of-every-piece with no seam to be
 * confused by. So that is what gets asserted, after actually running the
 * push-out. It is also the property that matters: nobody cares what number the
 * field holds, they care whether a champion can stand inside a wall.
 */
import { describe, expect, it } from 'vitest';
import NavGrid from '../../../src/game/nav/NavGrid';
import TerrainField, { STEP_SAFETY } from '../../../src/game/gameObject/map/TerrainField';
import type { TerrainHost } from '../../../src/game/gameObject/map/DynamicTerrain';
import { wallClearance, wallPolygons } from './geometry';

const MAP_SIZE = 6_400;
const CHAMPION_RADIUS = 27.5;

/** Frames of push-out a body gets. `TerrainMap.update` runs one per frame. */
const FRAMES = 4;

/**
 * Sample stride. Deliberately coprime with the 16px cell size: a stride sharing
 * a factor would land every sample on the same offset within a cell and measure
 * one slice of the interpolation rather than all of it.
 */
const STRIDE = 13;

/**
 * How far in from the map edge the sweep starts.
 *
 * 15 of the 329 wall polygons are the map's own border and are drawn a few
 * pixels *past* it — the file runs from x = -1 to x = 6403 against a grid that
 * is exactly [0, 6400]. Cells for the overhang do not exist, so no field baked
 * at this size can know that geometry, and a body pressed into the very corner
 * is held by the map's edge clamp rather than by terrain. That predates the
 * signed field, which left the outward half of the transform alone.
 */
const BORDER_MARGIN = 64;

/**
 * How far into a wall a resolved body may still be.
 *
 * Not zero, for the same kind of reason `NAV_MAX_ACCEPTED_OVERLAP` is not zero.
 * The field is sampled at cell centres and read back bilinearly, and around a
 * convex wall corner the true distance function is a cone — a convex function,
 * which linear interpolation *overestimates*. So the field reports a shade more
 * room than a corner really offers, and a body resolved against it comes to
 * rest a shade closer than it asked to.
 *
 * Measured over the sweep below: of 99,546 overlapping starts, 18 finish more
 * than a pixel inside a wall and the worst is 1.20px. The bound is set above
 * that with the same kind of headroom the navigation bound carries (4px against
 * a measured 2.84px), so ordinary drift does not fail the build but a real
 * regression does. For scale, walls are drawn with a 7px stroke.
 */
const ACCEPTED_OVERLAP = 2;

const grid = NavGrid.fromPolygons(
  wallPolygons.map(polygon => polygon.map(([x, y]) => ({ x, y }))),
  { size: MAP_SIZE }
);

// `resolveStatic` reads the baked field and nothing else; the host only exists
// for the spell-made walls, which this file is not about.
const field = new TerrainField({} as TerrainHost, grid);

interface Sweep {
  /** Points where a champion-sized body starts out overlapping a wall. */
  started: number;
  /** Of those, how many are still overlapping after FRAMES. */
  stuck: number;
  /** Worst remaining overlap, in px. */
  worst: number;
  at: { x: number; y: number };
  /** Deepest starting point the sweep found, as a sense of what it covered. */
  deepest: number;
}

const sweep = (): Sweep => {
  let started = 0;
  let stuck = 0;
  let worst = 0;
  let deepest = 0;
  let at = { x: 0, y: 0 };

  for (let y = BORDER_MARGIN; y < MAP_SIZE - BORDER_MARGIN; y += STRIDE) {
    for (let x = BORDER_MARGIN; x < MAP_SIZE - BORDER_MARGIN; x += STRIDE) {
      const before = wallClearance(x, y);
      if (before >= CHAMPION_RADIUS) continue;
      started++;
      deepest = Math.max(deepest, -before);

      let px = x;
      let py = y;
      for (let frame = 0; frame < FRAMES; frame++) {
        const resolved = field.resolveStatic(px, py, CHAMPION_RADIUS);
        if (!resolved) break;
        px = resolved.x;
        py = resolved.y;
      }

      // Tracked over every resolved body, not only the ones past the bound: a
      // worst case that only exists when it is already failing tells you
      // nothing about how much headroom the bound has on a green run.
      const overlap = CHAMPION_RADIUS - wallClearance(px, py);
      if (overlap > ACCEPTED_OVERLAP) stuck++;
      if (overlap > worst) {
        worst = overlap;
        at = { x, y };
      }
    }
  }

  return { started, stuck, worst, at, deepest };
};

const measured = sweep();

describe('push-out over the shipped map', () => {
  it('finds enough overlapping bodies to mean something', () => {
    // Guards the sweep, not the field: a stride or margin change that stopped
    // finding walls would make every assertion below pass on an empty set.
    expect(measured.started).toBeGreaterThan(20_000);
    expect(measured.deepest).toBeGreaterThan(100);
  });

  it('leaves no body inside a wall', () => {
    // eslint-disable-next-line no-console
    console.log(
      `${measured.started} overlapping starts (deepest ${measured.deepest.toFixed(0)}px in) | ` +
        `${measured.stuck} past ${ACCEPTED_OVERLAP}px after ${FRAMES} frames | ` +
        `worst ${measured.worst.toFixed(2)}px from (${measured.at.x}, ${measured.at.y})`
    );
    expect(measured.worst).toBeLessThanOrEqual(ACCEPTED_OVERLAP);
  });
});

/**
 * The steepest the field gets, in px of distance per px of travel.
 *
 * `TerrainField.sweep` is sphere tracing, which is only conservative while this
 * stays at or under 1 — otherwise a step sized by the reported clearance can
 * land past a surface, and a thin enough wall can be stepped clean over. It is
 * *not* under 1 here, and the reason is deliberate: inside depth is measured to
 * the nearest cell that is not `blocked`, which adds about a cell of bias, so
 * the field falls faster than 1:1 as it crosses a wall face.
 *
 * `STEP_SAFETY` is the fraction of the reported clearance a step actually takes.
 * This measures what it has to cover.
 */
const steepest = (): { slope: number; at: { x: number; y: number } } => {
  const STEP = 7;
  const H = 1;
  let slope = 0;
  let at = { x: 0, y: 0 };

  for (let y = BORDER_MARGIN; y < MAP_SIZE - BORDER_MARGIN; y += STEP) {
    for (let x = BORDER_MARGIN; x < MAP_SIZE - BORDER_MARGIN; x += STEP) {
      const here = grid.signedDistanceAt(x, y);
      // Only around surfaces: far from any wall the field is flat, and far
      // inside one it is flat too.
      if (here > 64 || here < -64) continue;
      const alongX = Math.abs(grid.signedDistanceAt(x + H, y) - here) / H;
      const alongY = Math.abs(grid.signedDistanceAt(x, y + H) - here) / H;
      const worst = Math.max(alongX, alongY);
      if (worst > slope) {
        slope = worst;
        at = { x, y };
      }
    }
  }
  return { slope, at };
};

const slope = steepest();

describe('the field a sweep steps through', () => {
  it('never falls faster than a march step allows for', () => {
    // eslint-disable-next-line no-console
    console.log(
      `steepest slope ${slope.slope.toFixed(3)} px/px at (${slope.at.x}, ${slope.at.y}) | ` +
        `STEP_SAFETY ${STEP_SAFETY} covers up to ${(1 / STEP_SAFETY).toFixed(3)}`
    );
    // The whole point of the constant, stated as the inequality it has to
    // satisfy rather than as a number copied from a run.
    expect(slope.slope * STEP_SAFETY).toBeLessThanOrEqual(1);
  });
});

describe('a resolved body settles', () => {
  it('reports itself clear rather than being corrected forever', () => {
    // `TerrainMap.pushOutOfWalls` calls `onCollideWall()` whenever `resolveStatic`
    // returns a position, and `AIChampion.onCollideWall` re-rolls its destination.
    // A body that is moved every frame without ever reporting itself clear is
    // therefore a bot that reconsiders where it is going sixty times a second,
    // standing still against a wall — so "did it move" is not enough, it has to
    // *stop being moved*.
    const SETTLE_FRAMES = 30;
    let unsettled = 0;
    let started = 0;
    let worstAt = { x: 0, y: 0 };

    for (let y = BORDER_MARGIN; y < MAP_SIZE - BORDER_MARGIN; y += 29) {
      for (let x = BORDER_MARGIN; x < MAP_SIZE - BORDER_MARGIN; x += 29) {
        if (wallClearance(x, y) >= CHAMPION_RADIUS) continue;
        started++;

        let px = x;
        let py = y;
        let settled = false;
        for (let frame = 0; frame < SETTLE_FRAMES; frame++) {
          const resolved = field.resolveStatic(px, py, CHAMPION_RADIUS);
          if (!resolved) {
            settled = true;
            break;
          }
          px = resolved.x;
          py = resolved.y;
        }
        if (!settled) {
          unsettled++;
          worstAt = { x, y };
        }
      }
    }

    // eslint-disable-next-line no-console
    console.log(
      `${started} overlapping starts | ${unsettled} still being corrected after ` +
        `${SETTLE_FRAMES} frames (last at ${worstAt.x}, ${worstAt.y})`
    );
    expect(started).toBeGreaterThan(4_000);
    expect(unsettled).toBe(0);
  });
});
