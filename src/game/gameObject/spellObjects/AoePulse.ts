import SpellObject from '@/game/gameObject/SpellObject';

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
 * ability got it. Six of them on one screen were indistinguishable: a
 * stack-consuming ultimate, a knockup tantrum and a stun pulverize all read as "a circle
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
 *
 * ## One style per champion identity, not per shape category
 *
 * `shards` was at one point the impact for five different champions at once,
 * and `columns` for three more — which put the
 * problem back exactly where the styles were invented to solve it. A dash
 * through water and a shotgun blast are not the same event and must not draw
 * the same picture. Adding a style is cheaper than sharing one: if a champion's
 * impact does not have a shape of its own here, give it one.
 */
export type AoePulseStyle =
  | 'ring'
  | 'shards'
  | 'bandage'
  | 'columns'
  | 'crater'
  /** Water thrown up and falling back. */
  | 'splash'
  /** A cone of pellets and muzzle smoke. */
  | 'buckshot'
  /** Tongues of flame licking outward. */
  | 'flame'
  /** Fragmentation — hard chunks plus rolling smoke puffs. */
  | 'frag'
  /** Creeping venom pools and bubbles. */
  | 'venom'
  /** A hoof-strike dust wedge, heavy and low. */
  | 'stomp'
  /** Descending blades of light. */
  | 'blades';

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
    else if (this.style === 'splash') this._drawSplash(t, fade, r, g, b);
    else if (this.style === 'buckshot') this._drawBuckshot(t, fade, r, g, b);
    else if (this.style === 'flame') this._drawFlame(t, fade, r, g, b);
    else if (this.style === 'frag') this._drawFrag(t, fade, r, g, b);
    else if (this.style === 'venom') this._drawVenom(t, fade, r, g, b);
    else if (this.style === 'stomp') this._drawStomp(t, fade, r, g, b);
    else if (this.style === 'blades') this._drawBlades(t, fade, r, g, b);
    else this._drawCrater(t, fade, r, g, b);

    pop();
  }

  /** Droplets thrown up on a parabola and falling back into a puddle. */
  _drawSplash(t: number, fade: number, r: number, g: number, b: number) {
    noStroke();
    for (let i = 0; i < this.spokes; i++) {
      const a = this.seed + (i / this.spokes) * TWO_PI;
      const reach = this.radius * t * (0.75 + 0.3 * Math.sin(this.seed + i * 1.9));
      // up first, then back down — the arc is what separates water from debris
      const lift = Math.sin(constrain(t, 0, 1) * PI) * this.radius * 0.16;
      fill(r, g, b, 235 * fade);
      circle(cos(a) * reach, sin(a) * reach - lift, this.radius * 0.1 * (1 - t * 0.6) + 4);
    }
    // the puddle spreading underneath
    fill(r, g, b, 90 * fade);
    circle(0, 0, this.radius * 2 * (0.4 + 0.6 * t));
    noFill();
    stroke(r, g, b, 220 * fade);
    strokeWeight(4 * fade + 1);
    circle(0, 0, this.radius * 2 * (0.2 + 0.8 * t));
  }

  /** A tight cone of pellets, not a symmetric burst. */
  _drawBuckshot(t: number, fade: number, r: number, g: number, b: number) {
    noStroke();
    const spread = 0.75; // radians, half-angle of the cone
    for (let i = 0; i < this.spokes * 2; i++) {
      const k = i / (this.spokes * 2);
      const a = this.seed + (k - 0.5) * 2 * spread;
      const d = this.radius * t * (0.5 + 0.7 * Math.abs(Math.sin(this.seed + i * 2.7)));
      fill(r, g, b, 240 * fade);
      circle(cos(a) * d, sin(a) * d, this.radius * 0.055 + 2);
    }
    // muzzle smoke hanging at the origin
    fill(r * 0.7, g * 0.7, b * 0.7, 110 * fade);
    for (let i = 0; i < 4; i++) {
      const a = this.seed + i * 1.3;
      circle(
        cos(a) * this.radius * 0.16 * t,
        sin(a) * this.radius * 0.16 * t,
        this.radius * 0.3 * (0.4 + t)
      );
    }
  }

  /** Tongues of flame, licking and tapering rather than flying straight. */
  _drawFlame(t: number, fade: number, r: number, g: number, b: number) {
    noStroke();
    for (let i = 0; i < this.spokes; i++) {
      const a = this.seed + (i / this.spokes) * TWO_PI;
      const reach = this.radius * (0.45 + 0.65 * t) * (0.75 + 0.35 * Math.sin(this.seed + i * 2.1));
      // each tongue is a tapering stack of shrinking blobs, curling as it rises
      for (let k = 0; k < 5; k++) {
        const p = k / 4;
        const curl = a + Math.sin(this.seed + i + p * 2.5) * 0.3 * p;
        fill(r, g * (1 - p * 0.45), b * (1 - p * 0.7), 235 * fade * (1 - p * 0.55));
        circle(
          cos(curl) * reach * p,
          sin(curl) * reach * p,
          this.radius * 0.2 * (1 - p * 0.75) + 4
        );
      }
    }
  }

  /** Hard fragments plus the rolling smoke of an actual explosive. */
  _drawFrag(t: number, fade: number, r: number, g: number, b: number) {
    // smoke first, so the chunks read on top of it
    noStroke();
    for (let i = 0; i < this.spokes; i++) {
      const a = this.seed + (i / this.spokes) * TWO_PI * 1.3;
      const d = this.radius * t * 0.7;
      fill(r * 0.55, g * 0.55, b * 0.6, 100 * fade);
      circle(cos(a) * d, sin(a) * d, this.radius * (0.28 + 0.35 * t));
    }
    for (let i = 0; i < this.spokes; i++) {
      const a = this.seed + (i / this.spokes) * TWO_PI;
      const d = this.radius * (0.2 + 1.0 * t) * (0.7 + 0.4 * Math.sin(this.seed + i * 3.3));
      const s = this.radius * 0.09 * fade + 3;
      push();
      translate(cos(a) * d, sin(a) * d);
      rotate(this.seed + i + t * 6);
      fill(r, g, b, 245 * fade);
      // irregular chunk, not a neat triangle
      quad(-s, -s * 0.6, s * 0.8, -s, s, s * 0.7, -s * 0.5, s);
      pop();
    }
  }

  /** Venom creeping outward in lobes, bubbling as it goes. */
  _drawVenom(t: number, fade: number, r: number, g: number, b: number) {
    // an uneven pool rather than a circle: poison spreads, it does not pulse
    noStroke();
    fill(r, g, b, 120 * fade);
    beginShape();
    const lobes = 18;
    for (let i = 0; i < lobes; i++) {
      const a = (i / lobes) * TWO_PI;
      const wobble =
        1 + 0.18 * Math.sin(this.seed + i * 1.7) + 0.08 * Math.sin(this.seed + i * 4.3);
      const rr = this.radius * (0.35 + 0.65 * t) * wobble;
      vertex(cos(a) * rr, sin(a) * rr);
    }
    endShape(CLOSE);

    // bubbles rising and popping in the pool
    for (let i = 0; i < this.spokes; i++) {
      const a = this.seed + (i / this.spokes) * TWO_PI;
      const d = this.radius * (0.2 + 0.6 * Math.abs(Math.sin(this.seed + i * 2.2))) * (0.4 + t);
      const phase = (t * 2 + i / this.spokes) % 1;
      fill(r, g, b, 220 * fade * (1 - phase));
      circle(cos(a) * d, sin(a) * d, this.radius * 0.1 * (1 - phase) + 3);
    }
  }

  /** A low, heavy dust wedge thrown out under a hoof strike. */
  _drawStomp(t: number, fade: number, r: number, g: number, b: number) {
    // squashed rings: the force goes along the ground, not up
    noFill();
    for (let i = 0; i < 2; i++) {
      const spread = t + i * 0.22;
      if (spread > 1) continue;
      stroke(r, g, b, 230 * (1 - spread));
      strokeWeight(8 * (1 - spread) + 2);
      ellipse(
        0,
        0,
        this.radius * 2 * (0.3 + 0.7 * spread),
        this.radius * 1.15 * (0.3 + 0.7 * spread)
      );
    }
    // dust clods kicked low and outward
    noStroke();
    for (let i = 0; i < this.spokes; i++) {
      const a = this.seed + (i / this.spokes) * TWO_PI;
      const d = this.radius * t * (0.65 + 0.35 * Math.sin(this.seed + i * 1.6));
      fill(r, g, b, 200 * fade);
      ellipse(
        cos(a) * d,
        sin(a) * d * 0.55,
        this.radius * 0.18 * (1 - t * 0.5) + 4,
        this.radius * 0.1 * (1 - t * 0.5) + 3
      );
    }
  }

  /** Blades of light driven down into the ground, point first. */
  _drawBlades(t: number, fade: number, r: number, g: number, b: number) {
    const fall = Math.min(1, t * 2.4);
    for (let i = 0; i < this.spokes; i++) {
      const a = this.seed + (i / this.spokes) * TWO_PI;
      const d = this.radius * (0.35 + 0.5 * Math.abs(Math.sin(this.seed + i * 1.4)));
      const len = this.radius * (0.4 + 0.2 * Math.sin(this.seed + i)) * (1 - t * 0.3);
      // each blade drops from above and plants, so the descent is the animation
      const drop = (1 - fall) * this.radius * 0.9;
      push();
      translate(cos(a) * d, sin(a) * d - drop);
      noStroke();
      fill(r, g, b, 240 * fade);
      // a long tapering blade with a crossguard
      quad(-3, -len, 3, -len, 6, len * 0.2, -6, len * 0.2);
      triangle(-6, len * 0.2, 6, len * 0.2, 0, len * 0.5);
      fill(r, g, b, 200 * fade);
      rectMode(CENTER);
      rect(0, -len * 0.05, 18, 4);
      pop();
    }
    noFill();
    stroke(r, g, b, 170 * fade);
    strokeWeight(3 * fade + 1);
    circle(0, 0, this.radius * 2);
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
        vertex(
          cos(angle) * reach * p - sin(angle) * wobble,
          sin(angle) * reach * p + cos(angle) * wobble
        );
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
    return this.squareDisplayBoundingBox(span * 2);
  }
}
