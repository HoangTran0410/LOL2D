import { describe, expect, it } from 'vitest';
import NavGrid, {
  NAV_CELL_SIZE,
  NAV_MAX_ACCEPTED_OVERLAP,
  NAV_MAX_TERRAIN_RADIUS,
} from '../../../src/game/nav/NavGrid';
import { MAX_UNIT_SIZE } from '../../../src/game/gameObject/Stats';
import { pointInPolygon, wallClearance, wallPolygons } from './geometry';

const MAP_SIZE = 6_400;
const CHAMPION_RADIUS = 27.5;
const MINION_RADIUS = 17;

const realGrid = NavGrid.fromPolygons(
  wallPolygons.map(polygon => polygon.map(([x, y]) => ({ x, y }))),
  { size: MAP_SIZE }
);

/** A box wall, as the map file would spell one. */
const box = (x: number, y: number, w: number, h: number) => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
];

describe('NavGrid', () => {
  it('covers the whole map at the resolution the game ships', () => {
    expect(realGrid.cellSize).toBe(NAV_CELL_SIZE);
    expect(realGrid.cols * realGrid.cellSize).toBeGreaterThanOrEqual(MAP_SIZE);
    expect(realGrid.rows).toBe(realGrid.cols);
    // one Uint16 per cell and nothing else: the static structure has to be
    // small enough that holding it is never a question. 16px cells put this
    // at ~313KB (400x400 cells) against 24px's ~139KB — the cap moved up
    // with the resolution, not because the old bound stopped being cheap.
    expect(realGrid.memoryBytes).toBe(realGrid.cols * realGrid.rows * 2);
    expect(realGrid.memoryBytes).toBeLessThan(384 * 1024);
  });

  it('never calls a spot walkable more than NAV_MAX_ACCEPTED_OVERLAP into a wall', () => {
    // The safety invariant, swept over the shipped map against the raw
    // polygons: if the grid says a body of radius r fits at a point, the
    // nearest wall is at least `r - NAV_MAX_ACCEPTED_OVERLAP` away. Every
    // free cell is checked at its centre, all four corners and all four edge
    // midpoints — not just centres — because `requiredClearance`'s margin is
    // sized against exactly that "body anywhere in the cell" case, and a
    // centre-only sweep would never see the corners it is meant to cover.
    // The search, the smoother and the straight-line check all go through
    // isWalkable, so this one property is what keeps every one of them
    // honest — and NAV_MAX_ACCEPTED_OVERLAP (not zero) is what they are
    // honest *to*. See NavGrid.requiredClearance for the reasoning and the
    // measurement behind that bound.
    const offsets: Array<[number, number]> = [
      [0.5, 0.5],
      [0.02, 0.02],
      [0.98, 0.02],
      [0.02, 0.98],
      [0.98, 0.98],
      [0.5, 0.02],
      [0.5, 0.98],
      [0.02, 0.5],
      [0.98, 0.5],
    ];
    let checked = 0;
    let tightest = Infinity;
    let tightestAt = '';

    for (const radius of [MINION_RADIUS, CHAMPION_RADIUS]) {
      const required = realGrid.requiredClearance(radius);
      for (let cy = 0; cy < realGrid.rows; cy++) {
        for (let cx = 0; cx < realGrid.cols; cx++) {
          if (realGrid.clearance[cy * realGrid.cols + cx] < required) continue;
          for (const [ox, oy] of offsets) {
            const x = (cx + ox) * realGrid.cellSize;
            const y = (cy + oy) * realGrid.cellSize;
            checked++;
            const slack = wallClearance(x, y, 200) - radius;
            if (slack < tightest) {
              tightest = slack;
              tightestAt = `(${x}, ${y}) r=${radius}`;
            }
          }
        }
      }
    }

    expect(checked).toBeGreaterThan(500_000);
    expect(
      tightest,
      `tightest walkable spot was ${tightest.toFixed(2)}px inside its own radius at ${tightestAt}, past the accepted ${NAV_MAX_ACCEPTED_OVERLAP}px`
    ).toBeGreaterThanOrEqual(-NAV_MAX_ACCEPTED_OVERLAP);
  });

  it('never refuses a spot for any reason but the stated margin', () => {
    // The mirror of the sweep above, and the property `refineNearWalls` exists
    // to create. That one bounds how wrong the grid may be in the *permissive*
    // direction; this one bounds the refusals, which is what a player feels.
    //
    // Before the refinement pass a cell could be refused with 19px of room to
    // spare on top of the margin, because clearance was measured to the nearest
    // blocked cell *centre* and a blocked cell's centre can be a half-diagonal
    // from the wall that blocked it. Per side that asks ~93px of corridor for a
    // 55px body, which on this map's 60-90px jungle gaps meant closed
    // passages, not wasted ground.
    //
    // So: if the grid says no, the wall really is inside `requiredClearance`.
    // The +1 is the stored value being floored to whole pixels.
    const radius = CHAMPION_RADIUS;
    const required = realGrid.requiredClearance(radius);
    let refused = 0;
    let loosest = 0;
    let loosestAt = '';

    for (let cy = 0; cy < realGrid.rows; cy++) {
      for (let cx = 0; cx < realGrid.cols; cx++) {
        if (realGrid.clearance[cy * realGrid.cols + cx] >= required) continue;
        refused++;
        const x = (cx + 0.5) * realGrid.cellSize;
        const y = (cy + 0.5) * realGrid.cellSize;
        const actual = wallClearance(x, y, 200);
        if (actual > loosest) {
          loosest = actual;
          loosestAt = `(${x}, ${y})`;
        }
      }
    }

    expect(refused).toBeGreaterThan(10_000);
    expect(
      loosest,
      `a refused cell had ${loosest.toFixed(2)}px of wall clearance at ${loosestAt}, past the ${required}px it was asked for`
    ).toBeLessThan(required + 1);
  });

  it('marks the inside of a wall unwalkable for every body size', () => {
    let insideSamples = 0;
    for (const polygon of wallPolygons) {
      let cx = 0;
      let cy = 0;
      for (const [x, y] of polygon) {
        cx += x / polygon.length;
        cy += y / polygon.length;
      }
      // convex-ish polygons only: a centroid outside its own polygon says
      // nothing about the grid
      if (!pointInPolygon(cx, cy, polygon)) continue;
      insideSamples++;
      expect(
        realGrid.isWalkable(cx, cy, MINION_RADIUS),
        `walkable inside wall at ${cx},${cy}`
      ).toBe(false);
    }
    expect(insideSamples).toBeGreaterThan(100);
  });

  it('sees a wall thinner than one cell', () => {
    // The scanline pass alone would miss this: no cell centre falls inside it.
    const grid = NavGrid.fromPolygons([box(1_000, 0, 4, 2_000)], { size: 4_096 });
    expect(grid.isWalkable(1_002, 1_000, 10)).toBe(false);
    expect(grid.isLineClear(800, 1_000, 1_200, 1_000, 10)).toBe(false);
  });

  it('refuses a line that clips a wall corner between two open endpoints', () => {
    const grid = NavGrid.fromPolygons([box(1_000, 1_000, 400, 400)], { size: 4_096 });
    // both ends are open ground; the segment between them crosses the corner
    expect(grid.isWalkable(900, 900, 20)).toBe(true);
    expect(grid.isWalkable(1_500, 1_500, 20)).toBe(true);
    expect(grid.isLineClear(900, 900, 1_500, 1_500, 20)).toBe(false);
    // and a line that goes round it is fine
    expect(grid.isLineClear(900, 900, 900, 1_500, 20)).toBe(true);
  });

  it('demands more clearance from a larger body', () => {
    const grid = NavGrid.fromPolygons([box(0, 0, 1_000, 460), box(0, 620, 1_000, 460)], {
      size: 2_048,
    });
    // a 160px gap between two walls: room for a minion, not for a big body
    expect(grid.isLineClear(100, 540, 900, 540, MINION_RADIUS)).toBe(true);
    expect(grid.isLineClear(100, 540, 900, 540, 70)).toBe(false);
  });

  it('pulls a point inside a wall out to the nearest ground a body fits on', () => {
    const grid = NavGrid.fromPolygons([box(1_000, 1_000, 300, 300)], { size: 4_096 });
    const rescued = grid.nearestWalkable(1_150, 1_150, 20, 700);

    expect(rescued).not.toBeNull();
    if (!rescued) return;
    expect(grid.isWalkable(rescued.x, rescued.y, 20)).toBe(true);
    // the middle of a 300px box is 150px from the nearest edge; anything much
    // beyond that plus a body and a cell has wandered off rather than stepped out
    expect(Math.hypot(rescued.x - 1_150, rescued.y - 1_150)).toBeLessThan(260);
  });

  it('gives up rather than teleporting when nothing near a point is standable', () => {
    const grid = NavGrid.fromPolygons([box(0, 0, 4_000, 4_000)], { size: 4_096 });
    expect(grid.nearestWalkable(2_000, 2_000, 20, 600)).toBeNull();
  });

  it('leaves a point that is already fine exactly where it is', () => {
    const found = realGrid.nearestWalkable(400, 6_075, CHAMPION_RADIUS, 700);
    expect(found).toEqual({ x: 400, y: 6_075 });
  });

  it('keeps both fountains and every lane mutually walkable for a champion', () => {
    // the resolution was chosen so this holds; coarser cells sever Baron's camp
    for (const [x, y] of [
      [400, 6_075],
      [6_100, 375],
      [3_423, 595],
      [3_885, 2_723],
      [2_995, 5_775],
      [2_147, 1_876],
    ]) {
      expect(realGrid.isWalkable(x, y, CHAMPION_RADIUS), `not standable at ${x},${y}`).toBe(true);
    }
  });

  /**
   * The cap `AttackableUnit.terrainRadius` applies. A body may grow to
   * `MAX_UNIT_SIZE` (radius 82.5), at which the map keeps only 57% of the
   * ground a champion can stand on and three of six sampled cross-map routes
   * stop reaching their goal at all — the search returns a best-effort stub a
   * few dozen pixels long, which is what a player sees as a giant refusing to
   * path. `NAV_MAX_TERRAIN_RADIUS` is the radius terrain stops taking the body
   * literally at; these are the two properties that choice rests on, so
   * raising it is a failing build rather than a silent regression.
   */
  describe('NAV_MAX_TERRAIN_RADIUS', () => {
    const standableCells = (radius: number): number => {
      const required = realGrid.requiredClearance(radius);
      let count = 0;
      for (let i = 0; i < realGrid.clearance.length; i++) {
        if (realGrid.clearance[i] >= required) count++;
      }
      return count;
    };

    it('leaves a champion untouched — it is a ceiling, not a resize', () => {
      expect(NAV_MAX_TERRAIN_RADIUS).toBeGreaterThan(CHAMPION_RADIUS);
      expect(NAV_MAX_TERRAIN_RADIUS).toBeGreaterThan(MINION_RADIUS);
    });

    it('keeps the landmarks a champion can reach standable for a capped body', () => {
      for (const [x, y] of [
        [400, 6_075],
        [6_100, 375],
        [3_423, 595],
        [3_885, 2_723],
        [2_995, 5_775],
        [2_147, 1_876],
      ]) {
        expect(
          realGrid.isWalkable(x, y, NAV_MAX_TERRAIN_RADIUS),
          `not standable at ${x},${y} for a capped body`
        ).toBe(true);
      }
    });

    it('keeps most of a champion’s ground, where an uncapped max body keeps barely half', () => {
      const champion = standableCells(CHAMPION_RADIUS);
      const capped = standableCells(NAV_MAX_TERRAIN_RADIUS);
      const uncapped = standableCells(MAX_UNIT_SIZE / 2);

      expect(
        capped / champion,
        'the cap must keep most of a champion’s standable ground'
      ).toBeGreaterThan(0.85);
      // the measurement the cap exists for: without it, a maxed body loses
      // nearly half the map's standable ground and detours around the rest
      expect(uncapped / champion).toBeLessThan(0.65);
    });
  });
});
