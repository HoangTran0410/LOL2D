import CollideUtils from '@/utils/collide.utils';
import { withinRadius } from '@/utils/math.utils';
import TerrainType from '@/game/enums/TerrainType';
import { Rectangle } from '@/libs/quadtree';

/**
 * Whether one unit can see another.
 *
 * `Reach.ts` answers "is it close enough". This is the other half of the same
 * question and it was missing entirely: every auto-locking spell in the game
 * picked its victim out of a bare `queryObjects` circle, which knows about
 * teams, death and targetability and nothing at all about the fog the player is
 * looking at. A leap ability standing in the jungle behind a wall, on a screen
 * showing nothing but black, still found a jungle camp, still passed
 * `checkCastCondition`, and still leaped through the wall to bite it. So did
 * the two dozen other spells that pick a target for you.
 *
 * The rule here is deliberately the *same* rule `FogOfWar` paints, because the
 * fog is the promise: what is dark cannot be hit, what is lit can.
 *
 *   - walls and bushes stop sight; water does not (`SIGHT_BLOCKERS`, the same
 *     list `computeSightPoly` sweeps against),
 *   - the bush you are standing in is not one of your own blockers, which is
 *     what lets a champion in a bush see out of it,
 *   - sight is a *team* property, so a friendly ward is an eye like any other —
 *     `StealthWard_Object` carries its owner's `teamId` and a `visionRadius`,
 *     and that is already all it takes.
 *
 * Champions each get their own `teamId` in this game (see the teams note in
 * CLAUDE.md), so for a champion "team vision" is themselves, their pets and
 * their wards; for a wave it is the wave. Both are the answer the fog gives.
 *
 * **Distance is not part of it.** `Reach.ts` owns range and every caller here
 * arrives holding a candidate its own query already bounded — a spell's range,
 * a minion's aggro radius. A sight-radius cap on top would silently retune all
 * of them against 500, a number picked for the camera, and would have shrunk
 * one leap ability from its authored 550. The one place a radius *does* count is a
 * borrowed eye: a ward sees the circle it lights and no further.
 *
 * Applied to `AIChampion`'s target scan at every tier, through
 * `BotBrain.canPerceive`. It was once `easy` only, on the grounds that a bot
 * you can break line of sight with is a difficulty change — but that made a
 * bot's basic attack the one thing in the game exempt from the promise this
 * module exists to keep, and a player meets it as an autoattack out of a wall
 * they cannot see into. No tier uses a sight radius either, because the rule
 * above still holds: distance is not part of this. A bot *casting* a spell goes
 * through the same gate as the player.
 */

interface Point {
  x: number;
  y: number;
}

interface SightObstacle {
  vertices: { x: number; y: number }[];
}

/** The map half of the world, as much of it as this module needs to ask about. */
export interface VisionHost {
  terrainMap?: {
    getObstaclesInArea?(area: unknown, terrainTypes?: string[]): SightObstacle[];
  };
  objectManager?: {
    objects: readonly unknown[];
    _objectToBeAdd?: readonly unknown[];
    revision?: number;
  };
}

/** Anything that might be looked at, or might be doing the looking. */
export interface Seeable {
  position?: Point;
  teamId?: string;
  toRemove?: boolean;
  isDead?: boolean;
  isInsideBush?: boolean;
  alwaysVisible?: boolean;
  visionRadius?: number;
  stats?: { visionRadius?: { value: number }; size?: { value: number } };
  game?: VisionHost;
}

/**
 * Terrain that stops sight. Water is see-through and always has been — this is
 * the list `FogOfWar.computeSightPoly` hands to its visibility sweep, and the
 * two must not drift apart or the fog would stop meaning anything.
 */
const SIGHT_BLOCKERS = [TerrainType.WALL, TerrainType.BUSH];

/**
 * Whether nothing on the map stands between `from` and `to`.
 *
 * Obstacles containing `from` are skipped: that is the bush the looker is
 * hiding in, and `computeSightPoly` drops it for exactly the same reason. A
 * context with no map at all — every spell test in `tests/game/spells/` builds
 * one of those — has no walls, so sight is clear.
 */
