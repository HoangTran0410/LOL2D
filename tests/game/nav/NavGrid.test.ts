import { describe, expect, it } from 'vitest';
import NavGrid, { NAV_CELL_SIZE } from '../../../src/game/nav/NavGrid';
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
    // small enough that holding it is never a question
    expect(realGrid.memoryBytes).toBe(realGrid.cols * realGrid.rows * 2);
    expect(realGrid.memoryBytes).toBeLessThan(256 * 1024);
  });

  it('never calls a spot walkable that a body would not fit in', () => {
    // The safety invariant, swept over the shipped map against the raw polygons:
    // if the grid says a body of radius r fits at a point, the nearest wall is
    // at least r away. Nothing else in the system is allowed to assume this —
    // the search, the smoother and the straight-line check all go through
    // isWalkable, so this one property is what keeps every one of them honest.
    let checked = 0;
    let tightest = Infinity;
    let tightestAt = '';

    for (const radius of [MINION_RADIUS, CHAMPION_RADIUS]) {
      for (let y = 7; y < MAP_SIZE; y += 43) {
        for (let x = 7; x < MAP_SIZE; x += 43) {
          if (!realGrid.isWalkable(x, y, radius)) continue;
          checked++;
          const slack = wallClearance(x, y, 400) - radius;
          if (slack < tightest) {
            tightest = slack;
            tightestAt = `(${x}, ${y}) r=${radius}`;
          }
        }
      }
    }

    expect(checked).toBeGreaterThan(10_000);
    expect(tightest, `tightest walkable spot was ${tightest.toFixed(2)}px inside its own radius at ${tightestAt}`).toBeGreaterThanOrEqual(0);
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
      expect(realGrid.isWalkable(cx, cy, MINION_RADIUS), `walkable inside wall at ${cx},${cy}`).toBe(
        false
      );
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
});
