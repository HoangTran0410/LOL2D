import { Rectangle } from '../../../../libs/quadtree.js';
import SpellObject from '../SpellObject.js';

export default class TrailSystem extends SpellObject {
  trails = [];
  _cachedBB = null;

  constructor({
    maxLength = 15,
    trailColor = '#77F5',
    trailSize = 5,
    trailLifeTime = 500,
    owner,
  } = {}) {
    super(owner);
    this.maxLength = maxLength;
    this.trailColor = trailColor;
    this.trailSize = trailSize;
    this.trailLifeTime = trailLifeTime;
  }

  addTrail(targetVector) {
    if (targetVector) {
      this.trails.push({
        pos: targetVector.copy(),
        lifeSpan: this.trailLifeTime,
      });
      if (this.trails.length > this.maxLength) this.trails.shift();
      this._cachedBB = null; // invalidate cache on add
    }
  }

  update() {
    let i = 0;
    while (i < this.trails.length) {
      this.trails[i].lifeSpan -= deltaTime;
      if (this.trails[i].lifeSpan <= 0) {
        this.trails.splice(i, 1); // remove current, don't advance i
      } else {
        i++;
      }
    }
    this._cachedBB = null; // invalidate cache after update
    if (this.trails.length === 0) this.toRemove = true;
  }

  draw() {
    if (this.trails.length > 0) {
      push();
      noFill();
      stroke(this.trailColor);
      strokeWeight(this.trailSize);
      beginShape();
      for (let trail of this.trails) {
        vertex(trail.pos.x, trail.pos.y);
      }
      endShape();
      pop();
    }
  }

  getDisplayBoundingBox() {
    if (this._cachedBB) return this._cachedBB;

    if (this.trails.length === 0) {
      this._cachedBB = new Rectangle({ x: 0, y: 0, w: 0, h: 0, data: this });
      return this._cachedBB;
    }

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (let trail of this.trails) {
      if (trail.pos.x < minX) minX = trail.pos.x;
      if (trail.pos.y < minY) minY = trail.pos.y;
      if (trail.pos.x > maxX) maxX = trail.pos.x;
      if (trail.pos.y > maxY) maxY = trail.pos.y;
    }

    this._cachedBB = new Rectangle({
      x: minX - this.trailSize / 2,
      y: minY - this.trailSize / 2,
      w: maxX - minX + this.trailSize,
      h: maxY - minY + this.trailSize,
      data: this,
    });
    return this._cachedBB;
  }
}
