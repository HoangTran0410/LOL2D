import NavGrid, { navNow, type NavPoint } from './NavGrid';

/**
 * A* over a NavGrid, plus the string pull that turns its staircase into
 * something a unit can walk.
 *
 * ## The search
 *
 * 8-connected, with the octile heuristic — `(dx + dy) + (sqrt2 - 2) * min(dx, dy)`
 * — which is the exact cost of an unobstructed 8-connected walk and therefore
 * both admissible and consistent. Diagonal steps are refused when either
 * orthogonal neighbour is blocked, so a path never squeezes through the
 * diagonal gap between two wall corners.
 *
 * The heuristic is then **weighted**, which trades optimality for expansions.
 * Measured over 178 reachable orders scattered across this map, and the walk
 * from the blue fountain to the jungle boss's camp as the hard case:
 *
 *   weight   median   p99      worst    route length
 *   1.0      —        —        —        (boss camp: 6,532 expansions)
 *   1.2        771    7,647    15,568   baseline
 *   1.5        395    5,166    13,591   +0.7%
 *   2.0        303    3,622     5,649   +2.1%   <- shipped
 *   3.0        253    3,909     4,728   +5.2%
 *
 * 2.0 cuts the worst case by 2.8x for routes 2% longer, and string pulling
 * flattens most of even that — the mean walked distance moves by 80 world units
 * out of 3,800. A route a hair off optimal is invisible in a game; a 5ms search
 * on a 16ms frame is not.
 *
 * ## Keeping a search bounded
 *
 * Two limits, because they fail differently:
 *
 * - `nodeBudget` caps expansions for one search. A *reachable* goal costs 303
 *   expansions at the median and 5,649 at the measured worst; a genuinely
 *   unreachable one costs 66,000, because A* can only rule it out by exhausting
 *   the whole connected component. The cap is what separates those two.
 * - When the cap is hit, or the component is exhausted, the search does not
 *   come back empty: it returns the path to the node that got *closest* to the
 *   goal, with `ok: false`. That is the graceful answer to an unreachable
 *   order — the unit walks as far as it can — and it is also what makes the cap
 *   safe to set aggressively, because `PathAgent` re-plans from wherever the
 *   truncated route left it and the second search starts much nearer.
 *
 * ## Allocation
 *
 * Every buffer is allocated once, at construction, and reused. Clearing 71,289
 * entries per search would cost more than the search; instead each cell carries
 * a generation stamp, and a stamp that does not match the current generation
 * means "never visited". A search therefore touches only the cells it expands.
 */

/** Heuristic weight. See the table above — measured, not guessed. */
export const NAV_HEURISTIC_WEIGHT = 2;

/**
 * Expansions one search may spend before it settles for the closest node
 * reached. The worst reachable order measured on this map costs 5,649, so this
 * clears every real route with room to spare while holding an unreachable one —
 * which would otherwise exhaust 66,000 cells — to about 2.5ms. A reachable
 * route that somehow overran it is not lost either: the truncated result still
 * walks the unit most of the way, and it re-plans from there.
 */
export const NAV_MAX_NODES_PER_SEARCH = 8_000;

/** How far from a blocked start or goal the search will look for standable ground. */
export const NAV_SNAP_DISTANCE = 700;

const SQRT2 = Math.SQRT2;
const DIAGONAL_COST = SQRT2 - 2;
const NEIGHBOUR_DX = [1, -1, 0, 0, 1, 1, -1, -1];
const NEIGHBOUR_DY = [0, 0, 1, -1, 1, -1, 1, -1];

export interface PathSearchOptions {
  /** Body radius the path must fit. */
  radius: number;
  /** Expansion cap for this one search. */
  nodeBudget?: number;
  /** Overrides NAV_HEURISTIC_WEIGHT. Exposed so the weight can be measured. */
  heuristicWeight?: number;
}

export interface PathResult {
  /** True when the goal itself was reached. False means `waypoints` is a best effort. */
  ok: boolean;
  /** Flat world coordinates `[x0, y0, x1, y1, ...]`, starting past the origin point. */
  waypoints: number[];
  /** Cells expanded. */
  expanded: number;
  /** Wall-clock cost, including snapping and smoothing. */
  elapsedMs: number;
  /** Why a search produced nothing usable at all. */
  failure?: 'NO_START' | 'NO_GOAL' | 'NO_PATH';
}

