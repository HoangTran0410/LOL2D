import { System } from '@/libs/detect-collisions';
import SpellObject from '@/game/gameObject/SpellObject';
import AttackableUnit from '@/game/gameObject/attackableUnits/AttackableUnit';
import CombatText from '@/game/gameObject/helpers/CombatText';
import { Circle, Quadtree, Rectangle } from '@/libs/quadtree';
import TrailSystem from '@/game/gameObject/helpers/TrailSystem';
import ParticleSystem from '@/game/gameObject/helpers/ParticleSystem';
import GameObject from '@/game/gameObject/GameObject';
import UnitCollisionSystem from './UnitCollisionSystem';
import { canSee, type Seeable as VisionObserver } from '@/game/combat/Vision';
import { blend, isContinuousStep } from '@/game/render/Interpolation';

export type QueryArea = Circle | Rectangle;
export type RenderQuality = 'auto' | 'low' | 'high';
export type GameObjectConstructor<T extends GameObject = GameObject> = abstract new (
  ...args: never[]
) => T;
export type GameObjectFilter = (object: GameObject) => boolean;
export type GameObjectTypeGuard<T extends GameObject> = (object: GameObject) => object is T;
export interface ObjectManagerGameContext {
  readonly mapSize: number;
  readonly touchUi?: boolean;
  readonly renderQuality?: RenderQuality;
  camera: {
    getBoundingBox(): Rectangle;
    constantSize?(pixels: number): number;
    currentScale?: number;
  };
}

interface GameObjectRegion {
  data: GameObject;
}

type TargetableGameObject = GameObject & { targetable?: unknown };

const hasTargetableProperty = (object: GameObject): object is TargetableGameObject =>
  'targetable' in object;

// Explicit slots keep the Champion gap even though importing Champion here
// would create a circular dependency through its targeting filters.
const Z_INDEX_MAP = new Map<Function, number>([
  [TrailSystem, 0],
  [ParticleSystem, 1],
  [SpellObject, 2],
  [AttackableUnit, 3],
  [CombatText, 5],
]);
const DEFAULT_Z_INDEX = 99;
export const MOBILE_PARTICLE_DRAW_BUDGET = 800;
export const MOBILE_CROWDED_PARTICLE_DRAW_BUDGET = 400;
export const MOBILE_CROWDED_DRAWABLE_COUNT = 40;
export const MOBILE_COMPACT_UNIT_COUNT = 8;
export const MOBILE_COMPACT_UNIT_SCALE = 0.45;
const ATTACKABLE_DRAW_MARGIN_PX = 100;

/**
 * The table above is keyed by exact constructor, so a subclass it does not list
 * falls through to DEFAULT_Z_INDEX. Classes that need a specific slot but cannot
 * be imported here (structures import PredefinedFilters from this module) set
 * `zIndex` on themselves instead — e.g. Fountain paints under everything.
 */
function zIndexOf(o: GameObject): number {
  const constructor = o.constructor;
  const classZIndex =
    Object.hasOwn(constructor, 'displayZIndex') &&
    'displayZIndex' in constructor &&
    typeof constructor.displayZIndex === 'number'
      ? constructor.displayZIndex
      : (Z_INDEX_MAP.get(constructor) ?? DEFAULT_Z_INDEX);
  return o.zIndex ?? classZIndex;
}

/**
 * Objects that exist only to be looked at, and so are indexed separately from
 * everything a gameplay query can ask about — see `ObjectManager._decorTree`.
 *
 * Deliberately a closed list of two rather than a `decorative = true` flag on
 * `GameObject`: a flag invites a spell object to set it because "it's only
 * VFX", and a spell object is exactly the thing that must stay queryable. Add
 * to this list only for something that deals no damage, holds no target and
 * blocks nothing. `CombatText` is not here on purpose — it extends
 * `SpellObject`, so a query narrowing by that type would quietly stop seeing it.
 */
function isDecoration(o: GameObject): boolean {
  return o instanceof ParticleSystem || o instanceof TrailSystem;
}

export interface QueryOptions {
  area?: QueryArea;
  filters?: readonly GameObjectFilter[];
  queryByDisplayBoundingBox?: boolean;
}

type GuardedGameObject<TFilter> =
  TFilter extends GameObjectTypeGuard<infer TObject> ? TObject : never;
type IntersectGuardedGameObjects<TFilter> = (
  GuardedGameObject<TFilter> extends infer TObject
    ? TObject extends GameObject
      ? (object: TObject) => void
      : never
    : never
) extends (object: infer TIntersection) => void
  ? TIntersection
  : never;
