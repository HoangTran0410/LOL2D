import type NavigationSystem from './NavigationSystem';

/**
 * One unit's route: the plan, the walk along it, and the rules for when a new
 * one is worth asking for.
 *
 * This class exists because `moveTo` is the wrong place to path from. It is
 * called every frame by chase code, by buffs, by dashes and by half a dozen
 * spells that write a destination directly, and each of those means "go here
 * now", not "plan a route". So `moveTo` keeps its exact old meaning — walk at
 * this point, in a straight line — and *clears* whatever route was running,
 * while `navigateTo` is the terrain-aware order. Nothing in the codebase has
 * to know which it got.
 *
 * The agent writes `unit.destination` directly rather than through `moveTo`,
 * for two reasons: `moveTo` would cancel the route it is following, and
 * `movementRevision` is the signal a channelled spell reads to know the player
 * issued a move order. Rounding a corner is not a new order, so it must not
 * bump that; taking a `navigateTo` is, so that does.
 */

/**
 * How far the goal must move before the route is re-planned. A chasing unit
 * calls `navigateTo` at its target sixty times a second; without this every one
 * of those would be a search. Roughly a champion's body plus its stride, so a
 * target jinking on the spot never triggers one.
 */
export const NAV_GOAL_TOLERANCE = 120;

/** Floor on the gap between two searches for one unit, whatever the goal does. */
export const NAV_REPLAN_INTERVAL_MS = 250;

/**
 * How often a unit following a route checks it is still on it. Body separation
 * and knockbacks shove units off their line; the clearance margin absorbs a
 * little of that, and this catches the rest. Two checks a second per moving
 * unit, jittered so a wave never checks in lockstep.
 */
export const NAV_PATH_CHECK_INTERVAL_MS = 500;

/** Distance from the goal at which a route counts as finished. */
export const NAV_ARRIVAL_TOLERANCE = 8;

/**
 * How much closer to the goal a truncated route must have carried the unit
 * before another search is worth buying. Two grid cells: small enough that a
 * capped search always counts as progress, large enough that the retry loop
 * terminates — every retry has to close at least this much, so a route can
 * only be re-planned `distance / 48` times before it either arrives or stops.
 */
export const NAV_MIN_PROGRESS = 48;

export type PathAgentState =
  /** No route and no order. */
  | 'IDLE'
  /** The goal is in a straight line; no search was needed. */
  | 'DIRECT'
  /** Waiting for a queued search. Walking straight at the goal meanwhile. */
  | 'PENDING'
  /** Walking a planned route. */
  | 'FOLLOWING'
  /** The goal cannot be reached; the unit walked as close as it could. */
  | 'BLOCKED';

/** The slice of a unit this agent touches. Keeps the nav module off the unit hierarchy. */
export interface PathAgentHost {
  position: { x: number; y: number };
  destination: { x: number; y: number; set(x: number, y: number): unknown };
  /**
   * Radius the route must fit through — `AttackableUnit.terrainRadius`, not
   * `bodyRadius`. The two differ for a grown body, and this is the one that
   * has to match what `TerrainMap.pushOutOfWalls` will actually enforce.
   */
  readonly terrainRadius: number;
  /** World units travelled per frame. */
  readonly moveSpeed: number;
}

export default class PathAgent {
  readonly host: PathAgentHost;
  private readonly navigation: NavigationSystem;

  state: PathAgentState = 'IDLE';

  /** Flat world coordinates `[x0, y0, ...]`, not including where the unit already is. */
  waypoints: number[] = [];
  waypointIndex = 0;

  goalX = 0;
  goalY = 0;
  private hasGoal = false;
  /**
   * Where the goal was when the running plan was committed.
   *
   * `order()` measures drift against *this*, not against last frame's goal. The
   * difference is the whole bug below: a goal that walks away one pixel a frame
   * never moves far enough in any single frame to trip a per-frame comparison,
   * so the order was swallowed forever and `destination` — which only `plan()`
   * writes — was left pointing at wherever the goal had been when the button
   * went down.
   */
  private planGoalX = 0;
  private planGoalY = 0;

