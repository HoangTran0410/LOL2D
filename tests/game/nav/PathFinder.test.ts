import { describe, expect, it } from 'vitest';
import NavGrid from '../../../src/game/nav/NavGrid';
import PathFinder, { NAV_MAX_NODES_PER_SEARCH, smoothPath } from '../../../src/game/nav/PathFinder';
import { routeClearance, segmentClearance, wallClearance, wallPolygons } from './geometry';

const MAP_SIZE = 6_400;
const CHAMPION_RADIUS = 27.5;

const realGrid = NavGrid.fromPolygons(
  wallPolygons.map(polygon => polygon.map(([x, y]) => ({ x, y }))),
  { size: MAP_SIZE }
);
const realFinder = new PathFinder(realGrid);

const box = (x: number, y: number, w: number, h: number) => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
];

/** Orders whose straight line is blocked, so a detour is the whole point. */
const BLOCKED_ORDERS: Array<[string, number, number, number, number]> = [
  ['blue fountain to red fountain', 400, 6_075, 6_100, 375],
  ['blue fountain to Baron', 400, 6_075, 2_147, 1_876],
  ['top lane turret to bot lane turret', 604, 3_557, 1_950, 5_837],
  ['mid lane to the top-left turn', 2_543, 3_687, 1_160, 890],
  ['red base out to mid', 6_100, 375, 3_885, 2_723],
];