type QueryResult<TFilters extends readonly GameObjectFilter[]> = [
  GuardedGameObject<TFilters[number]>,
] extends [never]
  ? GameObject
  : IntersectGuardedGameObjects<TFilters[number]>;

export const PredefinedFilters = {
  id:
    (id: string): GameObjectFilter =>
    object =>
      object.id === id,
  type:
    <T extends GameObject>(type: GameObjectConstructor<T>): GameObjectTypeGuard<T> =>
    (object): object is T =>
      object instanceof type,
  excludeType:
    (type: GameObjectConstructor): GameObjectFilter =>
    object =>
      !(object instanceof type),
  teamId:
    (teamId: string): GameObjectFilter =>
    object =>
      object.teamId === teamId,
  excludeTeamId:
    (teamId: string): GameObjectFilter =>
    object =>
      object.teamId !== teamId,
  includeTeamIds:
    (teamIds: string[]): GameObjectFilter =>
    object =>
      teamIds.some(teamId => object.teamId === teamId),
  excludeTeamIds:
    (teamIds: string[]): GameObjectFilter =>
    object =>
      !teamIds.some(teamId => object.teamId === teamId),
  includeTypes:
    (types: GameObjectConstructor[]): GameObjectFilter =>
    object =>
      types.some(type => object instanceof type),
  excludeTypes:
    (types: GameObjectConstructor[]): GameObjectFilter =>
    object =>
      !types.some(type => object instanceof type),
  excludeObjects:
    (
      objects: (GameObject | undefined | null)[] | Set<GameObject | undefined | null>
    ): GameObjectFilter =>
    object =>
      objects instanceof Set
        ? !objects.has(object)
        : !objects.some(excluded => excluded === object),
  includeDead: (object: GameObject): object is AttackableUnit =>
    object instanceof AttackableUnit && object.isDead,
  excludeDead: (object: GameObject): boolean =>
    object instanceof AttackableUnit ? !object.isDead : Boolean(object),
  includeUntargetable: (object: GameObject): boolean =>
    !hasTargetableProperty(object) || !Boolean(object.targetable),
  excludeUntargetable: (object: GameObject): boolean =>
    hasTargetableProperty(object) && Boolean(object.targetable),
  /**
   * Units within `radius` of a *point*. Not the home of the size-aware reach
   * rule, and not a substitute for it: this filter is handed a bare position,
   * so it can widen for the target's body but has no way to know whose body the
   * measurement started from. Caster-centred ranges go through
   * `combat/Reach.ts`, which needs both ends.
   */
  attackableUnitInRange:
    (
      position: p5.Vector,
      radius: number,
      includeSize = false
    ): GameObjectTypeGuard<AttackableUnit> =>
    (object): object is AttackableUnit =>
      object instanceof AttackableUnit &&
      p5.Vector.dist(object.position, position) <=
        radius + (includeSize ? object.animatedValues.size / 2 : 0),
  collideWith:
    (area?: QueryArea): GameObjectFilter =>
    object => {
      if (!area) return false;
      if (typeof object.getCollideBoundingBox !== 'function') return false;
      return object.getCollideBoundingBox().intersect(area);
    },
  missileSpellObject: (object: GameObject): object is SpellObject =>
    object instanceof SpellObject && object.isMissile,
  canTakeDamage: (object: GameObject): object is AttackableUnit =>
    object instanceof AttackableUnit && object.targetable && !object.isDead,
  canTakeDamageFromTeam:
    (teamId: string): GameObjectTypeGuard<AttackableUnit> =>
    (object): object is AttackableUnit =>
      object instanceof AttackableUnit &&
      object.targetable &&
      !object.isDead &&
      object.teamId !== teamId,
  /**
   * Drops units hidden by an active stealth (Twitch Q).
   *
   * Applied to every scan that acquires a target on its own — the wave, the
   * camps, the turrets and the bots. Before this, `ActionState.STEALTHED` was
   * read in exactly one place in the engine (`BasicAttackController`, so a
   * player could not *order* an attack on a stealthed unit), which meant
   * stealth dimmed the sprite and changed nothing else: everything on the map
   * kept chasing and hitting a champion nobody could see.
   *
   * Unlike `visibleTo` below this *is* applied to `AIChampion`. Bush cover is
   * terrain and leaving the bots blind to it would be a difficulty change;
   * stealth is an ability with a cast and a cooldown behind it, and a bot that
   * ignores it makes that ability worthless against the only real opponents in
   * the match.
   *
   * No observer side: a reveal is `TrueSight`, which strips the flag from the
   * hidden unit, so a revealed champion is simply no longer stealthed.
   */
  excludeStealthed: (object: GameObject): boolean =>
    !(object instanceof AttackableUnit) || !object.isStealthed,
  /**
   * Drops what `observer`'s team cannot see — the gate every scan that *picks*
   * a target needs, and the one `combat/Vision.ts` defines.
   *
   * It started as the bush rule alone, because bushes were cosmetic (the only
   * thing that ever read `isInsideBush` was the sprite's alpha) and a player
   * standing in one was picked up by every minion and camp scan that came
   * within aggro range. Terrain was the other half and was missing entirely:
   * nothing that acquired a target had ever asked whether it could *see* it, so
   * Warwick R found the blue camp through a jungle wall on a screen showing
   * nothing but fog. `canSee` answers walls, bushes, sight range and friendly
   * wards in one place, matching what `FogOfWar` paints.
   *
   * Only `AttackableUnit`s are gated: a query that also returns spell objects
   * or terrain is not asking about vision, and every caller's own filters have
   * already narrowed the units to the ones it may hit.
   *
   * `AIChampion` no longer routes its target scan through this filter at all:
   * whether a bot can be broken line-of-sight with is a difficulty knob now
   * (`seesThroughTerrain` in `src/game/ai/Difficulty.ts` — off for `easy`, on
   * for `normal` and `hard`), and `BotBrain.canPerceive` applies it directly so
   * the three tiers can differ. Every other caller here is unchanged.
   */
  visibleTo:
    (observer: VisionObserver): GameObjectFilter =>
    object =>
      !(object instanceof AttackableUnit) || canSee(observer, object),
};

