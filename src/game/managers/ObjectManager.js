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
  _objectToBeAdded = [];

  _objectQuadtree = null;
  _playerQuadtree = null;

  constructor(game) {
    this.game = game;

    let mapSize = this.game.mapSize;
    this._objectQuadtree = new Quadtree({
      x: 0,
      y: 0,
      w: mapSize,
      h: mapSize,
      maxObjects: 2,
      maxLevels: 4,
    });

    this._playerQuadtree = new Quadtree({
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
    if (this._objectToBeAdded.length > 0) {
      for (let o of this._objectToBeAdded) {
        this.objects.push(o);
        o.onAdded?.();
      }
      this._objectToBeAdded = [];
      this.objects.sort((a, b) => {
        let aZIndex = DisplayZIndex.findLastIndex(t => a instanceof t);
        let bZIndex = DisplayZIndex.findLastIndex(t => b instanceof t);
        return aZIndex - bZIndex;
      });
    }
  }

  draw() {
    for (let o of this.objects) {
      if (o.willDraw) o.draw?.();
    }
  }

  addObject(object) {
    this._objectToBeAdded.push(object);
  }

  removeObject(object) {
    object.toRemove = true;
  }

  queryObjects({ area, filters, debug }) {
    if (this._quadtreeInUpdating) {
      console.warn('Quadtree is updating, this may cause unexpected result.');
    }

    let objects;
    if (area) {
      objects = this._objectQuadtree.retrieve(area).map(r => r.data);
    } else {
      objects = this.objects;
    }

    if (debug) console.log('queryObjects', objects);

    if (!filters || filters.length === 0) {
      return objects;
    }

    return objects.filter(o => filters.every(filter => filter(o)));
  }

  getAllChampions() {
    return this.objects.filter(o => o instanceof AttackableUnit);
  }
}

export const PredefinedFilters = {
  id: id => o => o.id === id,
  type: type => o => o instanceof type,
  teamId: teamId => o => o.teamId === teamId,
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
};