describe('PathFinder on the shipped map', () => {
  it('routes around walls the straight line would have walked into', () => {
    for (const [label, fromX, fromY, toX, toY] of BLOCKED_ORDERS) {
      // the premise: walking straight at this goal hits terrain
      const straight = segmentClearance(fromX, fromY, toX, toY);
      expect(straight.clearance, `${label} needs no detour`).toBeLessThan(CHAMPION_RADIUS);

      const result = realFinder.search(fromX, fromY, toX, toY, { radius: CHAMPION_RADIUS });
      expect(result.ok, `${label} found no route`).toBe(true);
      expect(result.waypoints.length).toBeGreaterThanOrEqual(2);

      // and the route it produced clears every wall polygon for the whole walk
      const walked = routeClearance(result.waypoints, fromX, fromY);
      expect(
        walked.clearance,
        `${label} passes ${walked.clearance.toFixed(1)}px from a wall at (${walked.at.x}, ${walked.at.y})`
      ).toBeGreaterThanOrEqual(CHAMPION_RADIUS);

      // it ends where it was told to
      const endX = result.waypoints[result.waypoints.length - 2];
      const endY = result.waypoints[result.waypoints.length - 1];
      expect(Math.hypot(endX - toX, endY - toY)).toBeLessThan(1);
    }
  });

  it('leaves a route short enough to walk, not a cell-by-cell staircase', () => {
    // Fountain to fountain is 252 grid cells. Smoothing has to collapse that to
    // a handful of long straights or the unit reads as walking on graph paper.
    const result = realFinder.search(400, 6_075, 6_100, 375, { radius: CHAMPION_RADIUS });
    const corners = result.waypoints.length / 2;
    expect(corners).toBeGreaterThan(1);
    expect(corners).toBeLessThan(40);
  });

  it('serves every reachable order on this map inside the shipped node budget', () => {
    // The budget and the heuristic weight were both picked from this
    // distribution, so it is the thing that has to be re-measured if either
    // moves. A deterministic sample, so a failure is reproducible.
    let seed = 12_345;
    const random = () => (seed = (seed * 1_103_515_245 + 12_345) & 0x7fffffff) / 0x7fffffff;

    const points: Array<{ x: number; y: number }> = [];
    while (points.length < 300) {
      const point = realGrid.nearestWalkable(
        random() * MAP_SIZE,
        random() * MAP_SIZE,
        CHAMPION_RADIUS,
        300
      );
      if (point) points.push(point);
    }

    const expansions: number[] = [];
    for (let i = 0; i + 1 < points.length; i += 2) {
      const result = realFinder.search(points[i].x, points[i].y, points[i + 1].x, points[i + 1].y, {
        radius: CHAMPION_RADIUS,
        nodeBudget: 200_000,
      });
      if (result.ok) expansions.push(result.expanded);
    }

    expect(expansions.length).toBeGreaterThan(80);
    const worst = Math.max(...expansions);
    expect(
      worst,
      `the worst reachable order costs ${worst} expansions against a ${NAV_MAX_NODES_PER_SEARCH} budget`
    ).toBeLessThan(NAV_MAX_NODES_PER_SEARCH);

    // and the hard case the budget was sized against
    const baron = realFinder.search(400, 6_075, 2_147, 1_876, { radius: CHAMPION_RADIUS });
    expect(baron.ok).toBe(true);
    expect(baron.expanded).toBeLessThan(NAV_MAX_NODES_PER_SEARCH);
  });

  it('stays inside its expansion budget, and says so when it settles', () => {
    // A goal in a wall pocket nothing can reach: A* can only rule it out by
    // exhausting its component, which is the case the cap exists for.
    const sealed = NavGrid.fromPolygons(
      [
        box(1_000, 1_000, 1_200, 40),
        box(1_000, 1_000, 40, 1_200),
        box(1_000, 2_160, 1_200, 40),
        box(2_160, 1_000, 40, 1_200),
      ],
      { size: 4_096 }
    );
    const finder = new PathFinder(sealed);
    const result = finder.search(400, 400, 1_600, 1_600, { radius: 20, nodeBudget: 500 });

    expect(result.ok).toBe(false);
    expect(result.expanded).toBeLessThanOrEqual(500);
  });

  it('walks as close as it can to somewhere it cannot reach, instead of refusing', () => {
    const sealed = NavGrid.fromPolygons(
      [
        box(1_000, 1_000, 1_200, 40),
        box(1_000, 1_000, 40, 1_200),
        box(1_000, 2_160, 1_200, 40),
        box(2_160, 1_000, 40, 1_200),
      ],
      { size: 4_096 }
    );
    const finder = new PathFinder(sealed);
    // The goal sits just inside the west wall, not centred in the room: a
    // goal equidistant from all four walls (as the room's centre is from a
    // west-approaching start) leaves A* a genuine tie for "closest reachable
    // node" between the west, north and south exterior, and which of those
    // wins is an artifact of heap tie-breaking, not something this test
    // should pin to one cell size's tie-breaking over another's.
    const result = finder.search(300, 1_600, 1_050, 1_600, { radius: 20 });

    expect(result.ok).toBe(false);
    // it produced a real route towards the box rather than an empty list
    expect(result.waypoints.length).toBeGreaterThanOrEqual(2);
    const endX = result.waypoints[result.waypoints.length - 2];
    const endY = result.waypoints[result.waypoints.length - 1];
    expect(endX).toBeGreaterThan(300);
    expect(endX).toBeLessThan(1_000);
    expect(sealed.isWalkable(endX, endY, 20)).toBe(true);
  });

  it('resolves a destination inside a wall to the nearest ground outside it', () => {
    // the middle of a wall polygon on the real map
    const wall = wallPolygons.find(polygon => {
      let cx = 0;
      let cy = 0;
      for (const [x, y] of polygon) {
        cx += x / polygon.length;
        cy += y / polygon.length;
      }
      return wallClearance(cx, cy, 200) < -40;
    });
    expect(wall).toBeDefined();
    if (!wall) return;

    let targetX = 0;
    let targetY = 0;
    for (const [x, y] of wall) {
      targetX += x / wall.length;
      targetY += y / wall.length;
    }
    expect(realGrid.isWalkable(targetX, targetY, CHAMPION_RADIUS)).toBe(false);

    const result = realFinder.search(400, 6_075, targetX, targetY, { radius: CHAMPION_RADIUS });
    expect(result.waypoints.length).toBeGreaterThanOrEqual(2);

    const endX = result.waypoints[result.waypoints.length - 2];
    const endY = result.waypoints[result.waypoints.length - 1];
    // it stops on ground it fits on, near the click rather than somewhere else
    expect(realGrid.isWalkable(endX, endY, CHAMPION_RADIUS)).toBe(true);
    expect(Math.hypot(endX - targetX, endY - targetY)).toBeLessThan(700);
    const walked = routeClearance(result.waypoints, 400, 6_075);
    expect(walked.clearance).toBeGreaterThanOrEqual(CHAMPION_RADIUS);
  });

  it('walks a unit standing inside a wall back out rather than deeper in', () => {
    const grid = NavGrid.fromPolygons([box(1_000, 1_000, 400, 400)], { size: 4_096 });
    const finder = new PathFinder(grid);
    // squeezed into the wall by body separation, ordered somewhere legitimate
    const result = finder.search(1_200, 1_200, 2_400, 1_200, { radius: 20 });

    expect(result.waypoints.length).toBeGreaterThanOrEqual(2);
    // the first place it is sent is standable, which is the way out
    expect(grid.isWalkable(result.waypoints[0], result.waypoints[1], 20)).toBe(true);
  });

  it('gives up cleanly when there is nowhere at all to stand', () => {
    const grid = NavGrid.fromPolygons([box(0, 0, 4_000, 4_000)], { size: 4_096 });
    const finder = new PathFinder(grid);
    const result = finder.search(2_000, 2_000, 3_000, 3_000, { radius: 20 });

    expect(result.ok).toBe(false);
    expect(result.waypoints).toEqual([]);
    expect(result.failure).toBe('NO_START');
  });
});