declare global {
  var objectManager: ObjectManager | undefined;
}

export default class ObjectManager {
  system = new System();
  objects: GameObject[] = [];
  _objectToBeAdd: GameObject[] = [];
  _objectsTree!: Quadtree;
  /**
   * Spatial index for decoration — particle systems and trails.
   *
   * They are `GameObject`s so the update/draw loop carries them for free, but
   * nothing in the game ever asks a spatial question *about* them: they deal no
   * damage, hold no target and block nothing. Kept in the main index they were
   * still inserted every tick and then retrieved, stamped and intersect-tested
   * by every one of the ~150 `queryObjects` call sites, only to be thrown away
   * by each caller's own type filter — and a fight is where there are most of
   * them and least budget to spare.
   *
   * Splitting them out shrinks the gameplay tree as well as skipping the work,
   * so the queries that remain go shallower. `draw` reads both; `queryObjects`
   * reads only the gameplay one, which is the whole point.
   */
  _decorTree!: Quadtree;
  _objectsTreeIsUpdating = false;
  _deadBuffer: number[] = [];
  revision = 0;
  unitCollision = new UnitCollisionSystem();
  game: ObjectManagerGameContext;

  constructor(game: ObjectManagerGameContext) {
    this.game = game;

    const mapSize = this.game.mapSize;
    this._objectsTree = new Quadtree({
      x: 0,
      y: 0,
      w: mapSize,
      h: mapSize,
      // maxObjects: 2 forced deep splits and multi-leaf inserts (an object
      // that spans multiple quadrants near a boundary gets inserted into
      // each one) on every rebuild, every tick. 12 keeps leaves shallow
      // without turning every query into a near-linear scan of one big leaf.
      maxObjects: 12,
      maxLevels: 4,
    });
    this._decorTree = new Quadtree({
      x: 0,
      y: 0,
      w: mapSize,
      h: mapSize,
      maxObjects: 12,
      maxLevels: 4,
    });

    globalThis.objectManager = this;
  }

