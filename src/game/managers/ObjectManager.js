import { System } from '../../../libs/detect-collisions.js';
import SpellObject from '../gameObject/SpellObject.js';
import Champion from '../gameObject/attackableUnits/Champion.js';
import AttackableUnit from '../gameObject/attackableUnits/AttackableUnit.js';
import CombatText from '../gameObject/helpers/CombatText.js';
import { Quadtree } from '../../../libs/quadtree.js';
import TrailSystem from '../gameObject/helpers/TrailSystem.js';
import ParticleSystem from '../gameObject/helpers/ParticleSystem.js';

const DisplayZIndex = [
  //
  TrailSystem,
  ParticleSystem,
  SpellObject,
  AttackableUnit,
  Champion,
  CombatText,
];

// Precompute Z-index map once at startup — avoids O(n) instanceof search per object per frame
const Z_INDEX_MAP = new Map();
DisplayZIndex.forEach((cls, i) => Z_INDEX_MAP.set(cls, i));
const DEFAULT_Z_INDEX = 99;

export default class ObjectManager {
  system = new System();
  objects = [];
  _objectToBeAdd = [];
  _objectsTree = null;
  _objectsTreeIsUpdating = false;
  _deadBuffer = [];

  constructor(game) {
    this.game = game;

    let mapSize = this.game.mapSize;
    this._objectsTree = new Quadtree({
      x: 0,
      y: 0,
      w: mapSize,
      h: mapSize,
      maxObjects: 2,
      maxLevels: 4,
    });

    window.objectManager = this;
  }

  update() {
    // update
    for (let o of this.objects) {
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
      for (let o of this._objectToBeAdd) {
        this.objects.push(o);
        o.onAdded?.();
      }
      this._objectToBeAdd = [];
    }

    // update quadtree
    this._objectsTreeIsUpdating = true;
    this._objectsTree.clear();
    for (let o of this.objects) {
      this._objectsTree.insert(o.getDisplayBoundingBox());
    }
    this._objectsTreeIsUpdating = false;
  }

  draw() {
    let camBound = this.game.camera.getBoundingBox();
    let objectsInCamera = this.queryObjects({
      queryByDisplayBoundingBox: true,
      area: camBound,
    });

    objectsInCamera.sort((a, b) => {
      return (Z_INDEX_MAP.get(a.constructor) ?? DEFAULT_Z_INDEX) -
             (Z_INDEX_MAP.get(b.constructor) ?? DEFAULT_Z_INDEX);
    });

    for (let o of objectsInCamera) {
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

  addObject(object) {
    this._objectToBeAdd.push(object);
  }

  removeObject(object) {
    object.toRemove = true;
  }

  queryObjects({ area, filters, queryByDisplayBoundingBox = false }) {
    if (this._objectsTreeIsUpdating) {
      console.warn('Quadtree is updating, this may cause unexpected result.');
    }

    let objects;
    if (area) {
      objects = this._objectsTree.retrieve(area).map(r => r.data);
    } else {
      objects = this.objects;
    }

    if (!filters || filters.length === 0) {
      return objects;
    }

    if (!queryByDisplayBoundingBox) filters.push(PredefinedFilters.collideWith(area));
    return objects.filter(o => filters.every(filter => filter(o)));
  }
}

export const PredefinedFilters = {
  id: id => o => o.id === id,
  type: type => o => o instanceof type,
  excludeType: type => o => !(o instanceof type),
  teamId: teamId => o => o.teamId === teamId,
  excludeTeamId: teamId => o => o.teamId !== teamId,
  includeTeamIds: teamIds => o => teamIds.some(t => o.teamId === t),
  excludeTeamIds: teamIds => o => !teamIds.some(t => o.teamId === t),
  includeTypes: types => o => types.some(t => o instanceof t),
  excludeTypes: types => o => !types.some(t => o instanceof t),
  excludeObjects: objects => o => !objects.some(e => e === o),
  includeDead: o => o instanceof AttackableUnit && o.isDead,
  excludeDead: o => !(o instanceof AttackableUnit && o.isDead),
  includeUntargetable: o => !o.targetable,
  excludeUntargetable: o => o.targetable,
  attackableUnitInRange:
    (pos, radius, includeSize = false) =>
    o =>
      o instanceof AttackableUnit &&
      p5.Vector.dist(o.position, pos) <= radius + (includeSize ? o.animatedValues.size / 2 : 0),
  collideWith: area => o => {
    if (typeof o.getCollideBoundingBox !== 'function') return false;
    return o.getCollideBoundingBox().intersect(area);
  },
  missileSpellObject: o => o instanceof SpellObject && o.isMissile,
  canTakeDamage: o => o instanceof AttackableUnit && o.targetable && !o.isDead,
  canTakeDamageFromTeam: teamId => o =>
    o instanceof AttackableUnit && o.targetable && !o.isDead && o.teamId !== teamId,
};