  private replanCooldownMs = 0;
  private pathCheckCooldownMs: number;
  /**
   * How far the goal was when the running plan was made. A route that stops
   * short is only worth re-planning if walking it actually closed the gap —
   * that is what tells "the search hit its cap and there is more route to find"
   * apart from "there is no route", without asking the search twice for the
   * same answer.
   */
  private planStartDistance = Infinity;
  /** Set when the goal is the local player's own order, so it jumps the queue. */
  private urgent = false;

  constructor(host: PathAgentHost, navigation: NavigationSystem) {
    this.host = host;
    this.navigation = navigation;
    // jittered so fifty units never run their route check on the same frame
    this.pathCheckCooldownMs = Math.random() * NAV_PATH_CHECK_INTERVAL_MS;
  }

  get isActive(): boolean {
    return this.state !== 'IDLE';
  }

  /** The point the unit is currently walking at, or null when it has no route. */
  get currentWaypoint(): { x: number; y: number } | null {
    if (this.state !== 'FOLLOWING') return null;
    if (this.waypointIndex + 1 >= this.waypoints.length) return null;
    return { x: this.waypoints[this.waypointIndex], y: this.waypoints[this.waypointIndex + 1] };
  }

  /**
   * Take an order. Cheap and idempotent: an order that repeats the one already
   * running returns before it touches the grid, which is what makes calling
   * this every frame from chase code affordable.
   */
  order(x: number, y: number, urgent = false): void {
    // 'BLOCKED' is deliberately not in the swallow below. A blocked agent has
    // already parked the unit (`destination` is its own position) and will
    // never move again on its own, so swallowing a repeated order — which is
    // exactly what a caller that re-issues every frame sends, e.g.
    // `Monster.updateBackToCamp` — leaves it standing there for the rest of
    // the match with a goal it never retries. A camp dragged off its pit was
    // observed 1695px from home, phase BACK_TO_CAMP, agent BLOCKED, goal set
    // correctly, motionless. Retrying is cheap: `plan()` throttles a BLOCKED
    // agent to one search per `NAV_REPLAN_INTERVAL_MS`, and what blocked it
    // (a body in a chokepoint, a route that ran out of expansions) is usually
    // gone seconds later.
    if (this.hasGoal && this.state !== 'IDLE' && this.state !== 'BLOCKED') {
      // Measured from the *planned* goal, not from last frame's. Held orders
      // creep: `Game.update` re-issues the cursor's world position every frame
      // while the right button is down, and the camera rides the champion, so
      // the world point under a stationary cursor walks forward at exactly the
      // champion's own speed. Frame to frame that is three pixels — under the
      // tolerance, every time, forever — while `remaining` stays pinned at
      // whatever the cursor's screen offset is and so never falls under the
      // "nearly there" escape either. The champion walked to wherever the
      // cursor had been when the button went down, arrived, and stood still
      // with the button still held. Against the planned goal the same drift
      // trips the tolerance after ~120px of travel and the order is re-planned,
      // which is both correct and roughly one plan every forty frames.
      const goalMoved = Math.hypot(x - this.planGoalX, y - this.planGoalY);
      const remaining = Math.hypot(
        this.host.position.x - this.goalX,
        this.host.position.y - this.goalY
      );
      // A goal that has barely moved is the same order — unless the unit is
      // nearly on top of it, where a short adjustment *is* the whole order and
      // swallowing it would leave a right click that does nothing.
      if (goalMoved <= NAV_GOAL_TOLERANCE && remaining > NAV_GOAL_TOLERANCE * 2) {
        this.goalX = x;
        this.goalY = y;
        return;
      }
    }

    this.goalX = x;
    this.goalY = y;
    this.hasGoal = true;
    this.urgent = urgent;
    this.plan();
  }

  /** Drops the route. `moveTo`, `stopMovement` and death all land here. */
  clear(): void {
    if (this.state === 'PENDING') this.navigation.cancel(this);
    this.state = 'IDLE';
    this.waypoints.length = 0;
    this.waypointIndex = 0;
    this.hasGoal = false;
    this.urgent = false;
  }