export function hasLineOfSight(game: VisionHost | undefined, from: Point, to: Point): boolean {
  const terrainMap = game?.terrainMap;
  if (typeof terrainMap?.getObstaclesInArea !== 'function') return true;

  // The sightline's bounding box, and deliberately not the segment itself.
  //
  // Handing the quadtree a `Line` is tempting — it accepts any shape that can
  // answer `qtIndex`/`intersect`, and it narrows a diagonal far better. It also
  // loses walls. The final filter is `Rectangle.intersect(Line)`, which is
  // `CollideUtils.lineRect`: four edge crossings and no containment case. A
  // sightline that lies entirely *inside* a wall's bounding box crosses none of
  // its edges, so the wall is dropped from the retrieve and the view reads as
  // clear — which is every short sightline drawn beside a big wall, exactly
  // where a jungler stands. `tests/game/map/real-map-sight.test.ts` found it by
  // walking all 329 shipped walls: one of them saw straight through itself.
  //
  // Fixing `lineRect` is the wrong lever: `collide.utils.ts` is shared with the
  // spell hitboxes and says at the top not to touch its semantics. Narrowing
  // was only ever an optimisation anyway — `polyLine` below does the exact test
  // on whatever comes back, so a wider net costs a few extra polygons and
  // nothing else.
  const area = new Rectangle({
    x: Math.min(from.x, to.x),
    y: Math.min(from.y, to.y),
    w: Math.abs(to.x - from.x),
    h: Math.abs(to.y - from.y),
  });

  for (const obstacle of terrainMap.getObstaclesInArea(area, SIGHT_BLOCKERS)) {
    const vertices = obstacle?.vertices;
    if (!vertices || vertices.length < 3) continue;
    // Standing in it means seeing out of it — the bush you are hiding in.
    // `pointPolygon` is SAT's and so is only sound for convex polygons, which
    // some map walls are not; the same call backs `FogOfWar`'s identical check,
    // and matching it is worth more than being right where the fog is wrong.
    // Its failure mode is a looker *near* a concave wall seeing through it, and
    // `tests/game/map/real-map-sight.test.ts` walks all 329 shipped walls to
    // show none of them does that today.
    if (CollideUtils.pointPolygon(from.x, from.y, vertices)) continue;
    if (CollideUtils.polyLine(vertices, from.x, from.y, to.x, to.y)) return false;
  }
  return true;
}

/**
 * How much fog a thing lifts for its team.
 *
 * This is *granted* vision, not eyesight. `Minion`, `Monster` and `Turret` all
 * zero it on purpose — the fog in this game is painted by champions and wards
 * and nothing else — while plainly still being able to see the champion walking
 * past them. So this number decides who counts as a shared eye, and never
 * whether a unit can see for itself.
 *
 * `stats` first and the bare field second, because `AttackableUnit.visionRadius`
 * is the *animated* value: it starts at 0 and is lerped toward the stat inside
 * `draw()`, so a unit that has not been drawn yet — or is off camera, or is in a
 * headless test — reads as blind. `StealthWard_Object` and the other spell-made
 * eyes have no stats and carry the plain field.
 */
function grantedSightRadius(source: Seeable): number {
  const fromStats = source.stats?.visionRadius?.value;
  if (typeof fromStats === 'number') return fromStats;
  return typeof source.visionRadius === 'number' ? source.visionRadius : 0;
}

function grantsSight(candidate: Seeable, teamId: string): boolean {
  return (
    !!candidate &&
    candidate.teamId === teamId &&
    !candidate.toRemove &&
    !candidate.isDead &&
    !!candidate.position &&
    grantedSightRadius(candidate) > 0
  );
}

interface EyeCacheEntry {
  revision: number;
  objects: readonly unknown[];
  eyes: Seeable[];
}

/**
 * The team-eye scan is a linear walk of the world, and `canSee` is called per
 * candidate per frame by `ExecuteMarks` alone. Cached against
 * `ObjectManager.revision` *and* the identity of the `objects` array: the
 * revision covers the running game (it ticks once per `update`), the array
 * identity covers a test harness that swaps the whole world in without one.
 */
const eyeCache = new WeakMap<object, Map<string, EyeCacheEntry>>();

