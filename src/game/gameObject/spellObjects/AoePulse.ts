import { Rectangle } from '../../../libs/quadtree';
import SpellObject from '../SpellObject';

/**
 * The one-shot mark an area effect leaves behind: plays once, fades, gone.
 *
 * Purely cosmetic — the damage has already been applied by the spell that
 * spawned this. It exists because a dozen abilities needed the same expanding
 * shape, and a shared object also keeps them all honest about the radius they
 * actually hit: pass the real one.
 *
 * ## `style` is not decoration
 *
 * The first version of this drew one thing — a ring — and every new area
 * ability got it. Six of them on one screen were indistinguishable: a Nasus
 * ultimate, an Amumu tantrum and an Alistar pulverize all read as "a circle
 * appeared", so a player could not tell from the flash what had just hit them
 * or how far it reached. The styles below are shapes, not palettes: a burst of
 * shards, whipping strips, erupting columns and a cracked crater are told
 * apart at a glance even in the same colour, which a hue change never
 * achieves in a fight.
 *
 *   const ring = new AoePulse(owner);
 *   ring.position = point.copy();
 *   ring.radius = 200;
 *   ring.style = 'shards';
 *   game.objectManager.addObject(ring);
 */
export type AoePulseStyle = 'ring' | 'shards' | 'bandage' | 'columns' | 'crater';

export default class AoePulse extends SpellObject {
  position: p5.Vector = this.owner.position.copy();
  radius = 150;
  lifeTime = 380;
  age = 0;
  color: [number, number, number] = [255, 200, 120];
  style: AoePulseStyle = 'ring';
  /** Rings drawn inside the fading edge, `ring` style only. */
  rings = 2;
  /** How many shards / strips / columns radiate out. */
  spokes = 10;
  anchorToOwner = false;
  /** Filled disc under the shape, for a blast rather than an outline. */
  fillAlpha = 45;
  /** Fixed at construction so a shape does not shimmer between frames. */
  seed = Math.random() * Math.PI * 2;

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

    if (this.style === 'ring') this._drawRing(t, fade, r, g, b);
    else if (this.style === 'shards') this._drawShards(t, fade, r, g, b);
    else if (this.style === 'bandage') this._drawBandage(t, fade, r, g, b);
    else if (this.style === 'columns') this._drawColumns(t, fade, r, g, b);
    else this._drawCrater(t, fade, r, g, b);

    pop();
  }

  /** Concentric shockwave. The plain one — keep it for things that are a wave. */
  _drawRing(t: number, fade: number, r: number, g: number, b: number) {
    noFill();
    for (let i = 0; i < this.rings; i++) {
      const spread = t + i * 0.18;
      if (spread > 1) continue;
      stroke(r, g, b, 220 * (1 - spread));
      strokeWeight(5 * (1 - spread) + 1);
      circle(0, 0, this.radius * 2 * (0.35 + 0.65 * spread));
    }
  }

  /** Rock splinters thrown outward — a ground burst, no ring at all. */
  _drawShards(t: number, fade: number, r: number, g: number, b: number) {
    noStroke();
    const flight = this.radius * (0.25 + 0.85 * t);
    for (let i = 0; i < this.spokes; i++) {
      const a = this.seed + (i / this.spokes) * TWO_PI;
      const d = flight * (0.7 + 0.3 * Math.sin(this.seed + i * 2.4));
      const len = this.radius * 0.22 * fade + 6;
      push();
      translate(cos(a) * d, sin(a) * d);
      rotate(a + t * 1.4);
      fill(r, g, b, 235 * fade);
      triangle(-len * 0.35, -len * 0.3, len, 0, -len * 0.35, len * 0.3);
      pop();
    }
  }

  /** Strips whipping out and curling back — wrappings, not a shockwave. */
  _drawBandage(t: number, fade: number, r: number, g: number, b: number) {
    noFill();
    const reach = this.radius * Math.min(1, t * 1.5);
    for (let i = 0; i < this.spokes; i++) {
      const a = this.seed + (i / this.spokes) * TWO_PI;
      const curl = (i % 2 === 0 ? 1 : -1) * (0.5 + 0.5 * t);
      stroke(r, g, b, 240 * fade);
      strokeWeight(6 * fade + 1.5);
      beginShape();
      for (let k = 0; k <= 6; k++) {
        const p = k / 6;
        const wobble = Math.sin(p * PI * 2 + this.seed + i) * this.radius * 0.09 * p;
        const angle = a + curl * p * 0.55;
        vertex(cos(angle) * reach * p - sin(angle) * wobble, sin(angle) * reach * p + cos(angle) * wobble);
      }
      endShape();
    }
  }

  /** Slabs heaved up out of the ground, tallest at the rim. */
  _drawColumns(t: number, fade: number, r: number, g: number, b: number) {
    const rise = Math.min(1, t * 2.2);
    for (let i = 0; i < this.spokes; i++) {
      const a = this.seed + (i / this.spokes) * TWO_PI;
      const d = this.radius * (0.55 + 0.4 * Math.abs(Math.sin(this.seed + i * 1.7)));
      const w = this.radius * 0.16;
      const h = this.radius * (0.3 + 0.25 * Math.sin(this.seed + i)) * rise * (1 - t * 0.35);
      push();
      translate(cos(a) * d, sin(a) * d);
      rotate(a + HALF_PI);
      noStroke();
      fill(r, g, b, 230 * fade);
      quad(-w / 2, 0, w / 2, 0, w * 0.32, -h, -w * 0.32, -h);
      pop();
    }
    noFill();
    stroke(r, g, b, 150 * fade);
    strokeWeight(3 * fade + 1);
    circle(0, 0, this.radius * 2);
  }

  /** A hole punched in the ground: hard rim, cracks running out of it. */
  _drawCrater(t: number, fade: number, r: number, g: number, b: number) {
    const grow = 0.45 + 0.55 * Math.min(1, t * 1.6);
    noFill();
    stroke(r, g, b, 250 * fade);
    strokeWeight(9 * fade + 2);
    circle(0, 0, this.radius * 2 * grow);
    strokeWeight(2.5 * fade + 1);
    for (let i = 0; i < this.spokes; i++) {
      const a = this.seed + (i / this.spokes) * TWO_PI;
      const inner = this.radius * grow * 0.9;
      const outer = this.radius * grow * (1.05 + 0.28 * Math.abs(Math.sin(this.seed + i * 3.1)));
      const kink = a + 0.14 * Math.sin(this.seed + i);
      line(cos(a) * inner, sin(a) * inner, cos(kink) * outer, sin(kink) * outer);
    }
  }

  getDisplayBoundingBox() {
    // 1.4x the radius: shards and cracks deliberately overshoot the hit circle.
    const span = this.radius * 1.4;
    return new Rectangle({
      x: this.position.x - span,
      y: this.position.y - span,
      w: span * 2,
      h: span * 2,
      data: this,
    });
  }
}
