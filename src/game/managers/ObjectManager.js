import SpellObject from '../gameObject/SpellObject.js';
import Champion from '../gameObject/attackableUnits/Champion.js';
import AttackableUnit from '../gameObject/attackableUnits/AttackableUnit.js';
import CombatText from '../gameObject/helpers/CombatText.js';
import { Quadtree } from '../../../libs/quadtree.js';

const DisplayZIndex = [
  //
  SpellObject,
  AttackableUnit,
  Champion,
  CombatText,
];

export default class ObjectManager {
  objects = [];
  _objectToBeAdd = [];
  _objectQuadtree = null;
  _quadtreeInUpdating = false;

  constructor(game) {
    this.game = game;

    let mapSize = this.game.mapSize;
    this._objectQuadtree = new Quadtree({
      x: 0,
      y: 0,
      w: mapSize,
      h: mapSize,
      maxObjects: 5,
      maxLevels: 4,
    });
  }

  update() {
    // update
    for (let o of this.objects) {
      o.update?.();
    }

    // check remove
    for (let i = this.objects.length - 1; i >= 0; i--) {
      const o = this.objects[i];
      if (o.toRemove) {
        o.onRemoved?.();
        this.objects.splice(i, 1);
      }
    }

    // check add
    if (this._objectToBeAdd.length > 0) {
      for (let o of this._objectToBeAdd) {
        this.objects.push(o);
        o.onAdded?.();
      }
      this._objectToBeAdd = [];
      this.objects.sort((a, b) => {
        let aZIndex = DisplayZIndex.findLastIndex(t => a instanceof t);
        let bZIndex = DisplayZIndex.findLastIndex(t => b instanceof t);
        return aZIndex - bZIndex;
      });
    }

    // update quadtree
    this._quadtreeInUpdating = true;
    this._objectQuadtree.clear();
    for (let o of this.objects) {
      this._objectQuadtree.insert(o.getBoundingBox());
    }
    this._quadtreeInUpdating = false;
  }

  draw() {
    for (let o of this.objects) {
      if (o.willDraw) o.draw?.();
    }
  }

  addObject(object) {
    this._objectToBeAdd.push(object);
  }

  removeObject(object) {
    object.toRemove = true;
  }

  getObjectsByType(type) {
    return this.objects.filter(o => o instanceof type);
  }

  getAllChampions() {
    return this.objects.filter(o => o instanceof AttackableUnit);
  }

  getObjectById(id) {
    return this.objects.find(o => o.id === id);
  }

  // area: Rectangle | Circle | Line
  getObjectInArea(area) {
    if (this._quadtreeInUpdating) {
      console.warn('Quadtree is updating, this may cause unexpected result.');
    }
    return this._objectQuadtree.retrieve(area);
  }

  getObjectsInRange({
    position,
    radius,
    teamIds,
    excludeTeamIds,
    types,
    excludeTypes,
    excludeObjects,
    customFilter,
    maxResults = 0,
  }) {
    const results = [];
    let count = 0;
    for (let i = 0; i < this.objects.length && (maxResults === 0 || count < maxResults); i++) {
      const o = this.objects[i];
      if (o.toRemove) continue;
      if (radius > 0 && position instanceof p5.Vector && o.position.dist(position) > radius)
        continue;
      if (excludeTeamIds?.length > 0 && excludeTeamIds.some(t => o.teamId === t)) continue;
      if (teamIds?.length > 0 && !teamIds.some(t => o.teamId === t)) continue;
      if (excludeTypes?.length > 0 && excludeTypes.some(t => o instanceof t)) continue;
      if (types?.length > 0 && !types.some(t => o instanceof t)) continue;
      if (excludeObjects?.length > 0 && excludeObjects.some(e => e === o)) continue;
      if (typeof customFilter === 'function' && !customFilter(o)) continue;
      results.push(o);
      count++;
    }
    return results;
  }
}