describe('smoothPath', () => {
  it('collapses a staircase that has nothing in the way', () => {
    const grid = NavGrid.fromPolygons([], { size: 2_048 });
    const staircase = [200, 200, 300, 300, 400, 400, 500, 500, 600, 600];
    expect(smoothPath(100, 100, staircase, grid, 20)).toEqual([600, 600]);
  });

  it('refuses to cut a corner through geometry', () => {
    // An L around a wall block. The two ends see each other only the long way
    // round, so a smoother that trusted straight lines without testing them
    // would drop the corner and walk the unit through the block.
    const grid = NavGrid.fromPolygons([box(1_000, 1_000, 600, 600)], { size: 4_096 });
    const cornered = [900, 1_800, 1_700, 1_800, 1_700, 900];

    const smoothed = smoothPath(900, 900, cornered, grid, 25);

    // the corner survived: this is not a single straight hop to the far end
    expect(smoothed.length).toBeGreaterThan(2);
    const walked = [900, 900, ...smoothed];
    for (let i = 0; i + 3 < walked.length; i += 2) {
      expect(
        grid.isLineClear(walked[i], walked[i + 1], walked[i + 2], walked[i + 3], 25),
        `segment ${i / 2} of the smoothed route crosses geometry`
      ).toBe(true);
    }
  });

  it('never emits a segment its own line test would reject, on the real map', () => {
    for (const [label, fromX, fromY, toX, toY] of BLOCKED_ORDERS) {
      const result = realFinder.search(fromX, fromY, toX, toY, { radius: CHAMPION_RADIUS });
      const walked = [fromX, fromY, ...result.waypoints];
      for (let i = 0; i + 3 < walked.length; i += 2) {
        expect(
          realGrid.isLineClear(
            walked[i],
            walked[i + 1],
            walked[i + 2],
            walked[i + 3],
            CHAMPION_RADIUS
          ),
          `${label}: smoothed segment ${i / 2} is not walkable`
        ).toBe(true);
      }
    }
  });

  it('drops the cell the unit is already standing in', () => {
    const grid = NavGrid.fromPolygons([], { size: 2_048 });
    // first point is the unit's own cell centre, as reconstruct() emits it
    const raw = [grid.centreX(grid.cellX(500)), grid.centreY(grid.cellY(500)), 900, 500];
    const smoothed = smoothPath(500, 500, raw, grid, 20);
    expect(smoothed).toEqual([900, 500]);
  });
});
