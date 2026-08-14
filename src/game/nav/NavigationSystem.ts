import NavGrid, { NAV_CELL_SIZE, type NavPoint } from './NavGrid';
import PathFinder, { NAV_MAX_NODES_PER_SEARCH, type PathResult } from './PathFinder';
import type PathAgent from './PathAgent';

/**
 * Owns the one static grid, the one reusable search, and the frame budget that
 * keeps both off the critical path.
 *
 * ## Where the frame budget actually lives
 *
 * Almost none of the movement in this game needs a search at all, and the
 * system is built around getting to that answer cheaply:
 *
 * 1. **A straight line is tried first.** `PathAgent` asks `isLineClear` before
 *    it asks for anything else — a hundred-odd array reads. On open ground, and
 *    that is most orders, no search ever happens and no queue is touched.
 * 2. **Searches happen on an order, never on a frame.** A chasing unit calls
 *    `navigateTo` sixty times a second at a target that has barely moved;
 *    `PathAgent` collapses those into one plan and only re-plans when the goal
 *    has genuinely moved or the plan has gone stale.
 * 3. **What is left is queued and rationed.** At most
 *    `NAV_MAX_SEARCHES_PER_FRAME` searches and `NAV_MAX_NODES_PER_FRAME`
 *    expansions are spent per frame, whatever is asking. Anything that does not
 *    fit waits for the next frame, and a unit waiting for a plan keeps walking
 *    the way it always did, so nothing ever stalls waiting for the pathfinder.
 *
 * The two node limits do different jobs. The per-search cap bounds the *worst*
 * case — an unreachable goal, which A* can only rule out by exhausting its
 * whole connected component (66,000 expansions and 8ms on this map, unbounded).
 * The per-frame cap bounds the *aggregate*, so several units asking for
 * expensive routes on the same frame cannot add up to a hitch.
 *
 * The player's own orders jump the queue. Everything else is one frame of
 * latency nobody can see; input latency is not.
 */

/** Searches drained per frame. */
export const NAV_MAX_SEARCHES_PER_FRAME = 4;

/**
 * Expansions drained per frame, across all searches. Bounds the aggregate at
 * roughly 4ms even in the pathological frame — several units simultaneously
 * ordered somewhere unreachable — against a measured p95 of 0.7ms on a full
 * board. Everything over the line waits a frame, which nobody can see.
 */
export const NAV_MAX_NODES_PER_FRAME = 12_000;

/**
 * Smallest slice of the frame budget worth starting a search on. Above the
 * median reachable order (303 expansions), so a search that begins at all has a
 * fair chance of finishing rather than handing back a stub.
 */
export const NAV_MIN_NODES_PER_SEARCH = 512;

export interface NavigationStats {
  /** Cost of building the static grid, once, at map load. */
  buildMs: number;
  /** Bytes held by the grid plus the reusable search buffers. */
  memoryBytes: number;
  cellSize: number;
  cols: number;
  rows: number;

  /** Orders answered by a straight line, with no search at all. */
  directOrders: number;
  /** Orders that needed a search. */
  searchedOrders: number;
  totalSearches: number;
  totalNodes: number;
  failedSearches: number;
  searchMsTotal: number;
  maxSearchMs: number;
  /** Searches deferred to a later frame because the budget ran out. */
  deferrals: number;

  searchesLastFrame: number;
  nodesLastFrame: number;
  queueLength: number;
}

export default class NavigationSystem {
  /**
   * Runtime switch, mirroring `UnitCollisionSystem.enabled`, so the same build
   * can be measured with pathfinding on and off. Off, `navigateTo` degrades to
   * exactly the straight-line `moveTo` the game had before.
   */
  enabled = true;

  /**
   * Draws the nav debug overlay (`src/game/nav/NavDebugOverlay.ts`): the
   * clearance field at the player's own body radius, every unit's remaining
   * route, and every agent's state. Off by default, toggled in-game with `N`
   * (`Game.keyPressed`), and also reachable through `window.__lol2d` in dev
   * builds — which is how the Playwright harness screenshots a walk, and how
   * a change to the routing can be looked at rather than reasoned about.
   */
  debugRoutes = false;

  readonly grid: NavGrid;
  readonly finder: PathFinder;

  private queue: PathAgent[] = [];
  private frameSearches = 0;
  private frameNodes = 0;

  readonly stats: NavigationStats;

