export default class ObjectManager {
  objects = {};
  // _teamIds = new Set();

  constructor(game) {
    this.game = game;
  }

  update() {
    // update
    for (let key in this.objects) {
      this.objects[key].update();
    }

    // check remove
    for (let key in this.objects) {
      if (this.objects[key].toRemove) {
        this.objects[key].onRemoved();
        delete this.objects[key];
      }
    }
  }

  draw() {
    for (let key in this.objects) {
      this.objects[key].draw();
    }
  }

  addObject(object) {
    this.objects[object.id] = object;
    // this._teamIds.add(object.teamId);
    object.onAdded();
  }

  removeObject(object) {
    object.toRemove = true;

    // check remove teamId
    // let hasTeamId = false;
    // for (let key in this.objects) {
    //   if (this.objects[key].teamId === object.teamId) {
    //     hasTeamId = true;
    //     break;
    //   }
    // }
    // if (!hasTeamId) {
    //   this._teamIds.delete(object.teamId);
    // }
  }

  getObjects() {
    return Object.values(this.objects);
  }

  getObjectsByType(type) {
    return this.getObjects().filter(o => o instanceof type);
  }

  getObjectById(id) {
    return this.objects[id];
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
    const objects = this.getObjects();
    const results = [];
    let count = 0;
    for (let i = 0; i < objects.length && (maxResults === 0 || count < maxResults); i++) {
      const o = objects[i];
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

  getAllObjectsForTeam(teamIds, types, customFilter) {
    return this.getObjectsInRange({ teamIds, types, customFilter });
  }
}
