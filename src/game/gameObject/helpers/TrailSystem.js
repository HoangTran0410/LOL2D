import { Rectangle } from '../../../../libs/quadtree.js';
import SpellObject from '../SpellObject.js';

export default class TrailSystem extends SpellObject {
  trails = [];

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
    }
  }

  update() {
    for (let i = this.trails.length - 1; i >= 0; i--) {
      this.trails[i].lifeSpan -= deltaTime;
      if (this.trails[i].lifeSpan <= 0) {
        this.trails.splice(i, 1);

        // only check toRemove if there was particle added
        if (this.trails.length === 0) {
          this.toRemove = true;
        }
      }
    }
  }

  draw() {
    if (this.trails.length > 0) {
      push();
      noFill();
      stroke(this.trailColor);
      strokeWeight(this.trailSize);
      beginShape();
      this.trails.forEach(trail => {
        vertex(trail.pos.x, trail.pos.y);
      });
      endShape();
      pop();
    }
  }

  getDisplayBoundingBox() {
    if (this.trails.length === 0) return new Rectangle({ x: 0, y: 0, w: 0, h: 0, data: this });

    let topLeft = {
      x: Infinity,
      y: Infinity,
    };
    let bottomRight = {
      x: -Infinity,
      y: -Infinity,
    };

    for (let trail of this.trails) {
      topLeft.x = min(topLeft.x, trail.pos.x);
      topLeft.y = min(topLeft.y, trail.pos.y);
      bottomRight.x = max(bottomRight.x, trail.pos.x);
      bottomRight.y = max(bottomRight.y, trail.pos.y);
    }

    return new Rectangle({
      x: topLeft.x - this.trailSize / 2,
      y: topLeft.y - this.trailSize / 2,
      w: bottomRight.x - topLeft.x + this.trailSize,
      h: bottomRight.y - topLeft.y + this.trailSize,
      data: this,
    });
  }
}
