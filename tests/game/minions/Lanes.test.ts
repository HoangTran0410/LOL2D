import { describe, expect, it } from 'vitest';
import TeamId from '../../../src/game/enums/TeamId';
import {
  LANES,
  LANE_WAYPOINTS,
  Lane,
  getLaneWaypoints,
  type LaneWaypoint,
} from '../../../src/game/lanes';
import mapData from '../../../assets/json/summoner_map.json';

type Point = [number, number];
const walls = mapData.wall as Point[][];
const turret1 = mapData.turret1 as Point[];
const turret2 = mapData.turret2 as Point[];

const BLUE_FOUNTAIN = { x: 400, y: 6_075 };
const RED_FOUNTAIN = { x: 6_100, y: 375 };

/**
 * The widest minion is 34px across, so anything under ~20px of clearance means a
 * body is already inside the wall. 40 is that plus a margin for the fact that a
 * minion leaves the lane to reach whatever it aggroed; the real paths measure
 * 69px at their tightest, so this has room to fail loudly if one is edited badly
 * rather than tripping on a rounding change.
 */
const MIN_CLEARANCE = 40;

// ---------------------------------------------------------------- geometry

const pointInPolygon = (px: number, py: number, poly: Point[]): boolean => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};

const distanceToSegment = (
  px: number, py: number, ax: number, ay: number, bx: number, by: number
): number => {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSq));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
};

const bounds = walls.map(poly => {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of poly) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
});

/**
 * Distance from a point to the nearest wall, negative when the point is inside
 * one. Capped at `ceiling` so the bounding-box reject can skip most of the 329
 * polygons — the assertions only ever care whether it clears MIN_CLEARANCE.
 */
const wallClearance = (px: number, py: number, ceiling = 200): number => {
  let best = ceiling;
  for (let i = 0; i < walls.length; i++) {
    const b = bounds[i];
    const dx = px < b.minX ? b.minX - px : px > b.maxX ? px - b.maxX : 0;
    const dy = py < b.minY ? b.minY - py : py > b.maxY ? py - b.maxY : 0;
    if (Math.hypot(dx, dy) >= best) continue;

    const poly = walls[i];
    let edge = Infinity;
    for (let k = 0, j = poly.length - 1; k < poly.length; j = k++) {
      edge = Math.min(edge, distanceToSegment(px, py, poly[j][0], poly[j][1], poly[k][0], poly[k][1]));
    }
    const signed = pointInPolygon(px, py, poly) ? -edge : edge;
    if (signed < best) best = signed;
  }
  return best;
};

/** Worst clearance along the straight line a minion actually walks. */
const segmentClearance = (a: LaneWaypoint, b: LaneWaypoint): { clearance: number; at: LaneWaypoint } => {
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  const steps = Math.max(2, Math.ceil(length / 20));
  let worst = Infinity;
  let at = a;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = a.x + (b.x - a.x) * t;
    const y = a.y + (b.y - a.y) * t;
    const clearance = wallClearance(x, y);
    if (clearance < worst) {
      worst = clearance;
      at = { x: Math.round(x), y: Math.round(y) };
    }
  }
  return { clearance: worst, at };
};

const containsPoint = (path: LaneWaypoint[], [x, y]: Point): boolean =>
  path.some(p => p.x === x && p.y === y);

// ---------------------------------------------------------------- tests

