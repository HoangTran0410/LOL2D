import TeamId from '@/game/enums/TeamId';
import { getLaneWaypoints, LANES, LANE_WAYPOINTS, type LaneWaypoint } from '@/game/lanes';
import type AttackableUnit from '@/game/gameObject/attackableUnits/AttackableUnit';
import type { Vec2 } from '@/game/spell/runtime/types';

/**
 * The map's economy, as a bot sees it: which lane a thing is in, how far down
 * that lane it has got, how badly a lane wants somebody, and which bot goes
 * where.
 *
 * Everything here is pure. `TeamBlackboard` gathers the units — inside the one
 * pass it already makes over the object list — and this module turns that into
 * numbers; `BotBrain` reads the answer. Keeping the arithmetic out of both is
 * what lets the whole layer be tested without a running match.
 *
 * Only `lanes.ts` is imported for geometry, so the waypoint paths stay the one
 * description of where a lane is. Editing them retunes this for free.
 */

/**
 * How far off a lane a champion may stand and still count as "in" it.
 *
 * A lane is a polyline, not a corridor, and the map's lanes are 60-90px of
 * walkable gap in the jungle and much wider along the edges. This is the width
 * of the *interest* in a lane rather than its walkable width: a champion in the
 * river beside mid is pressuring mid, one in the enemy jungle is not in any
 * lane at all.
 *
 * The three paths are not 700px apart everywhere and do not have to be —
 * `nearestLane` returns exactly one lane, so an overlap is a tie broken by
 * distance rather than a champion counted twice. Measured against the shipped
 * waypoints (ignoring the shared fountain ends, where all three paths start on
 * the same point): TOP is 889px from BOT and 1048px from MID at their closest,
 * and MID and BOT come within 304px of each other on the way out of the blue
 * base. So this number decides one thing only — how far into the jungle a
 * champion can be and still count as pressuring the nearest lane.
 */
export const LANE_MEMBERSHIP_PX = 700;

/** Every lane wants somebody, even a quiet one. */
export const LANE_NEED_BASE = 4;
/** Per minion of enemy surplus. Negative surplus lowers the need by the same. */
export const LANE_NEED_MINION_DEFICIT = 1.5;
/** Full weight when our own front turret in the lane is gone. */
export const LANE_NEED_OWN_TURRET_HURT = 12;
/** Full weight when the next enemy turret is one hit from falling. */
export const LANE_NEED_ENEMY_TURRET_HURT = 10;
/** Per enemy champion standing in the lane. */
export const LANE_NEED_ENEMY_PRESENT = 6;

/**
 * What a lane's need is docked per bot already sent there.
 *
 * Sized above the ordinary spread between three lanes, so the default is one
 * bot per lane and doubling up is a decision the numbers had to earn — a lane
 * has to out-need its neighbour by more than this before a second bot walks to
 * it.
 */
export const LANE_CROWDING_PENALTY = 20;
/**
 * How much better another lane has to look before a bot walks out of the one
 * it is in.
 *
 * Without it the assignment is recomputed every `BLACKBOARD_TTL_MS` off numbers
 * that move every wave, and a bot spends the match walking between two lanes
 * that are one minion apart. Read as an incumbency bonus below, which is the
 * same rule stated from the lane's side.
 */
export const LANE_SWITCH_MARGIN = 8;

/** Where a point sits relative to the lane nearest it. */
export interface LanePoint {
  /**
   * `null` only when `LANES` is empty (a laneless map, Task 8) — there is
   * nothing to be nearest *to*. `distance` stays `Infinity` in exactly that
   * case, so every caller today already gates on `distance <=
   * LANE_MEMBERSHIP_PX` before reading this and never observes the `null`,
   * but the type says so honestly rather than lying with a placeholder id a
   * direct caller could read past the distance check.
   */
  lane: string | null;
  /** Shortest distance from the point to the lane polyline, in pixels. */
  distance: number;
  /** 0 at the blue end of the lane, 1 at the red end. */
  progress: number;
}

/** What `laneNeed` prices. One lane, from one team's side of it. */
export interface LaneNeedInput {
  alliedMinions: number;
  enemyMinions: number;
  /**
   * Health fraction of our most advanced living turret in the lane, or 0 when
   * we have none left there — nothing defending a lane is the most urgent
   * reading of this term, not the absence of one.
   */
  ownTurretHealthPct: number;
  /** Health fraction of the next enemy turret, or 0 when the lane is open. */
  enemyTurretHealthPct: number;
  enemyChampions: number;
}