export default class PathFinder {
  readonly grid: NavGrid;

  private readonly gScore: Float32Array;
  private readonly fScore: Float32Array;
  private readonly cameFrom: Int32Array;
  private readonly stamp: Int32Array;
  private readonly closed: Uint8Array;
  private readonly heap: Int32Array;
  private heapSize = 0;
  private generation = 0;

  /** Reused between searches so reconstruction and smoothing allocate nothing. */
  private readonly rawPath: number[] = [];

  constructor(grid: NavGrid) {
    this.grid = grid;
    const cells = grid.cols * grid.rows;
    this.gScore = new Float32Array(cells);
    this.fScore = new Float32Array(cells);
    this.cameFrom = new Int32Array(cells);
    this.stamp = new Int32Array(cells);
    this.closed = new Uint8Array(cells);
    this.heap = new Int32Array(cells + 1);
  }

  /** Bytes held by the search scratch space. Reported by the perf harness. */
  get memoryBytes(): number {
    return (
      this.gScore.byteLength +
      this.fScore.byteLength +
      this.cameFrom.byteLength +
      this.stamp.byteLength +
      this.closed.byteLength +
      this.heap.byteLength
    );
  }

  search(
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    {
      radius,
      nodeBudget = NAV_MAX_NODES_PER_SEARCH,
      heuristicWeight = NAV_HEURISTIC_WEIGHT,
    }: PathSearchOptions
  ): PathResult {
    const startedAt = navNow();
    const grid = this.grid;
    const required = grid.requiredClearance(radius);

    // A unit shoved into a wall by body separation, and a click on one, are the
    // same problem seen from both ends: find the nearest ground the body fits
    // on and use that instead of refusing the order.
    const start = grid.nearestWalkable(fromX, fromY, radius, NAV_SNAP_DISTANCE);
    if (!start) {
      return {
        ok: false,
        waypoints: [],
        expanded: 0,
        elapsedMs: navNow() - startedAt,
        failure: 'NO_START',
      };
    }
    const goal = grid.nearestWalkable(toX, toY, radius, NAV_SNAP_DISTANCE);
    if (!goal) {
      return {
        ok: false,
        waypoints: [],
        expanded: 0,
        elapsedMs: navNow() - startedAt,
        failure: 'NO_GOAL',
      };
    }

    const cols = grid.cols;
    const rows = grid.rows;
    const startIndex = grid.cellY(start.y) * cols + grid.cellX(start.x);
    const goalX = grid.cellX(goal.x);
    const goalY = grid.cellY(goal.y);
    const goalIndex = goalY * cols + goalX;

    const generation = ++this.generation;
    this.heapSize = 0;

    const { gScore, fScore, cameFrom, stamp, closed } = this;
    stamp[startIndex] = generation;
    closed[startIndex] = 0;
    gScore[startIndex] = 0;
    cameFrom[startIndex] = -1;
    fScore[startIndex] = this.heuristic(startIndex, goalX, goalY) * heuristicWeight;
    this.heapPush(startIndex);

    let expanded = 0;
    let bestIndex = startIndex;
    let bestHeuristic = this.heuristic(startIndex, goalX, goalY);
    let reached = false;

    while (this.heapSize > 0) {
      const current = this.heapPop();
      if (closed[current] === 1) continue;
      closed[current] = 1;

      if (current === goalIndex) {
        bestIndex = current;
        reached = true;
        break;
      }

      expanded++;
      if (expanded >= nodeBudget) break;

      const cx = current % cols;
      const cy = (current / cols) | 0;
      const currentG = gScore[current];

      for (let k = 0; k < 8; k++) {
        const nx = cx + NEIGHBOUR_DX[k];
        const ny = cy + NEIGHBOUR_DY[k];
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;

        const neighbour = ny * cols + nx;
        if (grid.clearance[neighbour] < required) continue;
        if (
          k >= 4 &&
          (grid.clearance[cy * cols + nx] < required || grid.clearance[ny * cols + cx] < required)
        ) {
          // no cutting the diagonal gap between two wall corners
          continue;
        }

        const tentative = currentG + (k >= 4 ? SQRT2 : 1);
        if (stamp[neighbour] === generation) {
          if (closed[neighbour] === 1 || tentative >= gScore[neighbour]) continue;
        }

        stamp[neighbour] = generation;
        closed[neighbour] = 0;
        gScore[neighbour] = tentative;
        cameFrom[neighbour] = current;

        const h = this.heuristic(neighbour, goalX, goalY);
        fScore[neighbour] = tentative + h * heuristicWeight;
        if (h < bestHeuristic) {
          bestHeuristic = h;
          bestIndex = neighbour;
        }
        this.heapPush(neighbour);
      }
    }

    if (!reached && bestIndex === startIndex) {
      // nowhere better than standing still was found
      return {
        ok: false,
        waypoints: [],
        expanded,
        elapsedMs: navNow() - startedAt,
        failure: 'NO_PATH',
      };
    }

    // the *snapped* goal, not the raw one: a click inside a wall must land on
    // the ground it was pulled onto, never back in the wall
    const startWasSnapped = start.x !== fromX || start.y !== fromY;
    const waypoints = this.reconstruct(
      bestIndex,
      generation,
      fromX,
      fromY,
      goal.x,
      goal.y,
      reached,
      radius,
      startWasSnapped
    );
    return { ok: reached, waypoints, expanded, elapsedMs: navNow() - startedAt };
  }

