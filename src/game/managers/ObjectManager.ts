import { System } from '../../libs/detect-collisions';
import SpellObject from '../gameObject/SpellObject';
import AttackableUnit from '../gameObject/attackableUnits/AttackableUnit';
import CombatText from '../gameObject/helpers/CombatText';
import { Circle, Quadtree, Rectangle } from '../../libs/quadtree';
import TrailSystem from '../gameObject/helpers/TrailSystem';
import ParticleSystem from '../gameObject/helpers/ParticleSystem';
import GameObject from '../gameObject/GameObject';
import UnitCollisionSystem from './UnitCollisionSystem';

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
      : Z_INDEX_MAP.get(constructor) ?? DEFAULT_Z_INDEX;
  return o.zIndex ?? classZIndex;
}

export interface QueryOptions {
  area?: QueryArea;
  filters?: readonly GameObjectFilter[];
  queryByDisplayBoundingBox?: boolean;
}

type GuardedGameObject<TFilter> = TFilter extends GameObjectTypeGuard<infer TObject>
  ? TObject
  : never;
type IntersectGuardedGameObjects<TFilter> = (
  GuardedGameObject<TFilter> extends infer TObject
    ? TObject extends GameObject
      ? (object: TObject) => void
      : never
    : never
) extends (object: infer TIntersection) => void
  ? TIntersection
  : never;
type QueryResult<TFilters extends readonly GameObjectFilter[]> =
  [GuardedGameObject<TFilters[number]>] extends [never]
    ? GameObject
    : IntersectGuardedGameObjects<TFilters[number]>;

export const PredefinedFilters = {
  id: (id: string): GameObjectFilter => (object) => object.id === id,
  type: <T extends GameObject>(type: GameObjectConstructor<T>): GameObjectTypeGuard<T> =>
    (object): object is T => object instanceof type,
  excludeType: (type: GameObjectConstructor): GameObjectFilter => (object) => !(object instanceof type),
  teamId: (teamId: string): GameObjectFilter => (object) => object.teamId === teamId,
  excludeTeamId: (teamId: string): GameObjectFilter => (object) => object.teamId !== teamId,
  includeTeamIds: (teamIds: string[]): GameObjectFilter =>
    (object) => teamIds.some((teamId) => object.teamId === teamId),
  excludeTeamIds: (teamIds: string[]): GameObjectFilter =>
    (object) => !teamIds.some((teamId) => object.teamId === teamId),
  includeTypes: (types: GameObjectConstructor[]): GameObjectFilter =>
    (object) => types.some((type) => object instanceof type),
  excludeTypes: (types: GameObjectConstructor[]): GameObjectFilter =>
    (object) => !types.some((type) => object instanceof type),
  excludeObjects: (objects: GameObject[]): GameObjectFilter =>
    (object) => !objects.some((excluded) => excluded === object),
  includeDead: (object: GameObject): object is AttackableUnit =>
    object instanceof AttackableUnit && object.isDead,
  excludeDead: (object: GameObject): boolean => !(object instanceof AttackableUnit && object.isDead),
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
    (position: p5.Vector, radius: number, includeSize = false): GameObjectTypeGuard<AttackableUnit> =>
    (object): object is AttackableUnit =>
      object instanceof AttackableUnit &&
      p5.Vector.dist(object.position, position) <=
        radius + (includeSize ? object.animatedValues.size / 2 : 0),
  collideWith: (area?: QueryArea): GameObjectFilter => (object) => {
    if (!area) return false;
    if (typeof object.getCollideBoundingBox !== 'function') return false;
    return object.getCollideBoundingBox().intersect(area);
  },
  missileSpellObject: (object: GameObject): object is SpellObject =>
    object instanceof SpellObject && object.isMissile,
  canTakeDamage: (object: GameObject): object is AttackableUnit =>
    object instanceof AttackableUnit && object.targetable && !object.isDead,
  canTakeDamageFromTeam: (teamId: string): GameObjectTypeGuard<AttackableUnit> =>
    (object): object is AttackableUnit =>
      object instanceof AttackableUnit && object.targetable && !object.isDead && object.teamId !== teamId,
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
   * Drops what `observer` cannot see. Bushes were previously cosmetic — the
   * only thing that ever read `isInsideBush` was the sprite's alpha — so a
   * player standing in one was still picked up by every minion and camp scan
   * that came within aggro range, and chased out the other side.
   *
   * The rule is the simple one: a unit inside a bush is hidden from an
   * observer that is not itself in a bush. Two units in *different* bushes can
   * still see each other, which real League would not allow, but
   * `AttackableUnit.isInsideBush` is a boolean rather than a bush identity and
   * the case (a jungler and a laner in adjacent brush) is rare enough not to
   * be worth widening that field for.
   *
   * Deliberately not applied to `AIChampion`'s own target scan: a bot that can
   * be broken line-of-sight with is a difficulty change, not a bug fix, and
   * this is the same reasoning that leaves `AIChampion.aimPoint` alone.
   */
  visibleTo: (observer: { isInsideBush?: boolean }): GameObjectFilter =>
    (object) =>
      !(object instanceof AttackableUnit) || !object.isInsideBush || !!observer.isInsideBush,
};

