import { Rectangle } from '../../../../libs/quadtree';
import SpellObject from '../SpellObject';

interface TrailParticle {
  pos: p5.Vector;
  lifeSpan: number;
}

interface TrailSystemOptions {
  maxLength?: number;
  trailColor?: string;
  trailSize?: number;
  trailLifeTime?: number;
  owner?: any;
}

export default class TrailSystem extends SpellObject {
  trails: TrailParticle[] = [];
  _cachedBB: Rectangle | null = null;

  maxLength: number;
  trailColor: string;
  trailSize: number;
  trailLifeTime: number;

  constructor(options: TrailSystemOptions = {}) {
    const {
      maxLength = 15,
      trailColor = '#77F5',
      trailSize = 5,
      trailLifeTime = 500,
      owner,
    } = options;

    super(owner);
    this.maxLength = maxLength;
    this.trailColor = trailColor;
    this.trailSize = trailSize;
    this.trailLifeTime = trailLifeTime;
  }

  addTrail(targetVector: p5.Vector | null): void {
    if (targetVector) {
      this.trails.push({
        pos: targetVector.copy(),
        lifeSpan: this.trailLifeTime,
      });
      if (this.trails.length > this.maxLength) this.trails.shift();
      this._cachedBB = null;
    }
  }

  update(): void {
    let i = 0;
    while (i < this.trails.length) {
      this.trails[i].lifeSpan -= deltaTime;
      if (this.trails[i].lifeSpan <= 0) {
        this.trails.splice(i, 1);
      } else {
        i++;
      }
    }
    this._cachedBB = null;
    if (this.trails.length === 0) this.toRemove = true;
  }

  draw(): void {
    if (this.trails.length > 0) {
      push();
      noFill();
      stroke(this.trailColor);
      strokeWeight(this.trailSize);
      beginShape();
      for (const trail of this.trails) {
        vertex(trail.pos.x, trail.pos.y);
      }
      endShape();
      pop();
    }
  }

  getDisplayBoundingBox(): Rectangle {
    if (this._cachedBB) return this._cachedBB;

    if (this.trails.length === 0) {
      this._cachedBB = new Rectangle({ x: 0, y: 0, w: 0, h: 0, data: this });
      return this._cachedBB;
    }

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const trail of this.trails) {
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