  update(): void {
    // update
    for (const o of this.objects) {
      // Remember where the object began this tick, before its own update moves
      // it, so `draw` can blend between the two endpoints. Riding the existing
      // walk keeps this a field write, not a second pass over the list.
      o.renderOriginX = o.position.x;
      o.renderOriginY = o.position.y;
      o.update?.();
    }

    // two-pass remove: collect dead, then filter once (avoids O(n²) splice)
    for (let i = 0, l = this.objects.length; i < l; i++) {
      if (this.objects[i].toRemove) this._deadBuffer.push(i);
    }
    if (this._deadBuffer.length > 0) {
      for (let i = this._deadBuffer.length - 1; i >= 0; i--) {
        const idx = this._deadBuffer[i];
        this.objects[idx].onRemoved?.();
        this.objects.splice(idx, 1);
      }
      this._deadBuffer.length = 0;
    }

    // check add
    if (this._objectToBeAdd.length > 0) {
      for (const o of this._objectToBeAdd) {
        this.objects.push(o);
        o.onAdded?.();
      }
      // Truncate rather than rebind. `onAdded` may itself call `addObject`,
      // and a for..of re-reads `length` each step, so anything queued during
      // the loop is drained by this same pass either way — but keeping the
      // array identity stops one throwaway allocation per tick.
      this._objectToBeAdd.length = 0;
    }

    // Bodies push each other apart once everything has moved, and before the
    // tree is rebuilt so the tree already reflects the settled positions.
    // Deliberately upstream of TerrainMap.update(), which Game runs next: terrain
    // gets the last word, so a unit shoved into a wall by a neighbour is back out
    // of it inside the same frame. The cost is that a wall push-out can leave two
    // bodies overlapping for one frame near a wall, which the next frame clears.
    this.unitCollision.resolve(this.objects);

    // update quadtree
    this._objectsTreeIsUpdating = true;
    this._objectsTree.clear();
    this._decorTree.clear();
    for (const o of this.objects) {
      // Decoration is indexed apart from everything gameplay can ask about —
      // see `_decorTree`.
      const tree = isDecoration(o) ? this._decorTree : this._objectsTree;
      tree.insert(o.getDisplayBoundingBox());
    }
    this._objectsTreeIsUpdating = false;
    this.revision++;
  }

  /**
   * @param alpha How far into the current simulation step the renderer is,
   *   `[0, 1]`. Defaults to `1` — the newest tick, a byte-for-byte no-op — so
   *   every existing caller and test keeps working untouched. Below 1 each
   *   object is drawn blended between its tick origin and its current position;
   *   `GameScene.draw` is the one caller that passes a real value. See
   *   `render/Interpolation.ts`.
   */
  draw(alpha = 1): void {
    const camBound = this.game.camera.getBoundingBox();
    const margin =
      this.game.camera.constantSize?.(ATTACKABLE_DRAW_MARGIN_PX) ?? ATTACKABLE_DRAW_MARGIN_PX;
    const visualBound = new Rectangle({
      x: camBound.x - margin,
      y: camBound.y - margin,
      w: camBound.w + margin * 2,
      h: camBound.h + margin * 2,
    });

    // Single pass over the quadtree hit-list: unwrap the region, filter to
    // what will actually draw, and tag it with a z-index together, instead of
    // the three full-length arrays (map region->object, map in z-index,
    // filter to drawables) this used to rebuild from scratch every frame for
    // the same object set — real GC churn at 60 draws/sec.
    const drawables: { o: GameObject; z: number }[] = [];
    let particleCount = 0;
    let attackableCount = 0;
    // Both indexes: decoration lives in its own tree so gameplay queries never
    // page it in (see `_decorTree`), but it still has to be painted, so the
    // draw pass is the one caller that reads both. An object is in exactly one
    // of them, so the two walks cannot hand back the same thing twice.
    for (const tree of [this._objectsTree, this._decorTree]) {
      for (const region of tree.retrieve(camBound) as GameObjectRegion[]) {
        const o = region.data;
        if (o instanceof AttackableUnit) {
          // The fog's answer for the player's own eyes — rendering only. What a
          // unit may *target* is `combat/Vision.ts`, asked per observer.
          if (!o.visibleToPlayerTeam) continue;
          if (!o.getCollideBoundingBox().intersect(visualBound)) continue;
          attackableCount++;
        } else if (o instanceof ParticleSystem) {
          particleCount += o.particles.length;
        }
        // zIndexOf does a Map lookup + Object.hasOwn — computed once here
        // rather than repeatedly by the sort comparator below.
        drawables.push({ o, z: zIndexOf(o) });
      }
    }
    drawables.sort((a, b) => a.z - b.z);

    const quality = this.game.renderQuality ?? 'auto';
    const automaticCompact = Boolean(
      this.game.touchUi &&
      (this.game.camera.currentScale ?? Infinity) <= MOBILE_COMPACT_UNIT_SCALE &&
      attackableCount >= MOBILE_COMPACT_UNIT_COUNT
    );
    const compactUnits = quality === 'low' || (quality === 'auto' && automaticCompact);
    const particleBudget =
      quality === 'high'
        ? Infinity
        : quality === 'low' || (compactUnits && drawables.length > MOBILE_CROWDED_DRAWABLE_COUNT)
          ? MOBILE_CROWDED_PARTICLE_DRAW_BUDGET
          : MOBILE_PARTICLE_DRAW_BUDGET;
    const limitParticles = quality === 'low' || (quality === 'auto' && this.game.touchUi);
    const particleScale =
      limitParticles && particleCount > particleBudget ? particleBudget / particleCount : 1;

    // When the frame sits between two ticks, draw each body at the fraction of
    // its step that has elapsed. Substitute the blended position onto the live
    // vector, draw, then put the true numbers back — no `draw()` body has to
    // know it happened, and no draw site is edited. Culling above stayed on the
    // true position on purpose (the difference is sub-pixel and the margin
    // covers it); this only moves where the object is *painted*.
    const interpolate = alpha < 1;
    for (const { o } of drawables) {
      let trueX = 0;
      let trueY = 0;
      let swapped = false;
      // A jump past the snap distance (a blink, a respawn) is not a journey to
      // blend across — `isContinuousStep` refuses it and it is drawn where the
      // simulation actually put it.
      if (
        interpolate &&
        isContinuousStep(o.renderOriginX, o.renderOriginY, o.position.x, o.position.y)
      ) {
        trueX = o.position.x;
        trueY = o.position.y;
        o.position.x = blend(o.renderOriginX, trueX, alpha);
        o.position.y = blend(o.renderOriginY, trueY, alpha);
        swapped = true;
      }

      if (o instanceof ParticleSystem) {
        o.draw(Math.floor(o.particles.length * particleScale));
      } else if (o instanceof TrailSystem) {
        o.draw(compactUnits);
      } else if (o instanceof AttackableUnit) {
        o.draw({ compactUnits });
      } else {
        o.draw?.();
      }
      // o.drawBoundingBox?.(true);

      // No try/finally: a throw inside a draw already breaks the frame, and the
      // state being restored is about to be discarded — a guard per object at
      // 60fps buys nothing.
      if (swapped) {
        o.position.x = trueX;
        o.position.y = trueY;
      }
    }

    // draw camera bound
    // push();
    // fill(200, 50);
    // stroke(255);
    // rect(camBound.x, camBound.y, camBound.w, camBound.h);
    // pop();
  }

