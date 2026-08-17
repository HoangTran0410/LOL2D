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

/**
 * How close a minion's centre can get to a turret's: the turret's body
 * (DEFAULT_TURRET_PRESET.size 92, so radius 46) plus the widest minion's
 * (34 across, radius 17). A turret is immovable in `UnitCollisionSystem`, so
 * this is a hard floor, not a preference.
 */
const TURRET_BLOCKED_RADIUS = 46 + 17;

/**
 * A waypoint any closer than this to a turret centre is unreachable: the
 * minion is held `TURRET_BLOCKED_RADIUS` away and `Minion.WAYPOINT_TOLERANCE`
 * is 40, so it never registers arrival, never advances `waypointIndex`, and
 * grinds against the turret until the match ends. That is not hypothetical —
 * it is what these paths did when they were the raw turret coordinates. The
 * margin over the blocked radius is small on purpose: the assertion is about
 * "can a minion stand here at all", and the real paths clear 80px.
 */
const MIN_TURRET_CLEARANCE = TURRET_BLOCKED_RADIUS + 5;

/** A lane "covers" the turret it is meant to walk past within this radius — the offsets in lanes.ts are 80-108px. */
const LANE_COVERS_TURRET = 150;

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
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): number => {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  const t =
    lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSq));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
};

const bounds = walls.map(poly => {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
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
      edge = Math.min(
        edge,
        distanceToSegment(px, py, poly[j][0], poly[j][1], poly[k][0], poly[k][1])
      );
    }
    const signed = pointInPolygon(px, py, poly) ? -edge : edge;
    if (signed < best) best = signed;
  }
  return best;
};