  private heuristic(index: number, goalX: number, goalY: number): number {
    const cols = this.grid.cols;
    const dx = Math.abs((index % cols) - goalX);
    const dy = Math.abs(((index / cols) | 0) - goalY);
    return dx + dy + DIAGONAL_COST * Math.min(dx, dy);
  }

  /**
   * Walks `cameFrom` back to the start, then hands the cell centres to the
   * smoother anchored at the unit's real position.
   *
   * The start cell centre is deliberately *kept* rather than overwritten with
   * the unit's position: when the start was snapped — a unit standing inside a
   * wall, or merely in the moat `NavGrid.requiredClearance` describes — that
   * cell is A way out, and dropping it unconditionally would aim the first
   * segment straight back through real geometry when the snap was for an
   * actual wall. When the start was not snapped the unit is already standing
   * on that cell, so the smoother drops the point on its own at no cost.
   * `smoothPath` gets `startWasSnapped` so it can go further for the moat
   * case specifically — see its own doc for why keeping the point there is
   * often a needless, visible backwards step rather than a safety net. The
   * goal end is the reverse: on success the real goal replaces its cell
   * centre, so an order lands where it was given rather than up to a cell off
   * it.
   */
  private reconstruct(
    endIndex: number,
    generation: number,
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    reached: boolean,
    radius: number,
    startWasSnapped: boolean
  ): number[] {
    const grid = this.grid;
    const cols = grid.cols;
    const raw = this.rawPath;
    raw.length = 0;

    let node = endIndex;
    let guard = cols * grid.rows;
    while (node !== -1 && guard-- > 0) {
      raw.push(grid.centreX(node % cols), grid.centreY((node / cols) | 0));
      if (this.stamp[node] !== generation) break;
      node = this.cameFrom[node];
    }
    // collected goal-first; flip to start-first, in pairs
    for (let head = 0, tail = raw.length - 2; head < tail; head += 2, tail -= 2) {
      const x = raw[head];
      const y = raw[head + 1];
      raw[head] = raw[tail];
      raw[head + 1] = raw[tail + 1];
      raw[tail] = x;
      raw[tail + 1] = y;
    }

    if (reached && raw.length >= 2) {
      raw[raw.length - 2] = toX;
      raw[raw.length - 1] = toY;
    }

    return smoothPath(fromX, fromY, raw, grid, radius, startWasSnapped);
  }

  // ------------------------------------------------------------ binary heap

  private heapPush(index: number): void {
    const heap = this.heap;
    const fScore = this.fScore;
    let child = ++this.heapSize;
    heap[child] = index;
    while (child > 1) {
      const parent = child >> 1;
      if (fScore[heap[parent]] <= fScore[heap[child]]) break;
      const swap = heap[parent];
      heap[parent] = heap[child];
      heap[child] = swap;
      child = parent;
    }
  }

