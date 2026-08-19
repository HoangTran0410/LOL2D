import TeamId from './enums/TeamId';

export const Lane = {
  TOP: 'top',
  MID: 'mid',
  BOT: 'bot',
};
Object.freeze(Lane);

/** Iteration order for wave spawning — one wave per lane, per base. */
export const LANES: string[] = [Lane.TOP, Lane.MID, Lane.BOT];

export interface LaneWaypoint {
  x: number;
  y: number;
}

/**
 * Lane paths, ordered blue base -> red base. Red minions walk the same list
 * backwards (see `getLaneWaypoints`), so a lane is one piece of data, not two.
 *
 * summoner_map.json ships no lane geometry — only the two turret rows. These
 * paths follow those rows, split by which edge of the map they hug, with the
 * blue fountain (400, 6075) in front and the red one (6100, 375) behind:
 *
 *   turret1 (blue)                       turret2 (red)
 *     TOP  520,4432  604,3557  410,1859    TOP  1873,440  3423,595  4517,518
 *     MID 1617,4767 2153,4346 2543,3687    MID 3885,2723 4291,2044 4790,1617
 *     BOT  963,5626 1950,5837 2995,5775    BOT 5994,4467 5801,2864 5898,1922
 *          4558,5962
 *   base turret 736,5392                   base turrets 5454,779  5646,967
 *
 * The base turrets are not lane waypoints — they sit inside their fountain's
 * open ground rather than on a route out of it.
 *
 * ## A lane runs *past* each turret, and the segments are the lane
 *
 * A minion walks its lane with `moveTo` — a straight line to the next
 * waypoint, no routing (`Minion.updateWalk`). **So the lane is the segments,
 * not the waypoints**, and every guarantee has to hold along the whole of one.
 *
 * These paths used to be the turret coordinates nudged 80-108px to one side.
 * That cleared each *waypoint* of the turret's body — a turret is a 92px
 * immovable in `UnitCollisionSystem` and a minion is 34px across, so a minion
 * centre is held 63px out — and left the straight runs between them going
 * through the buildings: measured against the map, the segments passed turret
 * centres at 4, 5, 8, 14, 19 and 22px on BOT and MID. Every wave therefore
 * drove into the side of a turret, was shoved around it by the collision
 * system, and re-acquired the same line on the far side. That is the reported
 * bug, and the waypoint-only check that was supposed to catch it could not
 * see it at all.
 *
 * The paths below were re-derived from the wall polygons rather than nudged:
 * an A* over a 16px clearance grid in which a cell is blocked unless it is
 * 58px clear of a wall **and 118px from every turret centre**, with a cost
 * that prefers the middle of a corridor and is pulled toward this lane's own
 * turret row, then simplified to the fewest waypoints whose straight runs
 * keep both floors and do not stray more than 110px from the routed line.
 *
 * What that buys, measured over every segment of all three lanes:
 *
 *   - no point on any lane is closer than **118px** to a turret centre, so a
 *     minion body passes with 55px to spare instead of grinding along it
 *   - no point is closer than 58px to a wall (a minion has 17px of body)
 *   - each lane still passes each of its own turrets at 118-256px, well
 *     inside the range it is defended from
 *
 * `tests/game/minions/Lanes.test.ts` asserts all three, per segment. Anything
 * edited here has to be re-checked against it — the floors are comfortable but
 * the corridors they run down are 300-500px wide, and there is no room to lose.
 */