  addObject(object: GameObject): void {
    this._objectToBeAdd.push(object);
  }

  removeObject(object: GameObject): void {
    object.toRemove = true;
  }

  queryObjects<const TFilters extends readonly GameObjectFilter[]>(
    options: Omit<QueryOptions, 'filters'> & { filters: TFilters }
  ): QueryResult<TFilters>[];
  queryObjects(options: QueryOptions): GameObject[];
  queryObjects({ area, filters, queryByDisplayBoundingBox = false }: QueryOptions): GameObject[] {
    if (this._objectsTreeIsUpdating) {
      console.warn('Quadtree is updating, this may cause unexpected result.');
    }

    let objects: GameObject[];
    if (area) {
      const regions = this._objectsTree.retrieve(area) as GameObjectRegion[];
      objects = [];
      for (let i = 0; i < regions.length; i++) {
        const data = regions[i]?.data;
        if (data && !data.toRemove) objects.push(data);
      }
    } else {
      objects = this.objects;
    }

    if (!filters || filters.length === 0) {
      if (area) return objects;
      const clean: GameObject[] = [];
      for (let i = 0; i < objects.length; i++) {
        const o = objects[i];
        if (o && !o.toRemove) clean.push(o);
      }
      return clean;
    }

    // Hand-rolled instead of `[...filters]` + `.filter(o => resolved.every(f => f(o)))`:
    // that spread built an array, `collideWith(area)` built a closure and the
    // two callbacks built two more — per query, and there are many queries per
    // frame. The collide test stays last, exactly where appending it put it,
    // because `every` short-circuits and the cheap type/team filters should
    // reject before a bounding-box intersect runs.
    const needsCollideCheck = !queryByDisplayBoundingBox;
    const result: GameObject[] = [];
    for (let i = 0; i < objects.length; i++) {
      const object = objects[i];
      if (!object || object.toRemove) continue;
      let passed = true;
      for (let f = 0; f < filters.length; f++) {
        if (!filters[f](object)) {
          passed = false;
          break;
        }
      }
      if (!passed) continue;
      if (needsCollideCheck) {
        // Matches PredefinedFilters.collideWith, including its "no area means
        // nothing matches" answer.
        if (!area) continue;
        if (typeof object.getCollideBoundingBox !== 'function') continue;
        if (!object.getCollideBoundingBox().intersect(area)) continue;
      }
      result.push(object);
    }
    return result;
  }
}
