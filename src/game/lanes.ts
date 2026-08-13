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
 * paths are those rows, split by which edge of the map they hug, with the blue
 * fountain (400, 6075) in front and the red one (6100, 375) behind:
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
 * The turret rows alone do not make a walkable path: joining the fountains to
 * the first turret, and turning the two corners of the map, cuts straight
 * through wall polygons. The extra waypoints marked "corner" below were found
 * by A*-ing over a clearance grid built from the `wall` layer and then
 * simplifying, so every straight segment between consecutive waypoints stays at
 * least 69px clear of the nearest wall. A minion is 34px across (17px radius),
 * so it walks the whole lane with ~50px of slack on either side. Anything
 * edited here should be re-checked against those polygons — the tolerance is
 * generous but it is not infinite.
 */
export const LANE_WAYPOINTS: Record<string, LaneWaypoint[]> = {
  // up the left edge, then right along the top
  [Lane.TOP]: [
    { x: 400, y: 6075 }, // blue fountain
    { x: 350, y: 4710 }, // corner: squeezes left of the wall lump at (525, 4860)
    { x: 520, y: 4432 },
    { x: 604, y: 3557 },
    { x: 410, y: 1859 },
    { x: 1160, y: 890 }, // corner: the top-left turn
    { x: 1873, y: 440 },
    { x: 3423, y: 595 },
    { x: 4517, y: 518 },
    { x: 4910, y: 310 }, // corner: passes above the wall at (4870, 470)
    { x: 6100, y: 375 }, // red fountain
  ],

  // the diagonal
  [Lane.MID]: [
    { x: 400, y: 6075 }, // blue fountain
    { x: 1010, y: 5740 }, // corner: leaves the base right of the lump at (720, 5750)
    { x: 1615, y: 4960 }, // corner: enters the mid corridor
    { x: 1617, y: 4767 },
    { x: 2153, y: 4346 },
    { x: 2543, y: 3687 },
    { x: 3885, y: 2723 },
    { x: 4291, y: 2044 },
    { x: 4790, y: 1617 },
    { x: 5260, y: 1460 }, // corner: threads the walls below the red base
    { x: 6010, y: 710 }, // corner
    { x: 6100, y: 375 }, // red fountain
  ],

  // right along the bottom, then up the right edge
  [Lane.BOT]: [
    { x: 400, y: 6075 }, // blue fountain
    { x: 940, y: 5790 }, // corner: rounds the wall lump at (720, 5750)
    { x: 963, y: 5626 },
    { x: 1790, y: 5710 }, // corner: passes above the wall at (1490, 5840)
    { x: 1950, y: 5837 },
    { x: 2995, y: 5775 },
    { x: 4558, y: 5962 },
    { x: 5490, y: 5240 }, // corner: the bottom-right turn
    { x: 5994, y: 4467 },
    { x: 5801, y: 2864 },
    { x: 5898, y: 1922 },
    { x: 6090, y: 1510 }, // corner: hugs the right edge past the wall at (5960, 1560)
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