/** Worst clearance along the straight line a minion actually walks. */
const segmentClearance = (
  a: LaneWaypoint,
  b: LaneWaypoint
): { clearance: number; at: LaneWaypoint } => {
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

/** The waypoint a lane walks past `point` at — index and distance. Lane waypoints sit *beside* their turret, never on it. */
const nearestWaypoint = (
  path: LaneWaypoint[],
  [x, y]: Point
): { index: number; distance: number } => {
  let index = -1;
  let distance = Infinity;
  path.forEach((p, i) => {
    const d = Math.hypot(p.x - x, p.y - y);
    if (d < distance) {
      distance = d;
      index = i;
    }
  });
  return { index, distance };
};

/**
 * The split claimed in the comment on LANE_WAYPOINTS, written out so both
 * tests below check the same claim against the raw map data rather than
 * restating it twice.
 */
const BLUE_LANE_TURRETS: Record<string, Point[]> = {
  [Lane.TOP]: [
    [520, 4432],
    [604, 3557],
    [410, 1859],
  ],
  [Lane.MID]: [
    [1617, 4767],
    [2153, 4346],
    [2543, 3687],
  ],
  [Lane.BOT]: [
    [963, 5626],
    [1950, 5837],
    [2995, 5775],
    [4558, 5962],
  ],
};
const RED_LANE_TURRETS: Record<string, Point[]> = {
  [Lane.TOP]: [
    [1873, 440],
    [3423, 595],
    [4517, 518],
  ],
  [Lane.MID]: [
    [3885, 2723],
    [4291, 2044],
    [4790, 1617],
  ],
  [Lane.BOT]: [
    [5994, 4467],
    [5801, 2864],
    [5898, 1922],
  ],
};
const laneTurrets = (lane: string): Point[] => [
  ...BLUE_LANE_TURRETS[lane],
  ...RED_LANE_TURRETS[lane],
];

/**
 * Which lane walks closest to `point`, and by how much it wins.
 *
 * Ownership is "the nearest lane", not "within N px of a lane": the paths
 * round corners near each other, and MID's corner out of the blue base passes
 * 123px from BOT's first turret. A fixed radius wide enough to cover a
 * turret's own lane (the offsets are 80-108px) is therefore also wide enough
 * to let a neighbour claim it, and picking a threshold between 108 and 123
 * would be a test tuned to two decimal places of the current geometry.
 */
const owningLane = (point: Point): { lane: string; distance: number; runnerUp: number } => {
  const ranked = LANES.map(lane => ({
    lane,
    distance: nearestWaypoint(LANE_WAYPOINTS[lane], point).distance,
  })).sort((a, b) => a.distance - b.distance);
  return { lane: ranked[0].lane, distance: ranked[0].distance, runnerUp: ranked[1].distance };
};

/** Distance from a point to the nearest turret of either row. */
const turretClearance = (x: number, y: number): number =>
  Math.min(...turret1.concat(turret2).map(([tx, ty]) => Math.hypot(x - tx, y - ty)));

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

  /**
   * The bug this guards: lane waypoints used to *be* the turret coordinates,
   * which put each one `TURRET_BLOCKED_RADIUS` deep inside ground a minion's
   * body can never enter. Every wave then wedged itself against the first
   * turret on its lane — its own, so it could not attack its way past either —
   * and never advanced another waypoint. Reproduced in the real game before
   * the fix: `distToWaypoint` and `nearestTurret` both pinned at 62px with
   * `waypointIndex` unchanged over 16 seconds of walking.
   */
  it('keeps every waypoint outside a turret, so a minion can stand on it', () => {
    for (const lane of LANES) {
      LANE_WAYPOINTS[lane].forEach((waypoint, i) => {
        const clearance = turretClearance(waypoint.x, waypoint.y);
        expect(
          clearance,
          `${lane}[${i}] (${waypoint.x},${waypoint.y}) is ${Math.round(clearance)}px from a turret ` +
            `centre — a minion body is blocked at ${TURRET_BLOCKED_RADIUS}px and gives up at 40px`
        ).toBeGreaterThanOrEqual(MIN_TURRET_CLEARANCE);
      });
    }
  });

  it('walks past its own turret row, in order, so a lane is defended along its length', () => {
    for (const lane of LANES) {
      const path = LANE_WAYPOINTS[lane];
      const indexOf = (p: Point) => nearestWaypoint(path, p).index;

      for (const point of laneTurrets(lane)) {
        expect(turret1.concat(turret2)).toContainEqual(point);
        const { distance } = nearestWaypoint(path, point);
        expect(
          distance,
          `${lane} passes turret ${point} at ${Math.round(distance)}px`
        ).toBeLessThanOrEqual(LANE_COVERS_TURRET);
      }
      // one waypoint per turret, so "the nearest" is unambiguous and no turret
      // shares its waypoint with the next one along the lane
      const allIndexes = laneTurrets(lane).map(indexOf);
      expect(new Set(allIndexes).size).toBe(allIndexes.length);

      // blue's row first, red's after: a lane is one route from one base to the other
      const blueIndexes = BLUE_LANE_TURRETS[lane].map(indexOf);
      const redIndexes = RED_LANE_TURRETS[lane].map(indexOf);
      expect(blueIndexes).toEqual([...blueIndexes].sort((a, b) => a - b));
      expect(redIndexes).toEqual([...redIndexes].sort((a, b) => a - b));
      expect(Math.max(...blueIndexes)).toBeLessThan(Math.min(...redIndexes));
    }
  });

  it('assigns every map turret to exactly one lane, or to a base', () => {
    // the two rows are 11 points each; 10 are lane turrets and the rest guard a
    // fountain. Nothing may be silently dropped when the paths are edited.
    const baseTurrets: Point[] = [
      [736, 5392],
      [5454, 779],
      [5646, 967],
    ];
    expect(turret1).toHaveLength(11);
    expect(turret2).toHaveLength(11);

    for (const point of [...turret1, ...turret2]) {
      const onBase = baseTurrets.some(([x, y]) => x === point[0] && y === point[1]);
      const { lane, distance } = owningLane(point);

      if (onBase) {
        // a base turret guards its fountain's open ground, off every route out
        expect(
          distance,
          `base turret ${point} is only ${Math.round(distance)}px from ${lane}`
        ).toBeGreaterThan(LANE_COVERS_TURRET);
        continue;
      }

      const expected = LANES.find(l =>
        laneTurrets(l).some(([x, y]) => x === point[0] && y === point[1])
      );
      expect(expected, `turret ${point} is on no lane's list`).toBeDefined();
      expect(lane, `turret ${point} is nearest ${lane}, not ${expected}`).toBe(expected);
      expect(distance).toBeLessThanOrEqual(LANE_COVERS_TURRET);
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
