import TeamId from './enums/TeamId';
import type { LaneDefinition } from '@/content/ContentPack';

export const Lane = {
  TOP: 'top',
  MID: 'mid',
  BOT: 'bot',
};
Object.freeze(Lane);

export interface LaneWaypoint {
  x: number;
  y: number;
}

/**
 * The active match's lane set — every id `getLaneWaypoints`, `nearestLane`,
 * `laneApproach`, `assignLanes` and `TeamBlackboard`'s per-lane bucketing walk,
 * in the map's own order. `Game`'s constructor installs the running match's
 * own list (`setActiveLanes(map.lanes)`); nothing that never starts a `Game` —
 * which is most of this codebase's tests — sees anything until something
 * installs one. Starts empty (Spec §7's laneless map, the same state a real
 * map with no `lanes[]` produces) rather than any particular map's own
 * three: this module is core's mechanism, not a map, and Task 6 of the
 * content-pack extraction moved the one map that used to ship a default
 * here (Summoner's Rift's three lanes) into `packs/riot/maps/
 * summonersRiftGeometry.ts`. A test that wants a concrete lane to read
 * installs one explicitly, the same way a real match does —
 * `tests/game/minions/Lanes.test.ts`'s own "the active lane set" describe
 * covers the mechanism with synthetic waypoints, and
 * `tests/packs/riot/maps/Lanes.test.ts` covers Summoner's Rift's own shape
 * against the pack's real data.
 *
 * A `let`, not a `const`. `setActiveLanes` **reassigns** this to a fresh
 * array rather than mutating it in place, because `LaneObjectives.ts`'s
 * `laneGeometry()` cache keys off this binding's own *identity* — a new array
 * invalidates it for free the moment the active map changes, where an
 * in-place splice would leave every cache in this file and in
 * `LaneObjectives.ts` serving a stale set forever. `TeamBlackboard.ts` and
 * `MinionSpawner.ts` both import this by name and loop it directly; neither
 * needed a code change for the lane set to become the map's; both already
 * read whatever this binding currently holds.
 *
 * **This is one process-wide slot, not one per `Game`.** There is exactly one
 * live match at a time in this codebase (one `GameScene`, one `new Game(...)`
 * call site) and every test file gets its own module registry, so nothing
 * has ever needed a second. But it is a real hazard for anything that stops
 * being true: build a `MinionSpawner` for map A, call `setActiveLanes(B)`
 * before A is torn down, and A's spawner starts queueing *B*'s lane ids on
 * its very next wave — `LANES` is no longer the array A's caller captured,
 * because nothing captured it; every reader asks this binding fresh. Two
 * live `Game`s sharing one process (a rematch that constructs the next match
 * before the old one's `destroy()` has run, or a future side-by-side
 * comparison) would hit exactly this, silently. `setActiveLanes` refuses to
 * overwrite an unstopped match's lanes for that reason — see its own doc
 * comment — rather than trusting every future caller to remember to clear
 * first.
 */
export let LANES: string[] = [];

/**
 * The active match's own waypoints, keyed by lane id — reassigned alongside
 * `LANES` by `setActiveLanes`, for the identity-cache reason documented
 * there: this file's own `redLaneWaypoints()` cache keys off it too.
 */
export let LANE_WAYPOINTS: Record<string, LaneWaypoint[]> = {};

/**
 * Whether the current `LANES`/`LANE_WAYPOINTS` were installed by a match that
 * has not yet cleared them (`clearActiveLanes`/`resetLanesForTests`) — the
 * guard `setActiveLanes` checks before ever overwriting them. Starts `false`:
 * the empty out-of-the-box default above belongs to nobody, and installing
 * over it is the ordinary first call from a match's `Game` constructor.
 */
let owned = false;

/**
 * Installs the running match's own lane set. Called once, from `Game`'s
 * constructor, with `map.lanes` — the active `MapDefinition`'s own declared
 * lanes, already resolved to an `ActiveMap`.
 *
 * `undefined` (or an empty array) is Spec §7's laneless map: `LANES` and
 * `LANE_WAYPOINTS` both go empty, so `MinionSpawner.queueWave()`'s `for
 * (const lane of LANES)` queues nothing and every reader in
 * `LaneObjectives.ts` that loops `LANES` (`nearestLane`, `assignLanes`,
 * `laneGeometry`) — and `TeamBlackboard`'s per-lane bucketing, which loops the
 * same binding — sees no lanes at all. None of those files needed a code
 * change to make that true: they already read `LANES`/`LANE_WAYPOINTS` live,
 * not a value captured at import time.
 *
 * **Throws if a previous match's lanes are still installed and unstopped.**
 * This binding is one process-wide slot (see `LANES`'s own doc comment for
 * the failure this prevents): a second call before `clearActiveLanes()` runs
 * would otherwise silently hand the first match's `MinionSpawner` and
 * `TeamBlackboard` the second match's lane ids the moment they next ask.
 * Matching this codebase's own convention for a violated precondition
 * (`MinionSpawner.musterSlotFor` and `validate.ts` both throw rather than
 * degrade — see `validate.ts`'s file comment on why a silent failure here is
 * worse than a loud one) rather than the softer "warn and continue": a stale
 * lane set is exactly the class of bug this batch has spent seven tasks
 * removing, and `Game`'s constructor already runs synchronously with nothing
 * to catch a thrown error but the caller that broke the invariant.
 * `GameScene.stopGame()` -> `Game.destroy()` -> `clearActiveLanes()` is the
 * seam that keeps every real match sequence from ever reaching this.
 */
