import SpellObject from './gameObject/SpellObject.js';
import Champion from './gameObject/attackableUnits/AI/Champion.js';
import CombatText from './gameObject/helpers/CombatText.js';

const DisplayZIndex = [
  //
  SpellObject,
  Champion,
  CombatText,
];

export default class ObjectManager {
  objects = [];
  _sorted = true;

  constructor(game) {
    this.game = game;
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
        o.onBeforeRemove?.();
        this.objects.splice(i, 1);
      }
    }

    // sort
    if (!this._sorted) {
      this.objects.sort((a, b) => {
        let aZIndex = DisplayZIndex.findIndex(t => a instanceof t);
        let bZIndex = DisplayZIndex.findIndex(t => b instanceof t);
        return aZIndex - bZIndex;
      });
      this._sorted = true;
    }
  }

  draw() {
    for (let o of this.objects) {
      o.draw?.();
    }
  }

  addObject(object) {
    this.objects.push(object);
    object.onAdded?.();
    this._sorted = false;
    // Cannot sort here because it will break the for loop in update()
  }

  removeObject(object) {
    object.toRemove = true;
  }

  getObjectsByType(type) {
    return this.objects.filter(o => o instanceof type);
  }

  getObjectById(id) {
    return this.objects.find(o => o.id === id);
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

  getObjectsWithTypes(types) {
    return this.objects.filter(o => types.some(t => o instanceof t));
  }

  getAllChampions() {
    return this.getObjectsWithTypes([Champion]);
  }
}