describe('lane waypoints', () => {
  it('walks every lane end to end without clipping a wall', () => {
    for (const lane of LANES) {
      const path = LANE_WAYPOINTS[lane];
      for (let i = 0; i + 1 < path.length; i++) {
        const { clearance, at } = segmentClearance(path[i], path[i + 1]);
        expect(
          clearance,
          `${lane} segment ${i} (${path[i].x},${path[i].y}) -> (${path[i + 1].x},${path[i + 1].y}) ` +
            `is ${Math.round(clearance)}px from a wall at (${at.x},${at.y})`
        ).toBeGreaterThanOrEqual(MIN_CLEARANCE);
      }
    }
  });

  it('runs blue fountain to red fountain in every lane', () => {
    for (const lane of LANES) {
      const path = LANE_WAYPOINTS[lane];
      expect(path[0]).toEqual(BLUE_FOUNTAIN);
      expect(path[path.length - 1]).toEqual(RED_FOUNTAIN);
      expect(path.length).toBeGreaterThan(3);
    }
  });

  it('threads its own turret row, in order, so a lane is defended along its length', () => {
    // the split claimed in the comment on LANE_WAYPOINTS, checked against the raw
    // map data rather than restated from it
    const blueLaneTurrets: Record<string, Point[]> = {
      [Lane.TOP]: [[520, 4432], [604, 3557], [410, 1859]],
      [Lane.MID]: [[1617, 4767], [2153, 4346], [2543, 3687]],
      [Lane.BOT]: [[963, 5626], [1950, 5837], [2995, 5775], [4558, 5962]],
    };
    const redLaneTurrets: Record<string, Point[]> = {
      [Lane.TOP]: [[1873, 440], [3423, 595], [4517, 518]],
      [Lane.MID]: [[3885, 2723], [4291, 2044], [4790, 1617]],
      [Lane.BOT]: [[5994, 4467], [5801, 2864], [5898, 1922]],
    };

    for (const lane of LANES) {
      const path = LANE_WAYPOINTS[lane];
      const indexOf = (p: Point) => path.findIndex(w => w.x === p[0] && w.y === p[1]);

      for (const point of [...blueLaneTurrets[lane], ...redLaneTurrets[lane]]) {
        expect(turret1.concat(turret2)).toContainEqual(point);
        expect(indexOf(point), `${lane} is missing turret ${point}`).toBeGreaterThan(-1);
      }
      // blue's row first, red's after: a lane is one route from one base to the other
      const blueIndexes = blueLaneTurrets[lane].map(indexOf);
      const redIndexes = redLaneTurrets[lane].map(indexOf);
      expect(blueIndexes).toEqual([...blueIndexes].sort((a, b) => a - b));
      expect(redIndexes).toEqual([...redIndexes].sort((a, b) => a - b));
      expect(Math.max(...blueIndexes)).toBeLessThan(Math.min(...redIndexes));
    }
  });

  it('assigns every map turret to exactly one lane, or to a base', () => {
    // the two rows are 11 points each; 10 are lane turrets and the rest guard a
    // fountain. Nothing may be silently dropped when the paths are edited.
    const baseTurrets: Point[] = [[736, 5392], [5454, 779], [5646, 967]];
    expect(turret1).toHaveLength(11);
    expect(turret2).toHaveLength(11);

    for (const point of [...turret1, ...turret2]) {
      const onBase = baseTurrets.some(([x, y]) => x === point[0] && y === point[1]);
      const lanesWithIt = LANES.filter(lane => containsPoint(LANE_WAYPOINTS[lane], point));
      expect(
        lanesWithIt.length,
        `turret ${point} is on ${lanesWithIt.length} lane(s) (base turret: ${onBase})`
      ).toBe(onBase ? 0 : 1);
    }
  });

  it('gives red the same path backwards, without mutating the shared blue one', () => {
    for (const lane of LANES) {
      const blue = getLaneWaypoints(lane, TeamId.BLUE);
      const red = getLaneWaypoints(lane, TeamId.RED);

      expect(blue).toBe(LANE_WAYPOINTS[lane]);
      expect(blue[0]).toEqual(BLUE_FOUNTAIN);
      expect(red[0]).toEqual(RED_FOUNTAIN);
      expect(red).toEqual([...blue].reverse());
      // handed to every minion in a wave, so it must be the same array each time
      expect(getLaneWaypoints(lane, TeamId.RED)).toBe(red);
    }

    expect(LANE_WAYPOINTS[Lane.TOP][0]).toEqual(BLUE_FOUNTAIN);
  });

  it('falls back to mid for a lane it does not know', () => {
    expect(getLaneWaypoints('jungle', TeamId.BLUE)).toBe(LANE_WAYPOINTS[Lane.MID]);
  });
});