export function setActiveLanes(lanes: readonly LaneDefinition[] | undefined): void {
  if (owned) {
    throw new Error(
      "lanes.ts: setActiveLanes() called while a previous match's lane set is " +
        'still installed. This is one process-wide slot — call clearActiveLanes() ' +
        '(Game.destroy() does, when a match actually ends) before installing another, ' +
        "or two live Games will silently share it and queue each other's lane ids."
    );
  }
  owned = true;
  if (!lanes || lanes.length === 0) {
    LANES = [];
    LANE_WAYPOINTS = {};
    return;
  }
  const ids: string[] = [];
  const waypoints: Record<string, LaneWaypoint[]> = {};
  for (const lane of lanes) {
    ids.push(lane.id);
    waypoints[lane.id] = lane.waypoints;
  }
  LANES = ids;
  LANE_WAYPOINTS = waypoints;
}

/**
 * Restores this module's out-of-the-box default — empty, the same laneless
 * state `setActiveLanes(undefined)` produces — and releases the
 * `setActiveLanes` guard above.
 *
 * The production seam: `Game.destroy()` calls this whenever a match actually
 * ends (`GameScene.stopGame()` runs it unconditionally before dropping its
 * `Game` reference), so the *next* match's `setActiveLanes(map.lanes)` never
 * trips the "already installed" throw.
 */
export function clearActiveLanes(): void {
  owned = false;
  LANES = [];
  LANE_WAYPOINTS = {};
}

/**
 * Test-only alias for `clearActiveLanes`, kept as its own name so a test's
 * teardown reads as "this file's own state must not leak", distinct from the
 * production seam that ends a real match.
 *
 * Vitest isolates module state per *test file*, not per `it()` — a test that
 * calls `setActiveLanes` and shares a file with others that assume the
 * default (or that install their own lanes) must call this in its own
 * teardown, or the next test either silently starts on whatever the last one
 * left behind, or trips the guard above.
 */
export function resetLanesForTests(): void {
  clearActiveLanes();
}

// Reversed on first use rather than at module load, and memoised rather than
// rebuilt per call: a spawner asks for a path every few seconds and hands the
// same array to every minion in the wave. Memoised on `LANE_WAYPOINTS`'s own
// *identity*, not a boolean latch: `setActiveLanes` reassigns rather than
// mutates it, so installing a different map's lanes (or resetting to the
// default) invalidates this cache for free instead of serving a stale
// reversal forever.
let redLaneWaypointsCache: Record<string, LaneWaypoint[]> | null = null;
let redLaneWaypointsCacheFor: Record<string, LaneWaypoint[]> | null = null;

function redLaneWaypoints(): Record<string, LaneWaypoint[]> {
  if (redLaneWaypointsCache && redLaneWaypointsCacheFor === LANE_WAYPOINTS) {
    return redLaneWaypointsCache;
  }
  // Every id `LANE_WAYPOINTS` currently carries, not a fixed TOP/MID/BOT
  // triple — the active map may declare a different set (Task 8).
  const reversed: Record<string, LaneWaypoint[]> = {};
  for (const id of Object.keys(LANE_WAYPOINTS)) {
    reversed[id] = [...LANE_WAYPOINTS[id]].reverse();
  }
  redLaneWaypointsCache = reversed;
  redLaneWaypointsCacheFor = LANE_WAYPOINTS;
  return redLaneWaypointsCache;
}

/**
 * The lane a minion of `teamId` should walk, from its own base outwards. The
 * returned array is shared — a minion tracks its progress with an index and
 * must never mutate it.
 *
 * Falls back to MID for a lane the active set does not know — `[]` if even
 * that is missing, which only happens on a laneless map, where nothing calls
 * this in practice (`MinionSpawner.queueWave()` loops `LANES`, which is empty
 * there too) but a defensive caller must not be handed `undefined`.
 */
export const getLaneWaypoints = (lane: string, teamId: string): LaneWaypoint[] => {
  const paths = teamId === TeamId.RED ? redLaneWaypoints() : LANE_WAYPOINTS;
  return paths[lane] ?? paths[Lane.MID] ?? [];
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