  constructor(
    wallPolygons: readonly (readonly NavPoint[])[],
    mapSize: number,
    cellSize: number = NAV_CELL_SIZE
  ) {
    this.grid = NavGrid.fromPolygons(wallPolygons, { size: mapSize, cellSize });
    this.finder = new PathFinder(this.grid);
    this.stats = {
      buildMs: this.grid.buildMs,
      memoryBytes: this.grid.memoryBytes + this.finder.memoryBytes,
      cellSize: this.grid.cellSize,
      cols: this.grid.cols,
      rows: this.grid.rows,
      directOrders: 0,
      searchedOrders: 0,
      totalSearches: 0,
      totalNodes: 0,
      failedSearches: 0,
      searchMsTotal: 0,
      maxSearchMs: 0,
      deferrals: 0,
      searchesLastFrame: 0,
      nodesLastFrame: 0,
      queueLength: 0,
    };
  }

  get meanSearchMs(): number {
    return this.stats.totalSearches === 0 ? 0 : this.stats.searchMsTotal / this.stats.totalSearches;
  }

  /**
   * Zeroes the running counters, leaving the build figures alone. Only the perf
   * harness calls this, so an A/B run measures one configuration rather than
   * the sum of both.
   */
  resetCounters(): void {
    const stats = this.stats;
    stats.directOrders = 0;
    stats.searchedOrders = 0;
    stats.totalSearches = 0;
    stats.totalNodes = 0;
    stats.failedSearches = 0;
    stats.searchMsTotal = 0;
    stats.maxSearchMs = 0;
    stats.deferrals = 0;
  }

  /**
   * Queues an agent for a search. Queuing the same agent twice is a no-op: its
   * pending goal is whatever it last set, so the second request is already
   * covered by the first.
   */
  request(agent: PathAgent, priority = false): void {
    if (this.queue.includes(agent)) {
      if (priority) {
        this.queue.splice(this.queue.indexOf(agent), 1);
        this.queue.unshift(agent);
      }
      return;
    }
    if (priority) this.queue.unshift(agent);
    else this.queue.push(agent);
  }

  cancel(agent: PathAgent): void {
    const at = this.queue.indexOf(agent);
    if (at >= 0) this.queue.splice(at, 1);
  }

  /** Runs one search immediately, outside the queue. Used by the queue itself. */
  runSearch(
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    radius: number,
    nodeBudget = NAV_MAX_NODES_PER_SEARCH
  ): PathResult {
    const result = this.finder.search(fromX, fromY, toX, toY, { radius, nodeBudget });
    const stats = this.stats;
    stats.totalSearches++;
    stats.totalNodes += result.expanded;
    stats.searchMsTotal += result.elapsedMs;
    if (result.elapsedMs > stats.maxSearchMs) stats.maxSearchMs = result.elapsedMs;
    if (!result.ok) stats.failedSearches++;
    return result;
  }

  /** Straight-line test, counted so the harness can show how rarely a search runs. */
  isLineClear(ax: number, ay: number, bx: number, by: number, radius: number): boolean {
    return this.grid.isLineClear(ax, ay, bx, by, radius);
  }

  noteDirectOrder(): void {
    this.stats.directOrders++;
  }

  noteSearchedOrder(): void {
    this.stats.searchedOrders++;
  }

  /**
   * Drains the queue within this frame's budget. Called once per tick, before
   * the objects update, so a plan asked for last frame is in hand before the
   * unit that asked for it takes its next step.
   */
  update(): void {
    this.frameSearches = 0;
    this.frameNodes = 0;

    while (this.queue.length > 0) {
      if (this.frameSearches >= NAV_MAX_SEARCHES_PER_FRAME) break;
      // Never hand out more of the frame's remaining expansions than are left,
      // so the last search of a frame cannot overrun the aggregate cap — and
      // never start one on a scrap of budget it cannot do anything useful with,
      // since that spends a queue slot to produce a route that is thrown away.
      const remaining = NAV_MAX_NODES_PER_FRAME - this.frameNodes;
      if (remaining < NAV_MIN_NODES_PER_SEARCH) break;

      const agent = this.queue.shift();
      if (!agent) break;

      const budget = Math.min(NAV_MAX_NODES_PER_SEARCH, remaining);
      const expanded = agent.runQueuedSearch(this, budget);
      this.frameSearches++;
      this.frameNodes += expanded;
    }

    this.stats.searchesLastFrame = this.frameSearches;
    this.stats.nodesLastFrame = this.frameNodes;
    this.stats.queueLength = this.queue.length;
    this.stats.deferrals += this.queue.length;
  }

  /** Somewhere a body of `radius` can stand, near a point that may be wall. */
  nearestWalkable(x: number, y: number, radius: number, maxDistance = 700): NavPoint | null {
    return this.grid.nearestWalkable(x, y, radius, maxDistance);
  }
}
