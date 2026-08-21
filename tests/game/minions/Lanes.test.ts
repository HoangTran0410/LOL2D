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
import { summonersRiftGeometry } from '../../../src/content/maps/summonersRiftGeometry';

type Point = [number, number];
const walls = mapData.wall as Point[][];
// `turret1`/`turret2` used to be read straight off the map JSON
// (`mapData.turret1`/`.turret2`); they now come off the active map's own
// `slots.structure` — same points, same order (blue's row first, then
// red's — see `summonersRiftGeometry.ts`'s `TURRET_ROWS`), just read through
// the map definition instead of the raw file.
const turret1: Point[] = [];
const turret2: Point[] = [];
for (const slot of summonersRiftGeometry.slots.structure) {
  (slot.faction === 'blue' ? turret1 : turret2).push([slot.x, slot.y]);
}

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

/**
 * The same question asked of the *walk* rather than of the waypoints, which is
 * the one that decides whether a wave gets down its lane.
 *
 * A minion goes to its next waypoint with `moveTo` — a straight line, no
 * routing — so clearing the turrets at the waypoints and nowhere else buys
 * nothing. The old paths cleared every waypoint by 80px and then ran their
 * segments through turret centres at 4, 5, 8, 14, 19 and 22px: the wave drove
 * into the building, `UnitCollisionSystem` shoved it around, and it re-aimed
 * at the same line on the far side. That is the "minions hug the turret and
 * walk around it" report, and it was invisible to a waypoint-only check.
 *
 * 100 rather than the blocked radius: this is a *lane*, not a squeeze, and a
 * wave is six bodies pushing each other sideways. The real paths hold 118.
 */
const MIN_SEGMENT_TURRET_CLEARANCE = 100;

/**
 * A lane "covers" the turret it is meant to walk past within this radius,
 * measured to the path rather than to the nearest waypoint — there is no
 * longer one waypoint per turret, because a straight run that passes three of
 * them needs no bend. The paths measure 118-256px.
 */
const LANE_COVERS_TURRET = 280;

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

/**
 * How close a lane comes to `point`, and how far along it that happens.
 *
 * Measured to the polyline, not to the nearest vertex. The vertex answer used
 * to be the same thing only because the paths carried one waypoint per turret;
 * a straight run past three turrets has none of its own, and asking the
 * vertices then says a lane misses its own first turret by 410px while the
 * minion walking it passes at 196.
 */
const nearestOnPath = (
  path: LaneWaypoint[],
  [x, y]: Point
): { distance: number; along: number } => {
  let distance = Infinity;
  let along = 0;
  let travelled = 0;
  for (let i = 0; i + 1 < path.length; i++) {
    const from = path[i];
    const to = path[i + 1];
    const spanX = to.x - from.x;
    const spanY = to.y - from.y;
    const spanSq = spanX * spanX + spanY * spanY;
    const length = Math.sqrt(spanSq);
    let t = 0;
    if (spanSq > 0) {
      t = ((x - from.x) * spanX + (y - from.y) * spanY) / spanSq;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
    }
    const d = Math.hypot(x - (from.x + spanX * t), y - (from.y + spanY * t));
    if (d < distance) {
      distance = d;
      along = travelled + length * t;
    }
    travelled += length;
  }
  return { distance, along };
};

/** The worst turret clearance anywhere on the straight line a minion walks. */
const segmentTurretClearance = (
  a: LaneWaypoint,
  b: LaneWaypoint
): { clearance: number; at: LaneWaypoint } => {
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  const steps = Math.max(2, Math.ceil(length / 10));
  let worst = Infinity;
  let at = a;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = a.x + (b.x - a.x) * t;
    const y = a.y + (b.y - a.y) * t;
    const clearance = turretClearance(x, y);
    if (clearance < worst) {
      worst = clearance;
      at = { x: Math.round(x), y: Math.round(y) };
    }
  }
  return { clearance: worst, at };
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
 * round corners near each other, and a fixed radius wide enough to cover a
 * turret's own lane is also wide enough to let a neighbour claim it.
 */
const owningLane = (point: Point): { lane: string; distance: number; runnerUp: number } => {
  const ranked = LANES.map(lane => ({
    lane,
    distance: nearestOnPath(LANE_WAYPOINTS[lane], point).distance,
  })).sort((a, b) => a.distance - b.distance);
  return { lane: ranked[0].lane, distance: ranked[0].distance, runnerUp: ranked[1].distance };
};

/**
 * All three lanes leave through the same gap between the base turrets, so
 * within about 800px of a fountain "which lane is this" has no answer — MID's
 * exit from the blue base runs 127px from BOT's first turret, which is nearer
 * than BOT's own path gets to it. True of the old paths as much as these; the
 * old check only missed it because it measured to the nearest waypoint.
 * Ownership is asserted outside that shared ground, and stated here rather
 * than absorbed into a threshold.
 */
