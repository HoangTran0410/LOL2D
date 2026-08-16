import { Rectangle } from '../../../libs/quadtree';
import SpellObject from '../SpellObject';

/**
 * The one-shot ring an area effect leaves behind: expands, fades, gone.
 *
 * Purely cosmetic — the damage has already been applied by the spell that
 * spawned this. It exists because a dozen abilities needed the same three
 * `circle()` calls, and a shared object also keeps them all honest about the
 * radius they actually hit: pass the real one.
 *
 *   const ring = new AoePulse(owner);
 *   ring.position = point.copy();
 *   ring.radius = 200;
 *   ring.color = [255, 180, 80];
 *   game.objectManager.addObject(ring);
 *
 * `anchorToOwner` follows the caster instead of standing still, for a burst
 * that comes off the champion's own body rather than off the ground.
 */
export default class AoePulse extends SpellObject {
  position: p5.Vector = this.owner.position.copy();
  radius = 150;
  lifeTime = 380;
  age = 0;
  color: [number, number, number] = [255, 200, 120];
  /** Rings drawn inside the fading edge. Two reads as a shockwave, one as a puff. */
  rings = 2;
  anchorToOwner = false;
  /** Filled disc under the ring, for a blast rather than an outline. */
  fillAlpha = 45;

  update() {
    if (this.anchorToOwner) this.position = this.owner.position.copy();
    this.age += deltaTime;
    if (this.age >= this.lifeTime) this.toRemove = true;
  }

  draw() {
    const t = constrain(this.age / this.lifeTime, 0, 1);
    const fade = 1 - t;
    const [r, g, b] = this.color;

    push();
    translate(this.position.x, this.position.y);
    noStroke();
    fill(r, g, b, this.fillAlpha * fade);
    circle(0, 0, this.radius * 2 * (0.6 + 0.4 * t));
    noFill();
    for (let i = 0; i < this.rings; i++) {
      const spread = t + i * 0.18;
      if (spread > 1) continue;
      stroke(r, g, b, 220 * (1 - spread));
      strokeWeight(5 * (1 - spread) + 1);
      circle(0, 0, this.radius * 2 * (0.35 + 0.65 * spread));
    }
    pop();
  }

  getDisplayBoundingBox() {
    return new Rectangle({
      x: this.position.x - this.radius,
      y: this.position.y - this.radius,
      w: this.radius * 2,
      h: this.radius * 2,
      data: this,
    });
  }
}
