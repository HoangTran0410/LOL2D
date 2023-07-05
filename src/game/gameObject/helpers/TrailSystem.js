export default class TrailSystem {
  trails = [];

  constructor({ maxLength = 15, trailColor = '#77F5', trailSize = 5, trailLifeTime = 500 } = {}) {
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

  draw() {
    if (this.trails.length > 1) {
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

    // update
    this.trails.forEach(trail => {
      trail.lifeSpan -= deltaTime;
    });
    this.trails = this.trails.filter(trail => trail.lifeSpan > 0);
  }
}