const SHARED_BASE_EXIT = 900;
const nearAFountain = ([x, y]: Point): boolean =>
  Math.hypot(x - BLUE_FOUNTAIN.x, y - BLUE_FOUNTAIN.y) < SHARED_BASE_EXIT ||
  Math.hypot(x - RED_FOUNTAIN.x, y - RED_FOUNTAIN.y) < SHARED_BASE_EXIT;

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

  /**
   * The bug the whole re-derivation was for, and the one the waypoint check
   * above structurally cannot see: a minion walks the *segment*, in a straight
   * line with no routing, so a path whose vertices all clear a turret and whose
   * runs between them go through one still drives every wave into a building.
   * The old paths measured 4px at the worst of it.
   */
  it('keeps the whole walk out of the turrets, not just the waypoints', () => {
    for (const lane of LANES) {
      const path = LANE_WAYPOINTS[lane];
      for (let i = 0; i + 1 < path.length; i++) {
        const { clearance, at } = segmentTurretClearance(path[i], path[i + 1]);
        expect(
          clearance,
          `${lane} segment ${i} (${path[i].x},${path[i].y}) -> (${path[i + 1].x},${path[i + 1].y}) ` +
            `passes ${Math.round(clearance)}px from a turret centre at (${at.x},${at.y}) — ` +
            `a minion body is blocked at ${TURRET_BLOCKED_RADIUS}px`
        ).toBeGreaterThanOrEqual(MIN_SEGMENT_TURRET_CLEARANCE);
      }
    }
  });

  it('walks past its own turret row, in order, so a lane is defended along its length', () => {
    for (const lane of LANES) {
      const path = LANE_WAYPOINTS[lane];
      const alongAt = (p: Point) => nearestOnPath(path, p).along;

      for (const point of laneTurrets(lane)) {
        expect(turret1.concat(turret2)).toContainEqual(point);
        const { distance } = nearestOnPath(path, point);
        expect(
          distance,
          `${lane} passes turret ${point} at ${Math.round(distance)}px`
        ).toBeLessThanOrEqual(LANE_COVERS_TURRET);
      }

      // Ordered by how far along the lane each turret is passed, rather than by
      // waypoint index — a straight run past three turrets has no vertex of its
      // own, so an index cannot separate them and a distance travelled can.
      const blueAlong = BLUE_LANE_TURRETS[lane].map(alongAt);
      const redAlong = RED_LANE_TURRETS[lane].map(alongAt);
      expect(blueAlong).toEqual([...blueAlong].sort((a, b) => a - b));
      expect(redAlong).toEqual([...redAlong].sort((a, b) => a - b));
      // blue's row first, red's after: a lane is one route from one base to the other
      expect(Math.max(...blueAlong)).toBeLessThan(Math.min(...redAlong));
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

      // Every base turret, and BOT's first, stands in the gap all three lanes
      // leave through. Nothing there belongs to one lane; the listing below is
      // still checked, only the "nearest lane owns it" part is skipped.
      if (nearAFountain(point)) {
        const expectedLane = LANES.find(l =>
          laneTurrets(l).some(([x, y]) => x === point[0] && y === point[1])
        );
        expect(onBase || expectedLane !== undefined).toBe(true);
        continue;
      }
      expect(onBase, `base turret ${point} sits outside the shared base exit`).toBe(false);

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

describe('the muster point a wave forms up on', () => {
  /**
   * `MinionSpawner.musterPointFor` puts a wave between the two turrets nearest
   * its own fountain. Those coordinates come out of this same map file, so the
   * pair is recomputed here from `turret1`/`turret2` rather than pasted — but
   * the *rule* is stated independently, so a spawner that started picking a
   * different pair would fail this rather than agree with itself.
   */
  const musterFor = (row: Point[], fountain: { x: number; y: number }) => {
    const byDistance = [...row].sort(
      (a, b) =>
        Math.hypot(a[0] - fountain.x, a[1] - fountain.y) -
        Math.hypot(b[0] - fountain.x, b[1] - fountain.y)
    );
    const [first, second] = byDistance;
    return { x: (first[0] + second[0]) / 2, y: (first[1] + second[1]) / 2 };
  };

  const MUSTERS = [
    { side: 'blue', at: musterFor(turret1, BLUE_FOUNTAIN) },
    { side: 'red', at: musterFor(turret2, RED_FOUNTAIN) },
  ];

  it.each(MUSTERS)('$side stands on open ground', ({ at }) => {
    expect(wallClearance(at.x, at.y)).toBeGreaterThan(MIN_CLEARANCE);
  });

  it.each(MUSTERS)('$side clears both turrets it forms up between', ({ at }) => {
    // A body inside a turret is shoved out by `UnitCollisionSystem` the moment
    // it appears, which reads as a wave exploding outward on spawn.
    for (const row of [turret1, turret2]) {
      for (const [tx, ty] of row) {
        const away = Math.hypot(at.x - tx, at.y - ty);
        expect(away).toBeGreaterThan(TURRET_BLOCKED_RADIUS);
      }
    }
  });

  it.each(MUSTERS)('$side keeps its whole scatter ring off the walls', ({ at }) => {
    // `MUSTER_SCATTER_PX` is 55, and a minion can land anywhere inside it.
    for (let i = 0; i < 16; i++) {
      const angle = (i / 16) * Math.PI * 2;
      const x = at.x + Math.cos(angle) * 55;
      const y = at.y + Math.sin(angle) * 55;
      expect(wallClearance(x, y)).toBeGreaterThan(MIN_CLEARANCE);
    }
  });
});