declare global {
  var objectManager: ObjectManager | undefined;
}

export default class ObjectManager {
  system = new System();
  objects: GameObject[] = [];
  _objectToBeAdd: GameObject[] = [];
  _objectsTree!: Quadtree;
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

    globalThis.objectManager = this;
  }

  update(): void {
    // update
    for (const o of this.objects) {
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
      this._objectToBeAdd = [];
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
    for (const o of this.objects) {
      this._objectsTree.insert(o.getDisplayBoundingBox());
    }
    this._objectsTreeIsUpdating = false;
    this.revision++;
  }

  draw(): void {
    const camBound = this.game.camera.getBoundingBox();
    const objectsInCamera = this.queryObjects({
      queryByDisplayBoundingBox: true,
      area: camBound,
    });

    // Precompute each object's z-index once (zIndexOf does a Map lookup +
    // Object.hasOwn) instead of recomputing it on every comparison the sort
    // makes, then sort the small keyed array and drop the keys.
    const keyed = objectsInCamera.map((o) => ({ o, z: zIndexOf(o) }));
    keyed.sort((a, b) => a.z - b.z);

    const margin = this.game.camera.constantSize?.(ATTACKABLE_DRAW_MARGIN_PX)
      ?? ATTACKABLE_DRAW_MARGIN_PX;
    const visualBound = new Rectangle({
      x: camBound.x - margin,
      y: camBound.y - margin,
      w: camBound.w + margin * 2,
      h: camBound.h + margin * 2,
    });
    const drawables = keyed.filter(({ o }) =>
      o.willDraw &&
      (!(o instanceof AttackableUnit) || o.getCollideBoundingBox().intersect(visualBound))
    );
    let particleCount = 0;
    let attackableCount = 0;
    for (const { o } of drawables) {
      if (o instanceof ParticleSystem) particleCount += o.particles.length;
      if (o instanceof AttackableUnit) attackableCount++;
    }
    const quality = this.game.renderQuality ?? 'auto';
    const automaticCompact = Boolean(
      this.game.touchUi &&
      (this.game.camera.currentScale ?? Infinity) <= MOBILE_COMPACT_UNIT_SCALE &&
      attackableCount >= MOBILE_COMPACT_UNIT_COUNT
    );
    const compactUnits = quality === 'low' || (quality === 'auto' && automaticCompact);
    const particleBudget = quality === 'high'
      ? Infinity
      : quality === 'low' || (compactUnits && drawables.length > MOBILE_CROWDED_DRAWABLE_COUNT)
        ? MOBILE_CROWDED_PARTICLE_DRAW_BUDGET
        : MOBILE_PARTICLE_DRAW_BUDGET;
    const limitParticles = quality === 'low' || (quality === 'auto' && this.game.touchUi);
    const particleScale = limitParticles && particleCount > particleBudget
      ? particleBudget / particleCount
      : 1;

    for (const { o } of drawables) {
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
  queryObjects({
    area,
    filters,
    queryByDisplayBoundingBox = false,
  }: QueryOptions): GameObject[] {
    if (this._objectsTreeIsUpdating) {
      console.warn('Quadtree is updating, this may cause unexpected result.');
    }

    let objects: GameObject[];
    if (area) {
      objects = this._objectsTree.retrieve(area).map((region: GameObjectRegion) => region.data);
    } else {
      objects = this.objects;
    }

    if (!filters || filters.length === 0) {
      return objects;
    }

    const resolvedFilters = [...filters];
    if (!queryByDisplayBoundingBox) resolvedFilters.push(PredefinedFilters.collideWith(area));
    return objects.filter((object) => resolvedFilters.every((filter) => filter(object)));
  }
}