  /**
   * Decides between "walk at it" and "ask for a route". The straight line is
   * always tried first: it is a few dozen array reads, and it is the right
   * answer for most orders on a map that is 60% open ground.
   */
  private plan(): void {
    const { position } = this.host;
    const radius = this.host.terrainRadius;
    // Only written where a plan is actually committed. Writing it up here would
    // reset the running route's progress every time a throttled chase order
    // bounced off the check below, and a route that has not moved since it was
    // planned reads as one that cannot make progress.
    const distance = Math.hypot(position.x - this.goalX, position.y - this.goalY);

    if (!this.navigation.enabled) {
      this.state = 'DIRECT';
      this.waypoints.length = 0;
      this.commitGoal(distance);
      this.host.destination.set(this.goalX, this.goalY);
      return;
    }

    if (this.navigation.isLineClear(position.x, position.y, this.goalX, this.goalY, radius)) {
      this.navigation.noteDirectOrder();
      this.state = 'DIRECT';
      this.waypoints.length = 0;
      this.waypointIndex = 0;
      this.commitGoal(distance);
      this.host.destination.set(this.goalX, this.goalY);
      return;
    }

    // The straight line is blocked, so this order costs a search — but only if
    // the last one was long enough ago. A unit chasing something behind a wall
    // calls this every frame; without the throttle each of those frames would
    // buy a fresh search to replace a route that is at most 250ms stale, which
    // over that window is under 50px of target movement. Walking the route it
    // already has is the better trade by a wide margin.
    // Every state but IDLE: a fresh order always gets its search, and every
    // other caller is re-issuing one. PENDING and DIRECT are in the list
    // because a held order now reaches `plan()` regularly rather than being
    // swallowed forever, and a held order over a line that has just become
    // blocked must not buy a search on each of those visits.
    if (this.replanCooldownMs > 0 && this.state !== 'IDLE') {
      return;
    }

    this.navigation.noteSearchedOrder();
    // Keep walking at the goal for the frame or two the search takes; that is
    // exactly what the game did before there was a pathfinder, and the terrain
    // push-out still has the last word.
    this.host.destination.set(this.goalX, this.goalY);
    this.state = 'PENDING';
    this.commitGoal(distance);
    this.replanCooldownMs = NAV_REPLAN_INTERVAL_MS;
    this.navigation.request(this, this.urgent);
  }

  /** Called by NavigationSystem while draining its queue. Returns nodes spent. */
  runQueuedSearch(navigation: NavigationSystem, nodeBudget: number): number {
    if (this.state !== 'PENDING' || !this.hasGoal) return 0;

    const { position } = this.host;
    const result = navigation.runSearch(
      position.x,
      position.y,
      this.goalX,
      this.goalY,
      this.host.terrainRadius,
      nodeBudget
    );

    if (result.waypoints.length < 2) {
      // Nowhere to go at all: stop rather than grind into the wall. The unit
      // keeps its order, so it tries again once the cooldown lapses.
      this.state = 'BLOCKED';
      this.waypoints.length = 0;
      this.host.destination.set(position.x, position.y);
      return result.expanded;
    }

    this.waypoints = result.waypoints;
    this.waypointIndex = 0;
    // `ok: false` means the search settled for the closest node it reached, so
    // the route is real but it stops short. FOLLOWING walks it and then parks.
    this.state = 'FOLLOWING';
    this.host.destination.set(this.waypoints[0], this.waypoints[1]);
    return result.expanded;
  }