/** One lane as the blackboard publishes it, from one team's side. */
export interface LaneState extends LaneNeedInput {
  lane: string;
  /**
   * The most advanced friendly minion in the lane — where our wave has got to,
   * and the first thing a pushing bot walks toward.
   */
  frontier: Vec2 | null;
  /** The living hostile turret nearest our own base: the next one to break. */
  nextEnemyTurret: AttackableUnit | null;
  /** Our most advanced living turret: the first one their push meets. */
  ownTurret: AttackableUnit | null;
  need: number;
}

interface LaneGeometry {
  waypoints: readonly LaneWaypoint[];
  /** Arc length from the blue end to each waypoint. */
  arcLengths: readonly number[];
  total: number;
}

let geometryCache: Record<string, LaneGeometry> | null = null;
let geometryCacheFor: readonly string[] | null = null;

function buildLaneGeometry(lanes: readonly string[]): Record<string, LaneGeometry> {
  const built: Record<string, LaneGeometry> = {};
  for (const lane of lanes) {
    const waypoints = LANE_WAYPOINTS[lane] ?? [];
    const arcLengths: number[] = [];
    let running = 0;
    for (let i = 0; i < waypoints.length; i++) {
      if (i > 0) {
        running += Math.hypot(
          waypoints[i].x - waypoints[i - 1].x,
          waypoints[i].y - waypoints[i - 1].y
        );
      }
      arcLengths.push(running);
    }
    built[lane] = { waypoints, arcLengths, total: running };
  }
  return built;
}

/**
 * Built on first use, not at module load. One polyline per active lane,
 * walked by every minion and every turret the blackboard buckets — cheap per
 * call, but not cheap enough to rebuild the cumulative lengths on each one,
 * so the result is memoised.
 *
 * Keyed on `LANES`'s own *identity*, not a boolean latch: `lanes.ts`'s
 * `setActiveLanes` reassigns `LANES` to a fresh array rather than mutating it
 * in place exactly so this invalidates for free the moment a match installs
 * a different map's lanes (or none at all) — a boolean would go stale the
 * first time a test installed a different map without also flipping it.
 */
function laneGeometry(): Record<string, LaneGeometry> {
  if (geometryCache && geometryCacheFor === LANES) return geometryCache;
  geometryCache = buildLaneGeometry(LANES);
  geometryCacheFor = LANES;
  return geometryCache;
}

/**
 * How far along a lane a point is, 0 at the blue end and 1 at the red end.
 *
 * The point is projected onto the polyline, so a champion standing beside the
 * lane still reads as being level with it. A point past either end clamps.
 * A lane nobody ships reads as 0 rather than throwing — `Minion.lane` defaults
 * to the empty string.
 */
export function laneProgressAt(lane: string, x: number, y: number): number {
  const geometry = laneGeometry()[lane];
  if (!geometry || geometry.total <= 0) return 0;
  return projectOnto(geometry, x, y).progress;
}

/** The lane nearest a point, how far off it the point is, and how far along. */
export function nearestLane(x: number, y: number): LanePoint {
  let best: LanePoint = { lane: LANES[0] ?? null, distance: Number.POSITIVE_INFINITY, progress: 0 };
  const geo = laneGeometry();
  for (const lane of LANES) {
    const geometry = geo[lane];
    if (!geometry || geometry.total <= 0) continue;
    const hit = projectOnto(geometry, x, y);
    // Strictly better, so a tie keeps the earlier lane and the answer never
    // depends on iteration luck. LANES is the order.
    if (hit.distance < best.distance) best = { lane, ...hit };
  }
  return best;
}

/**
 * The same progress read from `teamId`'s side: 0 at its own base, 1 at the
 * enemy's. Red walks the shipped path backwards — the rule `getLaneWaypoints`
 * already applies to minions — so "most advanced" is a maximum for both teams
 * rather than a maximum for one and a minimum for the other.
 */
export const laneAdvance = (teamId: string, progress: number): number =>
  teamId === TeamId.RED ? 1 - progress : progress;

/**
 * The deepest lane waypoint a bot should walk to when the lane holds nothing
 * else — the last one before the enemy fountain, never the fountain itself. A
 * bot ordered onto the enemy spawn is a bot that dies to four respawns.
 */
