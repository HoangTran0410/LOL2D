import { System } from '../../../libs/detect-collisions';
import SpellObject from '../gameObject/SpellObject';
import Champion from '../gameObject/attackableUnits/Champion';
import AttackableUnit from '../gameObject/attackableUnits/AttackableUnit';
import CombatText from '../gameObject/helpers/CombatText';
import { Quadtree } from '../../../libs/quadtree';
import TrailSystem from '../gameObject/helpers/TrailSystem';
import ParticleSystem from '../gameObject/helpers/ParticleSystem';

const DisplayZIndex: any[] = [
  //
  TrailSystem,
  ParticleSystem,
  SpellObject,
  AttackableUnit,
  Champion,
  CombatText,
];

// Precompute Z-index map once at startup — avoids O(n) instanceof search per object per frame
const Z_INDEX_MAP = new Map<any, number>();
DisplayZIndex.forEach((cls, i) => Z_INDEX_MAP.set(cls, i));
const DEFAULT_Z_INDEX = 99;

interface QueryOptions {
  area?: any;
  filters?: ((o: any) => boolean)[];
  queryByDisplayBoundingBox?: boolean;
}

export const PredefinedFilters = {
  id: (id: string) => (o: any): boolean => o.id === id,
  type: (type: any) => (o: any): boolean => o instanceof type,
  excludeType: (type: any) => (o: any): boolean => !(o instanceof type),
  teamId: (teamId: number) => (o: any): boolean => o.teamId === teamId,
  excludeTeamId: (teamId: number) => (o: any): boolean => o.teamId !== teamId,
  includeTeamIds: (teamIds: number[]) => (o: any): boolean => teamIds.some((t: number) => o.teamId === t),
  excludeTeamIds: (teamIds: number[]) => (o: any): boolean => !teamIds.some((t: number) => o.teamId === t),
  includeTypes: (types: any[]) => (o: any): boolean => types.some((t: any) => o instanceof t),
  excludeTypes: (types: any[]) => (o: any): boolean => !types.some((t: any) => o instanceof t),
  excludeObjects: (objects: any[]) => (o: any): boolean => !objects.some((e: any) => e === o),
  includeDead: (o: any): boolean => o instanceof AttackableUnit && o.isDead,
  excludeDead: (o: any): boolean => !(o instanceof AttackableUnit && o.isDead),
  includeUntargetable: (o: any): boolean => !o.targetable,
  excludeUntargetable: (o: any): boolean => o.targetable,
  attackableUnitInRange:
    (pos: any, radius: number, includeSize = false) =>
    (o: any): boolean =>
      o instanceof AttackableUnit &&
      (window as any).p5.Vector.dist(o.position, pos) <=
        radius + (includeSize ? o.animatedValues.size / 2 : 0),
  collideWith: (area: any) => (o: any): boolean => {
    if (typeof o.getCollideBoundingBox !== 'function') return false;
    return o.getCollideBoundingBox().intersect(area);
  },
  missileSpellObject: (o: any): boolean => o instanceof SpellObject && o.isMissile,
  canTakeDamage: (o: any): boolean => o instanceof AttackableUnit && o.targetable && !o.isDead,
  canTakeDamageFromTeam: (teamId: any) => (o: any): boolean =>
    o instanceof AttackableUnit && o.targetable && !o.isDead && o.teamId !== teamId,
};

export default class ObjectManager {
  system = new System();
  objects: any[] = [];
  _objectToBeAdd: any[] = [];
  _objectsTree!: Quadtree;
  _objectsTreeIsUpdating = false;
  _deadBuffer: number[] = [];
  game: any;

  constructor(game: any) {
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

    (window as any).objectManager = this;
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

    objectsInCamera.sort((a, b) => {
      return (Z_INDEX_MAP.get(a.constructor) ?? DEFAULT_Z_INDEX) -
             (Z_INDEX_MAP.get(b.constructor) ?? DEFAULT_Z_INDEX);
    });

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

  addObject(object: any): void {
    this._objectToBeAdd.push(object);
  }

  removeObject(object: any): void {
    object.toRemove = true;
  }

  queryObjects({ area, filters, queryByDisplayBoundingBox = false }: QueryOptions): any[] {
    if (this._objectsTreeIsUpdating) {
      console.warn('Quadtree is updating, this may cause unexpected result.');
    }

    let objects: any[];
    if (area) {
      objects = this._objectsTree.retrieve(area).map((r: any) => r.data);
    } else {
      objects = this.objects;
    }

    if (!filters || filters.length === 0) {
      return objects;
    }

    const resolvedFilters = [...filters];
    if (!queryByDisplayBoundingBox) resolvedFilters.push(PredefinedFilters.collideWith(area));
    return objects.filter((o: any) => resolvedFilters.every((filter: (o: any) => boolean) => filter(o)));
  }
}
