import { System } from '../../libs/detect-collisions';
import SpellObject from '../gameObject/SpellObject';
import AttackableUnit from '../gameObject/attackableUnits/AttackableUnit';
import CombatText from '../gameObject/helpers/CombatText';
import { Circle, Quadtree, Rectangle } from '../../libs/quadtree';
import TrailSystem from '../gameObject/helpers/TrailSystem';
import ParticleSystem from '../gameObject/helpers/ParticleSystem';
import GameObject from '../gameObject/GameObject';

export type QueryArea = Circle | Rectangle;
export type GameObjectConstructor<T extends GameObject = GameObject> = abstract new (
  ...args: never[]
) => T;
export type GameObjectFilter = (object: GameObject) => boolean;
export type GameObjectTypeGuard<T extends GameObject> = (object: GameObject) => object is T;
export interface ObjectManagerGameContext {
  readonly mapSize: number;
  camera: { getBoundingBox(): Rectangle };
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
  game: ObjectManagerGameContext;

  constructor(game: ObjectManagerGameContext) {
    this.game = game;

    const mapSize = this.game.mapSize;
    this._objectsTree = new Quadtree({
      x: 0,
      y: 0,
      w: mapSize,
      h: mapSize,
      maxObjects: 2,
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

    // update quadtree
    this._objectsTreeIsUpdating = true;
    this._objectsTree.clear();
    for (const o of this.objects) {
      this._objectsTree.insert(o.getDisplayBoundingBox());
    }
    this._objectsTreeIsUpdating = false;
  }

  draw(): void {
    const camBound = this.game.camera.getBoundingBox();
    const objectsInCamera = this.queryObjects({
      queryByDisplayBoundingBox: true,
      area: camBound,
    });

    objectsInCamera.sort((a, b) => zIndexOf(a) - zIndexOf(b));

    for (const o of objectsInCamera) {
      if (o.willDraw) o.draw?.();
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