  /**
   * Advances along the route. Runs once per frame from `AttackableUnit.update`,
   * before the unit steps, and costs a distance check on all but the frames
   * where a waypoint is actually consumed.
   */
  update(deltaMs: number): void {
    if (this.replanCooldownMs > 0) this.replanCooldownMs -= deltaMs;
    if (this.state !== 'FOLLOWING') return;

    const { position, destination } = this.host;

    // `AttackableUnit.move()` snaps onto the destination once it is within one
    // step, so arriving means "closer than a stride", never an exact match.
    const arrival = Math.max(this.host.moveSpeed + 1, 4);
    while (this.waypointIndex + 1 < this.waypoints.length) {
      const wx = this.waypoints[this.waypointIndex];
      const wy = this.waypoints[this.waypointIndex + 1];
      if (Math.hypot(position.x - wx, position.y - wy) > arrival) break;
      this.waypointIndex += 2;
    }

    if (this.waypointIndex + 1 >= this.waypoints.length) {
      this.waypoints.length = 0;
      this.waypointIndex = 0;
      const remaining = Math.hypot(position.x - this.goalX, position.y - this.goalY);

      if (remaining <= NAV_GOAL_TOLERANCE) {
        // goalX/goalY are not necessarily what this route was planned towards:
        // order() keeps them tracking the latest order even while a route is
        // FOLLOWING or PENDING, replanning only on a jump past the tolerance
        // or a stale plan. A held, dragged order creeps the goal forward one
        // small step a frame, well under that tolerance every time, so by the
        // time a (possibly one-waypoint) route finishes near it, the goal can
        // have drifted onto the far side of a wall the route was never asked
        // to cross. Unlike a brand new order, there is no distance here to
        // spend "walk at the goal while a search runs" on -- the unit is
        // already standing at the last point that *was* validated, so a
        // drifted goal gets checked before being trusted, and the unit holds
        // there rather than snapping straight at it.
        if (
          this.navigation.enabled &&
          !this.navigation.isLineClear(
            position.x,
            position.y,
            this.goalX,
            this.goalY,
            this.host.terrainRadius
          )
        ) {
          this.state = 'PENDING';
          destination.set(position.x, position.y);
          this.commitGoal(remaining);
          this.replanCooldownMs = NAV_REPLAN_INTERVAL_MS;
          this.navigation.request(this, this.urgent);
          return;
        }
        this.state = 'DIRECT';
        destination.set(this.goalX, this.goalY);
        return;
      }

      // The route stopped short of the goal, which means the search settled for
      // the closest node it reached — either because the goal is unreachable or
      // because it ran out of expansions. Those look identical from here, so
      // the tiebreaker is whether walking the route actually closed the gap. If
      // it did, there is more route to find and the next search starts from
      // much nearer, so it is worth paying for. If it did not, this is as close
      // as the unit gets and it stops.
      if (remaining < this.planStartDistance - NAV_MIN_PROGRESS) {
        this.replanCooldownMs = 0;
        this.plan();
        return;
      }

      this.state = 'BLOCKED';
      destination.set(position.x, position.y);
      return;
    }

    destination.set(this.waypoints[this.waypointIndex], this.waypoints[this.waypointIndex + 1]);

    this.pathCheckCooldownMs -= deltaMs;
    if (this.pathCheckCooldownMs > 0) return;
    this.pathCheckCooldownMs = NAV_PATH_CHECK_INTERVAL_MS;

    // Shoved off the line by body separation or a knockback: the segment the
    // unit is on may no longer be walkable from where it actually stands.
    if (
      this.navigation.enabled &&
      this.replanCooldownMs <= 0 &&
      !this.navigation.isLineClear(
        position.x,
        position.y,
        this.waypoints[this.waypointIndex],
        this.waypoints[this.waypointIndex + 1],
        this.host.terrainRadius
      )
    ) {
      this.repath();
    }
  }

  /**
   * Marks the current goal as the one the running plan was made for. Every
   * place that commits a plan goes through here, so `order()`'s drift check and
   * the truncated-route progress check can never disagree about which goal the
   * plan belongs to.
   */
  private commitGoal(distance: number): void {
    this.planStartDistance = distance;
    this.planGoalX = this.goalX;
    this.planGoalY = this.goalY;
  }

  /**
   * Re-plans from where the unit actually is, keeping its goal. Throttled, so a
   * unit wedged against geometry cannot turn into a search every frame.
   */
  repath(): boolean {
    if (!this.hasGoal || !this.navigation.enabled) return false;
    if (this.replanCooldownMs > 0) return this.state === 'FOLLOWING' || this.state === 'PENDING';
    this.plan();
    return true;
  }
}