  private heapPop(): number {
    const heap = this.heap;
    const fScore = this.fScore;
    const top = heap[1];
    heap[1] = heap[this.heapSize--];
    let parent = 1;
    for (;;) {
      const left = parent << 1;
      const right = left + 1;
      let smallest = parent;
      if (left <= this.heapSize && fScore[heap[left]] < fScore[heap[smallest]]) smallest = left;
      if (right <= this.heapSize && fScore[heap[right]] < fScore[heap[smallest]]) smallest = right;
      if (smallest === parent) break;
      const swap = heap[parent];
      heap[parent] = heap[smallest];
      heap[smallest] = swap;
      parent = smallest;
    }
    return top;
  }
}

/**
 * String pull: drop every point the unit can already see past.
 *
 * A raw grid path is a staircase of 24px steps and reads as a robot walking on
 * graph paper. Anchored at the unit's own position, this advances while the
 * *next* point is still directly reachable and emits only the last one that
 * was — the same line-of-sight simplification `lanes.ts` was hand-built with
 * offline.
 *
 * It cannot cut a corner, because the test it uses is `NavGrid.isLineClear` at
 * the same body radius the search ran with, and that enumerates every cell the
 * segment crosses rather than sampling along it. Stopping at the first failure
 * rather than hunting for the furthest visible point keeps this to roughly one
 * line test per point on the raw path.
 *
 * `points` is the flat list of grid cell centres, start-first. The anchor is
 * never emitted — the unit is already standing on it.
 *
 * `startWasSnapped` marks the case where `points[0]` is not a real routing
 * decision at all: it is `nearestWalkable`'s answer to "the origin itself
 * fails `requiredClearance`", which is true both deep inside a wall *and*
 * anywhere in the moat that margin deliberately leaves around one (see
 * `NavGrid.requiredClearance`). `nearestWalkable` picks by raw distance, with
 * no notion of which way the route is headed, so on this map it sends a
 * unit's very first step backwards about three times out of four when the
 * goal is short and the origin is in that moat — a step the unit visibly
 * takes before turning round, which reads as freezing at a gap between two
 * walls. The fix does not touch `nearestWalkable` — it is exactly right for
 * its other callers, a click on a wall and a unit squeezed into one by
 * separation, which have no "wrong direction" to avoid. Instead, when the
 * start was snapped and the *next* point is directly reachable from the
 * unit's real position at its bare `radius` — no nav margin, because the nav
 * margin is what made the origin's own cell fail in the first place — the
 * snapped point is dropped outright: a body that actually fits along that
 * line has no reason to detour through a cell that only existed to give the
 * search a legal start node. `isLineClearAt` still refuses the line outright
 * when the origin is genuinely inside a wall (its own cell fails even the
 * bare-radius check), so this never cuts a corner through real geometry —
 * see `tests/game/nav/PathFinder.test.ts`.
 */
export function smoothPath(
  originX: number,
  originY: number,
  points: readonly number[],
  grid: NavGrid,
  radius: number,
  startWasSnapped = false
): number[] {
  const out: number[] = [];
  if (points.length < 2) return out;

  let anchorX = originX;
  let anchorY = originY;
  let candidate = 0;

  while (candidate < points.length) {
    let furthest = candidate;
    let probe = candidate + 2;
    while (
      probe < points.length &&
      grid.isLineClear(anchorX, anchorY, points[probe], points[probe + 1], radius)
    ) {
      furthest = probe;
      probe += 2;
    }
    anchorX = points[furthest];
    anchorY = points[furthest + 1];
    out.push(anchorX, anchorY);
    candidate = furthest + 2;
  }

  if (out.length >= 4) {
    // The first grid cell is the one the unit is standing in whenever the
    // start was not snapped, so an order that needed no detour would
    // otherwise begin by walking on the spot.
    const stoodOnAlready = Math.hypot(out[0] - originX, out[1] - originY) < grid.cellSize * 0.75;
    // The snapped-start case above: the body fits the line to the next point
    // for real, so the detour through the snap cell buys nothing.
    const snapWasUnnecessary =
      startWasSnapped && grid.isLineClearAt(originX, originY, out[2], out[3], radius);
    if (stoodOnAlready || snapWasUnnecessary) out.splice(0, 2);
  }
  return out;
}

/** Convenience for callers that want points rather than a flat list. */
export const toPoints = (flat: readonly number[]): NavPoint[] => {
  const points: NavPoint[] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) points.push({ x: flat[i], y: flat[i + 1] });
  return points;
};
