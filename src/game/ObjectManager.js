export default class ObjectManager {
  objects = {};

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

  addObject(object) {
    this.objects[object.id] = object;
    object.onAdded();
  }

  removeObject(object) {
    object.toRemove = true;
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

  getObjectsInRange({ position, radius, teamId, type, customFilter }) {
    return this.getObjects().filter(o => {
      if (o.toRemove) return false;
      if (teamId && !(o.teamId === teamId)) return false;
      if (type && !(o instanceof type)) return false;
      if (o.position.dist(position) > radius) return false;
      if (typeof customFilter === 'function' && !customFilter(o)) return false;
      return true;
    });
  }

  getAllObjectsForTeam(teamId, objectTypes = []) {
    return this.getObjects().filter(o => {
      if (o.toRemove) return false;
      if (!(o.teamId === teamId)) return false;
      if (objectTypes.length > 0 && !objectTypes.some(t => o instanceof t)) return false;
      return true;
    });
  }
}