export function laneApproach(lane: string, teamId: string): Vec2 | null {
  const path = getLaneWaypoints(lane, teamId);
  // `getLaneWaypoints` falls back to MID for an unknown lane; this layer wants
  // the honest "there is no such lane" instead.
  if (!laneGeometry()[lane] || path.length === 0) return null;
  const chosen = path[path.length - 2] ?? path[path.length - 1];
  return { x: chosen.x, y: chosen.y };
}

/** How badly one lane wants a bot. Higher is needier. */
export function laneNeed(input: LaneNeedInput): number {
  return (
    LANE_NEED_BASE +
    LANE_NEED_MINION_DEFICIT * (input.enemyMinions - input.alliedMinions) +
    LANE_NEED_OWN_TURRET_HURT * (1 - input.ownTurretHealthPct) +
    LANE_NEED_ENEMY_TURRET_HURT * (1 - input.enemyTurretHealthPct) +
    LANE_NEED_ENEMY_PRESENT * input.enemyChampions
  );
}

/**
 * Which lane each bot takes.
 *
 * One pass in the caller's order, each bot taking the neediest lane left after
 * the dock for whoever is already going there, plus an incumbency bonus for the
 * lane it is already in. That last term is the hysteresis: a lane has to beat
 * the current one by more than `LANE_SWITCH_MARGIN` before the bot moves, so
 * the assignment survives a wave dying.
 *
 * Deterministic in two ways a test can hold on to: the lane loop is `LANES`
 * order, so an exact tie always goes to TOP then MID then BOT, and `units` is
 * consumed in the order given — the blackboard passes roster order, which is
 * spawn order, not a uuid.
 *
 * Generic over the unit so nothing about `Champion` reaches this file.
 */
export function assignLanes<T>(
  units: readonly T[],
  needs: ReadonlyMap<string, number>,
  previous: ReadonlyMap<T, string>
): Map<T, string> {
  const assigned = new Map<T, string>();
  const taken = new Map<string, number>();
  const geo = laneGeometry();

  for (const unit of units) {
    const incumbent = previous.get(unit);
    const held = incumbent !== undefined && geo[incumbent] ? incumbent : null;
    let best: string | null = null;
    let bestScore = Number.NEGATIVE_INFINITY;

    // The lane it is already in is scored first, so a tie keeps it there: a
    // rival that draws level has not "beaten it by a margin", and letting the
    // LANES order decide a draw would hand every level board to TOP and undo
    // the hysteresis the bonus below exists for.
    if (held !== null) {
      best = held;
      bestScore = laneScore(needs, taken, held) + LANE_SWITCH_MARGIN;
    }

    for (const lane of LANES) {
      if (lane === held) continue;
      const score = laneScore(needs, taken, lane);
      if (score > bestScore) {
        bestScore = score;
        best = lane;
      }
    }

    if (best === null) continue;
    assigned.set(unit, best);
    taken.set(best, (taken.get(best) ?? 0) + 1);
  }
  return assigned;
}

const laneScore = (
  needs: ReadonlyMap<string, number>,
  taken: ReadonlyMap<string, number>,
  lane: string
): number => (needs.get(lane) ?? 0) - LANE_CROWDING_PENALTY * (taken.get(lane) ?? 0);

/**
 * Closest approach from a point to one lane's polyline.
 *
 * `along` and `across`, never `dist` or `map` — both are p5 globals in this
 * project and a local of the same name shadows one silently (see CLAUDE.md).
 */
function projectOnto(
  geometry: LaneGeometry,
  x: number,
  y: number
): { distance: number; progress: number } {
  const { waypoints, arcLengths, total } = geometry;
  let bestDistanceSq = Number.POSITIVE_INFINITY;
  let bestArc = 0;

  for (let i = 1; i < waypoints.length; i++) {
    const from = waypoints[i - 1];
    const to = waypoints[i];
    const spanX = to.x - from.x;
    const spanY = to.y - from.y;
    const spanSq = spanX * spanX + spanY * spanY;
    let along = 0;
    if (spanSq > 0) {
      along = ((x - from.x) * spanX + (y - from.y) * spanY) / spanSq;
      along = along < 0 ? 0 : along > 1 ? 1 : along;
    }
    const acrossX = x - (from.x + spanX * along);
    const acrossY = y - (from.y + spanY * along);
    const distanceSq = acrossX * acrossX + acrossY * acrossY;
    if (distanceSq < bestDistanceSq) {
      bestDistanceSq = distanceSq;
      bestArc = arcLengths[i - 1] + (arcLengths[i] - arcLengths[i - 1]) * along;
    }
  }

  return { distance: Math.sqrt(bestDistanceSq), progress: bestArc / total };
}