export const LANE_WAYPOINTS: Record<string, LaneWaypoint[]> = {
  // up the left edge, then right along the top
  [Lane.TOP]: [
    { x: 400, y: 6075 }, // blue fountain
    { x: 376, y: 4680 },
    { x: 696, y: 4456 }, // rounds turret 520,4432 on the east, passing at 121px
    { x: 456, y: 3448 }, // back to the middle past turret 604,3557 (119px)
    { x: 744, y: 1288 }, // one straight run up the left edge, 256px off 410,1859
    { x: 1592, y: 664 }, // the top-left turn
    { x: 3608, y: 456 }, // above turrets 1873,440 (194px) and 3423,595 (119px)
    { x: 4328, y: 584 },
    { x: 4792, y: 728 }, // dips under turret 4517,518, passing at 119px
    { x: 6100, y: 375 }, // red fountain
  ],

  // the diagonal
  [Lane.MID]: [
    { x: 400, y: 6075 }, // blue fountain
    { x: 1144, y: 5672 }, // leaves the base right of the lump at (720, 5750)
    { x: 1416, y: 5208 },
    { x: 1784, y: 4760 }, // past turret 1617,4767 at 125px
    { x: 2120, y: 4152 }, // past turret 2153,4346 at 123px
    { x: 2760, y: 3672 }, // past turret 2543,3687 at 118px
    { x: 4200, y: 2232 }, // the long diagonal, 124px off turret 3885,2723
    { x: 4472, y: 2088 }, // past turret 4291,2044 at 124px
    { x: 5976, y: 856 }, // past turret 4790,1617 at 163px, then the red base
    { x: 6100, y: 375 }, // red fountain
  ],

  // right along the bottom, then up the right edge
  [Lane.BOT]: [
    { x: 400, y: 6075 }, // blue fountain
    { x: 1512, y: 5608 }, // past turret 963,5626 at 196px
    { x: 3096, y: 5928 }, // past turrets 1950,5837 (138px) and 2995,5775 (130px)
    { x: 5080, y: 5656 }, // one run along the bottom, 232px off 4558,5962
    { x: 5816, y: 4712 }, // the bottom-right turn, 164px off turret 5994,4467
    { x: 5944, y: 2424 }, // straight up the right edge, 118px off 5801,2864
    { x: 5736, y: 1832 }, // steps inside turret 5898,1922, passing at 123px
    { x: 6088, y: 1576 },
    { x: 6100, y: 375 }, // red fountain
  ],
};

// Reversed once at module load rather than per wave: a spawner asks for a path
// every few seconds and hands the same array to every minion in the wave.
const RED_LANE_WAYPOINTS: Record<string, LaneWaypoint[]> = {
  [Lane.TOP]: [...LANE_WAYPOINTS[Lane.TOP]].reverse(),
  [Lane.MID]: [...LANE_WAYPOINTS[Lane.MID]].reverse(),
  [Lane.BOT]: [...LANE_WAYPOINTS[Lane.BOT]].reverse(),
};

/**
 * The lane a minion of `teamId` should walk, from its own base outwards. The
 * returned array is shared — a minion tracks its progress with an index and
 * must never mutate it.
 */
export const getLaneWaypoints = (lane: string, teamId: string): LaneWaypoint[] => {
  const paths = teamId === TeamId.RED ? RED_LANE_WAYPOINTS : LANE_WAYPOINTS;
  return paths[lane] ?? paths[Lane.MID];
};

/**
 * The first waypoint on this team's path that lies *ahead* of `(x, y)`.
 *
 * A wave used to leave from the fountain, which is waypoint 0 of every lane, so
 * `MinionSpawner` could hard-code `startWaypointIndex: 1`. It musters between
 * the two turrets guarding the base now, which is already past waypoint 1 on
 * two of the three lanes — and a minion sent to a waypoint it has walked past
 * turns round, walks back down to it, and only then sets off. Visible from the
 * first wave of a match.
 *
 * The point is projected onto the polyline and the far end of the nearest
 * segment is the answer. Never 0: a minion is never sent back to its own
 * fountain, whatever it is standing on.
 */
export function nextWaypointIndexFrom(lane: string, teamId: string, x: number, y: number): number {
  const path = getLaneWaypoints(lane, teamId);
  if (path.length < 2) return 0;

  let best = 1;
  let bestDistanceSq = Number.POSITIVE_INFINITY;
  for (let i = 1; i < path.length; i++) {
    const from = path[i - 1];
    const to = path[i];
    const spanX = to.x - from.x;
    const spanY = to.y - from.y;
    const spanSq = spanX * spanX + spanY * spanY;
    // `along`, not `dist` or `map` — both are p5 globals in this project and a
    // local of the same name shadows one silently. See CLAUDE.md.
    let along = 0;
    if (spanSq > 0) {
      along = ((x - from.x) * spanX + (y - from.y) * spanY) / spanSq;
      along = along < 0 ? 0 : along > 1 ? 1 : along;
    }
    const offX = x - (from.x + spanX * along);
    const offY = y - (from.y + spanY * along);
    const distanceSq = offX * offX + offY * offY;
    // Strictly better, so a point sitting exactly on a waypoint keeps the
    // earlier segment and the answer never depends on iteration luck.
    if (distanceSq < bestDistanceSq) {
      bestDistanceSq = distanceSq;
      best = i;
    }
  }
  return best;
}