function alliedEyes(game: VisionHost | undefined, teamId: string | undefined): Seeable[] {
  const objectManager = game?.objectManager;
  if (!objectManager?.objects || teamId === undefined) return [];

  let perTeam = eyeCache.get(objectManager);
  if (!perTeam) {
    perTeam = new Map();
    eyeCache.set(objectManager, perTeam);
  }

  const revision = objectManager.revision ?? -1;
  const cached = perTeam.get(teamId);
  let eyes: Seeable[];
  if (cached && cached.revision === revision && cached.objects === objectManager.objects) {
    eyes = cached.eyes;
  } else {
    eyes = [];
    for (const object of objectManager.objects) {
      if (grantsSight(object as Seeable, teamId)) eyes.push(object as Seeable);
    }
    perTeam.set(teamId, { revision, objects: objectManager.objects, eyes });
  }

  // Never cached: `_objectToBeAdd` is refilled and emptied without the revision
  // moving, and a ward planted this frame is an eye this frame. It holds a
  // handful of objects at most — see the "paused match" note in CLAUDE.md.
  const pending = objectManager._objectToBeAdd;
  if (!pending || pending.length === 0) return eyes;
  const withPending = eyes.slice();
  for (const object of pending) {
    if (grantsSight(object as Seeable, teamId)) withPending.push(object as Seeable);
  }
  return withPending;
}

/**
 * Whether the view from `from` to the target is unobstructed — bushes and
 * terrain, and nothing about distance.
 *
 * Distance is `Reach.ts`'s job and stays there. Every caller reaches this
 * module holding a candidate its own query already bounded (a spell's range, a
 * minion's aggro radius), and a second, invisible cap here would quietly retune
 * every one of them against a number chosen for the camera.
 */
function viewIsClear(game: VisionHost | undefined, from: Seeable, target: Seeable): boolean {
  const origin = from.position;
  const to = target.position;
  if (!origin || !to) return false;

  // Kept alongside the polygon sweep rather than replaced by it. `isInsideBush`
  // is set by `TerrainMap` from the same polygons, so in the running game the
  // two agree; the boolean is what still holds in a context with no map.
  if (target.isInsideBush && !from.isInsideBush) return false;

  return hasLineOfSight(game, origin, to);
}

/**
 * Whether a *borrowed* eye — a ward, a pet, a teammate — puts `target` in the
 * team's sight. This one is range-gated, because what a ward covers is exactly
 * the circle it lights up: past that it is not seeing on anyone's behalf.
 */
function borrowedEyeSees(game: VisionHost | undefined, eye: Seeable, target: Seeable): boolean {
  const from = eye.position;
  const to = target.position;
  if (!from || !to) return false;

  // Measured to the target's edge, the same widening `Reach.ts` applies: a
  // champion who has grown to twice its size is seen from further away.
  const reach = grantedSightRadius(eye) + (target.stats?.size?.value ?? 0) / 2;
  if (!withinRadius(from, to, reach)) return false;

  return viewIsClear(game, eye, target);
}

/**
 * Whether `observer`'s team can see `target` right now.
 *
 * Structures are exempt (`alwaysVisible`): once a turret is discovered it stays
 * on the map, and `FogOfWar` already refuses to clear its `visibleToPlayerTeam`.
 * Allies are
 * exempt for the obvious reason.
 */
export function canSee(observer: Seeable | undefined, target: Seeable | undefined): boolean {
  if (!observer || !target) return false;
  if (observer === target) return true;
  if (target.alwaysVisible) return true;
  if (target.teamId !== undefined && target.teamId === observer.teamId) return true;
  // No viewpoint on either end is not blindness, it is an un-modelled pair: a
  // bare `{}` caster in a `TargetResolver` fixture, or a target that is not a
  // body at all. Refusing those would turn working casts into no-ops — the same
  // reason `hasLineOfSight` reads a missing map as clear rather than as walled in.
  if (!target.position || !observer.position) return true;

  const game = observer.game;
  if (viewIsClear(game, observer, target)) return true;

  for (const eye of alliedEyes(game, observer.teamId)) {
    if (eye === observer) continue;
    if (borrowedEyeSees(game, eye, target)) return true;
  }
  return false;
}
